#!/usr/bin/env python3
"""Archive the accidental duplicate Feature 051 release task (40943856).

Re-running teamwork_publish_feature_051.py after ship renamed the release task
to v3.20.14 - ... so ensure_release_task could not find the provisional manifest
key and created a second Spec Draft release task.

Idempotent: skips when the duplicate is already Archived with the supersede note.
"""

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
DUPLICATE_TASK_ID = 40943856
KEPT_TASK_ID = 40940299
KEPT_TASK_NAME = "v3.20.14 - PM Overview contract duration on project select"
DUPLICATE_MANIFEST_KEY = "Feature 051 - PM Overview contract duration on project select"
KEPT_MANIFEST_KEY = KEPT_TASK_NAME


def note_for() -> str:
    return f"""

---
{NOTE_MARKER}

`teamwork_publish_feature_051.py` was re-run after this feature shipped as
**v3.20.14**. The publish helper looked up the provisional task name in the
manifest, did not find it (the shipped task key is `v3.20.14 - ...`), and
created this duplicate Spec Draft task.

**Authoritative release task:** {task_url(KEPT_TASK_ID)}
  ({KEPT_TASK_NAME})

This duplicate was never worked. Archived (not completed) so delivery history
stays accurate.
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


def clean_manifest(manifest: dict) -> bool:
    tasks = manifest.setdefault("tasks", {})
    changed = False
    dup = tasks.pop(DUPLICATE_MANIFEST_KEY, None)
    if dup:
        changed = True
    if KEPT_MANIFEST_KEY not in tasks:
        raise SystemExit(f"Missing kept manifest task {KEPT_MANIFEST_KEY!r}")
    superseded = manifest.setdefault("supersededDuplicates", {})
    entry = superseded.setdefault(
        "feature_051",
        {
            "resolvedAt": date.today().isoformat(),
            "note": (
                "Accidental duplicate release task created when publish script "
                "re-ran after ship. Archived with supersede note; manifest "
                "tracks v3.20.14 release task only."
            ),
            "archivedTasks": [],
        },
    )
    archived = entry.setdefault("archivedTasks", [])
    if not any(t.get("id") == DUPLICATE_TASK_ID for t in archived):
        archived.append(
            {
                "id": DUPLICATE_TASK_ID,
                "name": DUPLICATE_MANIFEST_KEY,
                "tasklist": "Delivery",
                "previousStage": "Spec Draft",
                "supersededByTaskId": KEPT_TASK_ID,
            }
        )
        changed = True
    return changed


def main() -> None:
    stage = get_task_workflow_stage(DUPLICATE_TASK_ID)
    append_note_if_missing(DUPLICATE_TASK_ID, note_for())
    if stage == STAGE_ARCHIVED_ID:
        print(f"SKIP {DUPLICATE_TASK_ID}: already Archived")
    else:
        move_task_to_workflow_stage(DUPLICATE_TASK_ID, STAGE_ARCHIVED_ID)
        print(f"ARCHIVED duplicate {DUPLICATE_TASK_ID} -> kept {KEPT_TASK_ID}")

    manifest = load_manifest()
    if clean_manifest(manifest):
        save_manifest(manifest)
        print(f"Updated {ROOT / 'docs/teamwork-manifest.json'}")
    else:
        print("Manifest already clean")


if __name__ == "__main__":
    main()
