# Feature: Planned margin across PM Overview and Portfolio P&L

> **Status:** Spec Draft (pending Jess review)  
> **PRD version:** TBD at ship  
> **Feature ID:** **055**  
> **Release type:** Enhancement  
> **Task list:** Delivery (PM Overview surfaces) + Finance (Portfolio P&L)  
> **Inbox source:** [Add planned margin to the hub in two locations](https://win.godeap.io/app/tasks/40521091) (form 2026-07-17; requestor **jess.williams@harpin.ai**; priority **Medium**)  
> **Extends:** [040 - Project Performance layer](040-project-performance-layer.md), [046 - Hide planned margins without a resource plan](046-planned-margins-require-resource-plan.md), [053 - SOW-based planned margin](053-pm-overview-sow-margin-and-role.md)  
> **Teamwork notebook:** [Feature 055 - Planned margin on PM Overview and Portfolio P&L](https://win.godeap.io/app/projects/1615262/notebooks/313653)  
> **Release task:** [Feature 055 - Planned margin on PM Overview and Portfolio P&L](https://win.godeap.io/app/tasks/40954786)
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Origin / source request

Inbox title: **Add planned margin to the hub in two locations**

Jess's form (2026-07-17) asks for planned margin in **three** surfaces (title says two; description lists three):

| Surface (Jess wording) | Product route today | Ask |
| --- | --- | --- |
| **Delivery > Projects & P&L** (project detail) | **PM Overview** → select project → **Project financials** card | Add planned margin next to Table / Chart / Copy CSV; add **actual** to actual margin label |
| **Delivery > Projects & P&L** (active projects list) | **PM Overview** → **Active projects** table | New **Planned margin** column next to **Margin**; add **actual** to margin label |
| **Finance > Portfolio P&L** | **Finance** → **Portfolio P&L** | Planned summary near FY revenue/cost/margin; rename margin rows to **actual**; add **Planned margin $** and **Planned margin %** rows |

---

## Current product state (for review)

Understanding what already exists helps scope what Jess still wants.

### PM Overview - active projects list

- Column **Margin** shows **lifetime actual margin %** (recognized revenue basis) with a variance dot colored vs **Target Margin**.
- Payload already includes `targetMarginPct` (Fibery **Target Margin**) but it is **not** its own column; it appears only as subtext on the selected-project KPI strip (`tgt …%`).

### PM Overview - project detail (Project financials)

- **KPI strip** (always visible when a project is selected): chip labeled **Margin** = actual %; subtext `tgt …%` when Target Margin exists.
- **Accounting P&L** tab: monthly grid with **Margin $** / **Margin %** (ledger actuals); toolbar has Table / Chart / Copy CSV. **No planned margin control on this toolbar today.**
- **Project Performance** tab (feature **040**, planned margin updated in **053**): KPI chips **Planned margin** (SOW bill/cost rates on allocations), **Projected margin** (cost-card rates), **Actual margin to date**. Hidden as **N/A** when no resource plan (**046**).

### Finance - Portfolio P&L

- **Portfolio summary** strip: **FY revenue**, **FY total cost**, **FY margin** (%), **Projects in scope** (all from summed accounting P&L months).
- **Grid**: **Portfolio Revenue** row; expandable customers/projects; each project shows **Margin $** and **Margin %** (actual accounting). **No planned margin rows or KPIs.**

### Naming note

Nav labels were renamed (**PM Overview**, not "Delivery > Projects & P&L"). Spec uses current product names; inbox wording is quoted above.

---

## Questions for Jess

Please reply in the Teamwork notebook comment thread (or inline below). Engineering will lock **Locked product decisions** after answers.

| Q | Topic | Options / context | Your answer |
| --- | --- | --- | --- |
| **Q1** | **What is "planned margin" on list + Portfolio surfaces?** | **(A)** Fibery agreement **Target Margin** % (fixed plan % on the agreement). **(B)** **SOW-rate-based** planned margin (same formula as Project Performance after feature **053**). **(C)** Target Margin on list/Portfolio; SOW-based only on Project Performance (status quo split). **(D)** Other (describe). | |
| **Q2** | **Project detail - Accounting toolbar** | You asked for planned margin next to **Table / Chart / Copy CSV**. **Project Performance** already has a **Planned margin** KPI (SOW-based). Do you still want a **planned margin chip on the Accounting P&L view** (KPI strip and/or toolbar), or is Performance enough? | |
| **Q3** | **"Actual" labeling** | When we add Planned alongside existing margin, should we rename: **(A)** only where Planned is added side-by-side (e.g. **Actual margin %** + **Planned margin %**); **(B)** everywhere in scope including Portfolio **Margin $** → **Actual margin $** even before users see Planned in that row group; **(C)** use **Actual** prefix only on % labels, keep **Margin $** as-is. | |
| **Q4** | **Active projects - planned column format** | Show planned as **% only**, or **% + variance vs actual** (like today's dot)? Sortable column? | |
| **Q5** | **No resource plan (feature 046)** | For projects with **no allocations**, should planned margin on the **list** and **Portfolio** show **N/A** (same as Performance), or still show **Target Margin** from the agreement? | |
| **Q6** | **Portfolio - planned margin $ and %** | How should portfolio-level planned figures be calculated? **(A)** Weighted average of project planned % by **contract / planned revenue**. **(B)** `(sum of planned profit $) / (sum of planned revenue)` using per-project planned profit from SOW rates. **(C)** Sum Target Margin × planned revenue at project level, then portfolio %. **(D)** Show planned **%** only in summary (no $ row). **(E)** Other. | |
| **Q7** | **Portfolio - row placement** | Confirm new rows belong in **(A)** the top **Portfolio summary** KPI strip (next to FY revenue/cost/margin), **(B)** the **grid** as sibling rows under **Portfolio Revenue** (alongside Margin $ / %), or **(C)** both. | |
| **Q8** | **Scope vs inbox title** | Description lists **three** areas; title says **two locations**. Confirm **all three** ship in one release (055). | |
| **Q9** | **Projected margin** | Out of scope unless you want it on list/Portfolio too (inbox only mentions **planned** and **actual**). OK to defer projected to Performance only? | |
| **Q10** | **Mobile** | Active projects: new planned field on existing mobile project cards? Portfolio: grid remains horizontally scrollable; summary KPIs stack. Any extra mobile requirement? | |

---

## Draft goal (pending Q1-Q10)

Expose **planned margin** alongside **actual margin** on PM Overview (list + accounting-oriented detail) and Portfolio P&L so finance and delivery leads can compare plan vs recognized actuals without opening Project Performance for every project.

**Primary audience:** Client Engagement / PMs, Finance, Execs.

**Non-goals (draft):**

- Changing Project Performance SOW-rate formulas (**053**).
- Services Summary or Agreement Dashboard list (unless Jess expands scope).
- New Fibery fields (use existing Target Margin and/or allocation SOW rates).

---

## Draft user stories (pending lock)

- As a **PM**, I see **planned** and **actual** margin on the active projects list so I can scan variance without selecting each project.
- As a **delivery lead**, I see **planned margin** on the accounting-oriented project view when reviewing the monthly P&L table.
- As **Finance**, I see **planned margin $ and %** at portfolio level next to actual FY margin so I can compare plan vs ledger for the year.
- As a **mobile user**, planned/actual labels remain scannable on PM Overview cards and Portfolio summary KPIs.

---

## Draft acceptance criteria (testable; finalize after Jess)

- [ ] **Given** PM Overview active projects, **when** the table renders, **then** a **Planned margin** column appears next to the renamed **Actual margin** column (definitions per locked Q1).
- [ ] **Given** a selected project on **Accounting P&L**, **when** the toolbar is visible, **then** planned margin appears per locked Q2 (chip, toolbar label, or waived).
- [ ] **Given** Portfolio P&L with projects in scope, **when** the summary and/or grid renders, **then** **Planned margin $** and **Planned margin %** appear per Q6-Q7 and **Margin $ / %** rows show **Actual** in the label per Q3.
- [ ] **Given** `hasAllocations === false`, **when** list or Portfolio shows planned margin, **then** behavior matches locked Q5 (**N/A** vs Target Margin).
- [ ] **Given** viewport **&lt; 768px**, **when** PM Overview list or Portfolio summary is used, **then** planned/actual values are visible without desktop-only-only columns (cards or KPI strip).

---

## UI notes (draft)

| Area | File(s) | Change |
| --- | --- | --- |
| Active projects table | `DashboardShellPanels.html`, `DashboardShell.html` | Column headers; list row cells; mobile card fields |
| Project financials KPI / toolbar | `DashboardShellPanels.html`, `DashboardShell.html` | Planned chip placement; rename **Margin** → **Actual margin** per Q3 |
| Portfolio summary KPIs | `DashboardShellPanels.html`, `DashboardShell.html` | Optional planned FY chips |
| Portfolio grid rows | `DashboardShell.html`, `portfolioPnlDashboard.js` | New row kinds; label renames |
| Server payloads | `deliveryDashboard.js`, `portfolioPnlDashboard.js` | Planned margin fields at project + portfolio rollup |

**Mobile:** Follow **029** / **mobile-ui-shell** - list cards get planned/actual fields; Portfolio summary KPIs wrap; grid stays scrollable.

---

## Data model (draft)

| Field | Source (depends on Q1) |
| --- | --- |
| `plannedMarginPct` (list) | `targetMarginPct` and/or `performance.plannedMarginPct` from Delivery payload |
| Portfolio planned $ / % | New rollup in `portfolioPnlDashboard.js` from per-project P&L + agreement context |

Likely **cache schema bump** for Delivery list payload and/or Portfolio bundle if new fields are added. Snapshot job alignment per **009**.

---

## Edge cases

- Missing Target Margin and missing SOW rates: show **-** or **N/A** with tooltip (align with **053** / **046**).
- Portfolio partial load (failed project P&L): planned rollup excludes failed projects or shows partial note (match existing partial-data pattern).
- Snapshot dates before schema bump: client shows **-** for missing planned fields.

---

## Verification steps (draft)

1. Desktop: PM Overview list shows planned + actual columns for a project with Target Margin and with SOW planned margin.
2. Desktop: Select project → Accounting P&L → confirm planned placement per Q2.
3. Desktop: Portfolio P&L → confirm summary/grid planned rows and actual label renames.
4. Mobile ~390px: list cards and Portfolio summary readable.
5. Project with no resource plan: confirm Q5 behavior.

---

## Implementation checklist

- [ ] Jess answers Q1-Q10 in Teamwork notebook
- [ ] Lock decisions; move release task to **Spec Approved**
- [ ] Sync notebook to git; implement
- [ ] PRD FR/AC + version bump at ship

---

## Change requests

_(Customer edits after approval go here until ship.)_
