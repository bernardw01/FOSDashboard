#!/usr/bin/env python3
"""Archive the superseded duplicate Teamwork tasks for features 041 and 042.

On 2026-08-14 the intake/publish run for features 041 and 042 executed twice
about ten seconds apart, creating two complete sets of records:

  12:48:25-30  notebooks 313278-313281, inbox 40793083,
               release tasks 40793084 (041) and 40793085 (042)   <- superseded
  12:48:36-37  notebooks 313282-313285, inbox 40793086,
               release tasks 40793088 (041) and 40793089 (042)   <- kept

The second set is the one that shipped: 40793088 and 40793089 are named
`v3.7.0 - ...`, are complete, sit in workflow stage Shipped, carry all four
custom fields, and link notebooks 313282-313285, which are the ids recorded in
`docs/teamwork-manifest.json`. The first set never advanced past Spec Draft and
links notebooks that the manifest does not track.

This script is deliberately non-destructive. It appends a supersede note to each
duplicate's description and moves it to the **Archived** workflow stage
(`389194`). Nothing is deleted, and nothing is marked complete, because these
tasks were never worked; completing them would misreport delivered work.

Idempotent: a task already carrying the note and already in Archived is skipped.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import api  # noqa: E402
from teamwork_intake import (  # noqa: E402
    STAGE_ARCHIVED_ID,
    get_task_workflow_stage,
    move_task_to_workflow_stage,
)

NOTE_MARKER = "**Superseded duplicate (archived 2026-08-25).**"

DUPLICATES = [
    {
        "task_id": 40793084,
        "name": "Feature 041 - PM Overview rebrand",
        "kept_task_id": 40793088,
        "kept_name": "v3.7.0 - PM Overview rebrand",
        "stale_notebooks": "313278, 313279",
        "kept_notebooks": "313282, 313283",
    },
    {
        "task_id": 40793085,
        "name": "Feature 042 - Resource assignments By person variances",
        "kept_task_id": 40793089,
        "kept_name": "v3.7.0 - Resource assignments By person variances",
        "stale_notebooks": "313280, 313281",
        "kept_notebooks": "313284, 313285",
    },
    {
        "task_id": 40793083,
        "name": "Feature request - Resource assignments by person variances",
        "kept_task_id": 40793086,
        "kept_name": "Feature request - Resource assignments by person variances",
        "stale_notebooks": "313280",
        "kept_notebooks": "313284",
    },
]


def note_for(dup: dict) -> str:
    return f"""

---
{NOTE_MARKER}

The 2026-08-14 intake run for features 041 and 042 executed twice about ten
seconds apart and created two complete sets of records. This task is from the
first set and was never worked.

Superseded by: https://win.godeap.io/app/tasks/{dup['kept_task_id']}
  ({dup['kept_name']})

Notebooks linked above ({dup['stale_notebooks']}) are the superseded copies.
The tracked notebooks are {dup['kept_notebooks']}, recorded in
docs/teamwork-manifest.json.

Archived rather than deleted so the history stays recoverable. Not marked
complete, because no work was done against this record.
"""


def get_description(task_id: int) -> str:
    res = api("GET", f"/tasks/{task_id}.json")
    return str(res.get("todo-item", {}).get("description") or "")


def main() -> None:
    for dup in DUPLICATES:
        task_id = int(dup["task_id"])
        desc = get_description(task_id)

        if NOTE_MARKER in desc:
            print(f"{task_id}: note already present, skipping description update")
        else:
            api(
                "PUT",
                f"/tasks/{task_id}.json",
                {"todo-item": {"description": desc + note_for(dup)}},
            )
            print(f"{task_id}: appended supersede note")

        stage = get_task_workflow_stage(task_id)
        if stage == STAGE_ARCHIVED_ID:
            print(f"{task_id}: already in Archived ({STAGE_ARCHIVED_ID})")
        else:
            move_task_to_workflow_stage(task_id, STAGE_ARCHIVED_ID)
            after = get_task_workflow_stage(task_id)
            if after != STAGE_ARCHIVED_ID:
                raise SystemExit(
                    f"{task_id}: archive failed, expected {STAGE_ARCHIVED_ID}, got {after!r}"
                )
            print(f"{task_id}: moved {stage!r} -> Archived ({STAGE_ARCHIVED_ID})")


if __name__ == "__main__":
    main()
