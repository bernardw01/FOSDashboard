#!/usr/bin/env python3
"""Ensure a Teamwork release task exists for one release, then ship it.

A feature gets one release task at intake, but a feature that ships in several
releases (047 workstream B1, B2, B3 ...) needs one task per release. Nothing in
the ship path used to create those, so every release after the first shipped
untracked and was backfilled later by a bespoke script. This helper is that
script, parameterized once: it replaces
`teamwork_backfill_releases_3_9_5_to_3_10_1.py` and
`teamwork_backfill_release_3_11_0.py`.

Use it whenever `teamwork_ship_command.py` reports that a feature has no open
release task, whether the release is shipping now or is being backfilled after
the fact. The created task follows the intake contract exactly (Spec Draft,
Feature ID and Release Type set); the ship half (Release Version, Estimated Dev
Hours, the vX.Y.Z rename, the move to Shipped, the manifest update) is delegated
to `teamwork_ship_task.py` so the release goes through the identical ritual.

Idempotent: a release already recorded in the manifest, or whose task name
already exists in the project, is not created twice.

Example:

    python scripts/teamwork_ensure_release_task.py \
      --version-from-codejs \
      --title "Slim visualization payloads" \
      --feature-id 047 \
      --release-type Enhancement \
      --tasklist "Data platform" \
      --description-file tmp/release-notes.md \
      --estimate-base 581c668 \
      --ship
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_intake import (  # noqa: E402
    create_release_task,
    existing_task_names,
    load_manifest,
    manifest_version_index,
    normalize_feature_id,
    normalize_release_type,
    task_url,
)

CODE_JS_PATH = ROOT / "src" / "Code.js"


def read_fos_prd_version() -> str:
    match = re.search(
        r"FOS_PRD_VERSION\s*=\s*['\"]([^'\"]+)['\"]",
        CODE_JS_PATH.read_text(encoding="utf-8"),
    )
    if not match:
        raise SystemExit("FOS_PRD_VERSION not found in src/Code.js")
    return match.group(1)


def normalize_version(version: str) -> str:
    version = version.strip().lstrip("vV")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Invalid version (expected X.Y.Z): {version!r}")
    return version


def resolve_tasklist_id(manifest: dict, name: str | None, explicit: int | None) -> tuple[int, str]:
    tasklists: dict = manifest.get("tasklists", {})
    if explicit:
        for key, entry in tasklists.items():
            if int(entry.get("id", 0)) == explicit:
                return explicit, key
        return explicit, "(unknown)"
    if not name:
        raise SystemExit("Provide --tasklist or --tasklist-id.")
    if name not in tasklists:
        known = "\n  ".join(sorted(tasklists))
        raise SystemExit(f"Unknown task list {name!r}. Known:\n  {known}")
    return int(tasklists[name]["id"]), name


def read_description(args: argparse.Namespace) -> str:
    if args.description_file:
        return Path(args.description_file).read_text(encoding="utf-8")
    if args.description:
        return args.description
    raise SystemExit("Provide --description or --description-file.")


def ship_flags(
    task_id: int,
    version: str,
    title: str,
    feature_id: str,
    release_type: str,
    *,
    estimate_base: str | None,
    estimate_head: str | None,
) -> list[tuple[str, str | None]]:
    flags: list[tuple[str, str | None]] = [
        ("--task-id", str(task_id)),
        ("--version", version),
        ("--title", title),
        ("--feature-id", feature_id),
        ("--release-type", release_type),
    ]
    if estimate_base:
        flags.append(("--estimate-base", estimate_base))
    if estimate_head:
        flags.append(("--estimate-head", estimate_head))
    flags.append(("--update-manifest", None))
    return flags


def argv_for(flags: list[tuple[str, str | None]]) -> list[str]:
    argv = [sys.executable, "scripts/teamwork_ship_task.py"]
    for flag, value in flags:
        argv.append(flag)
        if value is not None:
            argv.append(value)
    return argv


def printable(flags: list[tuple[str, str | None]]) -> str:
    parts = ["python scripts/teamwork_ship_task.py"]
    for flag, value in flags:
        if value is None:
            parts.append(f"  {flag}")
        elif " " in value:
            parts.append(f'  {flag} "{value}"')
        else:
            parts.append(f"  {flag} {value}")
    return " \\\n".join(parts)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create the Teamwork release task for one release if it is missing, then ship it."
    )
    parser.add_argument("--version", help="Release version X.Y.Z.")
    parser.add_argument(
        "--version-from-codejs",
        action="store_true",
        help="Read the version from FOS_PRD_VERSION in src/Code.js.",
    )
    parser.add_argument("--title", required=True, help="Release title (task name after 'vX.Y.Z - ').")
    parser.add_argument("--feature-id", required=True, help="Three-digit feature id, e.g. 047.")
    parser.add_argument("--release-type", default="Enhancement", help="Enhancement or Bug Fix.")
    parser.add_argument("--tasklist", help="Task list name from the manifest, e.g. 'Data platform'.")
    parser.add_argument("--tasklist-id", type=int, help="Task list id (overrides --tasklist).")
    parser.add_argument("--description", help="Task description text.")
    parser.add_argument("--description-file", help="Path to a file holding the task description.")
    parser.add_argument("--estimate-base", help="Git ref for the hour-estimate diff base.")
    parser.add_argument("--estimate-head", help="Git ref for the hour-estimate diff head.")
    parser.add_argument(
        "--ship",
        action="store_true",
        help="Run teamwork_ship_task.py immediately instead of only printing the command.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be created without calling the Teamwork API.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    version = normalize_version(
        read_fos_prd_version() if args.version_from_codejs else (args.version or "")
    )
    feature_id = normalize_feature_id(args.feature_id)
    release_type = normalize_release_type(args.release_type)
    title = args.title.strip()
    shipped_name = f"v{version} - {title}"

    manifest = load_manifest()
    by_version = manifest_version_index(manifest)
    if version in by_version:
        print(f"SKIP {version}: manifest already records {by_version[version]!r}")
        return

    tasklist_id, tasklist_name = resolve_tasklist_id(manifest, args.tasklist, args.tasklist_id)

    if args.dry_run:
        print(f"DRY RUN - would create {shipped_name!r} in {tasklist_name} ({tasklist_id})")
        print(f"          feature {feature_id}, release type {release_type}")
        return

    names = existing_task_names()
    if shipped_name in names:
        task_id = names[shipped_name]
        print(f"EXISTS {version}: task {task_id} already named {shipped_name!r}")
    else:
        task_id = create_release_task(
            tasklist_id,
            shipped_name,
            read_description(args),
            feature_id=feature_id,
            release_type=release_type,
            manifest=manifest,
        )
        print(f"CREATED {version} -> task {task_id} in {tasklist_name}: {task_url(task_id)}")

    flags = ship_flags(
        task_id,
        version,
        title,
        feature_id,
        release_type,
        estimate_base=args.estimate_base,
        estimate_head=args.estimate_head,
    )

    if not args.ship:
        print("\n# Now ship it (all four custom fields, rename, move to Shipped, manifest):\n")
        print(printable(flags))
        return

    print("\n# Shipping via teamwork_ship_task.py:\n", flush=True)
    result = subprocess.run(argv_for(flags), cwd=ROOT, check=False)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
