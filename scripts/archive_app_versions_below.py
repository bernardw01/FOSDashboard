#!/usr/bin/env python3
"""Set Available=FALSE on App Versions rows below a semver floor.

Usage:
  AUTH_SPREADSHEET_ID=<id> python3 scripts/archive_app_versions_below.py --min 2.10.0

Uses clasp OAuth refresh token (~/.clasprc.json) and Google Sheets API v4.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLASP_RC = Path.home() / ".clasprc.json"
SHEET_NAME = "App Versions"


def parse_semver(raw: str) -> tuple[int, int, int] | None:
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)", str(raw).strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def compare_semver(a: str, b: str) -> int:
    pa, pb = parse_semver(a), parse_semver(b)
    if pa is None or pb is None:
        return (a > b) - (a < b)
    for x, y in zip(pa, pb):
        if x != y:
            return -1 if x < y else 1
    return 0


def is_available(raw) -> bool:
    if raw is True:
        return True
    if raw is False:
        return False
    s = str(raw or "").strip().upper()
    if s in ("FALSE", "F", "NO", "0"):
        return False
    return True


def refresh_access_token() -> str:
    data = json.loads(CLASP_RC.read_text(encoding="utf-8"))
    token = data["tokens"]["default"]
    body = urllib.parse.urlencode(
        {
            "client_id": token["client_id"],
            "client_secret": token["client_secret"],
            "refresh_token": token["refresh_token"],
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode())
    return payload["access_token"]


def sheets_get(access_token: str, spreadsheet_id: str, range_: str) -> list:
    q = urllib.parse.quote(range_)
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
        f"/values/{q}"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode())
    return payload.get("values") or []


def sheets_update(access_token: str, spreadsheet_id: str, range_: str, values: list) -> None:
    q = urllib.parse.quote(range_)
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
        f"/values/{q}?valueInputOption=USER_ENTERED"
    )
    body = json.dumps({"values": values}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="PUT",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        resp.read()


def header_index(headers: list, name: str) -> int:
    target = name.strip().lower()
    for i, h in enumerate(headers):
        if str(h or "").strip().lower() == target:
            return i
    return -1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min", default="2.10.0", help="Archive rows strictly below this version")
    parser.add_argument("--sheet", default=SHEET_NAME, help="Tab name")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    spreadsheet_id = (os.environ.get("AUTH_SPREADSHEET_ID") or "").strip()
    if not spreadsheet_id:
        print("Set AUTH_SPREADSHEET_ID to the auth spreadsheet id.", file=sys.stderr)
        return 1
    if not CLASP_RC.exists():
        print(f"Missing {CLASP_RC}; run clasp login first.", file=sys.stderr)
        return 1

    access_token = refresh_access_token()
    values = sheets_get(access_token, spreadsheet_id, f"{args.sheet}!A:Z")
    if not values:
        print("Empty sheet.")
        return 1

    headers = values[0]
    idx_version = header_index(headers, "PRD Version")
    idx_available = header_index(headers, "Available")
    if idx_version < 0 or idx_available < 0:
        print("Missing PRD Version or Available column.", file=sys.stderr)
        return 1

    archived: list[str] = []
    already: list[str] = []
    invalid: list[str] = []
    changed = False

    for row in values[1:]:
        while len(row) <= max(idx_version, idx_available):
            row.append("")
        version = str(row[idx_version] or "").strip()
        if not version:
            continue
        if parse_semver(version) is None:
            invalid.append(version)
            continue
        if compare_semver(version, args.min) >= 0:
            continue
        if not is_available(row[idx_available]):
            already.append(version)
            continue
        if not args.dry_run:
            row[idx_available] = "FALSE"
            changed = True
        archived.append(version)

    if changed and not args.dry_run:
        sheets_update(access_token, spreadsheet_id, f"{args.sheet}!A1", values)

    result = {
        "ok": True,
        "minVersion": args.min,
        "archived": sorted(archived, key=parse_semver),
        "alreadyArchived": sorted(already, key=parse_semver),
        "invalidVersions": invalid,
        "count": len(archived),
        "dryRun": args.dry_run,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"HTTP {e.code}: {body}", file=sys.stderr)
        raise SystemExit(1)
