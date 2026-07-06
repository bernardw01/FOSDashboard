#!/usr/bin/env python3
"""Publish Feature 028 notebook + release task (Spec Draft) from docs/features/028-*.md."""

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

NOTEBOOK_KEY = "feature_028"
NOTEBOOK_TITLE = "Feature 028 - Resource assignments plan vs actual"
NOTEBOOK_DESC = (
    "Resource assignments dashboard enhancement: tabbed weekly grid (By person / By project), "
    "assigned vs actual labor hours with variance, orange styling when Allocated & Billable "
    "is unchecked. Extends Feature 027."
)
FEATURE_MD = ROOT / "docs/features/028-resource-assignments-plan-vs-actual.md"
MANIFEST = ROOT / "docs/teamwork-manifest.json"
TASKLIST_NAME = "Operations"
RELEASE_TASK_NAME = "Feature 028 - Resource assignments plan vs actual"

RELEASE_TASK_DESC = """Release type: Enhancement
Feature id: 028
Workflow: Spec Draft (customer review)

**Scope:** Extend Operations **Resource assignments** with a **By project** tab showing **assigned vs actual hours** and **variance** by ISO week (project → person grouping). Keep existing **By person** tab. Style person name and actual hours **orange** when Fibery **`Allocated & Billable`** is unchecked on the allocation.

**Extends:** Feature 027 (Resource assignment dashboard)

Notebook: {notebook_url}
Git spec: docs/features/028-resource-assignments-plan-vs-actual.md
Parent notebook: {parent_027_url}
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


def update_release_task_description(
    task_id: int,
    *,
    notebook_url: str,
    manifest: dict,
) -> None:
    parent_027 = manifest.get("notebooks", {}).get("feature_027", {})
    desc = RELEASE_TASK_DESC.format(
        notebook_url=notebook_url,
        parent_027_url=parent_027.get("url", "(Feature 027 notebook)"),
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
            "featureId": "028",
            "publishedAt": date.today().isoformat(),
        }
        print(f"Created notebook: {nb_url}")

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        parent_027 = manifest.get("notebooks", {}).get("feature_027", {})
        desc = RELEASE_TASK_DESC.format(
            notebook_url=nb_url,
            parent_027_url=parent_027.get("url", "(Feature 027 notebook)"),
            how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id="028",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            workflow_stage_id=STAGE_SPEC_DRAFT_ID,
            manifest=manifest,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": "028",
            "releaseType": "Enhancement",
            "releaseTitle": "Resource assignments plan vs actual",
            "provisionalTaskName": True,
            "shippedVersion": None,
            "notebookKey": NOTEBOOK_KEY,
            "url": release_task_url,
            "renameAtShip": "v{FOS_PRD_VERSION} - Resource assignments plan vs actual",
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
