#!/usr/bin/env python3
"""Publish Feature 027 notebook + release task (Spec Draft) from docs/features/027-*.md."""

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
    link_inbox_task,
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    load_manifest,
    markdown_to_notebook_html,
    save_manifest,
    sync_notebook,
)

NOTEBOOK_KEY = "feature_027"
NOTEBOOK_TITLE = "Feature 027 - Resource assignment dashboard"
NOTEBOOK_DESC = (
    "Operations portfolio view of Fibery Resource Allocations: ISO week grid, "
    "allocation % heatmap, current week banner, expand/collapse, alerts, filters, "
    "CSV export, and historical snapshots. Shipped v2.18.0–2.18.3."
)
FEATURE_MD = ROOT / "docs/features/027-resource-assignment-dashboard.md"
MANIFEST = ROOT / "docs/teamwork-manifest.json"
INBOX_TASK_ID = 40228925
TASKLIST_NAME = "Operations"
RELEASE_TASK_NAME = "Feature 027 - Resource assignment dashboard"

RELEASE_TASK_DESC = """Release type: Enhancement
Feature id: 027
Product version: **2.18.3** (shipped; rename task at formal ship ritual)

**Scope:** Operations route **Resource assignments** — portfolio Fibery Resource Allocations by ISO week.

**Shipped releases:**
- **v2.18.0** — Core grid, alerts, filters, Copy CSV, TTL/cache, snapshot `resource-assignments.json`
- **v2.18.1** — Access gate: CLIENT-ENGAGEMENT team, EXEC, or ADMIN (same as Pipeline)
- **v2.18.2** — Alerts grouped by type then person (collapsible)
- **v2.18.3** — Current ISO week banner; allocation % heatmap (blue → green 100-110% → yellow/red)

Notebook: {notebook_url}
Git spec: docs/features/027-resource-assignment-dashboard.md
Inbox: {inbox_url}
Extends Feature 019: {parent_019_url}
Workflow: {how_we_work_url}
"""


def update_release_task_description(
    task_id: int,
    *,
    notebook_url: str,
    manifest: dict,
) -> None:
    parent_019 = manifest.get("notebooks", {}).get("feature_019", {})
    desc = RELEASE_TASK_DESC.format(
        notebook_url=notebook_url,
        inbox_url=task_url(INBOX_TASK_ID),
        parent_019_url=parent_019.get("url", "(resource allocation Fibery source)"),
        how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
    )
    api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"description": desc}})


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
            "featureId": "027",
            "intakeTaskId": INBOX_TASK_ID,
            "publishedAt": date.today().isoformat(),
        }
        print(f"Created notebook: {nb_url}")

    parent_019 = manifest.get("notebooks", {}).get("feature_019", {})
    parent_019_url = parent_019.get("url", "")

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        desc = (
            "Release type: Enhancement\n"
            "Feature id: 027\n"
            "Workflow: Spec Draft (customer review)\n"
            f"Intake: Inbox task {INBOX_TASK_ID} - Resource Assignment Dashboard\n\n"
            + RELEASE_TASK_DESC.format(
                notebook_url=nb_url,
                inbox_url=task_url(INBOX_TASK_ID),
                parent_019_url=parent_019_url or "(resource allocation Fibery source)",
                how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
            )
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id="027",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            workflow_stage_id=STAGE_SPEC_DRAFT_ID,
            manifest=manifest,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": "027",
            "releaseType": "Enhancement",
            "releaseTitle": "Resource assignment dashboard",
            "provisionalTaskName": True,
            "shippedVersion": None,
            "notebookKey": NOTEBOOK_KEY,
            "intakeTaskId": INBOX_TASK_ID,
            "url": release_task_url,
            "renameAtShip": "v{FOS_PRD_VERSION} - Resource assignment dashboard",
            "workflowStage": "Spec Draft",
        }
        print(f"Created release task: {release_task_url}")
    else:
        release_task_url = manifest["tasks"][task_key]["url"]
        task_id = int(manifest["tasks"][task_key]["id"])
        update_release_task_description(task_id, notebook_url=nb_url, manifest=manifest)
        print(f"Release task exists: {release_task_url}")
        print("Updated release task description with v2.18.0–2.18.3 release notes")

    stage = get_task_workflow_stage(task_id)
    print(f"Release task workflow stage id: {stage} (Spec Draft = {STAGE_SPEC_DRAFT_ID})")

    link_inbox_task(INBOX_TASK_ID, nb_url, release_task_url)
    print(f"Linked inbox task {INBOX_TASK_ID}")

    save_manifest(manifest)
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
