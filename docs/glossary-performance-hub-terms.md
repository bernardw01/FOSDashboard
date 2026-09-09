# Performance Hub glossary

> **PRD version 3.20.18** - see `docs/FOS-Dashboard-PRD.md`.  
> **Teamwork notebook:** [Performance Hub glossary](https://win.godeap.io/app/projects/1615262/notebooks/313662)  
> **Audience:** PMs, Client Engagement, Finance, and anyone reading PM Overview or related Hub numbers.  
> **Date:** 2026-09-01

**Source of truth in product:** FinOps Performance Hub as of PRD **3.20.18** behavior (SOW-rate Planned margin, date-range Actual margin to date). Formulas match **Project Performance** after feature **053** and feature **046** (hide plan KPIs when there is no resource plan).

Each term has a plain-language meaning, then **Hub-specific caveats** so two similar labels are not mixed up. Several names exist in Fibery or in conversation but are **not** labeled the same way in the Hub.

Related specs: [040](features/040-project-performance-layer.md), [046](features/046-planned-margins-require-resource-plan.md), [049](features/049-agreement-bid-program-fields.md), [053](features/053-pm-overview-sow-margin-and-role.md).

---

## Planned Margin

**What it means:** The labor margin implied by the **staffing plan on the SOW**: what we expected to make on allocated, billable people using the **rates written when the SOW was created**.

**How the Hub calculates it:** For every **Allocated and Billable** resource allocation:

`(hours × SOW bill rate − hours × SOW cost rate) ÷ (hours × SOW bill rate)`

**Where you see it:** Project Performance KPI chip **Planned margin** (subtext **From SOW rates**).

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
- Accounting P&L months also place **unrecognized** (forecast) milestones into future months by **Target Date**, so monthly revenue on the chart is not the same as lifetime Contract value.

---

## Planned Costs

**What it means (business):** What we expected to spend to deliver the SOW (mainly planned labor, plus planned expenses/ODC when we have them).

**How the Hub treats it:** There is **no chip labeled Planned Costs**. Related numbers:

| Idea | What the Hub uses |
| --- | --- |
| Labor plan for Planned margin | Allocated hours × **SOW cost rate** (billable allocations only) |
| Resource table **Allocated cost** | Allocated hours × **current Team Member Role cost rate** (cost card), in the selected range |
| **EAC $** remaining piece | Remaining months' **allocation cost** (Fibery allocated cost on the P&L plan line) plus remaining P&L expense months |

**Caveats unique to the Hub:**

- **SOW cost rates**, **today's cost-card rates**, and **Fibery Allocated Cost** are three different cost plans. They will not always match.
- Expenses/ODC are in **Total cost** and **EAC $**, not in Planned margin.
- Date range changes **Allocated cost** on the resource table; it does **not** invent a separate "planned cost to date" KPI.

---

## Bid snapshot (original proposal)

**Bid Revenue**, **Bid Costs**, and **Bid Margin** together are the **frozen original proposal** we took to the customer: what we said we would deliver for, what we thought it would cost, and the margin we bid. They exist so later SOW changes, staffing plans, rate cards, and actuals can be compared back to **what we first promised**, not rewritten as the engagement evolves.

**They should not change** after the proposal is submitted (or after the customer accepts that bid). Treat them as a historical snapshot. If scope, price, or staffing later change, those updates belong in **Planned Revenue**, the resource plan / SOW rates, and **actuals**, not in the bid fields.

**How they should / could be used:**

- Baseline for "did we sell this work at a healthy margin?" versus "are we still on that bid now that the SOW and plan exist?"
- Variance stories: bid vs contract value (price moved), bid cost vs allocated / EAC cost (delivery plan moved), bid margin vs Planned margin vs Actual margin (commercial vs staffing vs recognized).
- Portfolio or pursuit reviews: which deals were bid thin, and which later plans or actuals drifted from the original bid.
- They are **not** a substitute for Contract value, Planned margin, EAC, or Actual margin. Those numbers are allowed to move with the live agreement.

**Where you see them in the Hub today:** Fields are on the agreement in Fibery and mirrored into Datastore (feature **049**). They are **not** Project Performance chips yet. Product can surface them later as a fixed "original bid" column or KPI without mixing them into date-range actuals.

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

**What it means:** Work and cost **still left** after today (or after the as-of month): what we still expect to burn to finish.

**How the Hub uses it (not labeled ETC):** It is the **remaining** half of EAC.

- **Hours ETC:** planned allocation hours in months **after** the current UTC as-of month.
- **Cost ETC:** remaining planned **allocation cost** plus remaining **expense/ODC** months on the P&L.

**Where you see it:** Not its own chip. You infer it as **EAC minus actuals to date** (hours or $).

**Caveats unique to the Hub:**

- Remaining hours come from **month-prorated allocations** on the P&L, not from a separate ETC field in Fibery.
- Remaining allocation **dollars** on EAC still follow the **P&L allocated-cost plan** (Fibery allocated cost spread by duration), which can differ from hours × cost-card rate on the resource table.
- The Performance **date range does not change** ETC / EAC. Changing Start/End only affects Actual margin to date and the resource table.
- With **no resource plan**, EAC (and therefore this remaining piece) is hidden.

---

## Estimate at Complete (EAC)

**What it means:** **Forecast at finish** = actuals so far **plus** Estimate to Complete. If we keep following the remaining plan, where do hours and cost land?

**How the Hub calculates it:**

- **EAC hours:** logged hours through the as-of month **plus** remaining planned allocation hours. **Budget** (subtext) is total allocated hours when a plan exists.
- **EAC $:** labor **plus expenses/ODC** actuals to date **plus** remaining planned allocation cost **plus** remaining planned expenses. Subtext: **Labor + expenses/ODC**. This is **not labor-only**.

**Where you see it:** Project Performance chips **EAC hours** and **EAC $**.

**Caveats unique to the Hub:**

- Hidden (**N/A** / **No plan available**) when there is no resource plan.
- **Date range does not change** EAC; it stays full-project.
- EAC $ **budget** uses total Fibery allocation cost plus expenses on the series; it can disagree with summing **Allocated cost** on the resource table (especially after hours × cost-card rates).
- Engagement Review status packs use the **same EAC construction** so the two surfaces should not drift.

---

## Actual Margin

**What it means:** Margin from **what has actually been recognized and spent** on the agreement (accounting view), not the staffing-plan view.

**How the Hub calculates it:**

**(Revenue recognized − total cost) ÷ revenue recognized**

where total cost is **labor + Materials and ODC** (agreement / recognized basis).

**Where you see it:** Project financials chip labeled **Margin** (not "Actual margin"); Active Projects **Margin** column. Subtext can show **Target Margin**.

**Caveats unique to the Hub:**

- Label in the Hub is often just **Margin**. Feature **055** (draft) is the request to say **Actual** next to Planned on more surfaces.
- This uses **recognized revenue**, so a month with heavy labor and no invoice looks worse than the engagement really is. That is why Project Performance also has a timing badge when period GP is negative but revenue is planned later.
- **Current Margin** in Fibery is the same family of idea (recognized operational margin), not the SOW Planned margin chip.

---

## Projected Margin

**What it means:** The labor margin we would get if we **keep the same allocation plan but price it at today's cost cards** (current Team Member Role bill and cost rates), not the rates locked on the SOW.

**How the Hub calculates it:** Same weighted formula as Planned margin, substituting **current** role bill/cost rates for SOW rates.

**Where you see it:** Project Performance **Projected margin** (subtext **Cost card rates**).

**Caveats unique to the Hub:**

- This is **not** "actuals to date + remaining P&L plan" even though older specs described that. The Hub still **computes** that smoothed P&L projection internally (and uses remaining revenue for the timing badge), but the **chip** is the **cost-card allocation margin**.
- Labor-only; 100% rate coverage on billable allocations or **N/A**.
- **N/A** with no resource plan.
- **Date range does not change** Projected margin.

---

## Actual Margin to Date

**What it means:** Margin for the **period you are looking at** on Project Performance: money in vs money out on the monthly P&L, not the SOW-rate plan.

**How the Hub calculates it:**

**(Revenue − labor − expenses) ÷ revenue**

for P&L **calendar months** in the selected date range. **All Time** = through the as-of month.

**Where you see it:** Project Performance **Actual margin to date** (the range label sits next to this chip).

**Caveats unique to the Hub:**

- This is the **only** margin KPI that **follows the date range**. Planned, Projected, and EAC stay full-project.
- Still shown when there is **no resource plan**.
- Revenue in a month can include **forecast** (unrecognized milestones on Target Date), not only recognized invoices. That can differ from the project-strip **Margin** chip (recognized lifetime).
- Resource-table hours/cost can filter to **calendar days**; this margin still follows **whole P&L months** in range.
- If revenue in range is zero, the value is blank / not a percent.

---

## Quick map (what not to mix up)

| Term | Time horizon | Main ingredient | Typical Hub label |
| --- | --- | --- | --- |
| Bid Revenue / Cost / Margin | Frozen original proposal | What we first offered the customer | Not a Performance chip yet |
| Planned Revenue | Full SOW | Revenue item targets | **Contract value** |
| Planned Margin | Full SOW staffing | SOW bill/cost × allocated hours | **Planned margin** |
| Planned Costs | (no single chip) | Several cost plans | Allocated cost / EAC remaining |
| Projected Margin | Full SOW staffing | **Today's** role rates × hours | **Projected margin** |
| Actual Margin | Lifetime recognized | Recognized rev vs labor+ODC | **Margin** |
| Actual Margin to Date | Selected months | P&L rev vs labor+expenses | **Actual margin to date** |
| ETC | Remaining after as-of | Remaining allocations (+ ODC) | Inside EAC, not named |
| EAC | Finish | Actuals + ETC | **EAC hours** / **EAC $** |

---

## Change log

| Date | Note |
| --- | --- |
| 2026-09-01 | First version from current PRD and Project Performance behavior (features 040, 046, 049, 053). Teamwork notebook **313662**. |
| 2026-09-01 | Bid Revenue, Bid Costs, and Bid Margin described as the frozen original customer proposal; usage vs live Planned / Actual / EAC. |
