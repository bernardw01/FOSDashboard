#!/usr/bin/env python3
"""Ship ritual: rename release task and set Teamwork custom fields at deploy."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import BASE, api  # noqa: E402
from teamwork_estimate import estimate_from_git  # noqa: E402
from teamwork_intake import (  # noqa: E402
    RELEASE_TYPE_BUG_FIX,
    RELEASE_TYPE_ENHANCEMENT,
    STAGE_SHIPPED_ID,
    build_ship_custom_fields,
    get_task_workflow_stage,
    load_manifest,
    move_task_to_shipped,
    normalize_feature_id,
    normalize_release_type,
)

MANIFEST_PATH = ROOT / "docs" / "teamwork-manifest.json"
CODE_JS_PATH = ROOT / "src" / "Code.js"
PRD_PATH = ROOT / "docs" / "FOS-Dashboard-PRD.md"


def normalize_version(version: str) -> str:
    version = version.strip()
    if version.lower().startswith("v"):
        version = version[1:]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Invalid version (expected X.Y.Z): {version!r}")
    return version


def release_name(version: str, title: str) -> str:
    v = normalize_version(version)
    title = title.strip()
    if not title:
        raise SystemExit("Release title is required.")
    return f"v{v} - {title}"


def read_fos_prd_version() -> str:
    if not CODE_JS_PATH.exists():
        raise SystemExit(f"Missing {CODE_JS_PATH}")
    match = re.search(
        r"FOS_PRD_VERSION\s*=\s*['\"]([^'\"]+)['\"]",
        CODE_JS_PATH.read_text(encoding="utf-8"),
    )
    if not match:
        raise SystemExit("FOS_PRD_VERSION not found in src/Code.js")
    return normalize_version(match.group(1))


def read_fos_release_description() -> str:
    if not CODE_JS_PATH.exists():
        return ""
    match = re.search(
        r"FOS_RELEASE_DESCRIPTION\s*=\s*\n?\s*['\"]([^'\"]+)['\"]",
        CODE_JS_PATH.read_text(encoding="utf-8"),
    )
    return match.group(1).strip() if match else ""


def read_prd_changelog_summary_for_version(version: str) -> str:
    if not PRD_PATH.exists():
        return ""
    text = PRD_PATH.read_text(encoding="utf-8")
    in_log = False
    for line in text.splitlines():
        if line.strip().startswith("## 13)") or line.strip() == "## 13) Change Log":
            in_log = True
            continue
        if not in_log or not line.startswith("| 20"):
            continue
        cells = [c.strip() for c in line.split("|")]
        if len(cells) >= 4 and cells[2] == version:
            return cells[3]
    return ""


def infer_release_type(
    manifest_entry: dict, override: str | None, *, version: str
) -> str:
    if override and override.lower() != "auto":
        return normalize_release_type(override)
    if manifest_entry.get("releaseType"):
        return normalize_release_type(str(manifest_entry["releaseType"]))
    haystack = " ".join(
        [
            read_fos_release_description(),
            read_prd_changelog_summary_for_version(version),
        ]
    ).lower()
    bug_markers = (
        "bug fix",
        "bugfix",
        "fix ",
        " fixes ",
        "fixed ",
        "corrects",
        "repair",
        "hotfix",
    )
    if any(m in haystack for m in bug_markers):
        return RELEASE_TYPE_BUG_FIX
    return RELEASE_TYPE_ENHANCEMENT


def resolve_feature_id(manifest: dict, manifest_entry: dict, explicit: str | None) -> str:
    if explicit:
        return normalize_feature_id(explicit)
    if manifest_entry.get("featureId"):
        return normalize_feature_id(str(manifest_entry["featureId"]))
    notebook_key = manifest_entry.get("notebookKey")
    if notebook_key:
        nb = manifest.get("notebooks", {}).get(notebook_key, {})
        if nb.get("featureId"):
            return normalize_feature_id(str(nb["featureId"]))
    raise SystemExit(
        "Feature ID not found. Set featureId on the manifest task, pass --feature-id, "
        "or link notebookKey with featureId."
    )


def resolve_manifest_task(manifest: dict, manifest_task: str) -> tuple[int, str, dict]:
    tasks = manifest.get("tasks", {})
    if manifest_task not in tasks:
        keys = "\n  ".join(sorted(tasks))
        raise SystemExit(f"Manifest task key not found: {manifest_task!r}\nKnown keys:\n  {keys}")
    entry = dict(tasks[manifest_task])
    task_id = int(entry["id"])
    title = entry.get("releaseTitle") or manifest_task.split(" - ", 1)[-1]
    return task_id, title, entry


def get_task_name(task_id: int) -> str:
    res = api("GET", f"/tasks/{task_id}.json")
    return str(res.get("todo-item", {}).get("content", ""))


def ship_task_release(
    task_id: int,
    release_name_value: str,
    custom_fields: list[dict],
    *,
    dry_run: bool = False,
) -> None:
    body = {
        "todo-item": {
            "content": release_name_value,
            "customFields": custom_fields,
        }
    }
    if dry_run:
        print("DRY RUN - would PUT /tasks/{id}.json:")
        print(json.dumps(body, indent=2))
        return
    api("PUT", f"/tasks/{task_id}.json", body)


def update_manifest_after_ship(
    manifest: dict,
    old_key: str | None,
    task_id: int,
    release_name_value: str,
    version: str,
    *,
    feature_id: str,
    release_type: str,
    est_dev_hours: float,
    est_rationale: list[str],
    estimate_git_base: str,
) -> None:
    tasks = manifest.setdefault("tasks", {})
    entry: dict
    if old_key and old_key in tasks:
        entry = tasks.pop(old_key)
    else:
        entry = next((t for t in tasks.values() if int(t.get("id", 0)) == task_id), {})
        if old_key and old_key in tasks:
            tasks.pop(old_key, None)

    entry.update(
        {
            "id": task_id,
            "featureId": feature_id,
            "releaseType": release_type,
            "shippedVersion": f"v{version}",
            "provisionalTaskName": False,
            "releaseTitle": release_name_value.split(" - ", 1)[-1],
            "url": f"{BASE}/app/tasks/{task_id}",
            "shippedAt": date.today().isoformat(),
            "estDevHours": int(round(est_dev_hours)),
            "estDevHoursRationale": est_rationale,
            "estDevHoursGitBase": estimate_git_base,
            "workflowStage": "Shipped",
        }
    )
    tasks[release_name_value] = entry
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Updated manifest task key -> {release_name_value!r}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Ship ritual automation: rename release task, set custom fields "
            "(Release Version, Feature ID, Release Type, Estimated Dev Hours), "
            "and move the task to workflow stage Shipped."
        )
    )
    parser.add_argument(
        "--task-id",
        type=int,
        help="Teamwork task id (e.g. 40139491).",
    )
    parser.add_argument(
        "--manifest-task",
        help="Current manifest tasks{} key (resolves task id and default title).",
    )
    parser.add_argument(
        "--version",
        help="Release version X.Y.Z (optional if --version-from-codejs).",
    )
    parser.add_argument(
        "--version-from-codejs",
        action="store_true",
        help="Read version from FOS_PRD_VERSION in src/Code.js.",
    )
    parser.add_argument(
        "--title",
        help="Release title suffix after version (e.g. 'AI usage OpenAI ingest').",
    )
    parser.add_argument(
        "--feature-id",
        help="Three-digit feature id (default: manifest task or linked notebook).",
    )
    parser.add_argument(
        "--release-type",
        default="auto",
        help="Enhancement, Bug Fix, or auto (manifest, then PRD/changelog inference).",
    )
    parser.add_argument(
        "--est-dev-hours",
        type=float,
        help="Override lead-developer hour estimate (integer stored in Teamwork).",
    )
    parser.add_argument(
        "--estimate-base",
        help="Git ref for hour estimate diff base (default: prior 'Ship PRD' commit).",
    )
    parser.add_argument(
        "--estimate-head",
        default="HEAD",
        help="Git ref for hour estimate diff head (default: HEAD).",
    )
    parser.add_argument(
        "--no-estimate",
        action="store_true",
        help="Skip auto-estimate; requires --est-dev-hours.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print payload without calling Teamwork API.",
    )
    parser.add_argument(
        "--update-manifest",
        action="store_true",
        help="Rename manifest task key and record ship metadata after API update.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = load_manifest()
    fields = manifest.get("taskCustomFields", {})

    manifest_key: str | None = args.manifest_task
    task_id = args.task_id
    title = args.title
    manifest_entry: dict = {}

    if manifest_key:
        resolved_id, manifest_title, manifest_entry = resolve_manifest_task(manifest, manifest_key)
        task_id = task_id or resolved_id
        title = title or manifest_title
    if not task_id:
        raise SystemExit("Provide --task-id or --manifest-task.")

    if args.version_from_codejs:
        version = read_fos_prd_version()
    elif args.version:
        version = normalize_version(args.version)
    else:
        raise SystemExit("Provide --version or --version-from-codejs.")

    if not title:
        raise SystemExit("Provide --title or --manifest-task with releaseTitle in manifest.")

    feature_id = resolve_feature_id(manifest, manifest_entry, args.feature_id)
    release_type = infer_release_type(manifest_entry, args.release_type, version=version)

    if args.est_dev_hours is not None:
        est_hours = float(args.est_dev_hours)
        est_rationale = [f"Explicit --est-dev-hours: {est_hours:.1f}h"]
        estimate_git_base = args.estimate_base or "(manual)"
    elif args.no_estimate:
        raise SystemExit("Provide --est-dev-hours or allow auto-estimate (default).")
    else:
        est_hours, est_rationale, estimate_git_base = estimate_from_git(
            base_ref=args.estimate_base,
            head_ref=args.estimate_head,
            release_type=release_type,
        )

    name = release_name(version, title)
    custom_fields = build_ship_custom_fields(
        manifest,
        release_name_value=name,
        feature_id=feature_id,
        release_type=release_type,
        est_dev_hours=est_hours,
    )

    previous = get_task_name(task_id) if not args.dry_run else "(dry-run)"

    print(f"Task id:          {task_id}")
    print(f"Previous name:    {previous}")
    print(f"Release name:     {name}")
    print(f"Feature ID:       {feature_id} ({fields.get('featureId', {}).get('name', 'Feature ID')})")
    print(f"Release type:     {release_type} ({fields.get('releaseType', {}).get('name', 'Release Type')})")
    est_field = fields.get("estimatedDevHours", {}).get("name", "Estimated Dev Hours")
    print(f"Est dev hours:    {int(round(est_hours))} ({est_field})")
    print("Estimate basis:")
    for line in est_rationale:
        print(f"  - {line}")

    ship_task_release(task_id, name, custom_fields, dry_run=args.dry_run)

    if args.dry_run:
        print(f"DRY RUN - would move task {task_id} to workflow stage Shipped ({STAGE_SHIPPED_ID})")
        print("Dry run complete.")
        return

    print("Teamwork task updated.")
    verified = get_task_name(task_id)
    if verified != name:
        raise SystemExit(f"Task name verify failed: expected {name!r}, got {verified!r}")
    print(f"Verified name:    {verified}")

    moved = move_task_to_shipped(task_id)
    stage = get_task_workflow_stage(task_id)
    if stage != STAGE_SHIPPED_ID:
        raise SystemExit(
            f"Workflow move failed: expected stage {STAGE_SHIPPED_ID} (Shipped), got {stage!r}"
        )
    if moved:
        print(f"Workflow stage:   Shipped ({STAGE_SHIPPED_ID})")
    else:
        print(f"Workflow stage:   Shipped ({STAGE_SHIPPED_ID}, already set)")

    if args.update_manifest:
        update_manifest_after_ship(
            manifest,
            manifest_key,
            task_id,
            name,
            version,
            feature_id=feature_id,
            release_type=release_type,
            est_dev_hours=est_hours,
            est_rationale=est_rationale,
            estimate_git_base=estimate_git_base,
        )


if __name__ == "__main__":
    main()
