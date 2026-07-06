#!/usr/bin/env python3
"""Publish Feature 030 notebook + release task (Spec Draft) from docs/features/030-*.md."""

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
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    load_manifest,
    markdown_to_notebook_html,
    save_manifest,
    sync_notebook,
)

NOTEBOOK_KEY = "feature_030"
NOTEBOOK_TITLE = "Feature 030 - Sales OS pipeline"
NOTEBOOK_DESC = (
    "Merge Opportunity Tracker spreadsheet with Fibery HubSpot deals; sheet wins "
    "stage/ACV with delta asterisks; five Sales OS views; HubSpot pipeline chips; "
    "cacheSchemaVersion 3. Shipped v2.21.0–2.21.3."
)
FEATURE_MD = ROOT / "docs/features/030-sales-os-pipeline.md"
MANIFEST = ROOT / "docs/teamwork-manifest.json"
TASKLIST_NAME = "Sales"
RELEASE_TASK_NAME = "Feature 030 - Sales OS pipeline"

RELEASE_TASK_DESC = """Release type: Enhancement
Feature id: 030
Product version: **2.21.3** (shipped; rename task at formal ship ritual)

**Scope:** Sales Pipeline panel aligned with sales team Sales OS workflow.

**Shipped releases:**
- **v2.21.0** — Spreadsheet + HubSpot merge, five views, delta asterisks, cache schema 3
- **v2.21.1** — Resizable deal table columns with wrapped text
- **v2.21.2** — July mockup alignment; Next Step/Notes after Stage
- **v2.21.3** — Deals-by-stage collapsed by default; One Line Read shown once

Notebook: {notebook_url}
Git spec: docs/features/030-sales-os-pipeline.md
Extends Feature 016: {parent_016_url}
Workflow: {how_we_work_url}
"""


def create_notebook_html_direct(title: str, desc: str, html: str) -> int:
    res = api(
        "POST",
        f"/projects/{PROJECT_ID}/notebooks.json",
        {"notebook": {"title": title, "description": desc, "contents": html}},
    )
    nb_id = int(res["notebookId"])
    return nb_id


def update_release_task_description(
    task_id: int,
    *,
    notebook_url: str,
    manifest: dict,
) -> None:
    parent_016 = manifest.get("notebooks", {}).get("feature_016", {})
    desc = RELEASE_TASK_DESC.format(
        notebook_url=notebook_url,
        parent_016_url=parent_016.get("url", "(Feature 016 pipeline dashboard)"),
        how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
    )
    api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"description": desc}})


def main() -> None:
    if not FEATURE_MD.exists():
        raise SystemExit(f"Missing {FEATURE_MD}")

    manifest = load_manifest()

    nb_entry = manifest.get("notebooks", {}).get(NOTEBOOK_KEY)
    if nb_entry:
        sync_notebook(NOTEBOOK_KEY, FEATURE_MD, description=NOTEBOOK_DESC)
        manifest = load_manifest()
        nb_url = manifest["notebooks"][NOTEBOOK_KEY]["url"]
        print(f"Synced notebook: {nb_url}")
    else:
        md = FEATURE_MD.read_text(encoding="utf-8")
        html = markdown_to_notebook_html(md)
        nb_id = create_notebook_html_direct(NOTEBOOK_TITLE, NOTEBOOK_DESC, html)
        nb_url = notebook_url(nb_id)
        manifest.setdefault("notebooks", {})[NOTEBOOK_KEY] = {
            "id": nb_id,
            "title": NOTEBOOK_TITLE,
            "url": nb_url,
            "featureId": "030",
            "publishedAt": date.today().isoformat(),
        }
        print(f"Created notebook: {nb_url}")

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        parent_016 = manifest.get("notebooks", {}).get("feature_016", {})
        desc = RELEASE_TASK_DESC.format(
            notebook_url=nb_url,
            parent_016_url=parent_016.get("url", "(Feature 016 pipeline dashboard)"),
            how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id="030",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            workflow_stage_id=STAGE_SPEC_DRAFT_ID,
            manifest=manifest,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": "030",
            "releaseType": "Enhancement",
            "releaseTitle": "Sales OS pipeline",
            "provisionalTaskName": True,
            "shippedVersion": None,
            "notebookKey": NOTEBOOK_KEY,
            "url": release_task_url,
            "renameAtShip": "v{FOS_PRD_VERSION} - Sales OS pipeline",
            "workflowStage": "Spec Draft",
        }
        print(f"Created release task: {release_task_url}")
    else:
        release_task_url = manifest["tasks"][task_key]["url"]
        task_id = int(manifest["tasks"][task_key]["id"])
        update_release_task_description(task_id, notebook_url=nb_url, manifest=manifest)
        print(f"Release task exists: {release_task_url}")
        print("Updated release task description")

    stage = get_task_workflow_stage(task_id)
    print(f"Release task workflow stage id: {stage} (Spec Draft = {STAGE_SPEC_DRAFT_ID})")

    save_manifest(manifest)
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
