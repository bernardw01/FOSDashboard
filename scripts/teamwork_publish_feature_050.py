#!/usr/bin/env python3
"""Publish Feature 050 notebook and Spec Draft release task.

Inbox source (Jess, 2026-08-25):
https://win.godeap.io/app/tasks/40880310
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
    update_notebook,
)

FEATURE_ID = "050"
RELEASE_TITLE = "PM Overview perf allocation drill-down"
TASK_NAME = f"Feature {FEATURE_ID} - {RELEASE_TITLE}"
NOTEBOOK_KEY = "feature_050"
NOTEBOOK_TITLE = (
    "Feature 050 - PM Overview perf allocation info on Project Performance drill-down"
)
NOTEBOOK_DESC = (
    "Extend the Project Performance person drill-down (045) with Fibery resource "
    "allocation rows (duration, Allocated & Billable, % allocation, role) so PMs "
    "can see why a row is orange."
)
TASKLIST_NAME = "Delivery"
INBOX_TASK_ID = 40880310
INBOX_FILE_ID = 8358786
MD_PATH = ROOT / "docs/features/050-pm-overview-perf-allocation-drilldown.md"
HOW_WE_WORK_KEY = "how_we_work"

SCOPE = """**Scope:** PM Overview → Project Performance → person time-entry modal (feature **045**):

1. Compact **Resource allocation** summary in the modal header (under subtitle).
2. List all matching allocation rows: **Duration**, **Allocated & Billable**, **% allocation**, **Role on SOW** (Fibery field).
3. **N/A** for Role on SOW when no allocation or not Allocated & Billable.
4. Daily logged time unchanged from **045**; PP date range filters logged time only (not allocation rows).
5. Add `roleOnSow` to `assignments[]`; bump Delivery P&L cache schema.
6. Mobile: same modal pattern.

**Jess approved 2026-08-28** (notebook comments). Nice-to-have: orange daily rows outside allocation duration (deferred)."""


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
    """Embed local feature-spec images as data URLs in notebook HTML."""

    def img_tag(alt: str, rel: str) -> str:
        if rel.startswith("http"):
            return f'<p><img alt="{alt}" src="{rel}" style="max-width:100%;height:auto;border:1px solid #ddd"/></p>'
        img_path = (md_path.parent / rel).resolve()
        if not img_path.exists():
            return f"<p>![{alt}]({rel})</p>"
        mime = "image/png" if img_path.suffix.lower() == ".png" else "image/jpeg"
        b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
        safe_alt = alt.replace('"', "&quot;")
        return (
            f'<p><img alt="{safe_alt}" src="data:{mime};base64,{b64}" '
            f'style="max-width:100%;height:auto;border:1px solid #ddd"/></p>'
        )

    def repl_md(match: re.Match[str]) -> str:
        return img_tag(match.group(1), match.group(2))

    def repl_broken_link(match: re.Match[str]) -> str:
        return img_tag(match.group(2), match.group(1))

    html = re.sub(
        r"<p>!\[([^\]]*)\]\(([^)]+)\)</p>",
        repl_md,
        html,
    )
    html = re.sub(
        r'<p>!<a href="([^"]+)">([^<]*)</a></p>',
        repl_broken_link,
        html,
    )
    return html


def inject_inbox_screenshot(html: str) -> str:
    """Use the inbox task file URL in the notebook (Teamwork strips data: URIs)."""
    file_meta = api("GET", f"/projects/api/v3/files/{INBOX_FILE_ID}.json")["file"]
    img_url = file_meta.get("thumbURL") or file_meta.get("previewURL") or ""
    if not img_url:
        return html
    alt = (
        "Inbox screenshot — Project Performance drill-down for jack vessa shows "
        "daily time and orange banner but no allocation rows"
    )
    safe_alt = alt.replace('"', "&quot;")
    img_html = (
        f'<p><a href="{task_url(INBOX_TASK_ID)}">Inbox attachment (full size)</a></p>'
        f'<p><img alt="{safe_alt}" src="{img_url}" '
        f'style="max-width:100%;height:auto;border:1px solid #ddd"/></p>'
    )
    patterns = [
        r'<p>!\[([^\]]*)\]\(([^)]+)\)</p>',
        r'<p>!<a href="[^"]*050-inbox-40880310[^"]*">[^<]*</a></p>',
        r'<p><img alt="[^"]*" src="data:image[^"]*"[^/]*/></p>',
    ]
    for pattern in patterns:
        if re.search(pattern, html):
            html = re.sub(pattern, img_html, html, count=1)
            return html
    return html + "\n" + img_html


def feature_html(md_path: Path) -> str:
    md = md_path.read_text(encoding="utf-8")
    html = markdown_to_notebook_html(md)
    html = embed_local_images_in_html(html, md_path)
    return inject_inbox_screenshot(html)


def ensure_notebook(manifest: dict) -> tuple[dict, str]:
    nb_entry = manifest.get("notebooks", {}).get(NOTEBOOK_KEY)
    html = feature_html(MD_PATH)
    if nb_entry:
        update_notebook(int(nb_entry["id"]), content=html, description=NOTEBOOK_DESC)
        nb_entry["lastSyncedAt"] = date.today().isoformat()
        print(f"Synced notebook [{NOTEBOOK_KEY}]: {nb_entry['url']}")
        return manifest, str(nb_entry["url"])

    nb_id = create_notebook_html_direct(NOTEBOOK_TITLE, NOTEBOOK_DESC, html)
    nb_url = notebook_url(nb_id)
    manifest.setdefault("notebooks", {})[NOTEBOOK_KEY] = {
        "id": nb_id,
        "title": NOTEBOOK_TITLE,
        "url": nb_url,
        "featureId": FEATURE_ID,
        "intakeTaskId": INBOX_TASK_ID,
        "publishedAt": date.today().isoformat(),
        "lastSyncedAt": date.today().isoformat(),
        "gitMirror": str(MD_PATH.relative_to(ROOT)).replace("\\", "/"),
    }
    print(f"Created notebook [{NOTEBOOK_KEY}]: {nb_url}")
    return manifest, nb_url


def release_task_description(*, notebook_url: str, inbox_url: str, how_we_work_url: str) -> str:
    return f"""Release type: Enhancement
Feature id: {FEATURE_ID}
Product version: TBD at ship (do not guess in task title until deploy)
Workflow stage: Spec Approved

**Inbox source:** {inbox_url}

{SCOPE}

Feature notebook: {notebook_url}
Git feature spec: {MD_PATH.relative_to(ROOT).as_posix()}
Workflow: {how_we_work_url}
"""


def find_release_task_for_feature_(manifest: dict, feature_id: str) -> dict | None:
    """Return manifest task entry for feature_id (provisional or shipped name)."""
    fid = str(feature_id).zfill(3)
    for entry in manifest.get("tasks", {}).values():
        if str(entry.get("featureId", "")).zfill(3) == fid:
            return entry
    return None


def ensure_release_task(
    manifest: dict, *, notebook_url: str, inbox_url: str, how_we_work_url: str
) -> tuple[int, str]:
    desc = release_task_description(
        notebook_url=notebook_url,
        inbox_url=inbox_url,
        how_we_work_url=how_we_work_url,
    )
    existing = manifest.get("tasks", {}).get(TASK_NAME) or find_release_task_for_feature_(
        manifest, FEATURE_ID
    )
    if existing:
        task_id = int(existing["id"])
        api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"description": desc}})
        url = existing.get("url") or task_url(task_id)
        print(f"Updated release task: {url}")
        return task_id, url

    tl_id = int(manifest["tasklists"][TASKLIST_NAME]["id"])
    task_id = create_release_task(
        tl_id,
        TASK_NAME,
        desc,
        feature_id=FEATURE_ID,
        release_type=RELEASE_TYPE_ENHANCEMENT,
        workflow_stage_id=STAGE_SPEC_DRAFT_ID,
        manifest=manifest,
    )
    url = task_url(task_id)
    stage = get_task_workflow_stage(task_id)
    print(f"Created release task {task_id} stage {stage}: {url}")
    manifest.setdefault("tasks", {})[TASK_NAME] = {
        "id": task_id,
        "url": url,
        "featureId": FEATURE_ID,
        "releaseType": "Enhancement",
        "releaseTitle": RELEASE_TITLE,
        "provisionalTaskName": True,
        "shippedVersion": None,
        "tasklist": TASKLIST_NAME,
        "tasklistId": tl_id,
        "notebookKey": NOTEBOOK_KEY,
        "intakeTaskId": INBOX_TASK_ID,
        "inboxTaskUrl": inbox_url,
        "workflowStage": "Spec Draft",
        "createdAt": date.today().isoformat(),
        "renameAtShip": f"v{{FOS_PRD_VERSION}} - {RELEASE_TITLE}",
    }
    return task_id, url


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


def update_feature_md_links(*, notebook_url: str, release_task_url: str) -> None:
    md = MD_PATH.read_text(encoding="utf-8")
    replacement = (
        f"> **Teamwork notebook:** [{NOTEBOOK_TITLE}]({notebook_url})  \n"
        f"> **Release task:** [{TASK_NAME}]({release_task_url})\n"
    )
    if "> **Teamwork notebook:**" in md and "not published yet" not in md:
        print(f"{MD_PATH.name} already has Teamwork links")
        return
    md = md.replace(
        "> **Teamwork:** Notebook + release task not published yet (create after this RD is approved).  \n",
        replacement,
    )
    if "> **Teamwork notebook:**" not in md:
        md = insert_blockquote_after_first_group(md, replacement)
    MD_PATH.write_text(md, encoding="utf-8")
    print(f"Updated {MD_PATH.name} Teamwork links")


def main() -> None:
    if not MD_PATH.exists():
        raise SystemExit(f"Missing {MD_PATH}")

    manifest = load_manifest()
    how = manifest["notebooks"][HOW_WE_WORK_KEY]["url"]
    inbox_url = task_url(INBOX_TASK_ID)

    manifest, nb_url = ensure_notebook(manifest)
    task_id, release_url = ensure_release_task(
        manifest,
        notebook_url=nb_url,
        inbox_url=inbox_url,
        how_we_work_url=how,
    )
    link_inbox_task(INBOX_TASK_ID, nb_url, release_url)
    print(f"Linked inbox {INBOX_TASK_ID} -> {release_url}")

    update_feature_md_links(notebook_url=nb_url, release_task_url=release_url)

    html = feature_html(MD_PATH)
    nb_id = int(manifest["notebooks"][NOTEBOOK_KEY]["id"])
    update_notebook(nb_id, content=html, description=NOTEBOOK_DESC)
    manifest["notebooks"][NOTEBOOK_KEY]["lastSyncedAt"] = date.today().isoformat()
    print("Re-synced notebook after git link update")

    save_manifest(manifest)
    stage = get_task_workflow_stage(task_id)
    print(f"Feature {FEATURE_ID} workflow stage id: {stage} (Spec Draft = {STAGE_SPEC_DRAFT_ID})")
    print(nb_url)
    print(release_url)
    print(f"Updated {ROOT / 'docs/teamwork-manifest.json'}")


if __name__ == "__main__":
    main()
