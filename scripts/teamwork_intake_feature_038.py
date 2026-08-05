#!/usr/bin/env python3
"""Intake Feature 038: Labor Hours multi-window period (Teamwork notebook + Inbox backlog task)."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import PROJECT_ID, api, md_to_html, notebook_url  # noqa: E402
from teamwork_intake import (  # noqa: E402
    RELEASE_TYPE_ENHANCEMENT,
    STAGE_BACKLOG_ID,
    create_release_task,
    get_task_workflow_stage,
    load_manifest,
    task_url,
)
from teamwork_sync_notebook import save_manifest  # noqa: E402

FEATURE_ID = "038"
NOTEBOOK_KEY = "feature_038"
NOTEBOOK_TITLE = "Feature 038 - Labor Hours multi-window period"
NOTEBOOK_DESC = (
    "Enhance Labor Hours Review with preset period windows "
    "(This Week, Last Week, This Month, Last Month), prorated targets, and KPIs."
)
TASK_NAME = "Feature 038 - Labor Hours multi-window period"
TASKLIST_ID = 4175395  # Inbox

FEATURE_MD = """# Feature: Labor Hours multi-window period

> **Status:** Spec Draft (Inbox backlog)
> **Feature ID:** **038**
> **Release type:** Enhancement
> **Task list:** Inbox (move to Operations at Spec Approved)
> **Extends:** Feature 007 - Labor Hours Dashboard
> **Teamwork:** This notebook is the authoritative RD until Spec Approved; sync to `docs/features/038-labor-hours-multi-window.md` before coding.

## Goal

Let Operations users review labor hours across **preset time windows**, not only a single ISO week. Replace (or extend) the current single-week date picker with clear period options so reviewers can scan the current or prior week, or the current or prior calendar month, with **targets and top KPIs that match the selected window**.

## Problem today

The Labor Hours Review panel (`#panel-labor-hours`) only supports selecting **one ISO week** (Mon-Sun). Reviewers who want a month-to-date or last-month view must switch weeks manually and cannot see a coherent multi-week rollup. Weekly hour targets are applied as full-week targets even when the reviewer only cares about days elapsed so far in the current week or month.

## Locked product decisions (proposed for review)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Period options | Exactly four presets: **This Week**, **Last Week**, **This Month**, **Last Month**. |
| 2 | Week definition | Keep existing **ISO week** (Mon-Sun) for week presets. |
| 3 | Month definition | Calendar month in the dashboard timezone already used by Labor Hours / Utilization (document which TZ in implementation). |
| 4 | Default selection | **This Week** on first open (or last remembered selection if activity/local preference already exists; confirm in review). |
| 5 | Target proration (in-progress windows) | When **This Week** or **This Month** is selected, each person's **target hours** are scaled to **elapsed workdays in the window through today** (inclusive), not the full week/month target. |
| 6 | Completed windows | **Last Week** and **Last Month** use the **full** period target (no proration). |
| 7 | KPIs | All top KPI cards (people with time, over / under / on target, zero hours, and any hour totals shown) recompute for the selected window and its prorated or full targets. |
| 8 | Tables / cohorts | Over / Under / On-target / Zero sections and person rollups use the same window bounds and targets as the KPIs. |
| 9 | Data fetch | Fetch or slice utilization labor rows for the full selected range; reuse existing cache when the cached range covers the window. |
| 10 | Mobile | Period control usable under 768px via existing filter bottom sheet or compact control; KPIs remain scannable. |

## Open questions (resolve before Spec Approved)

1. **Workday basis for proration:** Count Mon-Fri only, or include weekends if the person historically logs weekend hours? Recommend Mon-Fri for target math; actual hours still include all logged days in the window.
2. **Company / partner weekly targets:** For **This Month** / **Last Month**, is the full-month target `weeklyTarget * (workdaysInMonth / 5)`, or a separate monthly target setting? Recommend derive from existing weekly Script Property targets.
3. **Default on open:** Always **This Week**, or remember last preset in `sessionStorage` / activity preference?
4. **Custom week picker:** Keep a way to pick an arbitrary historical week, or replace entirely with the four presets? Recommend keep a secondary "Pick week..." control if ops still need older weeks; otherwise presets-only for v1.
5. **Subtitle / export labels:** Confirm date range copy format (e.g. `This Week: 2026-07-20 - 2026-07-26 (through Wed)` when prorating).
6. **Activity events:** Extend `labor_hours_week_change` vs add `labor_hours_period_change`?

## User Stories

- As an **operations reviewer**, I want to choose **This Week / Last Week / This Month / Last Month** so I can review labor without flipping one week at a time.
- As an **operations reviewer**, I want **This Week** and **This Month** targets to reflect **days elapsed so far** so people are not flagged Over/Under against a full period they have not finished.
- As an **operations reviewer**, I want the **top KPIs** to match the selected window so the summary cards stay trustworthy.
- As a **mobile user**, I want to change the period from a phone without a cramped desktop-only week picker.

## Acceptance Criteria (testable)

- [ ] Given Labor Hours Review, when the period control is opened, then the options are exactly **This Week**, **Last Week**, **This Month**, and **Last Month**.
- [ ] Given **This Week**, when today is mid-week, then person targets are prorated to elapsed workdays through today, and Over/Under/On-target classification uses that prorated target.
- [ ] Given **This Month**, when today is mid-month, then person targets are prorated to elapsed workdays in the calendar month through today, and KPIs/tables use that target.
- [ ] Given **Last Week** or **Last Month**, when the period is selected, then targets use the full completed period (no "through today" proration), and actual hours include all days in that closed range.
- [ ] Given any preset, when the selection changes, then top KPIs, section headings, subtitle date range, and person tables all refresh for that window's bounds and targets.
- [ ] Given a cache miss for the selected range, when the panel loads, then data is fetched for the full window (subject to existing utilization max-range limits) and the loading state remains clear.
- [ ] Given company filters and sort/export already on the panel, when the period changes, then those filters still apply to the new window.
- [ ] **Mobile:** Given viewport width **&lt; 768px**, when the user changes period, then the control is usable (bottom sheet or equivalent), KPIs remain scannable, and no sidebar-only path is required.

## UI Notes

- **Routes / panels:** `#panel-labor-hours` (Labor hours review under Operations). No new primary nav route.
- **Desktop:** Replace or augment the current single-week date picker with a period selector (segmented control, select, or dropdown). Show the resolved date range in the subtitle. Keep existing KPI card jump behavior.
- **Mobile (`DashboardShell.html`, &lt; 768px):** Period picker via `openMobileFilterSheet_` or compact `.fos-mobile-only` control; KPI row as existing scannable grid/cards; touch targets at least 44px.
- **Copy:** Loading label should say "Loading period..." (or window-specific) rather than only "Loading week..." when a month is selected.

## Data Model

- No new Fibery entities. Continues to use Utilization / Labor Costs normalized rows (`getUtilizationDashboardData` / client cache).
- Period resolution is client-side (or thin server helper): `{ periodKey, rangeStart, rangeEnd, targetScale, label }`.
- Target inputs remain existing Script Properties (`LABOR_HOURS_DEFAULT_WEEKLY_TARGET`, partner / company maps). Month windows derive from weekly targets unless a new property is approved.
- Activity log: whitelist period-change event if renamed.

## Operations

- **Queries:** Existing utilization dashboard payload for `[rangeStart, rangeEnd]`.
- **Actions:** Period change, refresh, company filter, sort, export/copy CSV, KPI jump (unchanged aside from window bounds).

## Edge Cases

- **Timezone / "today":** Define "today" using the same clock as other Operations panels so week/month boundaries do not flip unexpectedly for remote users.
- **Empty range / no hours:** Zero cohort and empty tables behave as today.
- **Partial cache:** If cached utilization range does not cover a full month, fetch the missing span (or full window) rather than silently under-counting.
- **UTILIZATION_MAX_RANGE_DAYS:** If a month window exceeds max range, show a clear inline warning and either clamp or require a smaller window (decide in review; prefer support full calendar month).
- **Auth:** Same access as Labor Hours today (all authorized users).
- **Historical snapshot mode:** If Labor Hours is driven from a snapshot utilization bundle, period presets must still slice that payload (or disable presets that cannot be satisfied and explain why).

## Verification Steps

1) Desktop: open Labor Hours; confirm four presets; switch This Week, Last Week, This Month, Last Month; confirm subtitle dates, KPI counts, and table membership change.
2) Desktop mid-week: on **This Week**, confirm a person at about half of weekly target is classified against the prorated target, not a full 40h week.
3) Desktop mid-month: on **This Month**, confirm prorated monthly targets and KPI totals.
4) Desktop: **Last Month** shows full-month targets and includes all days of that month.
5) **Mobile (~390px):** change period via mobile control; KPIs and tables usable without sidebar-only UI.
6) Export/Copy CSV reflects the selected window's rows.
7) Activity log records the period change.

## Implementation Checklist

- [ ] Update feature spec checkboxes as implemented
- [ ] **Mobile UI** per mobile shell rule (same PR as desktop)
- [ ] Whitelist any new activity event in `userActivityLog.js`
- [ ] Sync this notebook to `docs/features/038-labor-hours-multi-window.md` at Spec Approved and again at ship
- [ ] PRD FR/AC + version bump at ship
- [ ] Run local smoke test on desktop and mobile width
- [ ] Commit with message: feat: labor hours multi-window period presets

## Change requests

(Post-approval customer edits only; merge into main body at ship.)
"""


def main() -> None:
    html = md_to_html(FEATURE_MD)
    res = api(
        "POST",
        f"/projects/{PROJECT_ID}/notebooks.json",
        {
            "notebook": {
                "name": NOTEBOOK_TITLE,
                "description": NOTEBOOK_DESC,
                "content": html,
                "content-type": "HTML",
            }
        },
    )
    nb_id = int(res.get("notebookId") or res.get("id"))
    nb_url = notebook_url(nb_id)
    print(f"Notebook created: {nb_id} {nb_url}")

    manifest = load_manifest()
    how = manifest["notebooks"]["how_we_work"]["url"]
    desc = f"""Release type: Enhancement
Feature id: {FEATURE_ID}
Product version: TBD at ship (do not guess in task title until deploy)
Workflow stage: Backlog (Inbox)

**Scope:** Labor Hours Review period presets beyond a single week:

1. Period options: This Week, Last Week, This Month, Last Month.
2. This Week / This Month: prorate target hours to elapsed workdays through today.
3. Last Week / Last Month: full-period targets.
4. Top KPIs and person tables recompute for the selected window.
5. Mobile-usable period control in the same release.

Feature notebook: {nb_url}
Extends: Feature 007 - Labor Hours Dashboard
Workflow: {how}
"""

    task_id = create_release_task(
        TASKLIST_ID,
        TASK_NAME,
        desc,
        feature_id=FEATURE_ID,
        release_type=RELEASE_TYPE_ENHANCEMENT,
        workflow_stage_id=STAGE_BACKLOG_ID,
        manifest=manifest,
    )
    t_url = task_url(task_id)
    stage = get_task_workflow_stage(task_id)
    print(f"Task created: {task_id} {t_url}")
    print(f"Workflow stage id: {stage}")

    manifest.setdefault("notebooks", {})[NOTEBOOK_KEY] = {
        "id": nb_id,
        "title": NOTEBOOK_TITLE,
        "url": nb_url,
        "featureId": FEATURE_ID,
        "intakeTaskId": task_id,
        "publishedAt": date.today().isoformat(),
        "lastSyncedAt": date.today().isoformat(),
    }
    manifest.setdefault("tasks", {})[TASK_NAME] = {
        "id": task_id,
        "url": t_url,
        "featureId": FEATURE_ID,
        "releaseType": RELEASE_TYPE_ENHANCEMENT,
        "tasklist": "Inbox",
        "tasklistId": TASKLIST_ID,
        "notebookKey": NOTEBOOK_KEY,
        "workflowStage": "Backlog",
        "createdAt": date.today().isoformat(),
    }
    save_manifest(manifest)
    print("Manifest updated.")
    print(t_url)


if __name__ == "__main__":
    main()
