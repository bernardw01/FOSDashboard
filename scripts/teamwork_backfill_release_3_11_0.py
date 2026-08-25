#!/usr/bin/env python3
"""Backfill the Teamwork release task for 3.11.0 (feature 047, workstream B2).

3.11.0 was committed and deployed (`581c668 Ship PRD 3.11.0`) with no Teamwork
release task. The preceding backfill run
(`teamwork_backfill_releases_3_9_5_to_3_10_1.py`) deliberately stopped at 3.10.1
to avoid creating a duplicate while 3.11.0 was still in flight.

Same contract as that script: this only CREATES the task, in Spec Draft, with
Feature ID and Release Type set. The ship half -- Release Version, Estimated Dev
Hours, the vX.Y.Z rename, the move to Shipped, and the manifest update -- is left
to `teamwork_ship_task.py` so this release goes through exactly the same ritual
as a normal ship.

Idempotent: skipped if the manifest already records 3.11.0 or a task with the
shipped name already exists.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_backfill_releases_3_9_5_to_3_10_1 import (  # noqa: E402
    existing_task_names,
    manifest_version_index,
)
from teamwork_intake import (  # noqa: E402
    RELEASE_TYPE_ENHANCEMENT,
    create_release_task,
    load_manifest,
    task_url,
)

DATA_PLATFORM_TL = 4174287

NB = "https://win.godeap.io/app/projects/1615262/notebooks"
WORKFLOW_NB = f"{NB}/311783"

VERSION = "3.11.0"
TITLE = "Resource assignment allocations selected in Postgres"
FEATURE_ID = "047"
RELEASE_TYPE = RELEASE_TYPE_ENHANCEMENT
ESTIMATE_BASE = "24f9e39"
ESTIMATE_HEAD = "581c668"

DESCRIPTION = f"""Release type: Enhancement
Feature id: 047 (Dashboard performance and responsiveness, workstream B2)
Release version: 3.11.0 (shipped 2026-08-24, task created retroactively)
Workflow stage: Shipped

Backfilled release task. The release was committed and deployed
(`581c668 Ship PRD 3.11.0`, deploy check green) without a Teamwork release task.

**Release notes**

New Postgres function **`public.fos_rpc_ra_week_grid(date, date)`** (migration
**050**) returns the allocations overlapping a range with their person, project,
customer, and role display fields already resolved, replacing a full-table read
of `fos_resource_allocations` followed by a JavaScript overlap filter.

Measured on live data: **116 of 149** allocations match the default -30/+90
window, the RPC runs in **7.5 ms** warm against a 200 ms budget, and it returns
**66 kB** of JSON.

The implementation plan's suggested predicate,
`duration_start < p_end and duration_end >= p_start`, was **not** used. It drops
allocations with no duration, which `allocationOverlapsRangeYmd_` treats as
always in range, and one live allocation is exactly that case, so the plan's SQL
would have moved a KPI. The RPC mirrors the JavaScript predicate instead,
including null fallback, reversed-pair swapping, and inclusive ends, and it
preserves heap row order because alert ties are broken by input order.

Scope honesty: the saving is **one PostgREST round trip** per panel load, not
five. The four dimension-table reads this path skips are still performed by the
plan-vs-actual labor aggregation later in the same build.

The panel payload is unchanged, so `RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_`
stays at 3 and no stored blob is invalidated. There is no `DashboardShell.html`
change, so the mobile rule has nothing to accommodate in this release.

**Not yet verified.** **`PERF_USE_RA_RPC`** ships **off** and must stay off
until **`_diag_verifyWorkstreamB2()`** passes in the Apps Script editor. That
diagnostic also counts which path each parity arm took, because a parity run
that silently fell back to the row scan would compare the old path against
itself and pass while proving nothing. End-to-end parity is **not** claimed by
this release.

**FR-146**, **AC-107**. MINOR -> 3.11.0.

Feature notebook: {NB}/313457
Implementation plan notebook: {NB}/313458
Git feature spec: docs/features/047-dashboard-performance-and-responsiveness.md
Git implementation plan: docs/features/047-dashboard-performance-and-responsiveness-implementation-plan.md
Workflow: {WORKFLOW_NB}
"""


def main() -> None:
    manifest = load_manifest()
    by_version = manifest_version_index(manifest)
    shipped_name = f"v{VERSION} - {TITLE}"

    if VERSION in by_version:
        print(f"SKIP {VERSION}: manifest already has {by_version[VERSION]!r}")
        return

    names = existing_task_names()
    existing = [
        (name, tid)
        for name, tid in names.items()
        if VERSION in name or re.search(r"\bB2\b", name)
    ]
    if existing:
        print("Possible pre-existing tasks for this release:")
        for name, tid in existing:
            print(f"  {tid}: {name}")

    if shipped_name in names:
        task_id = names[shipped_name]
        print(f"SKIP {VERSION}: task already exists ({task_id})")
    else:
        task_id = create_release_task(
            DATA_PLATFORM_TL,
            shipped_name,
            DESCRIPTION,
            feature_id=FEATURE_ID,
            release_type=RELEASE_TYPE,
            manifest=manifest,
        )
        print(
            f"CREATED {VERSION} -> task {task_id} in Data platform: {task_url(task_id)}"
        )

    print("\n# Now ship it (sets all four custom fields, renames, moves to Shipped,")
    print("# and updates the manifest):\n")
    print(
        "python scripts/teamwork_ship_task.py \\\n"
        f"  --task-id {task_id} \\\n"
        f"  --version {VERSION} \\\n"
        f'  --title "{TITLE}" \\\n'
        f"  --feature-id {FEATURE_ID} \\\n"
        f'  --release-type "{RELEASE_TYPE}" \\\n'
        f"  --estimate-base {ESTIMATE_BASE} \\\n"
        f"  --estimate-head {ESTIMATE_HEAD} \\\n"
        "  --update-manifest"
    )


if __name__ == "__main__":
    main()
