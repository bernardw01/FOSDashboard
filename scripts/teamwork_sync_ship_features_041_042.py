#!/usr/bin/env python3
"""Sync Feature 041/042 git specs to Teamwork notebooks, update tasks, ship v3.7.0."""

from __future__ import annotations

import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import api  # noqa: E402
from teamwork_intake import (  # noqa: E402
    STAGE_SHIPPED_ID,
    get_task_workflow_stage,
    link_inbox_task,
    load_manifest,
    task_url,
)
from teamwork_sync_notebook import save_manifest, sync_notebook  # noqa: E402

VERSION = "3.7.0"

NOTEBOOKS = [
    (
        "feature_041",
        ROOT / "docs/features/041-pm-overview-rebrand.md",
        "Feature 041 spec (PM Overview rebrand)",
    ),
    (
        "feature_041_implementation_plan",
        ROOT / "docs/features/041-pm-overview-rebrand-implementation-plan.md",
        "Feature 041 implementation plan",
    ),
    (
        "feature_042",
        ROOT / "docs/features/042-resource-assignments-by-person-variances.md",
        "Feature 042 spec (By person variances)",
    ),
    (
        "feature_042_implementation_plan",
        ROOT / "docs/features/042-resource-assignments-by-person-variances-implementation-plan.md",
        "Feature 042 implementation plan",
    ),
]

INBOX_TASK_NAME = "Feature request - Resource assignments by person variances"
TASK_041 = "Feature 041 - PM Overview rebrand"
TASK_042 = "Feature 042 - Resource assignments By person variances"
SHIPPED_041 = f"v{VERSION} - PM Overview rebrand"
SHIPPED_042 = f"v{VERSION} - Resource assignments By person variances"


def sync_all_notebooks() -> None:
    for key, md_path, desc in NOTEBOOKS:
        sync_notebook(key, md_path, description=desc)
        print(f"Synced {key}")


def update_task_description(task_id: int, description: str) -> None:
    api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"description": description}})


def build_task_desc_041(manifest: dict) -> str:
    nb = manifest["notebooks"]["feature_041"]["url"]
    plan = manifest["notebooks"]["feature_041_implementation_plan"]["url"]
    how = manifest["notebooks"]["how_we_work"]["url"]
    return f"""Release type: Enhancement
Feature id: 041
Release version: v{VERSION}
Workflow stage: Shipped

**Scope (shipped v{VERSION}):**
- Sidebar child **Projects & P&L** -> **PM Overview** (title case)
- Panel H1 **Delivery Dashboard** -> **PM Overview**
- Nav route **`pm-overview`**; legacy **`delivery`** redirects client-side
- **Delivery** nav group unchanged

**Bundled with:** Feature 042 (same v{VERSION} release)

Feature notebook: {nb}
Implementation plan: {plan}
Git: docs/features/041-pm-overview-rebrand.md
PRD: FR-138, AC-100
Workflow: {how}
"""


def build_task_desc_042(manifest: dict, inbox_url: str) -> str:
    nb = manifest["notebooks"]["feature_042"]["url"]
    plan = manifest["notebooks"]["feature_042_implementation_plan"]["url"]
    how = manifest["notebooks"]["how_we_work"]["url"]
    nb28 = manifest.get("notebooks", {}).get("feature_028", {}).get(
        "url", "(Feature 028 notebook)"
    )
    return f"""Release type: Enhancement
Feature id: 042
Release version: v{VERSION}
Workflow stage: Shipped

**Inbox source:** {inbox_url}

**Scope (shipped v{VERSION}):**
1. Rename tab **By person** -> **By person allocations** (behavior unchanged)
2. Add tab **By person variances**: person -> Assigned / Actual / Variance (default collapsed) -> project
3. Week cell click -> daily breakdown modal (Mon-Sun)
4. Resource assignments cache schema **3** (`personVariances[]`, `byDay`)

**Locked decisions:** variance group = projects with variance > 0; default tab = allocations; all groups collapsed by default.

Extends: Feature 028 ({nb28})

Feature notebook: {nb}
Implementation plan: {plan}
Git: docs/features/042-resource-assignments-by-person-variances.md
PRD: FR-139, AC-100
Workflow: {how}
"""


def build_inbox_desc(manifest: dict, release_042_url: str) -> str:
    nb = manifest["notebooks"]["feature_042"]["url"]
    return f"""**Type:** Feature request (Operations)
**Status:** Implemented in v{VERSION} (Feature 042)

**User story**

As an ops manager, I want to:
- Search by team member and time frame to see which projects they logged time against
- Know if they were allocated by PMs or not
- See if they were fulfilling a role listed on the SOW (billable)
- See any variances between allocated and actuals

So that I can identify unexpected time entries to follow up on.

**Delivered:** Feature 042 - **By person variances** tab on Resource assignments (extends Feature 028).

Feature notebook: {nb}
Release task: {release_042_url}
Related: Feature 041 PM Overview rebrand (same v{VERSION} release)
"""


def ship_task(manifest_key: str) -> None:
    cmd = [
        sys.executable,
        str(ROOT / "scripts" / "teamwork_ship_task.py"),
        "--manifest-task",
        manifest_key,
        "--version-from-codejs",
        "--release-type",
        "Enhancement",
        "--update-manifest",
    ]
    print(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> None:
    sync_all_notebooks()
    manifest = load_manifest()

    inbox_id = int(manifest["tasks"][INBOX_TASK_NAME]["id"])
    task41_id = int(manifest["tasks"][TASK_041]["id"])
    task42_id = int(manifest["tasks"][TASK_042]["id"])
    inbox_url = manifest["tasks"][INBOX_TASK_NAME]["url"]
    nb42_url = manifest["notebooks"]["feature_042"]["url"]

    update_task_description(task41_id, build_task_desc_041(manifest))
    update_task_description(task42_id, build_task_desc_042(manifest, inbox_url))
    print(f"Updated release task descriptions ({task41_id}, {task42_id})")

    link_inbox_task(inbox_id, nb42_url, task_url(task42_id))

    ship_task(TASK_041)
    manifest = load_manifest()
    ship_task(TASK_042)
    manifest = load_manifest()

    release_042_url = manifest["tasks"].get(SHIPPED_042, {}).get("url") or task_url(task42_id)
    update_task_description(inbox_id, build_inbox_desc(manifest, release_042_url))
    manifest["tasks"][INBOX_TASK_NAME]["workflowStage"] = "Shipped"
    manifest["tasks"][INBOX_TASK_NAME]["shippedVersion"] = VERSION
    manifest["tasks"][INBOX_TASK_NAME]["lastSyncedAt"] = date.today().isoformat()

    for nb_key, _, _ in NOTEBOOKS:
        if nb_key in manifest.get("notebooks", {}):
            manifest["notebooks"][nb_key]["lastSyncedAt"] = date.today().isoformat()
            manifest["notebooks"][nb_key]["shippedVersion"] = VERSION

    save_manifest(manifest)
    print(f"Manifest saved. Shipped v{VERSION}:")
    print(f"  {manifest['tasks'].get(SHIPPED_041, {}).get('url', SHIPPED_041)}")
    print(f"  {manifest['tasks'].get(SHIPPED_042, {}).get('url', SHIPPED_042)}")


if __name__ == "__main__":
    main()
