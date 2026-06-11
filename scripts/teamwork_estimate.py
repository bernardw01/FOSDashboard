#!/usr/bin/env python3
"""Lead-developer hour estimates from git diff stats (used at ship time)."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class FileDelta:
    path: str
    added: int
    deleted: int

    @property
    def churn(self) -> int:
        return self.added + self.deleted


def _run_git(*args: str) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed: {proc.stderr or proc.stdout}")
    return proc.stdout


def resolve_estimate_base_ref(explicit: str | None) -> str:
    """Parent of the latest ship commit, else HEAD~1."""
    if explicit:
        return explicit.strip()
    prior = _run_git("log", "--grep=Ship PRD", "-1", "--skip=1", "--format=%H").strip()
    if prior:
        return prior
    parent = _run_git("rev-parse", "HEAD~1").strip()
    return parent or "HEAD~1"


def git_diff_stats(base_ref: str, head_ref: str = "HEAD") -> list[FileDelta]:
    raw = _run_git("diff", "--numstat", f"{base_ref}..{head_ref}")
    deltas: list[FileDelta] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        added_s, deleted_s, path = parts[0], parts[1], parts[2]
        if added_s == "-" or deleted_s == "-":
            continue
        deltas.append(
            FileDelta(path=path, added=int(added_s), deleted=int(deleted_s))
        )
    return deltas


def estimate_lead_dev_hours(
    deltas: list[FileDelta],
    *,
    release_type: str,
) -> tuple[float, list[str]]:
    """
    Rough lead-developer hours for the diff (planning, implementation, review, docs).

    Rounded to nearest 0.5h; minimum 1.0h. Documented in docs/teamwork-workflow.md.
    """
    hours = 0.5
    rationale: list[str] = [
        "Ship overhead (PRD version, src headers, manifest sync): 0.5h",
    ]

    shell_added = 0
    substantial_src_js = 0
    feature_doc_added = 0
    script_added = 0
    header_only_js = 0

    for d in deltas:
        if d.path == "src/deliveryDashboard.js":
            block = 2.0 + min(d.added / 120.0, 2.5)
            hours += block
            rationale.append(
                f"Server P&L / Fibery logic (`{d.path}`, +{d.added} lines): +{block:.1f}h"
            )
            continue
        if d.path == "src/DashboardShell.html":
            shell_added = d.added
            block = 1.5 + min(d.added / 180.0, 3.0)
            hours += block
            rationale.append(
                f"Client chart/UI (`{d.path}`, +{d.added} lines): +{block:.1f}h"
            )
            continue
        if d.path.startswith("docs/features/") and d.added >= 80:
            feature_doc_added += d.added
            continue
        if d.path.startswith("scripts/") and d.added >= 30:
            script_added += d.added
            continue
        if d.path.startswith("src/") and d.path.endswith(".js"):
            if d.churn <= 12 and d.added <= 8:
                header_only_js += 1
            elif d.added >= 20 or d.deleted >= 20:
                block = 0.75 + min(d.added / 200.0, 1.5)
                hours += block
                substantial_src_js += 1
                rationale.append(f"Apps Script module `{d.path}`: +{block:.1f}h")

    if feature_doc_added:
        block = 1.0 + min(feature_doc_added / 400.0, 1.0)
        hours += block
        rationale.append(f"Feature spec / docs (+{feature_doc_added} lines): +{block:.1f}h")

    if script_added:
        block = 0.5 + min(script_added / 500.0, 1.5)
        hours += block
        rationale.append(f"Teamwork / automation scripts (+{script_added} lines): +{block:.1f}h")

    if any(d.path == "docs/FOS-Dashboard-PRD.md" for d in deltas):
        hours += 0.25
        rationale.append("PRD FR/AC + changelog row: +0.25h")

    if any(d.path == "src/dashboardSnapshotStore.js" for d in deltas):
        hours += 0.25
        rationale.append("Snapshot schema alignment: +0.25h")

    if release_type == "Bug Fix":
        src_feature_lines = shell_added
        for d in deltas:
            if d.path == "src/deliveryDashboard.js":
                src_feature_lines += d.added
        pre_cap = hours
        if src_feature_lines < 80 and pre_cap > 3.0:
            hours = min(pre_cap, 3.0)
            rationale.append(
                f"Small bug-fix scope (~{src_feature_lines} src lines): "
                f"{pre_cap:.1f}h -> {hours:.1f}h"
            )
        elif shell_added and shell_added < 40 and substantial_src_js == 0:
            hours = min(hours, 2.0)
            rationale.append("Client-only bug fix: capped at 2.0h")

    hours = max(1.0, round(hours * 2) / 2)
    rationale.append(f"Total (rounded to nearest 0.5h): {hours:.1f}h")
    return hours, rationale


def estimate_from_git(
    *,
    base_ref: str | None = None,
    head_ref: str = "HEAD",
    release_type: str,
) -> tuple[float, list[str], str]:
    base = resolve_estimate_base_ref(base_ref)
    deltas = git_diff_stats(base, head_ref)
    if not deltas:
        return 1.0, ["No git diff stat; default minimum: 1.0h"], base
    hours, rationale = estimate_lead_dev_hours(deltas, release_type=release_type)
    rationale.insert(0, f"Git range: {base[:8]}..{head_ref} ({len(deltas)} files)")
    return hours, rationale, base
