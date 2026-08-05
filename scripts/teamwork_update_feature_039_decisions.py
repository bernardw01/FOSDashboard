#!/usr/bin/env python3
"""Update Feature 039 Teamwork notebook + task after open-question decisions."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import api, md_to_html  # noqa: E402
from teamwork_intake import load_manifest, task_url  # noqa: E402
from teamwork_sync_notebook import save_manifest, update_notebook  # noqa: E402

FEATURE_ID = "039"
NOTEBOOK_ID = 312849
TASK_ID = 40578934
NOTEBOOK_KEY = "feature_039"
NOTEBOOK_TITLE = "Feature 039 - Utilization heatmap full view and legend filters"
NOTEBOOK_DESC = (
    "Utilization heatmap: raise TOP_N to 100, interactive single-select legend "
    "filters with sticky headers, rename no data to zero hours."
)
TASK_NAME = "Feature 039 - Utilization heatmap full view and legend filters"

FEATURE_MD = """# Feature: Utilization heatmap full view and legend filters

> **Status:** Spec Draft (Inbox backlog)
> **Feature ID:** **039**
> **Release type:** Enhancement
> **Task list:** Inbox (move to Operations at Spec Approved)
> **Extends:** Utilization dashboard heatmap (Phase C / Operations)
> **Teamwork:** This notebook is the authoritative RD until Spec Approved; sync to `docs/features/039-utilization-heatmap-full-view.md` before coding.

## Goal

Let Operations users scan a larger utilization heatmap (person cap raised to **100**), use the **heatmap legend as a single-select filter** to focus on people with any week in a chosen band, keep **sticky week headers and person labels** while scrolling, and rename the **no data** legend label to **zero hours**.

## Problem today

The Utilization panel heatmap (`#panel-utilization`, `#util-heatmap-svg`):

1. Caps rows at **30 people** via `UTILIZATION_HEATMAP_TOP_N_PERSONS`. Reviewers need the cap raised to **100**, not a different capping mechanism.
2. The legend is display-only. Reviewers cannot click a band (for example `> 110% over`) to focus on people who have any week in that band.
3. Week headers and person labels scroll away on large grids.
4. Empty cells are labeled **no data**, which undersells weeks with no logged hours.

## Locked product decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Person row cap | **Keep** `UTILIZATION_HEATMAP_TOP_N_PERSONS`. Do **not** remove the cap mechanism. Set default / configured value to **100** (Script Property + client constant / Settings registry default). |
| 2 | Week columns | Show **all weeks** present in the filtered dataset for the current Utilization page filters (date range, Customer, Person, Internal labor, Billable, heatmap role filter). No separate heatmap-only week truncation. |
| 3 | Page filters | Heatmap continues to honor the filters at the top of the Utilization panel. |
| 4 | Legend selection | **Single-select only.** At most one legend chip is active. Clicking another chip replaces the selection. Clicking the active chip again clears the filter. |
| 5 | Legend filter rule | When a chip is active, show people who have **at least one week** that matches that band. For those people, still show **all weeks** in the visible range (including weeks that do not match the band). |
| 6 | Filter bands | Filterable bands: `< 60% under`, `60-85% building`, `85-110% target`, `> 110% over`, `zero hours`, `partial week`. |
| 7 | Empty cells | Keep today's **empty** cell behavior. Do **not** invent a full person×week matrix of synthetic zero-hour cells for missing weeks. The dark empty band is labeled **zero hours** in the legend/tooltips. |
| 8 | Label rename | Replace legend copy **no data** with **zero hours**. Update cell tooltips / aria text that say "no data" for the same empty band. |
| 9 | Sort (legend active) | When a legend filter is active, sort people by **count of weeks that match the selected band**, descending. A person with 4 qualifying weeks ranks above a person with 3. Tie-break: existing total-hours descending (or stable name) is fine. |
| 10 | Sort (no legend filter) | Keep current default sort (total hours descending) when no legend chip is active. |
| 11 | Sticky chrome | **Sticky week headers** (top) and **sticky person labels** (left) while scrolling the heatmap. |
| 12 | Meta line | Meta shows `N people · M weeks` for the currently displayed set (after legend filter and TOP_N). Cap messaging may still appear when more people exist than TOP_N. |
| 13 | Mobile | Legend single-select and sticky headers usable under 768px; touch targets at least 44px for legend chips. |
| 14 | Activity | Log legend filter changes (e.g. `util_heatmap_legend_filter`) with the active band key (or cleared). |

## Resolved questions (were open)

| # | Question | Resolution |
| --- | --- | --- |
| 1 | Remove Script Property vs soft cap? | **Dropped.** Keep TOP_N; set value to **100**. |
| 2 | Empty vs fabricate zeros for missing weeks? | **Empty.** Do not materialize missing person-weeks as zeros. |
| 3 | Multi-select / AND vs OR? | **Single-select.** Show all weeks for any person with at least one qualifying week. |
| 4 | Sort order with legend filter? | Sort by **number of qualifying weeks** descending. |
| 5 | Sticky headers? | **Yes** - sticky week headers and sticky person labels. |

## User Stories

- As an **operations reviewer**, I want the heatmap person cap at **100** so I can see more of the filtered team without changing how capping works.
- As an **operations reviewer**, I want to **click one legend band** so I only see people who have any week in that band, while still seeing their full week row.
- As an **operations reviewer**, I want those people sorted by **how many weeks match** the selected band so the worst / densest cases rise to the top.
- As an **operations reviewer**, I want **sticky headers and person labels** so I can scroll a large grid without losing context.
- As an **operations reviewer**, I want the empty band labeled **zero hours** so it matches how we talk about empty weeks.
- As a **mobile user**, I want legend filters and sticky chrome to remain usable on a phone.

## Acceptance Criteria (testable)

- [ ] Given default Settings / Script Property `UTILIZATION_HEATMAP_TOP_N_PERSONS` = **100**, when the heatmap renders, then up to **100** people appear and the cap mechanism still applies when the filtered set is larger.
- [ ] Given the Utilization page date range and top filters, when the heatmap renders, then week columns match **all weeks** present in that filtered dataset (no heatmap-only week truncation).
- [ ] Given the legend, when the user clicks `> 110% over`, then only people with **at least one** over-band week remain; each retained person still shows **all** weeks in range (matching and non-matching).
- [ ] Given an active legend chip, when the user clicks a different chip, then only the new chip is active (single-select).
- [ ] Given an active legend chip, when the user clicks the same chip again, then the filter clears and the full capped person set returns.
- [ ] Given an active legend filter, when people are listed, then sort order is by **count of matching weeks** descending (4 qualifying weeks above 3).
- [ ] Given the legend, when it renders, then the former **no data** chip reads **zero hours**, and matching cell tooltips/aria use the same term; missing weeks stay empty (not fabricated zeros).
- [ ] Given the heatmap scrolls vertically or horizontally, when the user scrolls, then **week headers stay sticky at the top** and **person labels stay sticky on the left**.
- [ ] Given Customer / Person / role / billable filters at the top of the page, when a legend filter is applied, then legend filtering runs **on top of** those page filters.
- [ ] **Mobile:** Given viewport width **&lt; 768px**, when the user toggles a legend chip and scrolls the heatmap, then chips are tappable (≥ 44px), sticky chrome still helps orientation, and no sidebar-only path is required.

## UI Notes

- **Routes / panels:** Utilization panel only (`#panel-utilization`). No new primary nav route.
- **Desktop:** Keep existing heatmap header + legend row above the grid. Legend chips are single-select toggles with a clear selected state. Sticky week header row + sticky person name column while scrolling the heatmap body.
- **Mobile (`DashboardShell.html`, &lt; 768px):** Legend wraps; chips remain usable; heatmap scrolls with sticky labels/headers as feasible; follow mobile shell rules (touch targets ≥ 44px).
- **Copy:** `zero hours` replaces `no data` in legend and related tooltip/aria strings for that empty band.

## Data Model

- No new Fibery entities. Continues to use Utilization payload `aggregates.byPersonWeek` and `rows`, client `renderUtilHeatmap` / `renderHeatmapLegend_`.
- Client state: `utilState.heatmap.legendFilter` (single band key or null) in addition to existing `roleFilter`.
- Keep Script Property `UTILIZATION_HEATMAP_TOP_N_PERSONS` and admin registry entry; set default to **100** (also update client `UTIL_HEATMAP_TOP_N_PERSONS` if it mirrors the default).
- Activity log: whitelist legend-filter event.

## Operations

- **Queries:** Existing Utilization dashboard payload; legend filtering and sort are client-side on the already-loaded filtered set.
- **Actions:** Legend chip single-select toggle, clear on second click, existing heatmap cell click modal, existing page filters / role filter. TOP_N default **100**.

## Edge Cases

- **No matches for legend filter:** Show empty state with short copy (e.g. "No people match the selected legend filter") and keep chips visible so the user can clear.
- **Legend cleared:** Full filtered dataset subject to TOP_N, default hours sort.
- **TOP_N after legend filter:** Apply legend filter first, sort by qualifying-week count, then apply TOP_N to that ranked list (confirm in implementation; prefer filter → sort → cap so the densest matches are kept).
- **Historical snapshot mode:** Same client behavior on snapshot utilization payload.
- **Auth:** Same access as Utilization today.

## Verification Steps

1) Desktop: with TOP_N = **100**, confirm up to 100 rows appear and cap meta still works when more than 100 people qualify.
2) Desktop: widen/narrow the page date range; confirm week columns track the filtered weeks.
3) Desktop: click one legend chip; confirm only people with a qualifying week remain, full week rows still show, and sort is by qualifying-week count desc.
4) Desktop: click a second chip; confirm single-select (first chip clears). Click active chip again to clear.
5) Desktop: confirm legend shows **zero hours** (not **no data**); missing weeks stay empty.
6) Desktop: scroll the heatmap; confirm sticky week headers and sticky person labels.
7) Desktop: with page Person/Customer filters on, apply a legend filter; confirm intersection behavior.
8) **Mobile (~390px):** toggle legend chip; scroll heatmap; confirm usable touch targets and sticky chrome.
9) Activity log records legend filter changes.

## Implementation Checklist

- [ ] Update feature spec checkboxes as implemented
- [ ] **Mobile UI** per mobile shell rule (same PR as desktop)
- [ ] Set `UTILIZATION_HEATMAP_TOP_N_PERSONS` default to **100** (keep cap mechanism)
- [ ] Legend single-select filter + active styles; full week rows for matched people
- [ ] Sort by qualifying-week count when legend filter active
- [ ] Sticky week headers + sticky person labels
- [ ] Rename **no data** → **zero hours** (legend + tooltips/aria)
- [ ] Whitelist any new activity event in `userActivityLog.js`
- [ ] Sync this notebook to `docs/features/039-utilization-heatmap-full-view.md` at Spec Approved and again at ship
- [ ] PRD FR/AC + version bump at ship
- [ ] Run local smoke test on desktop and mobile width
- [ ] Commit with message: feat: utilization heatmap legend filters and sticky headers

## Change requests

(Post-approval customer edits only; merge into main body at ship.)
"""


def main() -> None:
    html = md_to_html(FEATURE_MD)
    update_notebook(NOTEBOOK_ID, content=html, description=NOTEBOOK_DESC)
    print(f"Notebook updated: {NOTEBOOK_ID}")

    manifest = load_manifest()
    how = manifest["notebooks"]["how_we_work"]["url"]
    nb_url = manifest["notebooks"][NOTEBOOK_KEY]["url"]
    desc = f"""Release type: Enhancement
Feature id: {FEATURE_ID}
Product version: TBD at ship (do not guess in task title until deploy)
Workflow stage: Backlog (Inbox)

**Scope:** Utilization heatmap legend filters + sticky headers:

1. Keep TOP_N person cap; set `UTILIZATION_HEATMAP_TOP_N_PERSONS` default to **100** (do not remove the cap).
2. Show all weeks for the current Utilization page filters.
3. Legend chips are **single-select** filters: show people with any week in the selected band; still display all weeks for those people.
4. When filtered, sort by **count of qualifying weeks** descending.
5. Sticky week headers and sticky person labels.
6. Rename legend **no data** → **zero hours**; empty cells stay empty (no fabricated zeros).
7. Mobile-usable legend + sticky chrome in the same release.

Feature notebook: {nb_url}
Extends: Utilization dashboard heatmap (Operations)
Workflow: {how}
"""
    api("PUT", f"/tasks/{TASK_ID}.json", {"todo-item": {"description": desc}})
    print(f"Task updated: {TASK_ID} {task_url(TASK_ID)}")

    nb = manifest.setdefault("notebooks", {}).setdefault(NOTEBOOK_KEY, {})
    nb["lastSyncedAt"] = date.today().isoformat()
    nb["description"] = NOTEBOOK_DESC
    save_manifest(manifest)
    print("Manifest lastSyncedAt updated.")


if __name__ == "__main__":
    main()
