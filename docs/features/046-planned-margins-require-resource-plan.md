# Feature: Hide planned margins when there is no resource plan

> **Status:** In development (**v3.9.0**)  
> **PRD version:** **3.9.0** (**FR-143**, **AC-104**)  
> **Feature ID:** **046**  
> **Release type:** Enhancement (tightens **040** R6 empty-plan behavior)  
> **Task list:** Delivery  
> **Inbox source:** [Feature Request](https://win.godeap.io/app/tasks/40850310) (form 2026-08-20; requestor **jess.williams@harpin.ai**; priority **High**)  
> **Extends:** [040 — Project Performance layer](040-project-performance-layer.md) (especially **v3.8.2** “No Resource Plan Found”)  
> **Depends on:** PM Overview ([041](041-pm-overview-rebrand.md)), Mobile shell ([029](029-mobile-shell-phase-ab.md))  
> **Teamwork notebook:** [Feature 046 - Hide planned margins without a resource plan](https://win.godeap.io/app/projects/1615262/notebooks/313417)  
> **Release task:** [Feature 046 - Hide planned margins without a resource plan](https://win.godeap.io/app/tasks/40857620)
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Origin / source request

Inbox (no title field; description only):

> As a PM, I only want to see planned margins for agreements where I have a plan so that I don't see margins where I didn't provide a plan. I also want to see that the reason I can't see the planned margins is bc no plan is available to use.

---

## Goal

On **PM Overview → Project Performance**, **do not show planned (or plan-derived) margin figures** unless the engagement has a **resource plan**. When there is no plan, **do not imply a plan exists** — show a clear reason: **no plan is available to use**.

**Primary audience:** PMs looking at agreements they have not staffed / allocated.

**Non-goals:**

- Changing how **Target Margin** is stored on the agreement in Fibery.
- Hiding **Actual margin to date** (that is actuals, not plan).
- Hiding Accounting P&L numbers.
- A new Fibery “plan” entity.

---

## Problem today

**v3.8.2 (040 R6)** already hides the **resource table** when `resourceAllocations.hasAllocations !== true` and shows **No Resource Plan Found**. The **KPI strip still shows Planned margin** (agreement Target Margin, e.g. 50%) and **Projected margin** (smoothed using remaining plan, which is empty).

That leaves a PM looking at a **planned margin % with no resource plan behind it**. Jess’s request is to stop showing those plan margins and to **explain why**.

| Pain | Today (v3.8.2) |
| --- | --- |
| Planned margin looks “real” without a staffing plan | KPI **Planned margin** = Fibery **Target Margin** even when `hasAllocations` is false |
| Projected margin still computes | Formula uses remaining planned revenue/cost; with no allocations this is not a PM-authored plan |
| Empty state only covers the table | **No Resource Plan Found** does not say that **margins are hidden because there is no plan** |

---

## Locked product decisions (review)

| # | Topic | Decision | Review with Jess |
| --- | --- | --- | --- |
| 1 | What “a plan” means | Same gate as **040 R6**: **`resourceAllocations.hasAllocations === true`** (Fibery/Datastore **resource allocation records**). Not “Target Margin is filled in.” | **Confirm** — if she meant Target Margin instead, we would hide only when that field is blank |
| 2 | Chips to suppress | When no plan: **Planned margin** and **Projected margin** do **not** show a percentage. Show **N/A** (or em dash) and subtitle **No plan available**. | Confirm copy |
| 3 | Why copy | Keep **No Resource Plan Found** on the table area. Add one sentence: **Planned and projected margins are hidden because no resource plan is available to use.** | Confirm |
| 4 | EAC hours / EAC $ | When no plan, remaining allocation hours/cost are zero, so EAC collapses toward actuals-to-date and can look like a complete forecast. **Proposal: treat EAC the same as planned margins** (N/A + “No plan available”). | **Ask Jess** — keep EAC as actuals-only vs hide |
| 5 | Actual margin to date | **Stay visible** (actuals). Date range control stays. | Confirm |
| 6 | Has plan | Unchanged: Planned = Target Margin (N/A only if Target Margin missing); Projected = project-level formula; resource table as today. | — |
| 7 | Target Margin still on header | Project summary **Margin** vs target (e.g. 18.3% vs 50%) on the **top** KPI strip is **out of scope** unless Jess wants that hidden too. | **Ask Jess** |
| 8 | Services Summary / Engagement Update | Out of scope. Those surfaces keep their own planned-margin rules unless she expands the request. | Confirm |
| 9 | Access / mobile | Same as Delivery; empty + N/A chips usable &lt; 768px. | — |

This RD **supersedes** 040 AC that said “Performance KPIs remain visible” when there is no resource plan, **for Planned and Projected margin** (and EAC if decision 4 is hide).

---

## User stories

- As a **PM**, I want **planned / projected margin % hidden** on agreements **without a resource plan** so I am not judging health against a plan I never built.
- As a **PM**, I want **explicit copy** that I cannot see planned margins **because no plan is available**, not a silent blank.
- As a **PM**, I still want **actual margin to date** so I can see what has already happened.

---

## Acceptance criteria (testable)

- [x] **Given** `hasAllocations !== true`, **when** Project Performance renders, **then** Planned margin and Projected margin do **not** display a numeric %; they show **N/A** (or equivalent) with **No plan available** (or the approved subtitle).
- [x] **Given** the same project, **when** the empty-plan panel shows, **then** copy states that planned margins are hidden **because no resource plan is available to use**.
- [x] **Given** `hasAllocations === true`, **when** Project Performance renders, **then** Planned / Projected margin behave as **040** today (Target Margin / smoothed projected).
- [x] **Given** no plan, **when** Actual margin to date is computed, **then** it still shows from actuals (and date range still filters it).
- [x] **Given** decision 4 = hide, **when** there is no plan, **then** EAC hours and EAC $ are N/A with the same reason (not actuals dressed as EAC). If review keeps EAC, document that exception in this table and skip this AC.
- [x] **Given** viewport **&lt; 768px**, **when** there is no plan, **then** N/A chips and reason copy are readable (not hover-only).
- [x] 040 R6 table hide + **No Resource Plan Found** title remain. Tests / smoke named `AC-104` at ship.

---

## UI notes

- Reuse `#delivery-pnl-perf-no-plan`. Extend body copy; do not add a second competing empty state.
- KPI chips: same strip, muted **N/A** values, tooltips that match the reason sentence (KPI formula tooltips from **040** R5 should not claim a Target Margin % when the chip is N/A).
- Mobile: 2-col KPI cards; reason text not truncated off-screen.

---

## Data model

- No new entities. Client (and optionally `performance.hasResourcePlan` boolean) uses existing `resourceAllocations.hasAllocations`.
- Optional: server sets `performance.plannedMarginPct` / `projectedMarginPct` to `null` when no allocations so snapshot clients cannot show a stale 50%. Prefer **server nulling** so historical snapshots stay honest.

## Edge cases

- Allocations exist but Target Margin is blank: still show Planned as **N/A** for missing target (existing 040), with subtitle **Target margin missing** — distinct from **No plan available**.
- Allocations exist, all hours zero: still “has a plan”; show margins.
- Labor-only orange rows without allocations: already no table (040 R6); this feature also blanks plan margins.

## Verification steps

1. Desktop: project **with** allocations (e.g. Marriott screenshot) → Planned/Projected % unchanged.
2. Desktop: project **without** allocations → table empty state; Planned/Projected not 50% / not a made-up projected %; reason sentence visible.
3. Confirm Actual margin to date still populates.
4. Mobile ~390px: same.
5. After review: confirm EAC and top-strip Margin vs 50% target.

## Implementation checklist

- [x] Jess review (decisions 1, 4, 7)
- [x] Teamwork notebook + `Feature 046 - …` release task → Spec Draft
- [x] Patch 040 AC text when this ships (KPI-visible-on-no-plan)
- [x] PRD FR/AC at ship
- [x] Mobile same release

## Change requests

(Post-approval customer edits only; merge into the main body at ship.)
