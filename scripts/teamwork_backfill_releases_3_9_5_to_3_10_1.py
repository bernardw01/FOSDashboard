#!/usr/bin/env python3
"""Backfill Teamwork release tasks for shipped versions that never got one.

Three releases were committed and deployed with no Teamwork release task:

  - 3.9.5  Portfolio P&L child-row indent + labor fallback  -> feature 022, Finance
  - 3.10.0 Operations payload slimmed (workstream B1)       -> feature 047, Data platform
  - 3.10.1 fos_perf_runs kind constraint widened            -> feature 047, Data platform

This script only CREATES the tasks (in Spec Draft, with Feature ID and Release
Type set, per the intake contract). The ship half -- Release Version, Estimated
Dev Hours, the vX.Y.Z rename, the move to Shipped, and the manifest update -- is
left to `teamwork_ship_task.py` so backfilled releases go through exactly the
same ritual as a normal ship.

Idempotent: a release whose task already exists (by name, or recorded in the
manifest) is skipped.

Run after this, once per release, using the printed commands.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import PROJECT_ID, api  # noqa: E402
from teamwork_intake import (  # noqa: E402
    RELEASE_TYPE_BUG_FIX,
    RELEASE_TYPE_ENHANCEMENT,
    create_release_task,
    load_manifest,
    task_url,
)

FINANCE_TL = 4174284
DATA_PLATFORM_TL = 4174287

NB = "https://win.godeap.io/app/projects/1615262/notebooks"
WORKFLOW_NB = f"{NB}/311783"

# Each release: the final shipped name, where it belongs, and why.
RELEASES = [
    {
        "version": "3.9.5",
        "title": "Portfolio P&L child-row indent and labor fallback",
        "tasklist_id": FINANCE_TL,
        "tasklist": "Finance",
        "feature_id": "022",
        "release_type": RELEASE_TYPE_BUG_FIX,
        "estimate_base": "c9a8667",
        "estimate_head": "5cb3d6e",
        "description": f"""Release type: Bug Fix
Feature id: 022 (Portfolio P&L, FR-116)
Release version: 3.9.5 (shipped 2026-08-24, task created retroactively)
Workflow stage: Shipped

Backfilled release task. The release was committed and deployed
(`5cb3d6e Ship PRD 3.9.5`) without a Teamwork release task, so it was invisible
on the board until this catch-up.

**Release notes**

Problem: expanded Portfolio P&L tree labels collided with the expand/collapse
arrow, and projects whose agreement had an empty Clockify Project ID showed no
Employee/Contractor labor cost at all.

Fix: deeper depth step plus a gutter on rows with no toggle. A lost CSS selector
above the projected-cell rule is restored: the orphaned declarations made the
block unparseable, and CSS error recovery swallowed the *following* rule too, so
the projected-cell highlight and the quarter-column shading had both silently
stopped rendering. Live P&L labor still prefers
`fos_agreements.clockify_project_id`, and when that field is empty it now
uniquely matches `fos_labor_costs.time_entry_project_name`, so recently imported
Clockify projects show Employee/Contractor cost. Clockify Project ID was also
linked on Order Form #6 Customer IP Development Support in Fibery.

Benefit: the Portfolio P&L grid is readable when expanded, projected and
quarter columns are visually distinct again, and new Clockify projects report
labor without waiting for a manual Fibery field edit.

Extends **FR-91**, **FR-116**. PATCH -> 3.9.5.

Note: this commit also carried feature 047 workstream A verification docs, which
should have been a separate release under the one-task-one-release rule.

Feature notebook: {NB}/311833
Git feature spec: docs/features/022-portfolio-project-pnl.md
Workflow: {WORKFLOW_NB}
""",
    },
    {
        "version": "3.10.0",
        "title": "Operations payload slimmed and row detail repaired",
        "tasklist_id": DATA_PLATFORM_TL,
        "tasklist": "Data platform",
        "feature_id": "047",
        "release_type": RELEASE_TYPE_ENHANCEMENT,
        "estimate_base": "5cb3d6e",
        "estimate_head": "198b9c1",
        "description": f"""Release type: Enhancement
Feature id: 047 (Dashboard performance and responsiveness, workstream B1)
Release version: 3.10.0 (shipped 2026-08-24, task created retroactively)
Workflow stage: Shipped

Backfilled release task. The release was committed and deployed
(`198b9c1 Ship PRD 3.10.0`) without a Teamwork release task.

**Release notes**

The Operations (utilization) payload drops from **6,060,530 to 1,302,583 JSON
characters**, a **78.5 percent** cut measured on the stored blob for the default
window. That matters because these payloads routinely exceeded the ~5 MB
`sessionStorage` quota and silently failed to cache, so every panel open paid a
full rebuild.

Three changes get there:

1. Eight row fields removed. `seconds`, `endDateTime`, and `revenueFromLabor`
   had no reader anywhere; `day`, `billableLabel`, and `marginPerHour` are
   derived client-side from fields still present; `name` and `dateOfCreation`
   were empty or null in all 6,043 rows.
2. Rows are sent as positional tuples rather than objects, removing repeated key
   names that were 44.5 percent of remaining row bytes.
3. Sixteen high-repetition string fields become indexes into per-field
   dictionaries, since a default window holds only 8 customers, 22 agreements,
   26 projects, 76 users, and 23 roles.

The transform is lossless and reversible, verified by
`_diag_verifyUtilRowCodec()`.

Also repaired: the row detail drawer's **Agreement state** and **Agreement
type**, which had rendered blank since the Datastore cutover, and **Created** is
removed because the mirror holds no creation timestamp for a time entry.

Utilization `cacheSchemaVersion` **6 -> 7**. **FR-145**, **AC-106**.
MINOR -> 3.10.0.

Feature notebook: {NB}/313457
Implementation plan notebook: {NB}/313458
Git feature spec: docs/features/047-dashboard-performance-and-responsiveness.md
Git implementation plan: docs/features/047-dashboard-performance-and-responsiveness-implementation-plan.md
Workflow: {WORKFLOW_NB}
""",
    },
    {
        "version": "3.10.1",
        "title": "Perf harness results record again",
        "tasklist_id": DATA_PLATFORM_TL,
        "tasklist": "Data platform",
        "feature_id": "047",
        "release_type": RELEASE_TYPE_BUG_FIX,
        "estimate_base": "198b9c1",
        "estimate_head": "24f9e39",
        "description": f"""Release type: Bug Fix
Feature id: 047 (Dashboard performance and responsiveness, workstream B1)
Release version: 3.10.1 (shipped 2026-08-24, task created retroactively)
Workflow stage: Shipped

Backfilled release task. The release was committed and deployed
(`24f9e39 Ship PRD 3.10.1`) without a Teamwork release task.

**Release notes**

Problem: `_diag_verifyUtilRowCodec()` on v3.10.0 returned 6,042 rows with zero
diffs, and the rows array went from 4,351,066 to 843,367 bytes (an 80.6 percent
cut, beating the pre-ship SQL estimate) -- but the run could not save its
result. Migration 048 pinned `fos_perf_runs.kind` to the two values that existed
at the time, so a `codec` row was rejected by `fos_perf_runs_kind_check`. The
failure was quiet by design: `perfPersistRun_` logs a warning and returns null,
so the measurement was correct in the execution log and only the persisted copy
was lost.

Fix: migration **049** replaces the allow-list with a lowercase-slug shape
check, so workstreams B, C, and D can add result kinds without a migration. That
deliberately trades away typo detection on an internal diagnostics table, on the
grounds that a rejected insert loses a measurement that costs a full hydrate to
reproduce. `_diag_verifyUtilRowCodec()` is also simplified.

Benefit: performance results for the remaining workstreams persist and stay
comparable in SQL against the workstream A baseline.

Extends **FR-145**. PATCH -> 3.10.1.

Feature notebook: {NB}/313457
Implementation plan notebook: {NB}/313458
Git implementation plan: docs/features/047-dashboard-performance-and-responsiveness-implementation-plan.md
Workflow: {WORKFLOW_NB}
""",
    },
]


def existing_task_names() -> dict[str, int]:
    """Every task name in the project mapped to id (both API versions)."""
    names: dict[str, int] = {}
    page = 1
    while True:
        res = api(
            "GET",
            f"/projects/api/v3/projects/{PROJECT_ID}/tasks.json"
            f"?pageSize=250&page={page}&includeCompletedTasks=true",
        )
        for t in res.get("tasks") or []:
            names[str(t.get("name") or "")] = int(t["id"])
        if not ((res.get("meta") or {}).get("page") or {}).get("hasMore"):
            break
        page += 1
    page = 1
    while True:
        res = api(
            "GET",
            f"/projects/{PROJECT_ID}/tasks.json"
            f"?pageSize=250&page={page}&includeCompletedTasks=1",
        )
        items = res.get("todo-items") or []
        for t in items:
            names[str(t.get("content") or "")] = int(t["id"])
        if len(items) < 250:
            break
        page += 1
    return names


def manifest_version_index(manifest: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, entry in (manifest.get("tasks") or {}).items():
        sv = str(entry.get("shippedVersion") or "").lstrip("v")
        if re.fullmatch(r"\d+\.\d+\.\d+", sv):
            out[sv] = key
    return out


def main() -> None:
    manifest = load_manifest()
    by_version = manifest_version_index(manifest)
    names = existing_task_names()

    ship_commands: list[str] = []

    for rel in RELEASES:
        version = rel["version"]
        shipped_name = f"v{version} - {rel['title']}"

        if version in by_version:
            print(f"SKIP {version}: manifest already has {by_version[version]!r}")
            continue
        if shipped_name in names:
            print(f"SKIP {version}: task already exists ({names[shipped_name]})")
            task_id = names[shipped_name]
        else:
            task_id = create_release_task(
                int(rel["tasklist_id"]),
                shipped_name,
                str(rel["description"]),
                feature_id=str(rel["feature_id"]),
                release_type=str(rel["release_type"]),
                manifest=manifest,
            )
            print(
                f"CREATED {version} -> task {task_id} in {rel['tasklist']}: "
                f"{task_url(task_id)}"
            )

        ship_commands.append(
            "python3 scripts/teamwork_ship_task.py \\\n"
            f"  --task-id {task_id} \\\n"
            f"  --version {version} \\\n"
            f"  --title \"{rel['title']}\" \\\n"
            f"  --feature-id {rel['feature_id']} \\\n"
            f"  --release-type \"{rel['release_type']}\" \\\n"
            f"  --estimate-base {rel['estimate_base']} \\\n"
            f"  --estimate-head {rel['estimate_head']} \\\n"
            "  --update-manifest"
        )

    if ship_commands:
        print("\n# Now ship each backfilled release (sets all four custom fields,")
        print("# renames, moves to Shipped, and updates the manifest):\n")
        for cmd in ship_commands:
            print(cmd + "\n")


if __name__ == "__main__":
    main()
