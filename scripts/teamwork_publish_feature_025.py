#!/usr/bin/env python3
"""Publish Feature 025 notebook + release task (Spec Draft) from docs/features/025-*.md."""

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

NOTEBOOK_KEY = "feature_025"
NOTEBOOK_TITLE = "Feature 025 - Portfolio P&L performance and load source"
NOTEBOOK_DESC = (
    "Portfolio P&L speed options (slim builder, batch size, Drive cache) and "
    "dashboard-wide loading Source labels (Fibery vs cache vs snapshot). "
    "Extends Feature 022."
)
FEATURE_MD = ROOT / "docs/features/025-portfolio-pnl-performance-and-load-source-ux.md"
PLAN_MD = ROOT / "docs/features/025-portfolio-pnl-performance-implementation-plan.md"
MANIFEST = ROOT / "docs/teamwork-manifest.json"
TASKLIST_NAME = "Finance"
RELEASE_TASK_NAME = "Feature 025 - Portfolio P&L performance and load source"


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
    plan_link = ""
    if PLAN_MD.exists():
        plan_link = (
            f"\n\nImplementation plan: "
            f"[025 implementation plan]"
            f"(https://github.com/bernardw01/FOSDashboard/blob/main/"
            f"docs/features/025-portfolio-pnl-performance-implementation-plan.md)"
        )

    if nb_entry:
        sync_notebook(NOTEBOOK_KEY, FEATURE_MD, description=NOTEBOOK_DESC + plan_link)
        manifest = load_manifest()
        nb_url = manifest["notebooks"][NOTEBOOK_KEY]["url"]
    else:
        md = FEATURE_MD.read_text(encoding="utf-8") + plan_link
        html = markdown_to_notebook_html(md)
        nb_id = create_notebook_html_direct(NOTEBOOK_TITLE, NOTEBOOK_DESC, html)
        nb_url = notebook_url(nb_id)
        manifest.setdefault("notebooks", {})[NOTEBOOK_KEY] = {
            "id": nb_id,
            "title": NOTEBOOK_TITLE,
            "url": nb_url,
            "featureId": "025",
            "publishedAt": date.today().isoformat(),
        }
        print(f"Created notebook: {nb_url}")

    parent_nb = manifest.get("notebooks", {}).get("feature_022", {})
    parent_url = parent_nb.get("url", "")

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        desc = (
            "Release type: Enhancement\n"
            "Feature id: 025\n\n"
            "Scope: (1) Show data source on all dashboard loading states "
            "(Fibery / browser cache / snapshot / Drive cache). "
            "(2) Speed Portfolio P&L via slim P&L builder + batch size tuning.\n\n"
            f"Notebook: {nb_url}\n"
            f"Git spec: docs/features/025-portfolio-pnl-performance-and-load-source-ux.md\n"
            f"Implementation plan: docs/features/025-portfolio-pnl-performance-implementation-plan.md\n"
            f"Extends Feature 022: {parent_url}\n"
            f"Workflow: {manifest['notebooks']['how_we_work']['url']}"
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id="025",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            manifest=manifest,
            workflow_stage_id=STAGE_SPEC_DRAFT_ID,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": "025",
            "releaseType": "Enhancement",
            "releaseTitle": "Portfolio P&L performance and load source",
            "provisionalTaskName": True,
            "shippedVersion": None,
            "notebookKey": NOTEBOOK_KEY,
            "url": release_task_url,
            "renameAtShip": "v{FOS_PRD_VERSION} - Portfolio P&L performance and load source",
            "workflowStage": "Spec Draft",
        }
        print(f"Created release task: {release_task_url}")
    else:
        release_task_url = manifest["tasks"][task_key]["url"]
        sync_notebook(NOTEBOOK_KEY, FEATURE_MD, description=NOTEBOOK_DESC + plan_link)
        print(f"Release task exists: {release_task_url}")

    stage = get_task_workflow_stage(int(manifest["tasks"][task_key]["id"]))
    print(f"Release task workflow stage: {stage}")

    save_manifest(manifest)
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
