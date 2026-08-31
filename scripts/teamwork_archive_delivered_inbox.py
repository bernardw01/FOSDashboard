#!/usr/bin/env python3
"""Archive Inbox tasks whose scope shipped via a linked release task.

Idempotent: skips tasks already archived with the delivered marker.
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
    task_url,
)

NOTE_MARKER = "**Delivered (archived from backlog cleanup).**"

DELIVERED_INBOX = [
    {
        "task_id": 40886771,
        "release_task_id": 40940299,
        "release_name": "v3.20.14 - PM Overview contract duration on project select",
        "version": "3.20.14",
        "feature_id": "051",
    },
    {
        "task_id": 40554541,
        "release_task_id": 40898277,
        "release_name": "v3.18.0 - SOW coverage gaps and unplanned time",
        "version": "3.18.0",
        "feature_id": "048",
    },
    {
        "task_id": 40793086,
        "release_task_id": 40793089,
        "release_name": "v3.7.0 - Resource assignments By person variances",
        "version": "3.7.0",
        "feature_id": "042",
    },
    {
        "task_id": 40850291,
        "release_task_id": 40857619,
        "release_name": "v3.9.0 - PM Overview resource time-entry drill-down",
        "version": "3.9.0",
        "feature_id": "045",
    },
    {
        "task_id": 40850310,
        "release_task_id": 40857620,
        "release_name": "v3.9.0 - Hide planned margins without a resource plan",
        "version": "3.9.0",
        "feature_id": "046",
    },
]


def note_for(entry: dict) -> str:
    release_url = task_url(entry["release_task_id"])
    return f"""

---
{NOTE_MARKER}

This inbox request was implemented in product release **{entry['version']}**
(feature **{entry['feature_id']}**).

Release task: {release_url}
  ({entry['release_name']})

Archived rather than marked complete so intake history stays visible.
"""


def append_note_if_missing(task_id: int, note: str) -> None:
    res = api("GET", f"/tasks/{task_id}.json")
    item = res.get("todo-item", {})
    desc = str(item.get("description") or "")
    if NOTE_MARKER in desc:
        return
    api(
        "PUT",
        f"/tasks/{task_id}.json",
        {"todo-item": {"description": desc + note}},
    )


def main() -> None:
    for entry in DELIVERED_INBOX:
        task_id = entry["task_id"]
        stage = get_task_workflow_stage(task_id)
        append_note_if_missing(task_id, note_for(entry))
        if stage == STAGE_ARCHIVED_ID:
            print(f"SKIP {task_id}: already Archived")
            continue
        move_task_to_workflow_stage(task_id, STAGE_ARCHIVED_ID)
        print(f"ARCHIVED {task_id} -> {entry['release_name']}")


if __name__ == "__main__":
    main()
