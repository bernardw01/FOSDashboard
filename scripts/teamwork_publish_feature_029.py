#!/usr/bin/env python3
"""Publish Feature 029 notebook + release task from docs/features/029-*.md."""

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

NOTEBOOK_KEY = "feature_029"
NOTEBOOK_TITLE = "Feature 029 - Mobile shell Phase A and B"
NOTEBOOK_DESC = (
    "Mobile shell below 768px: bottom nav, data-source pill, filter bottom sheets; "
    "Home / Agreements / Pipeline mobile layouts. Shipped v2.20.0–2.20.1."
)
FEATURE_MD = ROOT / "docs/features/029-mobile-shell-phase-ab.md"
MANIFEST = ROOT / "docs/teamwork-manifest.json"
TASKLIST_NAME = "Platform and shell"
RELEASE_TASK_NAME = "Feature 029 - Mobile shell Phase A and B"

RELEASE_TASK_DESC = """Release type: Enhancement
Feature id: 029
Product version: **2.20.1** (shipped; rename task at formal ship ritual)

**Scope:** Mobile shell Phase A + B for viewports under 768px.

**Shipped releases:**
- **v2.20.0** - Bottom nav, data-source pill, filter sheets; Home / Agreements / Pipeline mobile layouts
- **v2.20.1** - Mobile shell JS / viewport fix

Notebook: {notebook_url}
Git spec: docs/features/029-mobile-shell-phase-ab.md
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
    desc = RELEASE_TASK_DESC.format(
        notebook_url=notebook_url,
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
            "featureId": "029",
            "publishedAt": date.today().isoformat(),
        }
        print(f"Created notebook: {nb_url}")

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        desc = RELEASE_TASK_DESC.format(
            notebook_url=nb_url,
            how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id="029",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            workflow_stage_id=STAGE_SPEC_DRAFT_ID,
            manifest=manifest,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": "029",
            "releaseType": "Enhancement",
            "releaseTitle": "Mobile shell Phase A and B",
            "provisionalTaskName": True,
            "shippedVersion": None,
            "notebookKey": NOTEBOOK_KEY,
            "url": release_task_url,
            "renameAtShip": "v{FOS_PRD_VERSION} - Mobile shell Phase A and B",
            "workflowStage": "Spec Draft",
        }
        print(f"Created release task: {release_task_url}")
    else:
        release_task_url = manifest["tasks"][task_key]["url"]
        task_id = int(manifest["tasks"][task_key]["id"])
        update_release_task_description(task_id, notebook_url=nb_url, manifest=manifest)
        print(f"Release task exists: {release_task_url}")

    stage = get_task_workflow_stage(task_id)
    print(f"Release task workflow stage id: {stage} (Spec Draft = {STAGE_SPEC_DRAFT_ID})")

    save_manifest(manifest)
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
