# Feature: Monthly Client Financial Performance Review (Lookback)

> **Status:** Shipped in **v3.21.0** (build used proposed defaults for R1-R7); lock query fix **v3.21.1**  
> **PRD version:** 3.21.1  
> **Feature ID:** **056**  
> **Release type:** Enhancement  
> **Task list:** Delivery  
> **Depends on:** Engagement Review (**037**); Project Performance (**040** / **053**); Datastore Live (**036**); daily dashboard snapshots (**009** / **010**) as a *different* freeze mechanism; Mobile (**029**)  
> **Source:** Customer draft *Performance Hub Enhancement - Monthly Client Financial Performance Review (Lookback) Workflow* (PDF, 7 pages). Related origin: Inbox [Idea - View for Monthly Financial Health Check](https://win.godeap.io/app/tasks/40478571) (Jess Williams), which shipped as **037**.  
> **Teamwork notebook:** [Feature 056 - Monthly Client Financial Performance Review (Lookback)](https://win.godeap.io/app/projects/1615262/notebooks/313716)  
> **Release task:** [Feature 056 - Monthly Client Financial Performance Review (Lookback)](https://win.godeap.io/app/tasks/40976878)  
> **Jess comment:** [Q1-Q15 answers](https://win.godeap.io/#notebooks/313716?c=26587036) (2026-09-08)  
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Origin / source request

Jess drafted a **Monthly Client Financial Performance Review (Lookback)** process. Goal: Performance Hub should automatically identify projects that need review, lock a monthly financial snapshot, collect Project Owner narratives (and evidence), and keep an immutable history of each month's review.

This is a **follow-on to Engagement Review (037)**, not a rewrite of the already-shipped meeting workspace. **037** remains the facilitator tools (calendar, notes, recordings, status packs, AI synopsis). **056** adds the **locked monthly lookback cohort** the PDF describes.

Engineering compared the PDF to shipped **037** / **040** / **009** (2026-09-02). Jess answered the intake questions in a notebook comment on **2026-09-08**. Locked decisions are below. Remaining questions are rewritten in plain language (including Q4, Q9, Q12).

---

## Current product state (shipped)

Through **v3.20.18**, Delivery **Engagement review** (`engagement-review`) is a **scheduled meeting workspace**:

| What exists | What it does | Why it is not the Lookback yet |
| --- | --- | --- |
| Review event | Create review with target date; statuses `draft` / `scheduled` / `in_progress` / `completed` | No automatic monthly lock calendar |
| Engagement Updates | One status pack per project + reporting month on a review | **Manually** created; Refresh metrics stays allowed |
| Quantitative snapshot | Hours/cost MTD planned vs actual, EAC, margin series, revenue, resources; `metrics_pulled_at` | Freeze is per pack and **re-pullable**, not a process lock |
| Qualitative | Overall RAG + four dimension RAGs; key developments; next-period priorities; risks; revenue callout; margin footnote | Not the PDF's What / Why / Recovery / Leadership / Additional fields |
| Suggest from alerts | Admin seeds Critical/Warning Agreement alerts onto the review | Different rules than PDF auto-select; does not create updates; removable |
| Project picker | Delivery In Progress only (owner-scoped unless Admin) | **Closed-in-month** projects cannot be added |
| Drive files | Call **recordings** on the review | Not per-project narrative screenshots |
| Narrative completeness | Overall RAG = project health | No Not Started / In Progress / Complete |
| History | Review list by target date; dashboard Data source (**009**/**010**) is daily all-panel JSON | Not a read-only monthly Lookback archive |
| Access | View/create: CLIENT-ENGAGEMENT / EXEC / ADMIN | PDF expects **Project Owners** in a 4-business-day window |

**Do not reuse as Lookback selection:** Agreement **low margin** alerts use Settings **`LOW_MARGIN_THRESHOLD`** (default **35%**). The PDF's floor is **50%** and is a Lookback rule, not the Agreement Attention panel.

---

## Locked product decisions (Jess 2026-09-08)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Surface | **Tab / mode inside Engagement review** (month picker + lock). Do not add a separate Delivery nav item. Do not replace the existing Engagement review UX. |
| 2 | Who writes narratives | **Assigned Owner** for their selected projects, plus **Client Engagement / Exec / Admin override**. |
| 3 | Manual opt-in | **Assigned PM or Guy**, with a **required Reason**. Not the whole Finance team. Guy's Hub login still needed (R1 below). |
| 6 | Red project health | **No auto-check in the first release.** Missed milestone / at-risk / refused acceptance = **manual opt-in** until Hub can detect those fields. |
| 7 | Change orders | **Manual opt-in** for the first months. No CO detector in v1. |
| 8 | Closed in month | **Yes.** Auto-include agreements that left Delivery In Progress during the reporting month. |
| 10 | Green projects | **Read-only list** of projects **not** selected for that locked month (metrics only) so the meeting can scan "green" work. |
| 14 | Mobile | Standard Hub mobile (&lt; 768px) in the same release. No extra meeting-on-phone requirements. |
| 15 | Notifications | **Defer.** First cycles use in-person agenda meetings; no lock or auto-select emails. |

**Auto-select in v1 (so far):** margin rule (pending which margin: R2), **closed in the reporting month**, and **executed contracts only** (pending Fibery mapping: R3). Red health and COs are opt-in with reason.

---

## Remaining questions (plain language)

Jess: please confirm **R2, R3, R4, R5, R6**. Guy: please answer **R7** (Jess asked us to check with you). Reply in the notebook comments.

| ID | Who | Question | Proposed default if you just say "yes" |
| --- | --- | --- | --- |
| **R1** | Jess | Guy is not on this Teamwork project. What is **Guy's Hub / Google login email** so we can grant opt-in (and later, if needed, add him to Teamwork)? | Named user allowlist, not the FINANCE team. **Shipped:** Settings **`LOOKBACK_OPT_IN_EMAILS`**. |
| **R2** | Jess | The PDF says include a project when **margin is below 50%**. Hub has two different margins: **(A) Actual margin to date** (recognized revenue vs cost so far; can look bad in a month because an invoice has not landed yet). **(B) EAC / projected margin** (actuals so far + remaining plan; this is the Project Performance "will we finish healthy?" number). You asked "Should we do EAC margin?" **Pick A, B, or both.** | **Shipped as B:** Lookback-only **`LOOKBACK_MARGIN_THRESHOLD`** default **50%** vs EAC (Fibery Target Planned Margin at Complete). Agreement Attention stays **35% actual**. |
| **R3** | Jess | You said we avoid accrual-vs-invoice noise by only evaluating **executed** contracts. In Fibery, what should we treat as executed? Examples: agreement is **Delivery In Progress** (or was, if it closed this month); a specific **executed / signed** field; exclude drafts / proposals / internal. | **Shipped:** executed = `execution_date` set; eligible = Delivery In Progress **or** closed during the reporting month; exclude Internal type |
| **R4** | Jess | When a project is selected, the owner needs to type a short story. Your PDF asks for five boxes: **What happened?** **Why did it happen?** **Recovery plan and next steps** **Leadership support needed** (optional) **Additional details** (optional). Hub today already has a different form on Engagement Updates (On Track / At Risk / Off Track, plus schedule/cost/margin/sentiment, key developments, next priorities, risks). **(A)** Use only the five PDF boxes. **(B)** Keep the existing Hub form **and** add the five PDF boxes. **(C)** Reuse the existing Hub boxes (map What happened to key developments, and so on). | **Shipped as A** for Lookback. Engagement Updates form unchanged. |
| **R5** | Jess | Do we ship **everything in the first Hub release**, or a smaller first version? The only technical reason to split: "margin changed by 3 points vs last month" needs a **previous locked month**. We can still ship lock + selection + narratives + green list first, and turn on that month-over-month rule **after** the first lock exists. **(A)** One release with all PDF rules (skip MoM until month two). **(B)** Smaller first release (lock + list only, narratives later). | **Shipped as A:** MoM ±3 pts starts on the **second** locked month |
| **R6** | Jess | Lock time in the PDF is **11:59 Project Owner Pacific Time**, skipping US holidays (Labor Day example). We do **not** need a full company holiday handbook unless you want one. **(A)** US federal holidays + Pacific Time. **(B)** You will send a company holiday list. | **Shipped as A:** US federal holidays, timezone `America/Los_Angeles` |
| **R7** | **Guy** | On each selected project the PDF wants **Y2D** (year-to-date) numbers. Which year? **(A)** Calendar year (Jan through the reporting month). **(B)** Company fiscal year (same as Hub FYTD on status packs). **(C)** Project-to-date only (lifetime; do not label it Y2D). | **Shipped as C until Guy answers:** project-to-date + locked month; no Y2D label. Hours tiles N/A (no per-project P&L at lock). |

---

## Jess answers (intake Q1-Q15)

| Q | Topic | Jess (2026-09-08) |
| --- | --- | --- |
| Q1 | Surface | **B** (tab inside Engagement review) |
| Q2 | Who authors | **B** (owners plus CE / Exec / Admin override) |
| Q3 | Manual opt-in | Assigned PM or **Guy**; reason required |
| Q4 | Margin threshold | Open: "Should we do EAC margin?" See **R2** |
| Q5 | Accrual vs invoicing | Only evaluate **executed** contracts. See **R3** |
| Q6 | Red health | Manual opt-in until the system can check |
| Q7 | Change orders | Manual opt-in for now |
| Q8 | Closed in month | **Yes** |
| Q9 | Narrative vs existing form | Open: terms were unclear. Restated as **R4** |
| Q10 | Green projects | **A** (read-only list of non-selected) |
| Q11 | Y2D | Ask **Guy**. See **R7** |
| Q12 | Ship shape | Open: restated as **R5** |
| Q13 | Timezone / holidays | Asked if we need a company holiday list. See **R6** |
| Q14 | Mobile | No extra phone requirements |
| Q15 | Notifications | **Defer** (in-person agendas for the next few cycles) |

---

## Draft goal

Give Performance Hub a **Monthly Client Financial Performance Review (Lookback)** **inside Engagement review** so that after month-end time close, the Hub **locks** official numbers, **selects** projects by published rules (plus PM/Guy opt-in with reason), collects **Project Owner narratives and evidence**, shows a **green (not selected) list**, and preserves each month as a **read-only archive**. Live PM Overview / P&L continue to update independently. Email notifications are out of the first cycles.

**Primary audience:** Project Owners, Guy / Finance, Client Engagement, Execs, Operations (time-close follow-up).

**Non-goals (draft):**

- Changing live Project Performance formulas (**040** / **053**) except to **read** the same metrics into the lock.
- Using daily Drive dashboard snapshots (**009**) as the Lookback source of truth.
- Replacing calendar invites, meeting notes, call recordings, or AI synopsis on **037**.
- Auto-detecting red health or change orders in v1.
- Guest / non-Users invitees.
- Dual-write to Fibery Status Updates (**018**).
- Owner emails on lock or auto-select (deferred).

---

## Proposed cadence (from the PDF; confirm R6)

1. Team members submit time by the **first Sunday** time-entry deadline after month-end.
2. Operations has **one business day** to chase missing time.
3. At **11:59 Pacific Time** at the end of that business day, Hub **captures and locks** the Lookback view.
4. Time after lock is **out of** that month's Lookback; live dashboards still move.
5. Project Owners have **four business days** to review the lock, coordinate with Finance, complete required narratives if selected or opted in, and attach evidence.
6. The Lookback meeting is scheduled after that window. Whenever it occurs, discussion uses the **locked** view.

Example in the PDF: July 2026 results lock Monday 3 Aug 2026; owner window Tue 4 Aug-Fri 7 Aug; meeting Mon 10 Aug (as schedules permit). August 2026 skips Labor Day: lock Tue 8 Sep; owner window Wed 9 Sep-Mon 14 Sep.

---

## Gap vs shipped (what we still need to build)

| PDF section | Gap (after Jess 2026-09-08) |
| --- | --- |
| 1. Monthly snapshot | Scheduled lock job; business-day + holiday calendar (R6); official frozen payload; no Refresh after lock |
| 2. Automatic selection | v1: margin floor (R2), closed-in-month, executed-contract filter (R3). MoM ±3 pts after first lock (R5). Red health and CO = opt-in. Auto rows **not removable** by the PM. |
| 3. Manual selection | Opt-in by Assigned PM or Guy; **Selected By**; **required Reason**; cannot strip auto rows |
| 4. Review trigger | Per project: Automatic vs Manual; criteria met; Selected By; Reason |
| 5. Narrative | Five PDF fields unless R4 says otherwise |
| 6. Evidence | One or more screenshots/images **on the project** |
| 7. Narrative Status | `not_started` (default) / `in_progress` / `complete` |
| 8. Lookback view | Inside Engagement review; selected list + KPIs; Ready vs Action Required |
| 9. Historical archive | Month picker; read-only after cycle complete |
| 10. Meeting agenda | Header: reporting month + lock timestamp; **green (not selected) list** |

---

## Draft user stories

- As **Operations**, I want the Hub to lock the Lookback after the time-close business day so the meeting is not chasing live time entries.
- As a **Project Owner**, I want to see my selected (or opted-in) projects, why they were selected, and a four-day window to finish the narrative and evidence.
- As **Guy** (or the Assigned PM), I want to opt a project in with a required reason so we can discuss it even if auto-rules did not fire.
- As a **facilitator**, I want Ready for Review vs Action Required, plus a green-project list, so the call can cover selected narratives and a scan of the rest.
- As an **Exec**, I want to open any prior reporting month read-only so we never rewrite history.
- As a **mobile user**, I want the Lookback list, triggers, and narrative entry usable under **768px**.

---

## Draft acceptance criteria (finalize after R2-R7)

- [ ] **Given** month-end plus first Sunday deadline plus one business day (holiday-aware per R6), **when** lock time is reached, **then** Hub persists a Lookback for that reporting month **on the Engagement review surface** and live dashboards keep updating.
- [ ] **Given** a locked month, **when** later time is submitted, **then** that month's Lookback numbers do not change.
- [ ] **Given** auto-selection rules (margin per R2, executed per R3, closed-in-month), **when** lock runs, **then** matching projects appear with Review Type Automatic and criteria listed; PMs cannot remove them.
- [ ] **Given** Assigned PM or Guy opt-in, **when** they include a project, **then** Review Type is Manual with Selected By and a **required** Reason.
- [ ] **Given** red health or a change order with no auto detector, **when** someone includes the project, **then** it is Manual (not Automatic).
- [ ] **Given** a selected project, **when** the owner (or CE / Exec / Admin) edits, **then** they can fill the narrative (R4), set Narrative Status, and upload one or more images.
- [ ] **Given** the Lookback view, **when** it renders, **then** summary KPIs, Ready / Action Required ordering, and a **read-only non-selected list** are present.
- [ ] **Given** a completed cycle, **when** users open that month, **then** lock, triggers, narratives, evidence, and statuses are read-only.
- [ ] **Given** viewport **&lt; 768px**, **when** the user opens Lookback, **then** KPIs, project cards, filter sheet, and narrative entry are usable (≥ 44px targets).

---

## UI notes (draft)

| Surface | Change |
| --- | --- |
| Delivery nav | **No new child route.** Lookback is a tab/mode on **Engagement review**. |
| Lookback month bar | Reporting month picker; lock timestamp; owner-window copy |
| Summary KPIs | Total selected; automatic; manual; narrative status mix |
| Agenda | Ready for Review, then Action Required; auto before manual inside each |
| Green list | Read-only non-selected projects for the locked month |
| Project card / detail | Planned / projected / actual margin; Y2D per R7; month planned / actual / variance hours; trigger; narrative; evidence; Narrative Status |
| Settings | Lookback minimum margin % (R2); lock timezone |

**Desktop:** scannable table or cards with KPI strip.  
**Mobile:** card list; month picker and filters in **`openMobileFilterSheet_`**; narrative in a full-screen sheet; evidence upload with 44px targets. No new bottom-nav slot.

Reuse **037** meeting notes, calendar, recordings, and synopsis on the same review.

---

## Data model (draft)

New or extended Supabase (names illustrative):

- **Lookback month** (`reporting_period`, `locked_at`, `lock_timezone`, `status` e.g. `open_for_narratives` / `meeting` / `archived`, created by job).
- **Lookback project** (agreement id, review type auto/manual, criteria JSON, selected_by, reason, narrative JSON, narrative_status, quantitative_snapshot frozen at lock, evidence metadata).
- **Evidence** files: Drive folder (pattern like 037 recordings) or Supabase storage; Hub stores file ids, names, uploaded_by, uploaded_at.

Do **not** treat 037 `refreshEngagementUpdateMetrics` as the lock. Freeze a dedicated snapshot at lock time (or disable refresh when bound to a locked Lookback).

Unique: one Lookback month per reporting period; one project row per month + agreement.

---

## Operations (draft)

**Queries:** list Lookback months; get month bundle (summary + selected + green list); get project detail.

**Actions:** run/lock job (scheduled + Admin retry); manual opt-in (PM or Guy); save narrative; set narrative status; upload/delete evidence (delete only before archive); Admin close cycle.

**Jobs:** monthly lock after computed lock datetime (Apps Script trigger; US federal holidays pending R6).

**Settings:** Lookback margin threshold; which margin (actual vs EAC); lock timezone; Drive folder for evidence; Guy email allowlist if not a role.

---

## Edge Cases

- Lock job fails: Admin retry; do not leave a half-written month as official.
- First locked month: skip MoM ±3 pts (no prior Lookback) unless R5 says to compare live prior month instead.
- Duplicate opt-in of an auto-selected project: keep Automatic; Reason may be stored as a note; do not change type to Manual.
- Guy or owner with no Hub login: cannot opt in or write until R1 is resolved.
- Missing Datastore labor for the month: show N/A tiles; still lock.
- Snapshot Data source mode: Lookback reads its own archive, not **009** dates.

---

## Verification steps (draft)

1. Desktop: after a test lock for a past month, confirm numbers do not move when live time is added.
2. Desktop: a project under the margin floor (R2) appears Automatic and cannot be removed by a PM.
3. Desktop: a project that closed in the month appears even if it is no longer Delivery In Progress.
4. Desktop: PM/Guy opt-in stores Selected By and required Reason.
5. Desktop: complete a narrative + image; status Complete; appears under Ready for Review.
6. Desktop: non-selected projects appear on the green list.
7. Desktop: open a prior month read-only.
8. Mobile ~390px: month picker, cards, narrative sheet, evidence upload.
9. Confirm live PM Overview still updates after lock.

---

## Implementation checklist

- [x] Jess answers Q1-Q15 in the Teamwork notebook (2026-09-08)
- [x] Ship **v3.21.0** using proposed defaults for **R1-R7** (Guy Y2D still open; hours N/A)
- [ ] Confirm Guy Hub email in **`LOOKBACK_OPT_IN_EMAILS`**
- [ ] Teamwork ship checklist (`teamwork_ship_command.py --feature-id 056`) after clasp verify

---

## Change requests

_(Customer edits after Spec Approved go here until ship.)_

---

## Changelog (feature doc)

| Date | Note |
| --- | --- |
| 2026-09-02 | Spec Draft: PDF requirements vs shipped 037/040/009; questions for Jess; Feature **056** intake. |
| 2026-09-08 | Jess answers Q1-Q15 in notebook comment 26587036. Locked: tab inside Engagement review; owner + CE/Exec/Admin narratives; PM or Guy opt-in with reason; closed-in-month auto; green list; defer emails; red health and COs manual for v1. Remaining: R1-R7 in plain language (EAC vs actual, executed mapping, five PDF boxes, ship slice, holidays, Guy Y2D). |
| 2026-09-08 | **v3.21.0** shipped Lookback tab with proposed R1-R7 defaults. |
| 2026-09-09 | **v3.21.1** Lookback lock: drop nonexistent `fos_agreements.end_date`; closed-in-month uses `duration_end` only. |
