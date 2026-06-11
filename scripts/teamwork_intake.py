#!/usr/bin/env python3
"""Shared helpers for Teamwork feature intake (inbox -> release task)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from teamwork_bootstrap import BASE, PROJECT_ID, api

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "docs" / "teamwork-manifest.json"

# AI Dev Workflow on FOS Dashboard Development (project 1615262)
WORKFLOW_ID = 83492
STAGE_BACKLOG_ID = 0
STAGE_SPEC_DRAFT_ID = 389189
STAGE_SPEC_APPROVED_ID = 389190
STAGE_PLANNED_ID = 389191
STAGE_IN_PROGRESS_ID = 389192
STAGE_SHIPPED_ID = 389193
STAGE_ARCHIVED_ID = 389194

RELEASE_TYPE_ENHANCEMENT = "Enhancement"
RELEASE_TYPE_BUG_FIX = "Bug Fix"


def load_manifest() -> dict[str, Any]:
    if not MANIFEST_PATH.exists():
        return {}
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def task_custom_field_ids(manifest: dict[str, Any] | None = None) -> dict[str, int]:
    manifest = manifest or load_manifest()
    fields = manifest.get("taskCustomFields", {})
    out = {
        "releaseVersion": int(fields["releaseVersion"]["id"]),
        "featureId": int(fields["featureId"]["id"]),
        "releaseType": int(fields["releaseType"]["id"]),
    }
    est = fields.get("estimatedDevHours") or fields.get("estDevHours")
    if est and est.get("id"):
        out["estDevHours"] = int(est["id"])
    return out


def build_ship_custom_fields(
    manifest: dict[str, Any],
    *,
    release_name_value: str,
    feature_id: str,
    release_type: str,
    est_dev_hours: float | int,
) -> list[dict[str, Any]]:
    """All task custom fields set during the ship ritual."""
    ids = task_custom_field_ids(manifest)
    if "estDevHours" not in ids:
        raise SystemExit(
            "taskCustomFields.estimatedDevHours.id missing in teamwork-manifest.json"
        )
    hours_int = int(round(float(est_dev_hours)))
    if hours_int < 1:
        raise SystemExit(f"est_dev_hours must be >= 1, got {est_dev_hours!r}")
    return [
        {"customFieldId": ids["releaseVersion"], "value": release_name_value},
        {"customFieldId": ids["featureId"], "value": normalize_feature_id(feature_id)},
        {
            "customFieldId": ids["releaseType"],
            "value": normalize_release_type(release_type),
        },
        {"customFieldId": ids["estDevHours"], "value": str(hours_int)},
    ]


def normalize_feature_id(feature_id: str) -> str:
    feature_id = str(feature_id).strip().lstrip("0") or "0"
    if not feature_id.isdigit():
        raise ValueError(f"Invalid feature id: {feature_id!r}")
    return feature_id.zfill(3)


def normalize_release_type(release_type: str) -> str:
    value = release_type.strip().lower()
    if value in ("enhancement", "feature", "minor"):
        return RELEASE_TYPE_ENHANCEMENT
    if value in ("bug", "bug fix", "bugfix", "patch", "fix"):
        return RELEASE_TYPE_BUG_FIX
    if release_type in (RELEASE_TYPE_ENHANCEMENT, RELEASE_TYPE_BUG_FIX):
        return release_type
    raise ValueError(
        f"Invalid release type: {release_type!r} "
        f"(use Enhancement or Bug Fix)"
    )


def get_task_workflow_stage(task_id: int) -> int | None:
    res = api("GET", f"/projects/api/v3/tasks/{task_id}.json")
    stages = res.get("task", {}).get("workflowStages") or []
    if not stages:
        return None
    return int(stages[0].get("stageId", 0))


def move_task_to_workflow_stage(task_id: int, stage_id: int, workflow_id: int = WORKFLOW_ID) -> None:
    """Move an existing task from backlog (stage 0) to a workflow column."""
    api(
        "POST",
        f"/projects/api/v3/workflows/{workflow_id}/stages/{stage_id}/tasks.json",
        {"taskIds": [task_id]},
    )


def move_task_to_spec_draft(task_id: int) -> None:
    current = get_task_workflow_stage(task_id)
    if current == STAGE_SPEC_DRAFT_ID:
        return
    move_task_to_workflow_stage(task_id, STAGE_SPEC_DRAFT_ID)


def set_task_custom_fields(
    task_id: int,
    *,
    feature_id: str | None = None,
    release_type: str | None = None,
    release_version: str | None = None,
    est_dev_hours: float | int | None = None,
    manifest: dict[str, Any] | None = None,
) -> None:
    ids = task_custom_field_ids(manifest)
    custom_fields: list[dict[str, Any]] = []
    if feature_id is not None:
        custom_fields.append(
            {"customFieldId": ids["featureId"], "value": normalize_feature_id(feature_id)}
        )
    if release_type is not None:
        custom_fields.append(
            {
                "customFieldId": ids["releaseType"],
                "value": normalize_release_type(release_type),
            }
        )
    if release_version is not None:
        custom_fields.append(
            {"customFieldId": ids["releaseVersion"], "value": release_version}
        )
    if est_dev_hours is not None:
        if "estDevHours" not in ids:
            raise SystemExit(
                "taskCustomFields.estimatedDevHours.id missing in teamwork-manifest.json"
            )
        custom_fields.append(
            {
                "customFieldId": ids["estDevHours"],
                "value": str(int(round(float(est_dev_hours)))),
            }
        )
    if not custom_fields:
        return
    api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"customFields": custom_fields}})


def create_release_task(
    tasklist_id: int,
    name: str,
    description: str,
    *,
    feature_id: str,
    release_type: str = RELEASE_TYPE_ENHANCEMENT,
    workflow_stage_id: int = STAGE_SPEC_DRAFT_ID,
    manifest: dict[str, Any] | None = None,
) -> int:
    """
    Create a release task directly in Spec Draft (not backlog) and set custom fields.
    """
    body: dict[str, Any] = {
        "task": {"name": name, "description": description},
        "workflows": {"workflowId": WORKFLOW_ID, "stageId": workflow_stage_id},
    }
    res = api("POST", f"/projects/api/v3/tasklists/{tasklist_id}/tasks.json", body)
    task_id = int(res["task"]["id"])
    set_task_custom_fields(
        task_id,
        feature_id=feature_id,
        release_type=release_type,
        manifest=manifest,
    )
    stage = get_task_workflow_stage(task_id)
    if stage != workflow_stage_id:
        move_task_to_workflow_stage(task_id, workflow_stage_id)
    return task_id


def link_inbox_task(inbox_task_id: int, notebook_url: str, release_task_url: str) -> None:
    raw = api("GET", f"/tasks/{inbox_task_id}.json")
    item = raw.get("todo-item", {})
    desc = item.get("description") or ""
    appendix = (
        f"\n\n---\nFeature spec notebook: {notebook_url}\n"
        f"Release task: {release_task_url}\n"
    )
    if notebook_url in desc:
        return
    api(
        "PUT",
        f"/tasks/{inbox_task_id}.json",
        {"todo-item": {"description": desc + appendix}},
    )


def task_url(task_id: int) -> str:
    return f"{BASE}/app/tasks/{task_id}"
