#!/usr/bin/env python3
"""Intake Feature 039: Utilization heatmap full dataset + legend filters (Teamwork notebook + Inbox backlog task)."""

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

FEATURE_ID = "039"
NOTEBOOK_KEY = "feature_039"
NOTEBOOK_TITLE = "Feature 039 - Utilization heatmap full view and legend filters"
NOTEBOOK_DESC = (
    "Utilization heatmap: raise TOP_N via Settings, interactive single-select legend "
    "filters with sticky headers, rename no data to zero hours."
)
TASK_NAME = "Feature 039 - Utilization heatmap full view and legend filters"
TASKLIST_ID = 4175395  # Inbox

FEATURE_MD = """# Feature: Utilization heatmap full view and legend filters

> **Status:** Spec Draft (Inbox backlog)
> **Feature ID:** **039**
> **Release type:** Enhancement
> **Task list:** Inbox (move to Operations at Spec Approved)
> **Extends:** Utilization dashboard heatmap (Phase C / Operations)
> **Teamwork:** This notebook is the authoritative RD until Spec Approved; sync to `docs/features/039-utilization-heatmap-full-view.md` before coding.

## Goal

Let Operations users see the **full filtered utilization heatmap**, not a truncated top-30 people / short window, and use the **heatmap legend as a filter** so they can isolate under / building / target / over / zero-hours / partial-week cohorts. Rename the **no data** legend label to **zero hours** so the band matches how reviewers talk about empty weeks.

## Problem today

The Utilization panel heatmap (`#panel-utilization`, `#util-heatmap-svg`):

1. Caps rows at **30 people** (`UTIL_HEATMAP_TOP_N_PERSONS` / Script Property `UTILIZATION_HEATMAP_TOP_N_PERSONS`), hiding the rest with meta copy like `46 more hidden (cap 30)`.
2. Week columns already follow the panel date range and page filters, but reviewers still perceive a fixed short window when the range is narrow; the product ask is that the heatmap show **everything in the underlying dataset for the current page filters** (people and weeks), with no artificial row cap.
3. The legend is display-only. Reviewers cannot click a band (for example `> 110% over`) to focus the grid on people who match.
4. Empty / zero-utilization cells are labeled **no data**, which undersells weeks with zero logged hours.

## Locked product decisions (proposed for review)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Person rows | Show **all people** present in the filtered dataset. Remove the client top-N person cap and the "N more hidden (cap 30)" meta. |
| 2 | Week columns | Show **all weeks** present in the filtered dataset for the current Utilization page filters (date range, Customer, Person, Internal labor, Billable, heatmap role filter). No separate heatmap-only week truncation. |
| 3 | Page filters | Heatmap continues to honor the filters at the top of the Utilization panel; this feature does not invent a second date range control. |
| 4 | Legend as filter | Each legend chip is a **toggle filter**. When one or more chips are active, show only people who have **at least one week** matching any active band. |
| 5 | Filter bands | Filterable bands: `< 60% under`, `60-85% building`, `85-110% target`, `> 110% over`, `zero hours`, `partial week`. |
| 6 | Match rule | A person matches if **any** of their visible week cells falls in an active band. Inactive chips mean no filter on that band. With **no** chips active, show everyone (full filtered set). |
| 7 | Multi-select | Support **multi-select** (OR across active chips). Click again to deactivate a chip. Provide a clear way to reset (click active chip off, or a small Clear filters control if useful). |
| 8 | Label rename | Replace legend copy **no data** with **zero hours**. Update cell tooltips / aria text that say "no data" for the same empty/zero band. |
| 9 | Zero hours meaning | **zero hours** = utilization cell with **0 hours** (or the existing empty/no-pct cell styling today that used the dark "no data" swatch). Document exact mapping in implementation; do not invent a new Fibery field. |
| 10 | Partial week | `partial week` remains a filterable overlay band (hatched cells). A person matches if they have any partial-week cell in the visible range when that chip is active. |
| 11 | Meta line | Meta shows `N people · M weeks` for the **currently displayed** set after legend filters. Drop the hidden/cap suffix. |
| 12 | Performance / scroll | Large person counts must remain usable: keep horizontal scroll for many weeks; add or retain vertical scroll for many rows. Do not reintroduce a hard 30-row product cap. Soft performance guidance may appear in UI Notes if rendering becomes slow. |
| 13 | Mobile | Legend filters and full-height scroll usable under 768px; touch targets at least 44px for legend chips. |
| 14 | Activity | Log legend filter changes (e.g. `util_heatmap_legend_filter`) with active band keys. |

## Open questions (resolve before Spec Approved)

1. **Script Property:** Remove `UTILIZATION_HEATMAP_TOP_N_PERSONS` from Settings registry, or keep as an optional soft cap for extreme datasets (recommend **remove product cap**; optional advanced setting only if ops still needs it)?
2. **Empty vs zero:** Confirm whether today's dark cells are always `hours === 0` vs missing person-week rows; should missing rows render as zero-hours cells for every person×week in range, or only when an aggregate row exists?
3. **Partial + band combo:** When both `partial week` and e.g. `> 110% over` are selected, match people with a cell that is **both**, or people with **either**? Recommend **OR across chips** (person has any matching cell for any active chip).
4. **Sort order:** Keep total-hours descending among the filtered people, or preserve pre-filter rank?
5. **Very wide ranges:** If Utilization max range allows many weeks, is SVG scroll enough, or do we need sticky person labels / sticky week headers in this release?

## User Stories

- As an **operations reviewer**, I want the heatmap to show **every person and week** in the filtered Utilization dataset so I am not blind to people beyond the top 30.
- As an **operations reviewer**, I want to **click a legend band** so I only see people who have any weeks in that band (for example everyone with an over-allocated week).
- As an **operations reviewer**, I want the empty band labeled **zero hours** so it matches how we talk about people with no logged time.
- As a **mobile user**, I want legend filters and the full heatmap to remain usable on a phone without desktop-only chrome.

## Acceptance Criteria (testable)

- [ ] Given a filtered Utilization dataset with more than 30 people, when the heatmap renders, then **all** matching people appear as rows and the meta line does **not** mention a person cap or "more hidden".
- [ ] Given the Utilization page date range and top filters, when the heatmap renders, then week columns match **all weeks** present in that filtered dataset (no heatmap-only week truncation).
- [ ] Given the legend, when the user clicks `> 110% over`, then only people with **at least one** over-band week in the visible range remain; other people are hidden.
- [ ] Given an active legend filter, when the user clicks the same chip again (or clears filters), then the full filtered person set returns.
- [ ] Given multiple legend chips active, when the heatmap re-renders, then people matching **any** active band are shown (OR).
- [ ] Given the legend, when it renders, then the former **no data** chip reads **zero hours**, and matching cell tooltips/aria use the same term.
- [ ] Given `partial week` selected, when the heatmap filters, then only people with at least one hatched/partial cell remain (subject to OR with other active chips).
- [ ] Given Customer / Person / role / billable filters at the top of the page, when legend filters are applied, then legend filtering runs **on top of** those page filters (does not bypass them).
- [ ] **Mobile:** Given viewport width **&lt; 768px**, when the user toggles legend chips and scrolls the heatmap, then chips are tappable (≥ 44px), the grid remains scannable, and no sidebar-only path is required.

## UI Notes

- **Routes / panels:** Utilization panel only (`#panel-utilization`). No new primary nav route.
- **Desktop:** Keep existing heatmap header + legend row above the SVG. Make legend chips look interactive (button/toggle affordance, selected/active state, keyboard focus). Meta line stays to the right of the title.
- **Mobile (`DashboardShell.html`, &lt; 768px):** Legend wraps; chips remain usable; heatmap container scrolls horizontally and vertically; follow mobile shell rules (touch targets, no desktop-only-only control).
- **Copy:** `zero hours` replaces `no data` in legend and related tooltip/aria strings for that band.

## Data Model

- No new Fibery entities. Continues to use Utilization payload `aggregates.byPersonWeek` and `rows`, client `renderUtilHeatmap` / `renderHeatmapLegend_`.
- Client state: `utilState.heatmap.legendFilter` (set of band keys) in addition to existing `roleFilter`.
- Optional: retire or demote Script Property `UTILIZATION_HEATMAP_TOP_N_PERSONS` and admin registry entry after product decision.
- Activity log: whitelist legend-filter event.

## Operations

- **Queries:** Existing Utilization dashboard payload; no new server endpoint required for v1 if filtering is client-side on the already-loaded filtered set.
- **Actions:** Legend chip toggle, clear legend filters, existing heatmap cell click modal, existing page filters / role filter.

## Edge Cases

- **No matches for legend filter:** Show empty state with short copy (e.g. "No people match the selected legend filters") and keep chips visible so the user can clear.
- **All chips cleared:** Full filtered dataset (post page filters).
- **Historical snapshot mode:** Same client behavior on snapshot utilization payload.
- **Auth:** Same access as Utilization today.
- **Large N:** Prefer scroll over silent truncation; if a hard safety ceiling is required for Apps Script HTML performance, document it in Change requests and surface honest meta copy (not a silent top-30).

## Verification Steps

1) Desktop: set Utilization filters so more than 30 people qualify; confirm all rows render and meta has no "cap 30" / "more hidden".
2) Desktop: widen/narrow the page date range; confirm week columns track the filtered weeks with no separate heatmap week cap.
3) Desktop: click each legend chip alone; confirm person set matches "any week in that band"; click again to clear.
4) Desktop: select two chips; confirm OR behavior.
5) Desktop: confirm legend shows **zero hours** (not **no data**) and tooltips match.
6) Desktop: with page Person/Customer filters on, apply a legend filter; confirm intersection behavior.
7) **Mobile (~390px):** toggle legend chips; scroll heatmap; confirm usable touch targets and no missing controls.
8) Activity log records legend filter changes.

## Implementation Checklist

- [ ] Update feature spec checkboxes as implemented
- [ ] **Mobile UI** per mobile shell rule (same PR as desktop)
- [ ] Remove or gate `UTIL_HEATMAP_TOP_N_PERSONS` client cap per approved decision
- [ ] Legend toggle filters + active styles
- [ ] Rename **no data** → **zero hours** (legend + tooltips/aria)
- [ ] Whitelist any new activity event in `userActivityLog.js`
- [ ] Sync this notebook to `docs/features/039-utilization-heatmap-full-view.md` at Spec Approved and again at ship
- [ ] PRD FR/AC + version bump at ship
- [ ] Run local smoke test on desktop and mobile width
- [ ] Commit with message: feat: utilization heatmap full view and legend filters

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

**Scope:** Utilization heatmap full filtered view + interactive legend:

1. Remove the 30-person heatmap row cap; show all people in the filtered dataset.
2. Show all weeks present for the current Utilization page filters (no heatmap-only truncation).
3. Legend chips toggle filters: show people with any week matching the selected band(s) (OR).
4. Rename legend **no data** → **zero hours** (and matching tooltip/aria copy).
5. Mobile-usable legend filters and scrolling in the same release.

Feature notebook: {nb_url}
Extends: Utilization dashboard heatmap (Operations)
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
