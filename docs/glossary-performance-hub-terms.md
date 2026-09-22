# Performance Hub glossary

> **PRD version 3.29.5** - see `docs/FOS-Dashboard-PRD.md`.  
> **Teamwork notebook:** [Performance Hub glossary](https://win.godeap.io/app/projects/1615262/notebooks/313662)  
> **Audience:** PMs, Client Engagement, Finance, and anyone reading PM Overview, Lookback, or related Hub numbers.  
> **Date:** 2026-09-14

**Source of truth in product:** FinOps Performance Hub as of PRD **3.29.5**. Formulas below match `buildProjectPerformanceBlock_` in `projectPerformanceMetrics.js` and the Active Projects / P&L builders described in features **006**, **040**, and **056**.

Each term has a plain-language meaning, then **Hub-specific caveats** so two similar labels are not mixed up. Several names exist in Fibery or in conversation but are **not** labeled the same way in the Hub.

Related specs: [006](features/006-delivery-project-pnl.md), [040](features/040-project-performance-layer.md), [046](features/046-planned-margins-require-resource-plan.md), [049](features/049-agreement-bid-program-fields.md), [053](features/053-pm-overview-sow-margin-and-role.md), [056](features/056-monthly-lookback-financial-review.md).

---

## Planned Margin

**What it means:** The labor margin implied by the **staffing plan on the SOW**: what we expected to make on allocated, billable people using the **rates written when the SOW was created**.

**How the Hub calculates it:** For every **Allocated and Billable** resource allocation:

`(hours × SOW bill rate − hours × SOW cost rate) ÷ (hours × SOW bill rate)`

**Where you see it:** Project Performance KPI chip **Planned margin** (subtext **From SOW rates**). Lookback project detail freezes the same value at lock/re-run.

**Caveats unique to the Hub:**

- This is **not** Fibery **Target Margin**. Target Margin still appears as `tgt …%` under the project **Margin** chip on the selected-project strip / Accounting view.
- It is **labor only**. Materials and ODC are not in this percent.
- **Every** billable allocation must have both SOW bill and SOW cost rates. If any rate is missing, the chip is **N/A** and the tooltip says why.
- If the project has **no resource plan**, the chip is **N/A** with **No plan available** (not a made-up target percent).
- The Project Performance **date range does not change** Planned margin. It stays engagement-level.

---

## Planned Revenue

**What it means:** The **contract / SOW revenue plan**: how much we expect to bill for the agreement.

**How the Hub sources it:** Fibery **Total Planned Revenue** (sum of linked **Revenue Item** target amounts), shown as **Contract value**.

**Where you see it:** Project financials **Contract value**; Active Projects contract column; Agreement and portfolio planned-revenue rollups.

**Caveats unique to the Hub:**

- This is the **milestone / revenue-item plan**, not `allocated hours × SOW bill rate`. Those two plans can disagree if staffing rates and milestone amounts were not kept in sync.
- **Rev recognized** is only the subset of revenue items marked recognized. Remaining contract value is typically planned minus recognized.
- Monthly P&L also places **unrecognized** (forecast) milestones into months by **Target Date** for **projected** views; that blending does **not** feed **Actual margin to date** (see below).

---

## Planned Costs

**What it means (business):** What we expected to spend to deliver the SOW (mainly planned labor, plus planned expenses/ODC when we have them).

**How the Hub treats it:** There is **no chip labeled Planned Costs**. Related numbers:

| Idea | What the Hub uses |
| --- | --- |
| Labor plan for Planned margin | Allocated hours × **SOW cost rate** (billable allocations only) |
| Resource table **Allocated cost** | Allocated hours × **current Team Member Role cost rate** (cost card), in the selected range |
| **EAC $** remaining piece | Remaining months' **allocation cost** on the P&L plan line plus remaining P&L expense months |

**Caveats unique to the Hub:**

- **SOW cost rates**, **today's cost-card rates**, and **Fibery Allocated Cost** are three different cost plans. They will not always match.
- Expenses/ODC are in **Total cost** and **EAC $**, not in Planned margin.
- Date range changes **Allocated cost** on the resource table; it does **not** invent a separate "planned cost to date" KPI.

---

## Total Cost (labor + Materials and ODC)

**What it means:** Lifetime **logged labor cost plus other direct costs (ODC)** for the agreement.

**How the Hub calculates it (v3.29.5):** Sum of **`fos_labor_costs`** (Clockify time entries mapped to cost) **plus** **`fos_other_direct_costs`** for the agreement. This is the same raw data the monthly P&L grid uses (sections M.3 / M.4).

**Where you see it:** Active Projects KPI strip **Total cost**; selected-project financials; **Gross profit** = revenue recognized minus total cost.

**Caveats unique to the Hub:**

- The Hub **does not** use Fibery rollup fields **Total Labor Costs** / **Total Materials & ODC** for this KPI (those rollups are often stale or zero in Fibery). Bernard should still verify those Fibery formulas separately for Fibery-native reports.
- After a Datastore hydrate, agreement list totals come from one bulk pass over typed tables (no per-row P&L fetch on the list view).
- Monthly P&L **lifetime** row should align with this total when the same labor/ODC rows are in scope.

---

## Bid snapshot (original proposal)

**Bid Revenue**, **Bid Costs**, and **Bid Margin** together are the **frozen original proposal** we took to the customer: what we said we would deliver for, what we thought it would cost, and the margin we bid. They exist so later SOW changes, staffing plans, rate cards, and actuals can be compared back to **what we first promised**, not rewritten as the engagement evolves.

**They should not change** after the proposal is submitted (or after the customer accepts that bid). Treat them as a historical snapshot. If scope, price, or staffing later change, those updates belong in **Planned Revenue**, the resource plan / SOW rates, and **actuals**, not in the bid fields.

**How they should / could be used:**

- Baseline for "did we sell this work at a healthy margin?" versus "are we still on that bid now that the SOW and plan exist?"
- Variance stories: bid vs contract value (price moved), bid cost vs allocated / EAC cost (delivery plan moved), bid margin vs Planned margin vs Actual margin (commercial vs staffing vs recognized).
- Portfolio or pursuit reviews: which deals were bid thin, and which later plans or actuals drifted from the original bid.
- They are **not** a substitute for Contract value, Planned margin, EAC, or Actual margin. Those numbers are allowed to move with the live agreement.

**Where you see them in the Hub today:** Fields are on the agreement in Fibery and mirrored into Datastore (feature **049**). They are **not** Project Performance chips yet.

---

## Bid Revenue

**What it means:** The **revenue we originally proposed** to the customer. Stored on the Fibery agreement as **Bid Revenue**.

**Purpose:** Codify the commercial top line of that first proposal so we can always answer "what did we say this engagement was worth?" even if later change orders or milestone plans change **Total Planned Revenue** (Contract value).

**How it should be used:** Compare Bid Revenue to **Contract value** to see price or scope movement after the bid. Do not overwrite Bid Revenue when the SOW is amended; update Planned Revenue instead.

**Caveats unique to the Hub:** Not shown as a KPI chip today. Not the same as Contract value and not the same as `allocated hours × SOW bill rate`.

---

## Bid Costs

**What it means:** The **cost we originally proposed** (what we believed delivery would cost when we bid). Stored as **Bid Cost**.

**Purpose:** Codify the cost side of the first proposal so we can see whether the live staffing plan or actual burn departed from what we sold.

**How it should be used:** Compare Bid Cost to planned labor (SOW hours × SOW cost rates), to resource-table allocated cost (cost-card rates), and to EAC $ / actual cost. Drift is expected if the plan or rates changed; the bid number stays put so that drift is visible.

**Caveats unique to the Hub:** Not a Hub chip today. Not Clockify logged cost, not EAC, and not Fibery Allocated Cost. Those are living figures; Bid Cost is the original proposal.

---

## Bid Margin

**What it means:** The **margin we originally proposed**, from the bid revenue and bid cost. Fibery **Bid Margin** is a **formula** on those bid fields.

**Purpose:** Codify the profitability we took to the customer at pursuit, as a fixed reference. Later Planned margin (SOW staffing rates) and Actual margin (recognized) answer different questions.

**How it should be used:** Compare Bid Margin to **Planned margin** (are we still staffing to the margin we sold?) and to **Actual margin** / **Actual margin to date** (are we realizing it?). If Bid Cost or Bid Revenue were filled correctly at bid time and then left alone, Bid Margin stays a stable percent even when Target Margin, SOW rates, or actuals change.

**Where you see it:** Payload field only today (Fibery stores a 0-1 fraction; Hub payloads scale it to a **percent**, same as Target / Current Margin).

**Caveats unique to the Hub:**

- Bid Margin is not **Planned margin**, not **Target Margin**, and not **Actual margin**.
- Because it is a Fibery formula, it only stays meaningful if **Bid Revenue** and **Bid Cost** are left unchanged after the proposal.

---

## Estimate to Complete (ETC)

**What it means:** Work and cost **still left** after the as-of month: what we still expect to burn to finish.

**How the Hub uses it (not labeled ETC):** It is the **remaining** half of EAC.

- **Hours ETC:** planned allocation hours in P&L months **after** the as-of month key.
- **Cost ETC:** remaining planned **allocation cost** plus remaining **expense/ODC** months on the P&L.

**Where you see it:** Not its own chip. You infer it as **EAC minus actuals to date** (hours or $).

**Caveats unique to the Hub:**

- Remaining hours come from **month-prorated allocations** on the P&L, not from a separate ETC field in Fibery.
- The Performance **date range does not change** ETC / EAC. Changing Start/End only affects Actual margin to date and the resource table.
- With **no resource plan**, EAC (and therefore this remaining piece) is hidden.

---

## Estimate at Complete (EAC)

**What it means:** **Forecast at finish** = actuals so far **plus** Estimate to Complete. If we keep following the remaining plan, where do hours and cost land?

**How the Hub calculates it:**

- **EAC hours:** logged hours through the as-of month **plus** remaining planned allocation hours. **Budget** (subtext) is total allocated hours when a plan exists.
- **EAC $:** labor **plus expenses/ODC** actuals to date **plus** remaining planned allocation cost **plus** remaining planned expenses. Subtext: **Labor + expenses/ODC**. This is **not labor-only**.

**Where you see it:** Project Performance chips **EAC hours** and **EAC $**. Lookback project detail freezes the same values at lock/re-run.

**Caveats unique to the Hub:**

- Hidden (**N/A** / **No plan available**) when there is no resource plan.
- **Date range does not change** EAC; it stays full-project through the as-of month key.
- **EAC $** is a **dollar** forecast, not a margin percent. Do not confuse with **Projected margin** or the Lookback **EAC** column (below).

---

## Actual Margin

**What it means:** Margin from **what has actually been recognized and spent** on the agreement (accounting view), not the staffing-plan view.

**How the Hub calculates it:**

**(Revenue recognized − total cost) ÷ revenue recognized**

where total cost is **labor + Materials and ODC** (Datastore sums as of v3.29.5).

**Where you see it:** Project financials chip labeled **Margin** (not "Actual margin"); Active Projects **Margin** column. Subtext can show **Target Margin**.

**Caveats unique to the Hub:**

- Label in the Hub is often just **Margin**. Feature **055** (draft) is the request to say **Actual** next to Planned on more surfaces.
- This uses **recognized revenue**, so a month with heavy labor and no invoice looks worse than the engagement really is. That is why Project Performance also has a timing badge when period GP is negative but revenue is planned later.
- **Current Margin** in Fibery is the same family of idea (recognized operational margin), not the SOW Planned margin chip.

---

## Projected Margin

**What it means:** **Will we finish healthy?** A **project-level** margin that blends **actuals to date** with the **remaining plan** (revenue milestones plus planned labor/expense months), so lumpy invoice timing does not dominate the story.

**How the Hub calculates it (Locked Decision #6, v3.29.5):**

**Numerator:** `(revenue to date + remaining planned revenue) − (cost to date + remaining planned cost)`

**Denominator:** `(revenue to date + remaining planned revenue)`

Where:

- **Revenue to date + remaining planned revenue** uses the P&L month series (recognized **plus** forecast milestone amounts bucketed by Target Date for future months).
- **Cost to date + remaining planned cost** uses logged labor and ODC through the as-of month plus remaining allocation cost and remaining expense months after the as-of month.

**Where you see it:** Project Performance **Projected margin** chip. Lookback project detail **Projected margin** (frozen). Lookback **Action Required** list **EAC** column (see below).

**Caveats unique to the Hub:**

- This is **not** a static "cost card rate × all allocated hours" margin. It **changes month to month** as actuals accrue and remaining plan shrinks (as-of month key matters).
- **Not** the same as **Planned margin** (SOW rates only, no actuals).
- **N/A** with no resource plan (same gate as EAC hours/$).
- **Date range on Project Performance does not change** Projected margin; only the as-of month (UTC month of "today" live, or reporting month end in Lookback) matters.

---

## Actual Margin to Date

**What it means:** Margin for **recognized revenue and logged cost** in the months you are looking at on Project Performance: an accounting-style "what happened in this window?" view, not the SOW-rate plan.

**How the Hub calculates it (v3.29.3+):**

**(Recognized revenue in range − labor − expenses) ÷ recognized revenue in range**

for P&L **calendar months** in the selected date range through the as-of month. **All Time** = all months through as-of.

**Critical revenue rule:** Only **recognized** revenue items count. Unrecognized milestones whose Target Date has passed do **not** inflate this figure (forecast amounts still appear on the P&L chart and in **Projected margin**, but not here).

**Where you see it:** Project Performance **Actual margin to date** (the range label sits next to this chip). Lookback freezes the same metric at lock/re-run for the reporting month as-of.

**Caveats unique to the Hub:**

- This is the **only** margin KPI on Project Performance that **follows the date range** (Start/End). Planned, Projected, and EAC stay project-level.
- Still shown when there is **no resource plan**.
- Can differ from the project-strip **Margin** chip (lifetime recognized) and from **Projected margin** (includes remaining plan and forecast revenue).
- If recognized revenue in range is zero, the value is blank / not a percent.

---

## Lookback EAC column (Action Required list)

**What it means:** In **Performance Review / Lookback**, the **EAC** column on the Action Required table is **not** Fibery **Target Planned Margin At Complete** and **not** EAC dollars.

**How the Hub sources it (v3.29.5):** The same **`projectedMarginPct`** frozen at lock or **Re-run recommended list** (`metrics.eacMarginPct` in the Lookback project blob). Auto-select rules that compare margin to **`LOOKBACK_MARGIN_THRESHOLD`** use this value too.

**Where you see it:** Lookback month **Action Required** list **EAC** column; also in frozen project detail as **Projected margin** (the list column label says EAC for historical PDF alignment; the number is projected margin).

**Caveats unique to the Hub:**

- Fibery **Target Planned Margin At Complete** is **deprecated** for Lookback display (often neglected and identical to Target Margin on many SOWs).
- Numbers **do not update live** after lock. Admin must **Re-run recommended list** (open month) or **delete + re-lock** (archived month) to refresh after formula changes.
- Compare to **Actual margin** columns in Lookback (Fibery **Current Margin** / frozen actual margin fields), which answer a different question.

---

## Quick map (what not to mix up)

| Term | Time horizon | Main ingredient | Typical Hub label |
| --- | --- | --- | --- |
| Bid Revenue / Cost / Margin | Frozen original proposal | What we first offered the customer | Not a Performance chip yet |
| Planned Revenue | Full SOW | Revenue item targets | **Contract value** |
| Planned Margin | Full SOW staffing | SOW bill/cost × allocated hours | **Planned margin** |
| Planned Costs | (no single chip) | Several cost plans | Allocated cost / EAC remaining |
| Projected Margin | Through finish (as-of month) | Actuals + remaining P&L plan | **Projected margin**; Lookback **EAC** column |
| Actual Margin | Lifetime recognized | Recognized rev vs labor+ODC | **Margin** |
| Actual Margin to Date | Selected months | **Recognized** P&L rev vs labor+expenses | **Actual margin to date** |
| Total Cost | Lifetime | `fos_labor_costs` + ODC sums | **Total cost** |
| ETC | Remaining after as-of | Remaining allocations (+ ODC) | Inside EAC, not named |
| EAC hours / EAC $ | Finish | Actuals + ETC (hours or dollars) | **EAC hours** / **EAC $** |

---

## Change log

| Date | Note |
| --- | --- |
| 2026-09-14 | **Refresh for v3.29.5:** Projected margin = Locked Decision #6 (actuals + remaining plan); Actual margin to date = recognized revenue only; Total Cost from Datastore labor/ODC sums; Lookback EAC column = frozen projected margin. |
| 2026-09-01 | First version from current PRD and Project Performance behavior (features 040, 046, 049, 053). Teamwork notebook **313662**. |
| 2026-09-01 | Bid Revenue, Bid Costs, and Bid Margin described as the frozen original customer proposal; usage vs live Planned / Actual / EAC. |
