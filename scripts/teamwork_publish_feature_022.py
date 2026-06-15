#!/usr/bin/env python3
"""Publish Feature 022 notebook + release task (Spec Draft) from docs/features/022-*.md."""

from __future__ import annotations

import json
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
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    load_manifest,
    markdown_to_notebook_html,
    save_manifest,
    sync_notebook,
)

NOTEBOOK_KEY = "feature_022"
NOTEBOOK_TITLE = "Feature 022 - Portfolio Project P&L"
NOTEBOOK_DESC = (
    "Finance Portfolio P&L: roll up Subscription + Services project P&L "
    "with customer hierarchy, progress loading, projected-month toggle. "
    "Intake from Inbox task 40160887."
)
FEATURE_MD = ROOT / "docs/features/022-portfolio-project-pnl.md"
MANIFEST = ROOT / "docs/teamwork-manifest.json"
INBOX_TASK_ID = 40160887
TASKLIST_NAME = "Finance"
RELEASE_TASK_NAME = "Feature 022 - Portfolio Project P&L"


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
            "featureId": "022",
            "intakeTaskId": INBOX_TASK_ID,
            "publishedAt": date.today().isoformat(),
        }
        print(f"Created notebook: {nb_url}")

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        desc = (
            "Release type: Enhancement\n"
            "Feature id: 022\n"
            "Workflow: Spec Draft (customer review)\n"
            "Intake: Inbox task 40160887 - Portfolio Project P&L\n\n"
            "Scope: Finance nav Portfolio P&L grid (Portfolio → Customer → Project); "
            "Subscription + Services agreements only; reuse Delivery P&L data; "
            "Employee/Contractor split; progress indicator for all-project fetch; "
            "projected-month toggle (default off).\n\n"
            f"Notebook: {nb_url}\n"
            f"Git spec: docs/features/022-portfolio-project-pnl.md\n"
            f"Reference: Sample Structure.xlsx on inbox task\n"
            f"Workflow: {manifest['notebooks']['how_we_work']['url']}"
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id="022",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            workflow_stage_id=STAGE_SPEC_DRAFT_ID,
            manifest=manifest,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": "022",
            "releaseType": "Enhancement",
            "releaseTitle": "Portfolio Project P&L",
            "provisionalTaskName": True,
            "shippedVersion": None,
            "notebookKey": NOTEBOOK_KEY,
            "intakeTaskId": INBOX_TASK_ID,
            "url": release_task_url,
            "renameAtShip": "v{FOS_PRD_VERSION} - Portfolio Project P&L",
            "workflowStage": "Spec Draft",
        }
        print(f"Created release task: {release_task_url}")
    else:
        release_task_url = manifest["tasks"][task_key]["url"]
        task_id = int(manifest["tasks"][task_key]["id"])
        print(f"Release task exists: {release_task_url}")

    stage = get_task_workflow_stage(task_id)
    print(f"Release task workflow stage id: {stage} (Spec Draft = {STAGE_SPEC_DRAFT_ID})")

    link_inbox_task(INBOX_TASK_ID, nb_url, release_task_url)
    print(f"Linked inbox task {INBOX_TASK_ID}")

    save_manifest(manifest)
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
