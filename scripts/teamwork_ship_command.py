#!/usr/bin/env python3
"""Print a copy-paste Teamwork ship command for the current or named release task."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_intake import load_manifest, normalize_feature_id  # noqa: E402

CODE_JS_PATH = ROOT / "src" / "Code.js"


def read_fos_prd_version() -> str:
    if not CODE_JS_PATH.exists():
        return "?"
    match = re.search(
        r"FOS_PRD_VERSION\s*=\s*['\"]([^'\"]+)['\"]",
        CODE_JS_PATH.read_text(encoding="utf-8"),
    )
    return match.group(1) if match else "?"


class MissingReleaseTask(Exception):
    """No open release task exists, so this release is untracked in Teamwork."""

    def __init__(self, feature_id: str | None, shipped: list[tuple[str, dict]]):
        super().__init__("No open release task")
        self.feature_id = feature_id
        self.shipped = shipped


def is_open_task(entry: dict) -> bool:
    if entry.get("shippedVersion"):
        return False
    if entry.get("provisionalTaskName") is False and entry.get("shippedAt"):
        return False
    return True


def find_task(
    manifest: dict,
    *,
    manifest_task: str | None,
    feature_id: str | None,
    current_version: str = "",
) -> tuple[str, dict]:
    tasks: dict = manifest.get("tasks", {})

    if manifest_task:
        if manifest_task not in tasks:
            raise SystemExit(f"Manifest task not found: {manifest_task!r}")
        return manifest_task, tasks[manifest_task]

    if feature_id:
        fid = normalize_feature_id(feature_id)
        matches = [
            (key, entry)
            for key, entry in tasks.items()
            if normalize_feature_id(str(entry.get("featureId", ""))) == fid
        ]
        already = [
            (k, e)
            for k, e in matches
            if current_version
            and str(e.get("shippedVersion") or "").lstrip("v") == current_version
        ]
        if len(already) == 1:
            return already[0]
        open_matches = [(k, e) for k, e in matches if is_open_task(e)]
        if len(open_matches) == 1:
            return open_matches[0]
        if len(open_matches) > 1:
            keys = "\n  ".join(k for k, _ in open_matches)
            raise SystemExit(f"Multiple open tasks for feature {fid}:\n  {keys}")
        raise MissingReleaseTask(fid, matches)

    open_tasks = [(k, e) for k, e in tasks.items() if is_open_task(e)]
    if not open_tasks:
        raise MissingReleaseTask(None, [])
    if len(open_tasks) > 1:
        lines = [
            f"  --feature-id {e.get('featureId')}  # {k}"
            for k, e in open_tasks
            if e.get("featureId")
        ]
        raise SystemExit(
            "Multiple open release tasks. Re-run with one of:\n"
            + "\n".join(lines)
            + "\nOr pass --manifest-task \"...\""
        )
    return open_tasks[0]


def build_ship_command(
    manifest_task_key: str,
    entry: dict,
    *,
    shell_line_continuation: str = " \\",
) -> str:
    lines = [
        "python3 scripts/teamwork_ship_task.py \\",
        f'  --manifest-task "{manifest_task_key}" \\',
        "  --version-from-codejs \\",
    ]
    release_type = entry.get("releaseType")
    if release_type:
        lines.append(f'  --release-type {release_type} \\')
    feature_id = entry.get("featureId")
    if feature_id and not release_type:
        lines.append(f'  --feature-id {normalize_feature_id(str(feature_id))} \\')
    lines.append("  --update-manifest")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Print copy-paste teamwork_ship_task.py command for a release."
    )
    parser.add_argument(
        "--manifest-task",
        help="Exact manifest tasks{} key (current Teamwork task name).",
    )
    parser.add_argument(
        "--feature-id",
        help="Three-digit feature id (resolves open manifest task).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON with command and metadata instead of plain text.",
    )
    return parser.parse_args()


def build_ensure_command(feature_id: str | None, latest: dict, version: str) -> str:
    tasklist = latest.get("tasklist") or "Data platform"
    release_type = latest.get("releaseType") or "Enhancement"
    lines = [
        "python scripts/teamwork_ensure_release_task.py \\",
        "  --version-from-codejs \\",
        '  --title "<release title, no version prefix>" \\',
        f"  --feature-id {feature_id or '<NNN>'} \\",
        f'  --release-type "{release_type}" \\',
        f'  --tasklist "{tasklist}" \\',
        "  --description-file <path to release notes> \\",
        "  --ship",
    ]
    return "\n".join(lines)


def report_missing_release_task(
    missing: MissingReleaseTask, version: str, *, as_json: bool = False
) -> None:
    fid = missing.feature_id
    latest_entry = missing.shipped[-1][1] if missing.shipped else {}
    if as_json:
        print(
            json.dumps(
                {
                    "action": "create-release-task",
                    "featureId": fid,
                    "fosPrdVersion": version,
                    "shippedTaskKeys": [k for k, _ in missing.shipped],
                    "command": build_ensure_command(fid, latest_entry, version),
                },
                indent=2,
            )
        )
        return
    if fid:
        print(f"# Feature {fid} has no open release task, so v{version} is untracked in Teamwork.")
        if missing.shipped:
            print("# Every task for this feature is already shipped:")
            for key, entry in missing.shipped:
                print(f"#   {entry.get('shippedVersion', '?')}  {key}")
            print("# A feature that ships more than once needs one task per release.")
        else:
            print("# The manifest has no task for this feature at all.")
    else:
        print(f"# No open release task in the manifest, so v{version} is untracked in Teamwork.")
    print("# Create this release's task and ship it in one step:")
    print()
    print(build_ensure_command(fid, latest_entry, version))


def main() -> None:
    args = parse_args()
    manifest = load_manifest()
    version = read_fos_prd_version()
    try:
        key, entry = find_task(
            manifest,
            manifest_task=args.manifest_task,
            feature_id=args.feature_id,
            current_version=version,
        )
    except MissingReleaseTask as missing:
        report_missing_release_task(missing, version, as_json=args.json)
        return
    command = build_ship_command(key, entry)
    title = entry.get("releaseTitle") or key.split(" - ", 1)[-1]
    meta = {
        "manifestTaskKey": key,
        "taskId": entry.get("id"),
        "featureId": entry.get("featureId"),
        "releaseType": entry.get("releaseType"),
        "releaseTitle": title,
        "fosPrdVersion": version,
        "expectedTaskNameAfterShip": f"v{version} - {title}",
        "command": command,
    }
    if args.json:
        print(json.dumps(meta, indent=2))
        return

    print("# Run from repo root after PRD bump, commit, and clasp push.")
    print(f"# Task id {entry.get('id')} · Feature {entry.get('featureId') or '?'} · "
          f"will ship as v{version} - {title}")
    print()
    print(command)


if __name__ == "__main__":
    main()
