#!/usr/bin/env python3
"""Publish Feature 045 + 046 notebooks and Spec Draft release tasks.

Inbox sources (Jess, 2026-08-20):
- 045: https://win.godeap.io/app/tasks/40850291
- 046: https://win.godeap.io/app/tasks/40850310
"""

from __future__ import annotations

import base64
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import PROJECT_ID, api, notebook_url  # noqa: E402
from teamwork_intake import (  # noqa: E402
    RELEASE_TYPE_ENHANCEMENT,
    STAGE_SPEC_DRAFT_ID,
    create_release_task,
    get_task_workflow_stage,
    link_inbox_task,
    load_manifest,
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    markdown_to_notebook_html,
    save_manifest,
    sync_notebook,
)

DELIVERY_TASKLIST_NAME = "Delivery"
HOW_WE_WORK_KEY = "how_we_work"

FEATURES = [
    {
        "id": "045",
        "notebook_key": "feature_045",
        "notebook_title": "Feature 045 - PM Overview resource time-entry drill-down",
        "notebook_desc": (
            "PM Overview Project Performance: click a resource row to see that "
            "person's logged time on the project by day (including orange unallocated rows)."
        ),
        "md": ROOT / "docs/features/045-pm-overview-resource-time-entries.md",
        "task_name": "Feature 045 - PM Overview resource time-entry drill-down",
        "release_title": "PM Overview resource time-entry drill-down",
        "inbox_task_id": 40850291,
        "scope": """**Scope:** PM Overview -> Project Performance resource table:

1. Click / tap a resource row (including orange unallocated people) to open a modal.
2. Modal lists that person's logged days and hours on this project in the active date range.
3. Same path for allocated (white) people; empty state when no time is logged.
4. Mobile: tap a resource card for the same daily list.

**Review with Jess:** especially whether Clockify task/notes belong in v1 (decision 11).""",
    },
    {
        "id": "046",
        "notebook_key": "feature_046",
        "notebook_title": "Feature 046 - Hide planned margins without a resource plan",
        "notebook_desc": (
            "On Project Performance, hide planned and projected margin when there is "
            "no resource plan, and explain that no plan is available to use."
        ),
        "md": ROOT / "docs/features/046-planned-margins-require-resource-plan.md",
        "task_name": "Feature 046 - Hide planned margins without a resource plan",
        "release_title": "Hide planned margins without a resource plan",
        "inbox_task_id": 40850310,
        "scope": """**Scope:** PM Overview -> Project Performance when there is no resource plan:

1. Planned margin and Projected margin show N/A + No plan available (not a Target Margin %).
2. Empty-state copy explains planned margins are hidden because no plan is available.
3. Actual margin to date stays visible.
4. EAC hide vs actuals-only and top-strip Margin vs target are open review items.

**Review with Jess:** decisions 1 (what counts as a plan), 4 (EAC), and 7 (header Margin vs target).""",
    },
]


def create_notebook_html_direct(title: str, desc: str, html: str) -> int:
    res = api(
        "POST",
        f"/projects/{PROJECT_ID}/notebooks.json",
        {
            "notebook": {
                "name": title,
                "description": desc,
                "content": html,
                "content-type": "HTML",
            }
        },
    )
    return int(res.get("notebookId") or res.get("id"))


def embed_local_images_in_html(html: str, md_path: Path) -> str:
    """Turn leftover ![alt](relative) markdown in HTML into inline images."""

    def repl(match: re.Match[str]) -> str:
        alt = match.group(1)
        rel = match.group(2)
        if rel.startswith("http"):
            return match.group(0)
        img_path = (md_path.parent / rel).resolve()
        if not img_path.exists():
            return match.group(0)
        mime = "image/png" if img_path.suffix.lower() == ".png" else "image/jpeg"
        b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
        safe_alt = alt.replace('"', "&quot;")
        return (
            f'<p><img alt="{safe_alt}" src="data:{mime};base64,{b64}" '
            f'style="max-width:100%;height:auto;border:1px solid #ddd"/></p>'
        )

    return re.sub(
        r"<p>!\[([^\]]*)\]\(([^)]+)\)</p>",
        repl,
        html,
    )


def feature_html(md_path: Path) -> str:
    md = md_path.read_text(encoding="utf-8")
    html = markdown_to_notebook_html(md)
    return embed_local_images_in_html(html, md_path)


def ensure_notebook(
    manifest: dict,
    *,
    key: str,
    title: str,
    desc: str,
    md_path: Path,
    feature_id: str,
) -> tuple[dict, str]:
    nb_entry = manifest.get("notebooks", {}).get(key)
    if nb_entry:
        html = feature_html(md_path)
        from teamwork_sync_notebook import update_notebook  # noqa: PLC0415

        update_notebook(int(nb_entry["id"]), content=html, description=desc)
        nb_entry["lastSyncedAt"] = date.today().isoformat()
        print(f"Synced notebook [{key}]: {nb_entry['url']}")
        return manifest, str(nb_entry["url"])

    html = feature_html(md_path)
    nb_id = create_notebook_html_direct(title, desc, html)
    nb_url = notebook_url(nb_id)
    manifest.setdefault("notebooks", {})[key] = {
        "id": nb_id,
        "title": title,
        "url": nb_url,
        "featureId": feature_id,
        "publishedAt": date.today().isoformat(),
        "lastSyncedAt": date.today().isoformat(),
        "gitMirror": str(md_path.relative_to(ROOT)).replace("\\", "/"),
    }
    print(f"Created notebook [{key}]: {nb_url}")
    return manifest, nb_url


def insert_blockquote_after_first_group(md: str, block: str) -> str:
    lines = md.splitlines(keepends=True)
    insert_at = 0
    for i, line in enumerate(lines):
        if (
            line.startswith("> **")
            and i + 1 < len(lines)
            and not lines[i + 1].startswith("> **")
        ):
            insert_at = i + 1
            break
    if not insert_at:
        return md
    if not block.endswith("\n"):
        block += "\n"
    lines.insert(insert_at, block)
    return "".join(lines)


def release_task_description(
    feat: dict,
    *,
    notebook_url: str,
    inbox_url: str,
    how_we_work_url: str,
) -> str:
    return f"""Release type: Enhancement
Feature id: {feat["id"]}
Product version: TBD at ship (do not guess in task title until deploy)
Workflow stage: Spec Draft

**Inbox source:** {inbox_url}

{feat["scope"]}

Feature notebook: {notebook_url}
Git feature spec: {feat["md"].relative_to(ROOT).as_posix()}
Workflow: {how_we_work_url}
"""


def ensure_release_task(
    manifest: dict,
    feat: dict,
    *,
    notebook_url: str,
    inbox_url: str,
    how_we_work_url: str,
) -> tuple[int, str]:
    task_key = feat["task_name"]
    desc = release_task_description(
        feat,
        notebook_url=notebook_url,
        inbox_url=inbox_url,
        how_we_work_url=how_we_work_url,
    )
    existing = manifest.get("tasks", {}).get(task_key)
    if existing:
        task_id = int(existing["id"])
        api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"description": desc}})
        url = existing.get("url") or task_url(task_id)
        print(f"Updated release task: {url}")
        return task_id, url

    tl_id = int(manifest["tasklists"][DELIVERY_TASKLIST_NAME]["id"])
    task_id = create_release_task(
        tl_id,
        feat["task_name"],
        desc,
        feature_id=feat["id"],
        release_type=RELEASE_TYPE_ENHANCEMENT,
        workflow_stage_id=STAGE_SPEC_DRAFT_ID,
        manifest=manifest,
    )
    url = task_url(task_id)
    stage = get_task_workflow_stage(task_id)
    print(f"Created release task {task_id} stage {stage}: {url}")
    manifest.setdefault("tasks", {})[task_key] = {
        "id": task_id,
        "url": url,
        "featureId": feat["id"],
        "releaseType": "Enhancement",
        "releaseTitle": feat["release_title"],
        "provisionalTaskName": True,
        "shippedVersion": None,
        "tasklist": DELIVERY_TASKLIST_NAME,
        "tasklistId": tl_id,
        "notebookKey": feat["notebook_key"],
        "intakeTaskId": feat["inbox_task_id"],
        "inboxTaskUrl": inbox_url,
        "workflowStage": "Spec Draft",
        "createdAt": date.today().isoformat(),
        "renameAtShip": f"v{{FOS_PRD_VERSION}} - {feat['release_title']}",
    }
    return task_id, url


def update_feature_md_links(
    feat: dict,
    *,
    notebook_title: str,
    notebook_url: str,
    release_task_name: str,
    release_task_url: str,
) -> None:
    md_path: Path = feat["md"]
    md = md_path.read_text(encoding="utf-8")
    replacement = (
        f"> **Teamwork notebook:** [{notebook_title}]({notebook_url})  \n"
        f"> **Release task:** [{release_task_name}]({release_task_url})\n"
    )
    if "> **Teamwork notebook:**" in md:
        print(f"{md_path.name} already has Teamwork links")
        return
    md = md.replace(
        "> **Teamwork:** Notebook + release task not published yet (create after this RD is approved).  \n",
        replacement,
    )
    if "> **Teamwork notebook:**" not in md:
        md = insert_blockquote_after_first_group(md, replacement)
    if "## Change requests" not in md:
        md = md.rstrip() + (
            "\n\n## Change requests\n\n"
            "(Post-approval customer edits only; merge into the main body at ship.)\n"
        )
    md_path.write_text(md, encoding="utf-8")
    print(f"Updated {md_path.name} Teamwork links")


def main() -> None:
    for feat in FEATURES:
        if not feat["md"].exists():
            raise SystemExit(f"Missing {feat['md']}")

    manifest = load_manifest()
    how = manifest["notebooks"][HOW_WE_WORK_KEY]["url"]

    for feat in FEATURES:
        inbox_url = task_url(feat["inbox_task_id"])
        manifest, nb_url = ensure_notebook(
            manifest,
            key=feat["notebook_key"],
            title=feat["notebook_title"],
            desc=feat["notebook_desc"],
            md_path=feat["md"],
            feature_id=feat["id"],
        )
        task_id, release_url = ensure_release_task(
            manifest,
            feat,
            notebook_url=nb_url,
            inbox_url=inbox_url,
            how_we_work_url=how,
        )
        link_inbox_task(feat["inbox_task_id"], nb_url, release_url)
        print(f"Linked inbox {feat['inbox_task_id']} -> {release_url}")

        update_feature_md_links(
            feat,
            notebook_title=feat["notebook_title"],
            notebook_url=nb_url,
            release_task_name=feat["task_name"],
            release_task_url=release_url,
        )
        # Re-sync notebook so Teamwork includes the live notebook/task URLs.
        html = feature_html(feat["md"])
        from teamwork_sync_notebook import update_notebook  # noqa: PLC0415

        nb_id = int(manifest["notebooks"][feat["notebook_key"]]["id"])
        update_notebook(nb_id, content=html, description=feat["notebook_desc"])
        manifest["notebooks"][feat["notebook_key"]]["lastSyncedAt"] = date.today().isoformat()
        print(f"Re-synced notebook {feat['id']} after git link update")

        stage = get_task_workflow_stage(task_id)
        print(f"Feature {feat['id']} workflow stage id: {stage} (Spec Draft = {STAGE_SPEC_DRAFT_ID})")
        print(nb_url)
        print(release_url)

    save_manifest(manifest)
    print(f"Updated {ROOT / 'docs/teamwork-manifest.json'}")


if __name__ == "__main__":
    main()
