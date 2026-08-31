#!/usr/bin/env python3
"""Archive duplicate Feature 050 release task 40928860 (superseded by 40926974)."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import api  # noqa: E402
from teamwork_intake import (  # noqa: E402
    STAGE_ARCHIVED_ID,
    get_task_workflow_stage,
    load_manifest,
    move_task_to_workflow_stage,
    task_url,
)
from teamwork_sync_notebook import save_manifest  # noqa: E402

NOTE_MARKER = "**Superseded duplicate (archived 2026-08-31).**"
DUPLICATE_TASK_ID = 40928860
KEPT_TASK_ID = 40926974


def note_for(kept_name: str) -> str:
    return f"""

---
{NOTE_MARKER}

Early publish run created this duplicate **Feature 050** release task. The
authoritative release task is **{kept_name}** ({task_url(KEPT_TASK_ID)}).

This duplicate was never the tracked manifest task. Archived (not deleted) so
intake history stays visible.
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


def clean_manifest(manifest: dict, kept_name: str) -> bool:
    superseded = manifest.setdefault("supersededDuplicates", {})
    entry = superseded.setdefault(
        "feature_050",
        {
            "resolvedAt": date.today().isoformat(),
            "note": (
                "Duplicate release task from early publish; authoritative task "
                "is the manifest-tracked release (shipped as v3.20.14)."
            ),
            "archivedTasks": [],
        },
    )
    archived = entry.setdefault("archivedTasks", [])
    if any(t.get("id") == DUPLICATE_TASK_ID for t in archived):
        return False
    archived.append(
        {
            "id": DUPLICATE_TASK_ID,
            "name": "Feature 050 - PM Overview perf allocation drill-down",
            "tasklist": "Delivery",
            "previousStage": "Shipped",
            "supersededByTaskId": KEPT_TASK_ID,
        }
    )
    return True


def main() -> None:
    manifest = load_manifest()
    kept_key = next(
        (
            k
            for k, v in manifest.get("tasks", {}).items()
            if int(v.get("id", 0)) == KEPT_TASK_ID
        ),
        "v3.20.14 - PM Overview perf allocation drill-down",
    )
    kept_name = kept_key

    stage = get_task_workflow_stage(DUPLICATE_TASK_ID)
    append_note_if_missing(DUPLICATE_TASK_ID, note_for(kept_name))
    if stage == STAGE_ARCHIVED_ID:
        print(f"SKIP {DUPLICATE_TASK_ID}: already Archived")
    else:
        move_task_to_workflow_stage(DUPLICATE_TASK_ID, STAGE_ARCHIVED_ID)
        print(f"ARCHIVED duplicate {DUPLICATE_TASK_ID} -> kept {KEPT_TASK_ID}")

    if clean_manifest(manifest, kept_name):
        save_manifest(manifest)
        print(f"Updated {ROOT / 'docs/teamwork-manifest.json'}")


if __name__ == "__main__":
    main()
