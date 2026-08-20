#!/usr/bin/env python3
"""Publish Feature 044 notebook(s) + Spec Draft release task from docs/features/044-*.md.

Scope: Live visualization serve performance (RPCs, slim charts, Refresh = blob
re-read, range-keyed cache; browser-direct charts follow-on).
"""

from __future__ import annotations

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
    load_manifest,
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    markdown_to_notebook_html,
    save_manifest,
    sync_notebook,
)

NOTEBOOK_KEY = "feature_044"
NOTEBOOK_TITLE = "Feature 044 - Live visualization serve performance"
NOTEBOOK_DESC = (
    "Faster Live charts and grids: Utilization/RA Postgres RPCs, slim chart "
    "payloads, Refresh re-reads Datastore blobs, range-keyed cache. "
    "Browser-direct chart reads are a follow-on."
)

PLAN_NOTEBOOK_KEY = "feature_044_implementation_plan"
PLAN_NOTEBOOK_TITLE = "Feature 044 - Implementation plan (Live viz serve)"
PLAN_NOTEBOOK_DESC = (
    "Engineering plan for Feature 044 phases A-E: RPCs, slim APIs, Refresh "
    "semantics, fos_viz_range_payloads, optional browser-direct reads."
)

FEATURE_MD = ROOT / "docs/features/044-live-visualization-serve-performance.md"
PLAN_MD = (
    ROOT / "docs/features/044-live-visualization-serve-performance-implementation-plan.md"
)
MANIFEST = ROOT / "docs/teamwork-manifest.json"
TASKLIST_NAME = "Data platform"
RELEASE_TASK_NAME = "Feature 044 - Live visualization serve performance"
FEATURE_ID = "044"

RELEASE_TASK_DESC = """Release type: Enhancement
Feature id: 044
Product version: TBD at ship (do not guess in task title until deploy)
Workflow stage: Spec Draft

**Scope:** Faster Live visualization serve from Datastore:

1. Utilization and Resource assignments Live loads use Postgres RPCs (date-range aggregates), not paging fact tables in Apps Script.
2. Slim chart endpoints so Chart.js can paint before full tables arrive.
3. Panel Refresh re-reads stored panel JSON; ADMIN Pull remains the Fibery hydrate.
4. Range-keyed cache for custom From/To windows.
5. Browser-direct chart reads are a follow-on (Phase E), not in the first ship.

Feature notebook: {notebook_url}
Implementation plan notebook: {plan_notebook_url}
Git feature spec: docs/features/044-live-visualization-serve-performance.md
Git implementation plan: docs/features/044-live-visualization-serve-performance-implementation-plan.md
Workflow: {how_we_work_url}
"""


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
        sync_notebook(key, md_path, description=desc)
        manifest = load_manifest()
        return manifest, str(manifest["notebooks"][key]["url"])

    md = md_path.read_text(encoding="utf-8")
    html = markdown_to_notebook_html(md)
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
    save_manifest(manifest)
    print(f"Created notebook [{key}]: {nb_url}")
    return manifest, nb_url


def update_release_task_description(
    task_id: int,
    *,
    notebook_url: str,
    plan_notebook_url: str,
    manifest: dict,
) -> None:
    desc = RELEASE_TASK_DESC.format(
        notebook_url=notebook_url,
        plan_notebook_url=plan_notebook_url,
        how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
    )
    api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"description": desc}})


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
    if block.endswith("\n"):
        lines.insert(insert_at, block if block.endswith("\n\n") else block + "\n")
    else:
        lines.insert(insert_at, block + "\n")
    return "".join(lines)


def main() -> None:
    if not FEATURE_MD.exists():
        raise SystemExit(f"Missing {FEATURE_MD}")
    if not PLAN_MD.exists():
        raise SystemExit(f"Missing {PLAN_MD}")

    manifest = load_manifest()

    manifest, nb_url = ensure_notebook(
        manifest,
        key=NOTEBOOK_KEY,
        title=NOTEBOOK_TITLE,
        desc=NOTEBOOK_DESC,
        md_path=FEATURE_MD,
        feature_id=FEATURE_ID,
    )

    manifest, plan_url = ensure_notebook(
        manifest,
        key=PLAN_NOTEBOOK_KEY,
        title=PLAN_NOTEBOOK_TITLE,
        desc=PLAN_NOTEBOOK_DESC,
        md_path=PLAN_MD,
        feature_id=FEATURE_ID,
    )

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        desc = RELEASE_TASK_DESC.format(
            notebook_url=nb_url,
            plan_notebook_url=plan_url,
            how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id=FEATURE_ID,
            release_type=RELEASE_TYPE_ENHANCEMENT,
            workflow_stage_id=STAGE_SPEC_DRAFT_ID,
            manifest=manifest,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": FEATURE_ID,
            "releaseType": "Enhancement",
            "releaseTitle": "Live visualization serve performance",
            "provisionalTaskName": True,
            "shippedVersion": None,
            "notebookKey": NOTEBOOK_KEY,
            "implementationPlanNotebookKey": PLAN_NOTEBOOK_KEY,
            "url": release_task_url,
            "renameAtShip": "v{FOS_PRD_VERSION} - Live visualization serve performance",
            "workflowStage": "Spec Draft",
            "createdAt": date.today().isoformat(),
        }
        print(f"Created release task: {release_task_url}")
    else:
        release_task_url = manifest["tasks"][task_key]["url"]
        task_id = int(manifest["tasks"][task_key]["id"])
        update_release_task_description(
            task_id,
            notebook_url=nb_url,
            plan_notebook_url=plan_url,
            manifest=manifest,
        )
        print(f"Release task exists: {release_task_url}")

    stage = get_task_workflow_stage(task_id)
    print(
        f"Release task workflow stage id: {stage} "
        f"(Spec Draft = {STAGE_SPEC_DRAFT_ID})"
    )

    feature_md = FEATURE_MD.read_text(encoding="utf-8")
    replacement_block = (
        f"> **Teamwork notebook:** [{NOTEBOOK_TITLE}]({nb_url})  \n"
        f"> **Implementation plan notebook:** [{PLAN_NOTEBOOK_TITLE}]({plan_url})  \n"
        f"> **Release task:** [{RELEASE_TASK_NAME}]({release_task_url})\n"
    )
    if "> **Teamwork notebook:**" not in feature_md:
        FEATURE_MD.write_text(
            insert_blockquote_after_first_group(feature_md, replacement_block),
            encoding="utf-8",
        )
        sync_notebook(NOTEBOOK_KEY, FEATURE_MD, description=NOTEBOOK_DESC)
        disk = load_manifest()
        manifest["notebooks"] = disk.get("notebooks", manifest.get("notebooks", {}))
        print("Updated feature md Teamwork links and re-synced notebook")
    else:
        print("Feature md already has Teamwork links")

    plan_md = PLAN_MD.read_text(encoding="utf-8")
    plan_links = (
        f"> **Teamwork notebook:** [{PLAN_NOTEBOOK_TITLE}]({plan_url})  \n"
        f"> **Feature notebook:** [{NOTEBOOK_TITLE}]({nb_url})  \n"
        f"> **Release task:** [{RELEASE_TASK_NAME}]({release_task_url})\n"
    )
    if "> **Teamwork notebook:**" not in plan_md:
        PLAN_MD.write_text(
            insert_blockquote_after_first_group(plan_md, plan_links),
            encoding="utf-8",
        )
        sync_notebook(PLAN_NOTEBOOK_KEY, PLAN_MD, description=PLAN_NOTEBOOK_DESC)
        disk = load_manifest()
        manifest["notebooks"] = disk.get("notebooks", manifest.get("notebooks", {}))
        print("Updated plan md Teamwork links and re-synced notebook")

    save_manifest(manifest)
    print(f"Updated {MANIFEST}")
    print(nb_url)
    print(plan_url)
    print(release_task_url)


if __name__ == "__main__":
    main()
