#!/usr/bin/env python3
"""Publish Feature 041 + 042 notebooks, release tasks, and Inbox feature request."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import PROJECT_ID, api, notebook_url  # noqa: E402
from teamwork_intake import (  # noqa: E402
    RELEASE_TYPE_ENHANCEMENT,
    STAGE_BACKLOG_ID,
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

DELIVERY_TASKLIST = 4174283
OPERATIONS_TASKLIST = 4174282
INBOX_TASKLIST = 4175395

FEATURE_041 = "041"
FEATURE_042 = "042"

INBOX_TASK_NAME = "Feature request - Resource assignments by person variances"
INBOX_DESC = """**Type:** Feature request (Operations)

**User story**

As an ops manager, I want to:
- Search by team member and time frame to see which projects they logged time against
- Know if they were allocated by PMs or not
- See if they were fulfilling a role listed on the SOW (billable)
- See any variances between allocated and actuals

So that I can identify unexpected time entries to follow up on.

**Proposed solution:** Feature 042 - **By person variances** tab on Resource assignments (extends Feature 028). Rename existing **By person** tab to **By person allocations**.

**Related:** Feature 041 - PM Overview rebrand (Delivery nav label) is a separate release in the same intake batch.

Workflow: Backlog until linked release task is Spec Approved.
"""

TASK_041 = "Feature 041 - PM Overview rebrand"
TASK_042 = "Feature 042 - Resource assignments By person variances"


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
    key: str,
    title: str,
    desc: str,
    md_path: Path,
    feature_id: str,
) -> tuple[int, str]:
    entry = manifest.get("notebooks", {}).get(key)
    if entry:
        sync_notebook(key, md_path, description=desc)
        manifest = load_manifest()
        url = manifest["notebooks"][key]["url"]
        nb_id = int(manifest["notebooks"][key]["id"])
        print(f"Synced notebook {key}: {url}")
        return nb_id, url

    html = markdown_to_notebook_html(md_path.read_text(encoding="utf-8"))
    nb_id = create_notebook_html_direct(title, desc, html)
    url = notebook_url(nb_id)
    manifest.setdefault("notebooks", {})[key] = {
        "id": nb_id,
        "title": title,
        "url": url,
        "featureId": feature_id,
        "publishedAt": date.today().isoformat(),
        "lastSyncedAt": date.today().isoformat(),
    }
    print(f"Created notebook {key}: {url}")
    return nb_id, url


def ensure_release_task(
    manifest: dict,
    *,
    task_key: str,
    tasklist_id: int,
    tasklist_name: str,
    task_name: str,
    description: str,
    feature_id: str,
    notebook_key: str,
) -> tuple[int, str]:
    existing = manifest.get("tasks", {}).get(task_key)
    if existing:
        task_id = int(existing["id"])
        api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"description": description}})
        url = existing.get("url") or task_url(task_id)
        print(f"Updated release task: {url}")
        return task_id, url

    task_id = create_release_task(
        tasklist_id,
        task_name,
        description,
        feature_id=feature_id,
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
        "featureId": feature_id,
        "releaseType": RELEASE_TYPE_ENHANCEMENT,
        "tasklist": tasklist_name,
        "tasklistId": tasklist_id,
        "notebookKey": notebook_key,
        "workflowStage": "Spec Draft",
        "createdAt": date.today().isoformat(),
    }
    return task_id, url


def main() -> None:
    manifest = load_manifest()
    how = manifest["notebooks"]["how_we_work"]["url"]

    if INBOX_TASK_NAME not in manifest.get("tasks", {}):
        inbox_id = create_release_task(
            INBOX_TASKLIST,
            INBOX_TASK_NAME,
            INBOX_DESC,
            feature_id=FEATURE_042,
            release_type=RELEASE_TYPE_ENHANCEMENT,
            workflow_stage_id=STAGE_BACKLOG_ID,
            manifest=manifest,
        )
        inbox_url = task_url(inbox_id)
        manifest.setdefault("tasks", {})[INBOX_TASK_NAME] = {
            "id": inbox_id,
            "url": inbox_url,
            "featureId": FEATURE_042,
            "releaseType": RELEASE_TYPE_ENHANCEMENT,
            "tasklist": "Inbox",
            "tasklistId": INBOX_TASKLIST,
            "workflowStage": "Backlog",
            "createdAt": date.today().isoformat(),
        }
        print(f"Created inbox feature request: {inbox_url}")
    else:
        inbox_id = int(manifest["tasks"][INBOX_TASK_NAME]["id"])
        inbox_url = manifest["tasks"][INBOX_TASK_NAME]["url"]
        print(f"Inbox feature request exists: {inbox_url}")

    _, nb41_url = ensure_notebook(
        manifest,
        "feature_041",
        "Feature 041 - PM Overview rebrand",
        "Rename Delivery nav and page title to PM Overview.",
        ROOT / "docs/features/041-pm-overview-rebrand.md",
        FEATURE_041,
    )
    _, plan41_url = ensure_notebook(
        manifest,
        "feature_041_implementation_plan",
        "Feature 041 - Implementation plan (PM Overview rebrand)",
        "Engineering plan for Feature 041.",
        ROOT / "docs/features/041-pm-overview-rebrand-implementation-plan.md",
        FEATURE_041,
    )

    desc_041 = f"""Release type: Enhancement
Feature id: 041
Product version: TBD at ship
Workflow stage: Spec Draft

**Scope:** Rename Delivery workspace labels:
- Sidebar **Projects & P&L** → **PM Overview**
- Page title **Delivery Dashboard** → **PM Overview**
- Route id **`delivery`** unchanged (no breaking deep links)

Feature notebook: {nb41_url}
Implementation plan: {plan41_url}
Git: docs/features/041-pm-overview-rebrand.md
Workflow: {how}
"""
    ensure_release_task(
        manifest,
        task_key=TASK_041,
        tasklist_id=DELIVERY_TASKLIST,
        tasklist_name="Delivery",
        task_name=TASK_041,
        description=desc_041,
        feature_id=FEATURE_041,
        notebook_key="feature_041",
    )

    _, nb42_url = ensure_notebook(
        manifest,
        "feature_042",
        "Feature 042 - Resource assignments By person variances",
        "By person variances tab + rename By person allocations.",
        ROOT / "docs/features/042-resource-assignments-by-person-variances.md",
        FEATURE_042,
    )
    _, plan42_url = ensure_notebook(
        manifest,
        "feature_042_implementation_plan",
        "Feature 042 - Implementation plan (By person variances)",
        "Engineering plan for Feature 042.",
        ROOT / "docs/features/042-resource-assignments-by-person-variances-implementation-plan.md",
        FEATURE_042,
    )

    desc_042 = f"""Release type: Enhancement
Feature id: 042
Product version: TBD at ship
Workflow stage: Spec Draft

**Inbox source:** {inbox_url}

**Scope:** Resource assignments weekly grid:
1. Rename tab **By person** → **By person allocations** (behavior unchanged).
2. Add tab **By person variances**: person → Assigned / Actual / Variance (collapsible) → project rows.
3. Week cell click → daily breakdown modal.
4. Extend payload + cache schema; snapshot alignment.

Extends: Feature 028 (By project tab)

Feature notebook: {nb42_url}
Implementation plan: {plan42_url}
Git: docs/features/042-resource-assignments-by-person-variances.md
Workflow: {how}
"""
    task42_id, task42_url = ensure_release_task(
        manifest,
        task_key=TASK_042,
        tasklist_id=OPERATIONS_TASKLIST,
        tasklist_name="Operations",
        task_name=TASK_042,
        description=desc_042,
        feature_id=FEATURE_042,
        notebook_key="feature_042",
    )

    link_inbox_task(inbox_id, nb42_url, task42_url)
    print(f"Linked inbox {inbox_id} to release {task42_id}")

    save_manifest(manifest)
    print("Manifest saved.")


if __name__ == "__main__":
    main()
