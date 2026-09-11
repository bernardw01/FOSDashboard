# Feature: Monthly Client Financial Performance Review (Lookback)

> **Status:** Shipped in **v3.21.0** (build used proposed defaults for R1-R7); lock query fix **v3.21.1**; route rename **v3.21.3**; Admin redo/delete **v3.22.0**; selection + Action UX **v3.23.0**
> **PRD version:** 3.29.2
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

Through **v3.20.18**, Delivery **Engagement review** (`engagement-review`) was a **scheduled meeting workspace** (as of **v3.21.3** the nav route is **`project-performance-review`**, label **Project performance review**; legacy deep links still work):

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
| 1 | Surface | **Tab / mode inside Project performance review** (month picker + lock). Do not add a separate Delivery nav item. Do not replace the existing Performance Review UX. |
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
| Q1 | Surface | **B** (tab inside Project performance review) |
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

Give Performance Hub a **Monthly Client Financial Performance Review (Lookback)** **inside Project performance review** so that after month-end time close, the Hub **locks** official numbers, **selects** projects by published rules (plus PM/Guy opt-in with reason), collects **Project Owner narratives and evidence**, shows a **green (not selected) list**, and preserves each month as a **read-only archive**. Live PM Overview / P&L continue to update independently. Email notifications are out of the first cycles.

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
| 2. Automatic selection | v1: margin floor (R2), closed-in-month; **Services-only** auto-select (**v3.23.0**); Subscriptions eligible for Green/opt-in; `execution_date` gate **dropped** (**v3.23.0**). Red health and CO = opt-in. Selected rows (Manual **or** Automatic) soft-removable by owner/override (**v3.23.0**; overturns earlier “auto not removable”). |
| 3. Manual selection | Opt-in by Assigned PM or Guy; **Selected By**; **required Reason**; soft-remove returns to Green |
| 4. Review trigger | Per project: Automatic vs Manual; criteria met; Selected By; Reason |
| 5. Narrative | Five PDF fields unless R4 says otherwise |
| 6. Evidence | One or more screenshots/images **on the project** |
| 7. Narrative Status | `not_started` (default) / `in_progress` / `complete` |
| 8. Lookback view | Inside Project performance review; selected list + KPIs; Ready vs Action Required |
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

- [ ] **Given** month-end plus first Sunday deadline plus one business day (holiday-aware per R6), **when** lock time is reached, **then** Hub persists a Lookback for that reporting month **on the Project performance review surface** and live dashboards keep updating.
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
| Delivery nav | **No new child route.** Lookback is a tab/mode on **Project performance review** (`project-performance-review`). |
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

## Bug fixes / refinements (engineering-tracked)

*(Technical appendix; not synced to the Teamwork notebook per `docs/teamwork-workflow.md` "Bug-fix releases." Authored by Claude Code from code review + user report 2026-09-09; implementation belongs to Cursor.)*

### CHANGE-056-01: Automatic selection must only consider Services engagements, not Subscriptions

**Reported:** 2026-09-09 - "When we are selecting projects for automatic inclusion in the lookback, make sure to only select services engagements and not subscriptions." Refined same day: "only select Services work that has state = Delivery in Progress or Closed date within the month selected."

**Current behavior (confirmed, code-level):** `lookbackEvaluateMonthProjects_` (`src/lookbackJob.js` lines 96-171) builds the **entire** Lookback population (both auto-selected and Green) from every `fos_agreements` row that is not `Internal` type (`lookbackIsInternalType_`, line 117), **has an `execution_date` set** (line 118), and is Delivery In Progress or closed in the reporting month (lines 119-122, `lookbackIsDeliveryInProgress_` / `lookbackDateInPeriod_`). **Subscription**-type agreements pass all three checks today and are therefore eligible for auto-selection alongside Services agreements - R3 (locked decision, line 74 above) only ever named "exclude Internal type," not Subscription. Agreement types in this codebase are the same three values used by Portfolio P&L (`PORTFOLIO_PNL_AGREEMENT_TYPES_ = ['Subscription', 'Services']` in `src/portfolioPnlDashboard.js:13`, plus `Internal`).

**Second decision needed - the `execution_date` gate:** the user's restated eligibility rule ("Services + Delivery In Progress or Closed date within the month") names only **two** conditions and does not mention "executed contract." The currently-shipped rule (line 118, from locked decision **R3**, line 74) has a **third**, independent condition: `execution_date` must be set, regardless of type or state. **Do not silently drop this** - R3 was locked specifically to avoid accrual-vs-invoice noise. Ask the user to explicitly confirm one of:
- **(i)** Keep the `execution_date` requirement as-is; the restated rule was just shorthand and didn't mean to drop it.
- **(ii)** Drop the `execution_date` requirement for Services-type agreements specifically (state/closed-date is now sufficient on its own for Services); this is a real R3 change, not a restatement.

This matters beyond correctness: if many in-flight Services/Delivery-In-Progress agreements in this org lack `execution_date` in Fibery/Supabase, that would **starve eligibility entirely** for those agreements - a very plausible unifying explanation for **BUG-056-02** below (empty Green list / opt-in dropdown). Check the actual data (count of Delivery-In-Progress Services agreements with `execution_date` null vs set) before assuming which reading is correct, and report back what you find either way.

**Decision needed (Cursor: confirm with product if genuinely unclear, don't guess):** the report says "for automatic inclusion" specifically. Two readings:
- **(A) Recommended:** Subscription agreements are never **auto-selected** (no `criteria.push(...)` for them), but stay eligible for the **Green (not selected)** list so PM/Guy can still manually opt one in with a reason (unchanged manual opt-in decision, line 54 above). Only the auto-select criteria computation (lines 137-148) is gated on `agreement_type === 'Services'`; the eligibility/population gate (line 117-122) is unchanged except Internal stays excluded as today.
- **(B)** Subscription agreements are removed from Lookback **entirely** (not even in Green) - gate the whole eligibility check at line 117 on `agreement_type === 'Services'` instead of just excluding Internal.

**Acceptance Criteria (testable):**
- [x] Given a Subscription-type agreement that would otherwise meet the margin or variance auto-select criteria, when the monthly lock or "Re-run recommended list" runs, then it is **not** auto-selected (no `criteria` entries, `review_type` stays null/not automatic). **Pass (v3.23.0):** `test_lookbackEvaluateServicesOnlyAuto_` + `lookbackIsServicesType_` gate around criteria.
- [x] Given option (A) is chosen: the same Subscription agreement still appears in the **Green (not selected)** list and remains choosable in the "Opt a project in" dropdown (see BUG-056-02 below) for PM/Guy manual opt-in with a reason. **Decision: (A).** Pass via eligibility without auto criteria.
- [ ] Given option (B) is chosen: the same Subscription agreement does not appear anywhere in that month's Lookback (Ready, Action, or Green). **N/A - (B) not chosen.**
- [x] Services-type agreements are unaffected - existing auto-select criteria (EAC margin below threshold, actual-vs-plan variance, closed-in-month, MoM ±3pts) still apply exactly as today. **Pass:** Services path unchanged inside the Services gate.
- [x] Internal-type agreements remain excluded everywhere, as today. **Pass:** `lookbackIsInternalType_` still first continue.
- [x] The `execution_date` question above (keep vs drop for Services) is explicitly answered and recorded here before ship, not defaulted silently either way. **Decision 2026-09-09: drop gate (do not block null execution_date).** Data: 3/9 DIP Services had null `execution_date`.

**Product decisions (2026-09-09):**
- Subscriptions: **(A)** never auto-selected; remain in Green for manual opt-in.
- `execution_date`: **do not block** null values (R3 gate removed from eligibility).

**Architecture Review:**
- **Security:** None - server-side eligibility filter only, no new access surface.
- **Performance:** No change - same single `fos_agreements` select, just an added string comparison per row already being iterated.
- **Regression risk:** This filter feeds the **entire** Lookback surface (KPIs, Ready/Action/Green lists, month-over-month comparison via `priorEacById`). Re-running the lock for an **already-locked** month must go through the existing "Re-run recommended list" path (`b.canRedo`, keeps Manual rows + narratives per the **v3.22.0** changelog entry below) - do not silently change already-locked historical months. Confirm the MoM ±3pts comparison (line 145-148) still lines up correctly if a Subscription agreement was counted in a **prior** locked month before this fix ships (mixed old/new eligibility across months is expected and fine; don't try to retroactively rewrite prior months).
- **Testing gaps:** No existing `test_*`/`_diag_*` coverage for `lookbackEvaluateMonthProjects_` eligibility rules. Add a manual test that stubs one Services, one Subscription, and one Internal agreement (same margin/date shape) and asserts only Services can produce `criteria.length > 0`.

**Verification Steps:**
1. Desktop: with a Subscription-type agreement below the margin threshold, run "Re-run recommended list" (or a test lock) and confirm it is not auto-selected.
2. Confirm a Services-type agreement with the same margin profile is still auto-selected as today (no regression).
3. Per the chosen option (A or B), confirm the Subscription agreement's presence/absence in the Green list and opt-in dropdown matches.

---

### BUG-056-02: "Opt a project in" - Project dropdown is empty

**Reported:** 2026-09-09 - clicking **Opt a project in** on the Lookback month view opens the form, but the **Project** dropdown (`#lb-optin-project`) has no options and does nothing.

**Confirmed mechanism (code-level):** the dropdown is populated 1:1 from the month bundle's `green` array (`b.green`, the same data backing the on-screen "Green (not selected)" table), filtered in `lbRenderMonth_` (`src/DashboardShell.html` ~lines 23352-23370) to only the projects the current user may opt in: any project if `b.canOptInAny` or `b.canOverride` is true (Admin / Exec / Client-Engagement / allowlisted email, all resolved server-side by the same `isAdminUser_`/`lookbackIsOverride_`/`lookbackCanOptIn_` used for the button's own visibility check, so client/server admin state cannot disagree) - otherwise only projects where `assignedOwnerEmail` matches the signed-in user.

Traced through, an **empty dropdown for a user who can see the button at all** reduces to one of two causes - **investigate in this order before writing a UI fix, since the fix differs completely depending on which it is:**
1. **`b.green` is genuinely empty for the open reporting month** - every eligible agreement that month already matched an auto-select criterion (or the eligible population itself is empty). This is not a UI bug; it may be **caused or worsened by CHANGE-056-01 above** if Subscription agreements were being auto-selected when they shouldn't have been, artificially inflating "selected" and starving Green - fix CHANGE-056-01 first and re-check before assuming a separate defect. Check by logging/inspecting `b.green.length` (or querying `fos_lookback_projects` for the month with `selected = false`) for the reporting month the user was on.
2. **`b.green` is non-empty, but every entry gets filtered out by the ownership check** because the signed-in user is a Project Owner/PM who does not own any of that month's Green projects, and is not Admin/Exec/CE/allowlisted. If this is what's happening, it is **arguably correct** per the locked manual-opt-in decision (line 54: "Assigned PM or Guy... Not the whole Finance team") - but the empty state should say so explicitly (e.g. "No projects available for you to opt in") instead of silently rendering a blank, confusing `<select>`. Confirm with the user which role they were signed in as when they saw this.

**Acceptance Criteria (testable):**
- [x] Given `b.green` is non-empty and the signed-in user has permission (Admin/Exec/CE/allowlisted, or owns at least one Green project), when they open "Opt a project in," then the Project dropdown lists those eligible projects. **Pass after CHANGE-056-01:** eligibility expands (null `execution_date` + Subscriptions in Green); re-run recommended list required to refresh existing months.
- [x] Given `b.green` is empty for the open reporting month, when the user opens "Opt a project in," then the form communicates **"No projects available to opt in this month"** instead of an unlabeled empty `<select>`. **Pass (v3.23.0):** `#lb-optin-empty`.
- [x] Given `b.green` is non-empty but none belong to the signed-in user and they have no override permission, when they open "Opt a project in," then the form communicates that they may only opt in their own projects, rather than showing a silently empty dropdown. **Pass (v3.23.0).**
- [x] No regression to the existing button-visibility rule (`erState_.isAdmin` / `b.canOptInAny` / `b.canOverride` / owns-a-green-project).

**Architecture Review:**
- **Security:** None - this only changes what empty-state message renders; the underlying permission gate (`b.canOptInAny`, `b.canOverride`, ownership match) is unchanged and correct as designed.
- **Performance:** None - no new data fetch, just an empty-state branch in existing render code.
- **Regression risk:** Low, localized to `lbRenderMonth_`'s dropdown-population branch. Verify the "Opt in" Save flow (`optInLookbackProject`, `src/lookbackApi.js`) still rejects a blank `aid` server-side regardless of client messaging (defense in depth - don't rely on the UI alone to prevent an empty submit).
- **Testing gaps:** No existing `test_*`/`_diag_*` coverage for the opt-in dropdown population branch. Add a manual test/diagnostic that loads a known month bundle and asserts dropdown option count matches the expected eligible count for a given test user (Admin, owner, and non-owner-non-admin cases).

**Verification Steps:**
1. First, confirm which of the two causes above actually applies for the reporting user's role and the actual `b.green` count that month - do not skip straight to a UI change.
2. Desktop, as Admin/Exec/CE: with at least one Green project present, confirm the dropdown lists it and Save succeeds.
3. Desktop, as a non-privileged Project Owner with zero owned Green projects: confirm the new empty-state message appears instead of a blank dropdown.
4. **Mobile (~390px):** repeat step 2 in device mode.

---

### BUG-056-03: Only Admins should see "Delete Lookback" and "Lock month now"

**Reported:** 2026-09-09 - non-Admin users should not see these controls on the Lookback month view.

**Investigation (confirmed, code-level) - the two buttons are in different states today:**
- **"Lock month now"** (`#lb-lock-btn`, inside the `#lb-admin-lock-wrap` container, `src/DashboardShellPanels.html` line 1780): **confirmed bug.** The container's markup is `class="d-none d-md-flex ..."`, and `lbLoadMonths_` (`src/DashboardShell.html` line 23159-23160) correctly does `lockWrap.classList.toggle('d-none', !res.canLock)` for a **permission** gate - but Bootstrap's `.d-md-flex { display:flex!important }` utility is defined *after* `.d-none` in Bootstrap's own stylesheet, so at viewport widths ≥768px the two `!important` rules tie on specificity and the **later-defined** `d-md-flex` wins regardless of which class was added last via JS. Net effect: on desktop, `#lb-admin-lock-wrap` (and the Lock button inside it) is visible to **every** user, admin or not; the JS permission toggle is fighting a losing CSS battle. The server-side flag itself (`canLock: isAdminUser_(auth)`, `src/lookbackApi.js` line 142/167) is already correctly Admin-only - this is purely a client rendering bug, not an access-control bug (no non-admin can actually *lock* a month even if they see the button - `lockLookbackMonth`-style API calls should already re-check `isAdminUser_` server-side; confirm that as part of this fix rather than assuming it).
- **"Delete Lookback"** (`#lb-delete-btn`, `src/DashboardShellPanels.html` line 1777): markup is a plain `class="... d-none"` (no responsive companion class), and `src/DashboardShell.html` line 23335-23336 toggles it via `!b.canDeleteMonth`, which is already `isAdminUser_(auth) && ...` server-side (`src/lookbackApi.js` line 145). This one **looks already correctly restricted** from a static read - no CSS conflict, no logic gap found. Confirm at runtime with an actual non-admin session before assuming there's a second bug here; if it turns out to also be visible to non-admins, find the actual cause empirically rather than assuming it mirrors the Lock button's cause.

**Acceptance Criteria (testable):**
- [x] Given a non-Admin, non-Exec, non-Client-Engagement-override user, when they open the Lookback month view at desktop width (≥768px), then neither "Lock month now" nor "Delete Lookback" is visible. **Pass (v3.23.0):** `#lb-admin-lock-wrap` outer permission-only `d-none` wrapper (inner keeps `d-none d-md-flex`); Delete unchanged single `d-none` + `canDeleteMonth`.
- [x] Given an Admin user, when they open the Lookback month view, then both remain visible and functional exactly as today.
- [x] Server-side: confirm the lock and delete endpoints themselves reject a non-Admin caller even if they somehow reach the button (belt-and-suspenders - do not rely on hidden-button-as-security). **Pass:** `test_lookbackAdminLockDeleteGates_` - both call `requireAdminRole_`.
- [x] **Mobile:** unaffected either way (`#lb-admin-lock-wrap` inner still `d-none` below 768px).

**Architecture Review:**
- **Security:** This is exactly the kind of authz-adjacent UI gap the Architecture Review process exists to catch - a visible button for an action the user cannot actually perform is a confusing near-miss, not a real permission bypass, **provided** the server endpoint re-checks `isAdminUser_`. Confirm that re-check exists for whatever "lock month" API `lb-lock-btn` calls; do not treat the CSS fix alone as sufficient.
- **Performance:** None.
- **Regression risk:** Do not simply delete the `d-md-flex` class - it may be load-bearing for the *mobile-hidden* half of the responsive behavior (`d-none` at <768px). Use a wrapper that doesn't combine a permission-driven `d-none` with a breakpoint-driven `d-*-flex` on the **same** element - e.g. toggle a dedicated class (`.fos-hidden` with its own unconditional `display:none!important` defined after Bootstrap's utilities), or wrap the permission check in an outer element and let the inner element keep its pure responsive classes. Same underlying anti-pattern is worth a quick grep across the Lookback markup (`d-none d-md-` combinations) in case it recurs elsewhere in this same panel.
- **Testing gaps:** No existing coverage. Add a manual test/diagnostic that renders the Lookback month view under a stubbed non-admin auth and asserts computed `display` (not just the class list) for both buttons is `none` at a ≥768px viewport.

**Verification Steps:**
1. Desktop (≥768px), signed in as a non-Admin CLIENT-ENGAGEMENT/EXEC/PM user: confirm neither button is visible.
2. Desktop, signed in as Admin: confirm both are visible and still work (lock a test month; delete a test month).
3. Mobile (~390px), either role: confirm unchanged (already hidden below 768px).

---

### FEATURE-056-04: Remove a project from Action Required via a trash icon

**Requested:** 2026-09-09 - "On the Lookback page, I should be able to remove items from the action required list by clicking a trashcan icon on the right hand side of the row."

**Conflict to resolve first (do not implement silently either way):** the existing "Gap vs shipped" table (line 140 above) records a **locked** decision: *"Auto rows **not removable** by the PM."* A trashcan that removes any Action Required row wholesale would contradict that decision for **Automatic** rows. Recommended reconciliation, consistent with everything else already locked for manual opt-in (line 54, "Assigned PM or Guy, with a required Reason"):
- **Manual-review-type rows** (`reviewType === 'manual'`) in Action Required get a working trashcan that removes the row (the inverse of Opt-in) - gated by the same permission model as opt-in itself (`lookbackCanOptIn_` / `lookbackIsOverride_`, i.e. Admin/Exec/CE/allowlisted, or the row's own owner).
- **Automatic-review-type rows** either show **no** trashcan, or a disabled one with a tooltip explaining why ("Automatically selected - cannot be removed"), so the row's existence isn't confusing. Do not silently no-op a clicked icon with no feedback.
- If the user actually wants Automatic rows removable too (overriding the locked decision), that must come back as an explicit confirmation, not an inference from this request.

**No server capability exists for this today** - `optInLookbackProject` (`src/lookbackApi.js` line 322) only adds a manual row. A new API (e.g. `removeLookbackManualProject(monthId, agreementFiberyId)` or similar naming consistent with `optInLookbackProject`) is needed, following the same guard pattern: `requireLookbackAccessForApi_`, `lookbackMonthWritable_(bundle.month)` (read-only months can't be edited), find the row, confirm `review_type === 'manual'`, confirm caller permission via the existing `lookbackCanOptIn_`/`lookbackIsOverride_` helpers, then remove/deselect it (decide: hard-delete the row vs. set `selected: false, review_type: null` and keep history/narrative - recommend the latter, consistent with how `lookbackJob.js` already preserves "orphan" manual rows with narrative content around lines 383-402, so a removed row with an in-progress narrative isn't silently destroyed).

**Conflict resolved (2026-09-09 product):** Automatic rows **are** removable too (explicit override of the earlier locked “auto not removable” decision). Soft-remove for both Manual and Automatic: `selected:false`, `review_type:null`, `reason:'Removed by user'`, `criteria:['user_removed']`, narrative kept. Re-run recommended list respects `user_removed` and does not re-auto-select.

**Acceptance Criteria (testable):**
- [x] Given a Manual-review-type row in Action Required, when the signed-in user has opt-in permission for it (owner, or Admin/Exec/CE/allowlisted) and clicks the trashcan, then a confirmation prompt appears, and on confirm the row is removed from Action Required (and Ready, if already complete) without deleting other months' data. **Pass (v3.23.0):** `removeLookbackSelectedProject`.
- [x] Given an Automatic-review-type row, when rendered in Action Required, then the trashcan is present and works the same as Manual (product override 2026-09-09). **Pass.**
- [x] Given a Manual row with narrative content already entered, when it is removed, then the narrative/evidence is not silently hard-deleted. **Soft-remove chosen.**
- [x] Given a read-only (archived) Lookback month, the trashcan does not appear at all (writable-month gate). **Pass:** `lbCanRemoveLookbackRow_` requires open_for_narratives.
- [x] **Mobile:** trashcan ≥44px on Action Required cards. **Pass.**

**Architecture Review:**
- **Security:** New write endpoint - must reuse the existing `lookbackCanOptIn_`/`lookbackIsOverride_` permission checks (do not invent a new, looser check), and must re-verify `review_type === 'manual'` **server-side** even if the client only shows the icon for manual rows - a client-only gate is not sufficient.
- **Performance:** Single-row update, negligible.
- **Regression risk:** This touches the same `fos_lookback_projects`-style rows read by KPIs, Ready/Action/Green rendering, and the opt-in dropdown's Green population (`b.green`) - removing a manual row should make it reappear in Green (assuming it's still otherwise eligible) rather than vanishing from the month entirely, unless the intent is full removal. Confirm which behavior is wanted before shipping. Also re-check this doesn't clash with the existing "Re-run recommended list" orphan-preservation logic in `lookbackJob.js` (~lines 383-402) - a manually-removed row should not be silently re-added by the next recommended-list run.
- **Testing gaps:** No existing coverage for any Lookback write path's removal case. Add a manual test covering: remove-as-owner, remove-as-non-owner-non-admin (must be rejected server-side), remove-an-automatic-row (must be rejected or hidden), remove-on-an-archived-month (must be rejected).

**Verification Steps:**
1. Desktop: as the owning PM, remove a Manual row with no narrative yet; confirm it leaves Action Required and (per the chosen behavior) reappears in Green or is gone entirely.
2. Desktop: attempt removal via direct API call as a non-owner, non-admin user; confirm server rejects it even though the button wouldn't be shown.
3. Desktop: confirm an Automatic row cannot be removed (no icon, or disabled with tooltip).
4. Desktop: confirm no trashcan appears on an archived (read-only) month.
5. **Mobile (~390px):** repeat step 1 on the card layout.

---

### FEATURE-056-05: Filter Action Required by status and owner

**Requested:** 2026-09-09 - "On the Action required list, I want to be able to filter by status and owner."

**Grounding (code-level):** Action Required rows (`action` array, `src/DashboardShell.html` line 23318-23321) are the `selected` projects whose `narrativeStatus !== 'complete'` - so in practice this is really a filter over `narrativeStatus` (`not_started` / `in_progress`, since `complete` rows are already routed to Ready) and `assignedOwnerName`/`assignedOwnerEmail`. No filter UI exists today for this table (`lbRenderProjectTable_` / `lbRenderProjectCards_` take a fixed `rows` array with no filter state) - this is net-new UI, not a bug fix. Reuse the desktop filter-chip / mobile-filter-sheet pattern already established for Utilization's detail table (feature **026**, `docs/features/026-utilization-detail-table-filters-export.md`) and the mobile `openMobileFilterSheet_` helper (`.cursor/rules/mobile-ui-shell.mdc`) rather than inventing a new filter widget style.

**Acceptance Criteria (testable):**
- [x] Given the Action Required list has rows with more than one distinct `narrativeStatus` value present, when the user opens the Status filter, then they can select one, several, or all statuses, and the table/cards update to match. **Pass (v3.23.0):** multi-select `#lb-action-filter-status`.
- [x] Given the Action Required list has rows with more than one distinct owner, when the user opens the Owner filter, then they can select one, several, or all owners, and the table/cards update to match. **Pass:** `#lb-action-filter-owner`.
- [x] Both filters can be combined (AND) and cleared independently; a "Clear filters" affordance exists. **Pass.**
- [x] Filters apply only to **Action Required** - Ready for Review and Green are unaffected.
- [x] Filter state resets when the reporting month changes (`lbOpenMonth_` id change).
- [x] **Mobile:** filter sheet via `openMobileFilterSheet_`. **Pass:** `#lb-action-filter-mobile-btn`.

**Architecture Review:**
- **Security:** None - client-side filter over already-authorized data already sent to the browser.
- **Performance:** Trivial - Action Required lists are small (single-digit to low tens of rows per month in practice); a client-side `Array.filter` is sufficient, no new server call needed.
- **Regression risk:** Do not change the underlying `action` array construction (line 23318-23321) - filtering must be a presentation-layer concern on top of the existing `ready`/`action` split, so Ready/Green rendering and the KPI counts (which likely count unfiltered totals) are unaffected. Confirm KPI counts (`kpis.automatic`, `kpis.manual`, etc., `src/lookbackApi.js` ~line 90-91) reflect the **true** totals, not the filtered view.
- **Testing gaps:** No existing coverage for any filter on this page. Add a manual test asserting filtered row count matches an expected subset for a known status/owner combination.

**Verification Steps:**
1. Desktop: with a month containing rows of at least two different statuses and two different owners, apply each filter independently and combined; confirm the visible rows match expectations and KPI totals above the list stay unchanged (they reflect all rows, not the filtered subset).
2. Desktop: clear filters; confirm the full Action Required list returns.
3. **Mobile (~390px):** open the filter sheet, apply a filter, confirm the card list updates and the sheet dismisses per the existing mobile filter pattern.
4. Confirm Ready for Review and Green lists are unaffected by Action Required filter state.

---

### BUG-056-06: "Reviews" tab should be hidden for non-Admins on Project Performance Review

**Requested:** 2026-09-09 - "We would like to hide the reviews button on the Project Performance Review page if you are not an admin."

**Current behavior (confirmed, code-level):** the `#er-mode-reviews-btn` tab (`src/DashboardShellPanels.html` line 1715) is only hidden via `erState_.lookbackOnly` (`src/DashboardShell.html` line 21672-21673: `reviewsBtn.classList.toggle('d-none', !!erState_.lookbackOnly)`). `lookbackOnly` (`src/lookbackApi.js` lines 148/168, `src/Code.js` line 230) is `canAccessLookback_(auth) && !canAccessEngagementReview_(auth)` - true only for a narrow cohort (Lookback opt-in allowlisted emails, or an agreement's Assigned Owner, who can access Lookback but not the full Reviews workspace). It is **not** role-based beyond that.

**Conflict to resolve first (do not implement silently):** the page itself is already gated to **ADMIN, EXEC, or CLIENT-ENGAGEMENT team** (`canAccessEngagementReview_`, `src/engagementReviewAuth.js` lines 13-22 - this is locked decision **#4** in feature **037**). Today, any of those three groups who reach the page at all also sees the "Reviews" tab. Hiding it for "not an admin" would newly hide it from **EXEC** and **CLIENT-ENGAGEMENT** too, which narrows locked decision **#4/#5** (037: "ADMIN, EXEC, and CLIENT-ENGAGEMENT MAY create Engagement Reviews and create/edit Engagement Updates"). Confirm explicitly with the user: is this **(A)** a genuine narrowing - EXEC/CE should now land on Lookback-only, same as the existing `lookbackOnly` cohort - or **(B)** they only mean literally the Admins-who-lock-months distinction from BUG-056-03, and actually intend EXEC/CE to keep seeing Reviews? Do not silently reinterpret a locked access decision.

**Decision (2026-09-09):** **(A)** Hide Reviews for everyone who is not Admin. EXEC and CLIENT-ENGAGEMENT land on Lookback-only for the mode tabs (narrows 037 #4 for tab visibility only). **New review** creation is unchanged (037 #5).

**Acceptance Criteria (testable, assuming reading A is confirmed):**
- [x] Given a non-Admin user (EXEC, CLIENT-ENGAGEMENT, or the existing `lookbackOnly` cohort) who can access the page, when they open Project Performance Review, then the "Reviews" tab is not shown and they land on the Lookback tab (mirroring today's `lookbackOnly` behavior, now extended to EXEC/CE). Evidence: `erHideReviewsTab_()` = `lookbackOnly || !isAdmin`; default open uses that for Lookback landing. `test_erShouldHideReviewsTab_`.
- [x] Given an Admin user, when they open the page, then "Reviews" remains visible and functional exactly as today. Evidence: Admin + not lookbackOnly → hide false.
- [x] The "New review" creation button/modal (`erCreateModal`) is **not** touched by this change unless the user separately confirms they also want that restricted - it is a distinct, already-locked capability (037 decision #5). Evidence: `erApplyCanCreateUi_` still uses `lookbackOnly` only for create affordances, not the Reviews hide rule.
- [x] Server-side: any `google.script.run` calls gated behind the Reviews tab already re-check access independently of tab visibility (confirm, don't assume, since hiding a tab is not itself an access control). Evidence: `listEngagementReviews` / create paths still call `requireEngagementReviewAccessForApi_` / `requireEngagementReviewCreateForApi_`.

**Architecture Review:**
- **Security:** Confirm the underlying review-listing/creation APIs (`listEngagementReviews`, etc.) still enforce their own access checks regardless of this tab's visibility - this change should only affect what's shown, not introduce a new place where access is decided.
- **Performance:** None.
- **Regression risk:** This reuses and extends the existing `lookbackOnly`-driven visibility branch rather than adding a parallel one - do not create a second, separately-maintained "isAdmin" check alongside `lookbackOnly` for the same button; fold the new condition into the single existing branch so there's one source of truth for "can this user see Reviews."
- **Testing gaps:** No existing coverage for this tab's visibility logic. Add a manual test asserting `#er-mode-reviews-btn` visibility for Admin, EXEC, CLIENT-ENGAGEMENT, and `lookbackOnly` roles once the reading (A or B) is confirmed.

**Verification Steps:**
1. As Admin: confirm Reviews tab visible, Lookback tab visible, both function.
2. As EXEC and as CLIENT-ENGAGEMENT (once reading A/B is confirmed): confirm Reviews tab matches the confirmed behavior.
3. As the existing `lookbackOnly` cohort: confirm unchanged (already hidden today).
4. Confirm "New review" creation is unaffected unless explicitly asked to change too.

---

### FEATURE-056-07: Drag-and-drop reorder for the Ready for Review list

**Requested:** 2026-09-09 - "On the lookback tab for those projects that are ready for review, we want to be able to reorder the list by dragging and dropping items."

**Grounding (code-level):** Ready for Review is currently server-sorted with **no persisted custom order** - `lbMapBundleForClient_` (`src/lookbackApi.js` lines 100-116) sorts the whole `selected` array (which the client then splits into `ready`/`action` by `narrativeStatus`) by a fixed `rank()`: complete-first, then automatic-before-manual, then alphabetical by name. There is no `sort_order`-style column on the Lookback project row today (unlike Engagement Updates, which already has one - `erNextUpdateSortOrder_` / `reorderEngagementStatusPacks`, `src/engagementReviewStore.js` line 518 / `src/engagementReviewApi.js`). **Reuse that existing pattern rather than inventing a new one**: same idea (persisted `sort_order` column + reorder API + drag-drop client wiring), applied to the Lookback project rows.

**Existing precedent for permission scope:** feature 037 locked reorder of the Engagement Updates agenda to **ADMIN only** (decision **#6**, 037). Recommend mirroring that here for consistency (Admin-only reorder of Ready for Review) unless the user wants it open to CE/EXEC/owners too - confirm rather than assume, since this is a new decision for Lookback specifically, not automatically inherited from 037.

**Existing precedent for mobile:** 037's Engagement Updates agenda already ships "drag-drop + mobile up/down reorder" (v3.5.0 changelog entry in `docs/features/037-engagement-review.md`) because touch drag-and-drop is unreliable on mobile. Reuse that same up/down-button fallback pattern for Ready for Review's mobile card view (`lbRenderProjectCards_`) instead of inventing a new mobile interaction.

**Acceptance Criteria (testable):**
- [x] Given the Ready for Review desktop table, when a user with reorder permission drags a row to a new position, then the new order persists (survives a page reload / re-fetch of the month bundle). Evidence: `reorderLookbackReadyProjects` + `fos_lookback_projects.sort_order` (migration `056_lookback_projects_sort_order.sql`); desktop drag wired in `lbWireReadyDesktopReorder_`.
- [x] Given the reorder happens, when the server sort runs again (`lbMapBundleForClient_`), then Ready for Review respects the persisted custom order instead of being overwritten by the fixed `rank()` sort - decide explicitly whether `rank()` becomes a tie-breaker only, or is replaced entirely by `sort_order` within Ready for Review (Action Required and Green keep their existing sort, unaffected). **Decision: (A) `sort_order` replaces `rank()` within Ready**; Action keeps auto-then-name; Green stays alpha. Evidence: `test_lookbackReadySortOrder_`.
- [x] Given a user without reorder permission, drag handles are not shown (or are disabled) - confirm and apply whatever permission scope is confirmed above. **Decision: Admin only** (`canReorderReady`). Evidence: `showReorder` gated on `b.canReorderReady`.
- [x] **Mobile:** Given viewport **< 768px**, the same reordering is achievable via up/down buttons per row, matching the 037 Engagement Updates precedent, not via touch drag. Evidence: `lbMoveReadyProject_` + mobile up/down on ready cards.
- [x] Reordering Ready for Review does not affect Action Required or Green list order. Evidence: reorder API rejects non-complete selected rows; Action/Green sort paths unchanged.

**Architecture Review:**
- **Security:** New write path - reuse whatever permission check is confirmed (likely `isAdminUser_`, matching 037's precedent) and re-verify server-side, not just by hiding the drag handle client-side.
- **Performance:** Negligible - single-column integer update per reordered row, small lists.
- **Regression risk:** Adding a persisted `sort_order` requires a new additive Supabase migration (`supabase/migrations/0NN_*.sql`, per the project's own migration convention - never rewrite history) on whatever table backs Lookback projects (`055_lookback_reviews.sql`). Confirm this doesn't collide with the existing fixed `rank()` sort used for Action Required/Green (those keep today's behavior; only Ready for Review's ordering changes), and confirm "Re-run recommended list" (`b.canRedo`) does not silently reset custom order for rows it preserves.
- **Testing gaps:** No existing coverage for any Lookback ordering. Add a manual test: reorder two rows, reload the month, confirm order persisted; confirm Action Required/Green order is unaffected.

**Verification Steps:**
1. Desktop: with reorder permission, drag a Ready for Review row to a new position; reload the page; confirm the order persisted.
2. Confirm Action Required and Green lists kept their existing sort order (unaffected).
3. Without reorder permission: confirm no drag handle / reorder affordance appears.
4. **Mobile (~390px):** confirm up/down reorder buttons work per row, matching the 037 Engagement Updates pattern.

---

### BUG-056-08: Margin / EAC numbers in Lookback are off by a factor of 100 (confirmed)

**Reported:** 2026-09-09 - "When we open a lookback we are seeing that the numbers (Margin, EAC etc) are not calculating correctly."

**Root cause - CONFIRMED, not a hypothesis.** Fibery's margin fields (`Agreement Management/Current Margin`, `.../Target Margin`, `.../Target Planned Margin at Complete`) are **fractions** (e.g. `0.42` for 42%). This codebase has an established, correct convention for that: `scaleFractionToPercent_(v)` (`src/fiberyAgreementDashboard.js` line 1444, `return n * 100`), applied e.g. at `src/fiberyAgreementDashboard.js:521` and again at `src/supabasePanelBuilders.js:1251-1252` for the **same three fields** read from the same `fos_agreements` columns.

However, **two other consumers of those same raw Supabase columns skip the scaling entirely:**
1. `src/lookbackJob.js` (`lookbackEvaluateMonthProjects_`, lines 124-171) reads `ag.current_margin` / `ag.target_margin` / `ag.target_planned_margin_at_complete` straight from `fos_agreements` with only `Number(...)` coercion - no `scaleFractionToPercent_`. This feeds **every** Margin/EAC number shown anywhere in Lookback (KPIs, Ready/Action/Green tables, project detail).
2. `src/supabasePanelBuilders.js` lines 314-315 (a **different** function in the same file than the one that scales correctly at 1251-1252) also reads `r.current_margin` / `r.target_margin` unscaled.

**This is not just a display bug - it silently breaks the auto-selection criteria too**, which explains more than the visible numbers:
- `lookbackJob.js` line 149 compares `eacMargin < thr` where `thr` is the `LOOKBACK_MARGIN_THRESHOLD` Settings value (a percent number, default **50**). Since `eacMargin` is actually an unscaled fraction (≈0-1), it is **almost always** less than 50 - meaning the margin criterion has likely been **firing for nearly every eligible agreement**, regardless of true health.
- Conversely, `Math.abs(actual - planned) >= 5` (line 151) and `Math.abs(eacMargin - priorEac) >= 3` (line 156) compare two unscaled fractions against percent-point thresholds (5, 3) - these differences are almost always **far below 1**, so those two criteria have likely **almost never fired**, regardless of true variance.
- Net effect: this single unit bug plausibly explains the wrong displayed numbers, an over-inflated "automatic" selection count driven almost entirely by the margin-threshold criterion, and ties directly into **BUG-056-02** (empty Green list) - if nearly everything eligible gets auto-selected by the broken margin check, there is little left for Green. **Re-verify BUG-056-02 and CHANGE-056-01 against real data after this fix ships**, in case some or all of what looked like an eligibility/execution_date problem was actually this.

**Out of scope but flagged in passing:** `src/supabasePanelBuilders.js` line 314-315 feeds `buildAgreementDashboardPayloadFromSupabase_` (the **live Agreement Dashboard**, feature 003, when served from Supabase) with the same unscaled values into `fiberyAgreementDashboard.js`'s reused KPI/chart functions, which expect an already-scaled percent (per the *other*, correctly-scaled function in the same file at line 1251-1252). This may be a live, currently-shipped bug in the Agreement Dashboard whenever it serves from Supabase, unrelated to Lookback. Not part of this request's scope - flagging separately rather than expanding this spec.

**Acceptance Criteria (testable):**
- [x] Given an agreement with a known Fibery Current Margin of e.g. 42%, when its Lookback project row renders (KPIs, table, project detail), then it displays **42.0%**, not **0.4%**. Evidence: `lookbackEvaluateMonthProjects_` now uses `scaleFractionToPercent_` on all three margin fields; `test_lookbackMarginFractionScale_` asserts 0.42→42 and healthy 0.52 no longer false-selects vs thr 50.
- [x] Given the `LOOKBACK_MARGIN_THRESHOLD` Settings value (percent, default 50), when auto-selection runs, then the EAC-margin-below-threshold comparison uses correctly-scaled percent values on both sides. Evidence: same helper + test.
- [x] Given the actual-vs-plan variance (≥5pts) and MoM (≥3pts) criteria, when auto-selection runs, then they compare correctly-scaled percent-point differences, not fraction differences. Evidence: abs(actual−planned) now on percent scale; test asserts |40−50|≥5.
- [ ] Re-run "Re-run recommended list" for an already-affected month after the fix and confirm the Ready/Action/Green split changes to reflect real margin health, not the former all-or-nothing pattern. (Ops verification after deploy.)
- [x] Confirm whether `src/lookbackJob.js` lines 559-595 (the test-fixture-looking `current_margin: 10, target_margin: 40, ...` blocks) are demo/seed data using percent-scale numbers already, or something else - make sure the fix doesn't double-scale those. Evidence: fixtures converted to Fibery fractions (0.1 / 0.4 / 0.2); `test_lookbackEvaluateServicesOnlyAuto_` scales before compare.

**Architecture Review:**
- **Security:** None.
- **Performance:** None - same values, just multiplied by 100 at read time.
- **Regression risk:** Fix at the point(s) where `current_margin`/`target_margin`/`target_planned_margin_at_complete` are read for percent-display/comparison purposes (`lookbackJob.js`, and confirm `supabasePanelBuilders.js:314-315`'s consumer too) - use the existing `scaleFractionToPercent_` helper rather than writing a new one. Do **not** change `amMirrorNum_` itself or the stored Supabase column values - those columns are read unscaled by design in places that need the raw fraction (if any), and rescaling at the mirror-write layer would silently double-scale the one place that already does this correctly (`supabasePanelBuilders.js:1251-1252`). Re-verify **CHANGE-056-01** and **BUG-056-02** against live data once this ships, per the note above.
- **Testing gaps:** No existing coverage caught this - the discrepancy was only found by comparing two sibling functions in the same file. Add a manual test/diagnostic for `lookbackEvaluateMonthProjects_` that stubs an agreement with `current_margin: 0.42` and asserts the mapped/displayed value is `42`, not `0.42`, and that the threshold comparison behaves correctly at the boundary.

**Verification Steps:**
1. Pick an agreement with a known Fibery margin (spot-check against the live Agreement Dashboard or Project Performance for the same agreement); confirm Lookback shows the same percent, not a value ~100x smaller.
2. Re-run "Re-run recommended list" for a test month; confirm the automatic-selection count is no longer near-100% of eligible agreements.
3. Confirm the actual-vs-plan and MoM variance criteria can now actually fire (construct or find a case with a real ≥5pt / ≥3pt gap and confirm it's flagged).
4. Re-check BUG-056-02's empty-dropdown symptom for the same month/user once this ships.

---

### BUG-056-09: "Opt a project in" - button, dropdown, and reason box no longer appear

**Reported:** 2026-09-09 - "On the lookback tab the ability to add Green projects has been removed. I want to add that back." Follow-up detail: "The section header is there but the dropdown and the text box and button are gone." (i.e. the "Green (not selected)" heading still renders; the "Opt a project in" button, the Project dropdown, and the Reason textarea do not.)

**Investigated, not yet root-caused - here is what was checked and ruled out, to save Cursor from re-treading the same ground:**
- The markup for `#lb-optin-toggle-btn`, `#lb-optin-form`, `#lb-optin-project`, `#lb-optin-reason`, `#lb-optin-save-btn` is still present in `src/DashboardShellPanels.html` (lines 1807-1819) - it was not deleted from the template.
- The population/visibility logic in `lbRenderMonth_` (`src/DashboardShell.html`, the block reading `var optBtn = document.getElementById('lb-optin-toggle-btn')` through the empty-state handling added for **BUG-056-02**) is still present and reads as logically correct on a static review.
- `lbRenderProjectTable_` / `lbRenderProjectCards_`'s new `showRemove` parameter (added for **FEATURE-056-04**) each declare their own local `var b = erState_.lookbackBundle` and `var writable = ...` (`src/DashboardShell.html` ~lines 23412-23417, 23481-23486) before calling `lbCanRemoveLookbackRow_(p, b, writable)` - this does **not** reference an out-of-scope variable and should not throw. Ruled out as a crash source, but worth Cursor double-checking with real data shapes rather than trusting this static read alone.
- Server-side `canOptInAny` / `canOverride` are still returned from `lbMapBundleForClient_` (`src/lookbackApi.js` lines 146-147), unchanged.

**Given static review didn't find the cause, the fastest real diagnosis is live, not more code reading:**
1. Open a real Lookback month as the reporting user (or reproduce their role) and check the browser console for a thrown JS error during `lbRenderMonth_` - if anything upstream in that function throws (e.g. inside the newly-added `lbPopulateActionFilters_` / `lbFilterActionRows_` for **FEATURE-056-05**, which run immediately before the Green/opt-in code in render order), everything after the throw silently never runs, which would produce exactly this symptom (static header renders from raw HTML; everything JS-driven after the crash point does not).
2. If there's no console error, log or inspect the actual `canOpt` inputs for that user/month bundle (`b.canOptInAny`, `b.canOverride`, `erState_.isAdmin`, and whether `green.length` is 0) to confirm whether the button is being **correctly** hidden by design (no permission, or nothing in Green) rather than a bug - in which case this may be a side effect of **BUG-056-08**'s margin scaling bug (near-universal auto-selection leaving Green empty) rather than a UI regression at all. Cross-check against BUG-056-08's fix once that ships.

**Acceptance Criteria (testable):**
- [x] Root cause identified and stated explicitly (crash vs. permission/data state vs. something else not yet considered) before writing a fix. Evidence: (1) **BUG-056-08** near-universal auto-select emptied Green, which also hides owner-scoped opt-in (`canOpt` loop over green); (2) **FEATURE-056-05** filter `change` during `lbPopulateActionFilters_` can re-enter `lbRenderMonth_` and abort before opt-in wiring. Guard: `erState_._lbRendering` + `lbRenderMonthBody_`.
- [x] Given a user with opt-in permission and at least one eligible Green project, when they open the Lookback month view, then the "Opt a project in" button, Project dropdown, and Reason box all render and function as originally shipped. Evidence: re-entrancy guard; Green restored via BUG-056-08. Ops: verify on deployed Web App after Re-run.
- [x] No regression to **FEATURE-056-04** (trashcan remove) or **FEATURE-056-05** (Action Required filters), which share this render path. Evidence: render body still calls populate/filter/showRemove paths; nested render skips instead of stacking.
- [ ] **Mobile:** confirm the mobile equivalent (card view + opt-in form) is similarly unaffected. (Ops verification ~390px after deploy.)

**Architecture Review:**
- **Security:** None expected - this is a rendering regression, not a permission change, pending root cause.
- **Performance:** None.
- **Regression risk:** This shares `lbRenderMonth_` with three other recently-shipped items (BUG-056-02, FEATURE-056-04, FEATURE-056-05) - whatever the fix is, re-verify all three still work afterward, not just the opt-in form.
- **Testing gaps:** This exact regression is why a `test_lbRenderMonth_` -style smoke function (asserting all expected element states after a render: ready/action/green tables populated, opt-in controls present-or-correctly-hidden, filters populated) would have caught this before it reached the user - add one now covering all of BUG-056-02/04/05/09's overlapping surface, not just this one symptom in isolation.

**Verification Steps:**
1. Reproduce with the browser console open; capture and read any thrown error during Lookback month load.
2. Once root cause is found, verify the fix against a user/month combination matching the original report (opt-in button, dropdown, and reason box all visible and functional).
3. Regression-check Action Required's trashcan and filters still work in the same session.
4. **Mobile (~390px):** repeat step 2 on the card layout.

---

### BUG-056-10: Lookback owner shows "Unassigned" - stale `owner_email`/`owner_name`, should resolve from `assigned_owner_id`

**Reported:** 2026-09-09 - "The owner in the lookback table is coming up unassigned. We should be pulling the owner from the assigned owner field for the respective agreement. This is in supabase and in several of the blobs that have been loaded on the dashboard."

**Root cause - confirmed, and broader than Lookback alone.** `fos_agreements` carries **two independent owner representations** added at different times:
- `owner_email` / `owner_name` (text columns, migration `039_engagement_reviews.sql`) - the **original**, older representation.
- `assigned_owner_id` (a relation id to `fos_clockify_users.fibery_id`, migration `041_agreement_management_mirror.sql` / `042_am_mirror_foreign_keys.sql`) - added later when the fuller **AM mirror** sync (`src/supabaseAmMirror.js`, `amMirrorMapAgreement_`) took over `fos_agreements` upserts.

**`amMirrorMapAgreement_` only writes `assigned_owner_id` - it never writes `owner_email`/`owner_name`.** So for any agreement whose row has been touched by the AM mirror since (which is most of them by now), `owner_email`/`owner_name` are stale or null, while `assigned_owner_id` holds the real, current answer. This codebase already has a **documented, correct fix for exactly this**, built once already:
- `src/engagementUpdateMetrics.js` `lookupFosAgreementCurrentOwner_()` (lines 581-614) - doc comment literally says *"Clockify-user fallback when `owner_email`/`owner_name` are empty but `assigned_owner_id` is set (AM mirror populates the id; Agreement dashboard uses the same join)."* This was built for **BUG-037-01** (the Edit Project Update modal owner fix, earlier this session) - but it is **display-only for one single-agreement lookup call**, not applied everywhere the same stale columns are read.
- `src/supabasePanelBuilders.js` (~lines 293-309, the Delivery-style Supabase builder) already does this **correctly and in bulk**: resolves `r.assigned_owner_id` against a pre-loaded `ownerUsersMap` (no per-row Supabase round-trip). **This is the pattern to replicate** for any list/bulk builder - do not call a single-agreement lookup in a loop (N+1).

**Confirmed NOT yet fixed - reads raw `owner_email`/`owner_name` with no `assigned_owner_id` fallback at all:**
- `src/lookbackJob.js` (`lookbackEvaluateMonthProjects_`) - the reported symptom. Bulk query at line ~99 selects `owner_email,owner_name` directly; lines ~159-160 write them straight onto the Lookback project row with no fallback.
- `src/engagementUpdateMetrics.js` `listDeliveryInProgressProjectsForEngagementUpdate_` (lines 617-664, the Engagement Update **project picker** list) - ironically in the **same file** as the correct single-lookup fallback, but this list function doesn't use it.
- `src/engagementUpdateMetrics.js` `buildEngagementUpdateQuantitativeSnapshot_` (~line 552-553, `meta.owner_email` / `meta.owner_name` direct read) - this feeds the `agreement.ownerEmail`/`ownerName` object that `src/engagementReviewStore.js` writes onto **new** Engagement Update rows at creation and metric-refresh time (lines 595-596, 713-714). So this bug isn't just a Lookback display issue - **newly created Engagement Updates in 037 can also get stamped with a stale/blank owner at creation**, independent of BUG-037-01's Edit-modal display fix.
- `src/engagementReviewStore.js` lines 318-319, 341-342 (a separate agreement-link upsert path) - audit for the same pattern.

**"Several of the blobs already loaded on the dashboard" - this needs a data backfill, not just a code fix:**
- Any **already-locked** `fos_lookback_projects` row has `assigned_owner_email`/`assigned_owner_name` frozen at lock time from the buggy read. Fixing the live query only fixes **future** locks/re-runs - it does not retroactively correct rows already written. Check whether "Re-run recommended list" (`b.canRedo`, feature **056**) re-derives and overwrites these fields per row; if so, that is the backfill mechanism to reuse. If not, do **not** write a new one-off backfill script for this - this repo has an explicit standing rule against that (`.cursor/rules/teamwork-product-workflow.mdc`: "Do not write a one-off backfill script... that has happened three times already"). Extend an existing, reusable path instead.
- Existing Engagement Update rows (037) created before this fix may carry the same frozen wrong owner - same backfill consideration applies (likely via "Refresh metrics," if that path re-derives owner; confirm rather than assume).
- Drive-based daily/historical snapshot caches and same-day warm caches (features **009**/**010**, Delivery/Portfolio/Resource Assignments/Agreement Dashboard) that embed agreement owner from this same source will keep showing stale data until their normal refresh cycle regenerates them - identify which snapshot artifacts actually embed owner name/email and confirm whether a manual cache-bust is needed or the next scheduled rebuild is sufficient. Panels already using the correct `assigned_owner_id` resolution (the Delivery-style Supabase builder) were never wrong and need no cache action.

**Acceptance Criteria (testable):**
- [x] Given an agreement whose `owner_email`/`owner_name` are null/stale but `assigned_owner_id` is set, when it appears in the Lookback table (Ready, Action, or Green), then its owner resolves via `assigned_owner_id` -> `fos_clockify_users`, not "Unassigned." Evidence: `lookbackEvaluateMonthProjects_` bulk-resolves via `resolveFosAgreementOwnerFromRow_(ag, usersMap)`.
- [x] The bulk resolution added to `lookbackJob.js` does not introduce an N+1 Supabase call per agreement - reuse the pre-loaded-map pattern from `supabasePanelBuilders.js`, not a loop calling `lookupFosAgreementCurrentOwner_` per row. Evidence: single `loadFosClockifyUsersMap_()` per evaluate.
- [x] `listDeliveryInProgressProjectsForEngagementUpdate_` (Engagement Update project picker) and `buildEngagementUpdateQuantitativeSnapshot_` (feeds new Engagement Update owner at creation/refresh) are audited and fixed with the same resolution, or explicitly confirmed already correct. Evidence: both use `resolveFosAgreementOwnerFromRow_`; picker filters non-Admins in memory after resolve.
- [x] Already-locked Lookback months and pre-existing Engagement Updates get their stored owner fields corrected via an **existing** re-derive path (Re-run recommended list / Refresh metrics) - confirmed which one, not a new backfill script. Evidence: Re-run overwrites `assigned_owner_email/name` from fresh eval (lookbackJob ~410-414); Refresh metrics patches owner from snapshot (`erRefreshStatusPackMetrics_` 713-714). Drive Lookback artifacts: none (Supabase-backed); Agreement/Delivery panels that already resolve `assigned_owner_id` need no manual bust.
- [x] A shared, reusable resolution helper exists (bulk-friendly) rather than a fourth copy of the same fallback logic - consolidate `lookupFosAgreementCurrentOwner_`'s fallback tier and `supabasePanelBuilders.js`'s bulk pattern into one canonical function other callers use. Evidence: `resolveFosAgreementOwnerFromRow_` in `engagementUpdateMetrics.js`; `test_resolveFosAgreementOwnerFromRow_`. `erUpsertAgreementLink_` resolves blank owners via `lookupFosAgreementCurrentOwner_`.

**Architecture Review:**
- **Security:** None - read-only resolution against already-authorized data.
- **Performance:** This is the primary risk here - `lookbackJob.js` already loads up to 3000 `fos_agreements` rows in one query; any fix **must** resolve owners via one bulk `fos_clockify_users` map load (already available via whatever function backs `loadFosClockifyUsersMap_`/`ownerUsersMap`), not a per-row lookup call.
- **Regression risk:** This touches a **shared** helper file (`engagementUpdateMetrics.js`) used by both **037** (Engagement Update creation/edit/refresh) and **056** (Lookback). Changes here must be re-verified against BUG-037-01's original fix (Edit Project Update modal owner display) to confirm no regression, since that fix and this one now share the same underlying data problem but were patched at different times by different code paths.
- **Testing gaps:** No existing coverage caught that only ONE of several `owner_email`/`owner_name` consumers got the BUG-037-01 fallback. Add a manual test that stubs an agreement with `owner_email: null, owner_name: null, assigned_owner_id: 'X'` and a matching `fos_clockify_users` row, then asserts every consumer identified above (Lookback, project picker, Engagement Update creation) resolves the same name/email instead of blank.

**Verification Steps:**
1. Pick an agreement known to have null `owner_email`/`owner_name` but a set `assigned_owner_id`; confirm it now shows the correct owner in the Lookback table (Ready/Action/Green) and in the Engagement Update project picker.
2. Confirm no new N+1 Supabase calls were introduced (check request count/timing for a month with many agreements).
3. Create a new Engagement Update for that same agreement; confirm it captures the correct owner at creation, not blank.
4. Confirm the backfill path (Re-run recommended list, or whatever is chosen) corrects an already-locked month's stored owner without a new one-off script.
5. Spot-check one Drive-cached panel that embeds agreement owner; confirm it's either already correct or gets corrected on its normal refresh cycle.

---

### FEATURE-056-11: Individual Lookback project page - replace KPI cards with PM Overview's Project Performance KPIs

**Requested:** 2026-09-09 - screenshot of the PM Overview "Project Performance" tab's KPI row (Days remaining, % elapsed, Planned margin, Projected margin, EAC hours, EAC $, Actual margin to date - each with hover tooltip help text). "I want those implemented to replace the KPI cards on the current individual projects lookback page... We want the same logic, calculations and hover over help text."

**Current state (Lookback project detail):** `lbOpenProject_` (`src/DashboardShell.html`, in the `er-view-lookback-project` view) renders exactly **4** plain, tooltip-less cards via `lbKpiCard_`: Actual margin, Planned margin, "EAC / projected" (single combined card), and a hardcoded "Hours (locked month): N/A". These read from the project's frozen `metrics` blob (`actualMarginPct` / `plannedMarginPct` / `eacMarginPct`), which **BUG-056-08** already found to be percent-scaled incorrectly and far simpler than Project Performance's real calculation (no days-remaining/elapsed, no separate EAC hours vs EAC $, no "reason" annotations for missing-rate-coverage cases).

**Target (PM Overview Project Performance tab, `src/DashboardShell.html` ~lines 19530-19582 and ~31690-31761):** 7 cards, each rendered via `deliveryKpiChipHtml_({tipId, title, label, valueHtml, subHtml, chipClass})` with a hover `title` tooltip:
1. **Days remaining** / **2. % elapsed** - cheap date math against the agreement's `duration_start`/`duration_end` (no extra data fetch - Lookback already selects these columns). Tooltips: `DELIVERY_KPI_TIPS_.daysRemaining` / `.elapsed`.
2. **Planned margin**, **Projected margin**, **EAC hours**, **EAC $**, **Actual margin to date** - come from `buildProjectPerformanceBlock_()` (`src/projectPerformanceMetrics.js:434`), fed by a per-project monthly P&L fetch: `buildDeliveryProjectMonthlyPnLFromSupabase_(agreementId, {})` -> `{months, resourceAllocations}` -> `buildProjectPerformanceBlock_({months, resourceAllocations, targetMarginPct, asOfMonthKey, assignments})`. **This exact call chain already exists** in `src/engagementUpdateMetrics.js` (`buildEngagementUpdateQuantitativeSnapshot_`, lines ~380, ~465-473) for **037**'s Engagement Update snapshot - reuse it, do not re-derive the math or re-fetch the data a third way. Tooltips: `DELIVERY_KPI_TIPS_.planned` / `.projected` / `.eacHours` / `.eacDollars` / `.actualMargin`, with the `perfMarginKpiTip_` / `perfMarginKpiSub_` "reason" annotation pattern when SOW/cost-card rate coverage isn't 100% (e.g. "See tooltip" subtext), and the `hasResourcePlan` / `noPlanTip` gate showing **N/A** + "No plan available" when there's no resource plan - matching the screenshot's "No plan available" state exactly.

**Decision (confirmed 2026-09-09): freeze everything at lock time, never recompute live.** "I would rather calculate it when we lock it so it does not shift. We should not be pulling it each time." All **7** cards - the 5-value performance block (Planned margin, Projected margin, EAC hours, EAC $, Actual margin to date) **and** Days remaining / % elapsed - are computed **once**, at lock (and again whenever "Re-run recommended list" runs), and stored in the project's frozen `metrics` blob on `fos_lookback_projects` - the same blob that already stores the simpler `actualMarginPct`/`plannedMarginPct`/`eacMarginPct` fields (per **BUG-056-08**). The project detail page renders **only** from that stored blob; it must not call `buildDeliveryProjectMonthlyPnLFromSupabase_` / `buildProjectPerformanceBlock_` or recompute duration math on page view, ever - not for open months, not for archived ones.

**Days remaining / % elapsed "as-of" date (confirmed):** computed as-of the **last calendar day of the reporting month being locked**, not the actual lock timestamp (which usually falls a few business days into the *following* month, per this doc's own lock-schedule model) and not "today" at render time. E.g. locking August 2026 freezes Days remaining / % elapsed as of **2026-08-31**, even though the lock itself happens in early September.
- **Cost this decision commits to:** `buildDeliveryProjectMonthlyPnLFromSupabase_` runs once per eligible agreement (Ready + Action + Green, post **CHANGE-056-01**'s Services-only narrowing) at every lock and every "Re-run recommended list" - heavier than today's lock job, which only reads scalar columns in one bulk query. **Volume check (2026-09-09):** live `fos_agreements` has ≈**20** Delivery-In-Progress non-Internal rows (9 Services, 9 Subscription) - acceptable for per-project P&L at lock/re-run. Re-check with `test_lookbackEligibleVolumeForPerfFreeze_` if the portfolio grows past ~80 eligible.

**Acceptance Criteria (testable):**
- [x] Given an individual Lookback project's detail page, when it renders, then it shows the same 7 KPI cards (Days remaining, % elapsed, Planned margin, Projected margin, EAC hours, EAC $, Actual margin to date) as PM Overview's Project Performance tab for the same agreement/as-of period, using `deliveryKpiChipHtml_` (not the old `lbKpiCard_`). Evidence: `lbRenderFrozenProjectPerfKpis_` in `DashboardShell.html`.
- [x] Hover/tooltip text on each card matches `DELIVERY_KPI_TIPS_` verbatim (reused, not re-typed) - including the "reason" annotation behavior when rate coverage is incomplete. Evidence: tips + `perfMarginKpiTip_` / `perfMarginKpiSub_` reused.
- [x] Given no resource plan exists for the project, when the page renders, then Planned margin / Projected margin / EAC hours / EAC $ show **N/A** with "No plan available" subtext, matching the screenshot and the existing `hidePlanKpis`/`noPlanTip` behavior - Days remaining, % elapsed, and Actual margin to date remain populated regardless (they don't depend on a resource plan). Evidence: `hasResourcePlan` frozen flag gates the four plan-dependent chips.
- [x] For **any** Lookback month (open **or** archived), the 5 performance-block KPI values shown are the **frozen** values from the last lock/re-run, not recomputed from current live data - verify by changing something in the project's live allocations/time entries after lock and confirming the Lookback project detail page's numbers don't move, even while the month is still `open_for_narratives`. Evidence: page view reads only `metrics.performance` / `metrics.duration`; no PnL call in `lbOpenProject_`. Ops: confirm after lock + live change.
- [x] At the moment of lock (or "Re-run recommended list"), the frozen values match what PM Overview's Project Performance tab showed for that agreement at that same `asOfMonthKey` - this is a shared-calculation reuse, not a reimplementation, so they must agree exactly **as of that instant**, even though they can diverge afterward if live data changes. Evidence: `lookbackFreezeProjectPerformanceMetrics_` uses `buildDeliveryProjectMonthlyPnLFromSupabase_` + `buildProjectPerformanceBlock_` (same EU chain).
- [x] Days remaining / % elapsed are frozen at lock/re-run time too, computed as-of the **last calendar day of the reporting month** (not the lock timestamp, not render time) - confirm this with a month whose lock happens well into the following month, so the distinction is actually exercised. Evidence: `lookbackLastCalendarDayOfPeriod_` / `test_lookbackDurationAsOfMonthEnd_` (Aug → as-of 2026-08-31).
- [x] **Mobile:** the KPI chips render correctly at **< 768px** - since this reuses an already-mobile-compliant component (`fos-delivery-pnl-kpi-chip`), confirm it "just works" rather than needing new mobile CSS; call out explicitly if it doesn't. Evidence: flex-wrap container on `#lb-proj-metrics`; same chip CSS as PM Overview. Ops: verify ~390px after deploy.

**Architecture Review:**
- **Security:** None - read-only reuse of already-authorized data and calculation.
- **Performance:** Confirmed by the freeze-at-lock decision - `buildDeliveryProjectMonthlyPnLFromSupabase_` runs once per eligible agreement at lock/re-run time only, never on page view. Confirm real eligible-agreement counts per month before shipping to size the added lock-time cost (see note above).
- **Regression risk:** `buildProjectPerformanceBlock_` and `buildDeliveryProjectMonthlyPnLFromSupabase_` are shared with PM Overview (**040**/**053**), Delivery P&L (**006**), and Engagement Updates (**037**) - reusing them here (read-only, at lock time) is low-risk **for those existing callers** since nothing about their signature or return shape changes; store Lookback's own copy of the result rather than mutating anything those functions return. Once **BUG-056-08** ships, the project's simpler frozen `actualMarginPct`/`plannedMarginPct`/`eacMarginPct` fields become redundant with this richer block - decide whether to keep both (simple fields for KPI/table rollups elsewhere on the Lookback page, rich block for this detail page) or consolidate; don't silently duplicate two sources of truth for the same numbers on the same page. "Re-run recommended list" must re-freeze this block too, not just the simple margin fields, or the two will drift apart on the same project.
- **Testing gaps:** No existing coverage that a lock/re-run actually freezes this richer block correctly. Add a manual test that locks a month, changes the project's live data, re-opens the Lookback project detail, and asserts the 5 performance-block values are unchanged while confirming PM Overview's live tab **does** reflect the change (proving the two are correctly decoupled, not that the fetch silently isn't happening).

**Verification Steps:**
1. Lock a month; open the project detail page and PM Overview's Project Performance tab for the same agreement at the same time; confirm all 7 values and tooltips match at that instant.
2. Change something in that project's live allocations/time entries; reopen the Lookback project detail page (month still open) and confirm the 5 performance-block KPIs are unchanged, while PM Overview's live tab reflects the change.
3. Run "Re-run recommended list" for that month; confirm the frozen block updates to the new lock-time snapshot.
4. Pick a project with **no** resource plan; confirm the N/A + "No plan available" state was correctly frozen too (not just skipped).
5. **Mobile (~390px):** confirm the KPI chip row renders and scrolls/wraps sensibly on the Lookback project detail page.

---

### BUG-056-12: Planned margin (and likely Projected margin / EAC hours / EAC $) show N/A for every project after FEATURE-056-11

**Reported:** 2026-09-09 - "In reviewing the project lookback I see that all of the planned margins are showing up as N/A." Follow-up confirmed: **Projected margin** is also missing/N/A; **Actual margin** shows a real value.

**CORRECTED 2026-09-09 - initial theory disproven, closing as not-a-code-bug.** The first hypothesis below (systemic freeze failure) assumed EAC hours/$ would also be blank, inferred from the user's earlier answer rather than confirmed directly. A screenshot of the actual affected project (RCI (T+L) - Phase 2 - Acuity Implementation) showed **EAC hours: 491.3** and **EAC $: ($62.6K)** both populated with real numbers, with Planned margin and Projected margin showing **N/A · "See tooltip"** - not "No plan available". That subtext is the `perfMarginKpiSub_(reason, fallback)` pattern (`src/DashboardShell.html` line 31117-31119): it only shows "See tooltip" when `plannedMarginReason`/`projectedMarginReason` is set, which only happens when `ppComputeAllocationLaborMargin_` (`src/projectPerformanceMetrics.js`) succeeds in finding a resource plan but fails its **100% rate coverage** requirement (not every billable allocation has a SOW bill/cost rate, for Planned; or a current Team Member Role rate, for Projected) - a completely different, much narrower code path than the "no resource plan at all" (`hasResourcePlan`) gate this entry originally assumed was firing.

The user confirmed **PM Overview's live Project Performance tab shows the identical N/A / "See tooltip" state for this same project right now.** That settles it: Lookback's frozen snapshot is **faithfully reproducing** what the live calculation already shows - this is not a Lookback bug, not a freeze failure, and not something Cursor can fix in code. It's a genuine, pre-existing data gap: this project's resource allocations don't have complete SOW and/or current Team Member Role rate coverage in Fibery, which is exactly the condition **046** ("Hide planned margins without a resource plan") and this margin calculation were designed to surface, not hide.

**No code fix queued for the reported symptom.** The earlier analysis (systemic freeze failure, `perfWarnings` audit, rate-limit risk) is preserved below only in case a **future** report shows the pattern originally assumed here (Planned/Projected/EAC hours/EAC $ **all** blank together, or Actual margin also failing) - that would be the real systemic-failure signature this entry was written for, and none of that has actually been observed yet.

**Optional, small UX follow-on (not required, confirm with the user before doing it):** "See tooltip" requires a hover to learn anything - on a page meant to be reviewed in a meeting (Lookback's whole purpose), that's an easy thing to miss or misread as broken. Consider surfacing the reason text (already available as `plannedMarginReason`/`projectedMarginReason`) directly in the card's subtext instead of behind a hover, at least on this page. This is a UI-clarity nice-to-have, not a bug fix - do not build it without asking, since it's out of scope of what was actually reported.

**Original (superseded) analysis, kept for reference:**
- **Where the rich freeze can silently come back empty** (still valid background, just not what happened here): `hasResourcePlan` defaults to `false` and `performance` defaults to `null` if `fetchAgreementContextForPnlFromSupabase_` or `buildDeliveryProjectMonthlyPnLFromSupabase_` fail, or if an exception is thrown - all captured in `perfWarnings`, which nothing surfaces to the user today. If a **true** systemic failure is ever reported (EAC hours/$ also blank), start there.
- **Volume/rate-limit risk**, flagged in FEATURE-056-11's own Architecture Review before it shipped, remains a live, unverified risk worth checking independently of this specific report - not because it explains this case, but because it hasn't been ruled out for larger eligible-agreement counts.

**Acceptance Criteria:** none - closed without a code change. If a future report shows the true systemic pattern (EAC hours/$ also blank), reopen with that evidence rather than starting a new entry.

---

### CHANGE-056-13: Action Required filters should use the same multi-select dropdown widget as PM Overview

**Requested:** 2026-09-11 - "On the lookback main page, the filters are multi-select list but they are not drop downs. I want to use the same multi-select drop downs that are on the PM Overview page."

**Current state (confirmed, code-level):** `FEATURE-056-05`'s Status/Owner filters render as native HTML `<select multiple>` list boxes - `src/DashboardShellPanels.html` lines 1796-1799 (`#lb-action-filter-status`, `#lb-action-filter-owner`), populated by `lbPopulateActionFilters_` (`src/DashboardShell.html`) via plain `<option>` elements. A native multi-select shows as an always-expanded scrollable list, not a closed dropdown - exactly the "list, not a dropdown" the user is pointing at.

**Target widget, already built and used elsewhere - reuse it, do not build a new one.** PM Overview's Customer/Agreement type/Status/Owner filters (`src/DashboardShellPanels.html` ~lines 1130-1147, e.g. `#delivery-customer-trigger`/`#delivery-customer-menu`) use a shared multi-select dropdown pattern:
- Markup: a `div.fos-util-multi` wrapper containing a `button.multi-trigger` (`data-bs-toggle="dropdown" data-bs-auto-close="outside"`, so it opens as a real dropdown and stays open while checking multiple boxes) plus a `ul.dropdown-menu` that gets populated with checkbox `<li>` items.
- Client logic: `expensesUpdateMultiTrigger_(trigger, defaultLabel, dimLabel, selectedMap)` (`src/DashboardShell.html` ~line 25418) updates the trigger button's label (e.g. "3 owners" + a count badge when something is selected, the default label like "All owners" when nothing is); `expensesPopulateMultiMenu_(menu, items, keyFn, labelFn, selectedMap, onChange)` (~line 25430) builds the checkbox list inside the dropdown menu and wires the change handler.
- Despite the `expenses`-prefixed function names (historical - this widget originated on the Expenses panel), it is already the **general-purpose, cross-panel multi-select dropdown** for this codebase - PM Overview/Delivery, and presumably Utilization (`fos-util-multi` class name), already reuse it rather than each panel inventing its own. Lookback should be the next reuse, not a new implementation.

**Acceptance Criteria (testable):**
- [x] `#lb-action-filter-status` and `#lb-action-filter-owner` (native `<select multiple>`) are replaced with the `fos-util-multi` trigger-button + dropdown-menu markup, matching PM Overview's Customer/Type/Status/Owner filters exactly (same classes, same `data-bs-toggle`/`data-bs-auto-close` attributes). **PASS (v3.29.2):** `DashboardShellPanels.html` uses `div.fos-util-multi`, `button.multi-trigger`, `ul.dropdown-menu` with matching attributes.
- [x] `lbPopulateActionFilters_` is rewritten to call `expensesPopulateMultiMenu_`/`expensesUpdateMultiTrigger_` (or thin Lookback-specific wrappers around them, if a different call shape is needed) instead of building `<option>` elements - reuse the shared functions, don't fork a parallel copy of their logic. **PASS (v3.29.2):** `lbPopulateActionFilters_` + `lbUpdateActionFilterTriggers_` call shared helpers; maps sync to `erState_.lookbackActionFilters` arrays.
- [x] Given no filter is selected, the trigger buttons read "All statuses" / "All owners" (matching the "All customers"/"All owners" convention already used elsewhere), not a blank control. **PASS:** default labels on triggers; `expensesUpdateMultiTrigger_` resets when map empty.
- [x] Given one or more values are checked, the trigger button shows the count (e.g. "2 statuses", with the count badge), matching the existing widget's behavior exactly - no new label format invented. **PASS:** uses `expensesUpdateMultiTrigger_` with dimLabel `status`/`owner`.
- [x] Filtering behavior itself (which rows show/hide in Action Required) is unchanged - this is a presentation-only swap, not a logic change. `lbFilterActionRows_` and the underlying filter-state (`erState_.lookbackActionFilters`) keep working exactly as before. **PASS:** `lbFilterActionRows_` untouched; state remains `{statuses:[], owners:[]}` arrays.
- [x] The existing "Clear filters" button (`#lb-action-filter-clear`) still clears both dropdowns' selections and resets the trigger labels. **PASS:** `lbClearActionFilters_` clears maps, unchecks boxes, updates triggers.
- [x] **Mobile:** the existing `#lb-action-filter-mobile-btn` / mobile filter sheet path for Action Required (if it currently duplicates the native selects for mobile) is updated consistently - confirm what the mobile path currently renders before assuming it needs the same dropdown treatment; a bottom sheet with checkboxes may already be the right mobile pattern per `.cursor/rules/mobile-ui-shell.mdc` and shouldn't be replaced with a desktop-style dropdown. **PASS:** mobile path unchanged (`lbOpenActionFilterMobileSheet_` uses `openMobileFilterSheet_` with checkbox items); desktop-only dropdown swap.

**Architecture Review:**
- **Security:** None - presentation-only change, no new data exposure or entry point.
- **Performance:** None - same filter-state and same underlying row data; only the control rendering changes.
- **Regression risk:** Low, but touches shared functions (`expensesUpdateMultiTrigger_`/`expensesPopulateMultiMenu_`) used by Expenses and PM Overview/Delivery today - do not change either shared function's signature or behavior to accommodate Lookback; if Lookback needs something those functions don't already support, add an optional parameter with a default that preserves existing callers' behavior, or wrap rather than modify. Re-verify Expenses and PM Overview's own filters still work after this change, since they share the code being touched.
- **Testing gaps:** No existing test covers the Action Required filter UI at all (FEATURE-056-05 shipped without one). Add a quick manual check/assertion that populating the new dropdowns with a known status/owner set produces the expected trigger label and checkbox state, consistent with how the shared widget already behaves for PM Overview - register it in `FOS_DIAG_SUITE_STEPS_` per the standing convention (feature 057) if it's automatable; otherwise a documented manual Verification Step is sufficient given this is a thin UI change.

**Verification Steps:**
1. Desktop: open the Lookback tab on Project performance review with a month that has Action Required rows spanning more than one status/owner; confirm Status and Owner now render as closed dropdown buttons (not always-expanded list boxes), open/close correctly, and show the same trigger-label/count-badge behavior as PM Overview's filters.
2. Apply a filter; confirm Action Required rows update exactly as before (no behavior change, only appearance).
3. Click **Clear filters**; confirm both dropdowns reset to "All statuses"/"All owners" and the full list returns.
4. Regression-check PM Overview's own Customer/Type/Status/Owner filters and Expenses' filters still work unchanged, since this touches shared code.
5. **Mobile (~390px):** confirm whatever the mobile filter path already does for Action Required still works correctly after this change.

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
| 2026-09-09 | **v3.21.3** Surface renamed to **Project performance review** (`project-performance-review`); Lookback remains a tab on that route. |
| 2026-09-09 | **v3.22.0** Admin **Re-run recommended list** (keep Manual + narratives) and **Delete Lookback**; Project Update create lists selected Lookback projects only. |
| 2026-09-09 | Spec update: added **CHANGE-056-01** (auto-select Services only, not Subscriptions) and **BUG-056-02** (empty opt-in Project dropdown) to Bug fixes / refinements. Not yet implemented. |
| 2026-09-09 | Spec update: refined **CHANGE-056-01** with the `execution_date` open question; added **BUG-056-03** (Admin-only Lock/Delete buttons - confirmed CSS bug on Lock), **FEATURE-056-04** (trashcan remove on Action Required, reconciled against the "auto rows not removable" locked decision), **FEATURE-056-05** (Action Required status/owner filters). Not yet implemented. |
| 2026-09-09 | **v3.23.0:** Decisions: Subscriptions **(A)** Green-only (not auto); drop `execution_date` gate; Automatic rows soft-removable. Implemented CHANGE-056-01, BUG-056-02 empty opt-in copy, BUG-056-03 lock CSS wrap, FEATURE-056-04 remove API + trashcan, FEATURE-056-05 Action filters. |
| 2026-09-09 | Spec update: added **BUG-056-06** (Reviews tab admin-only - flagged as narrowing locked decision 037#4, needs confirmation), **FEATURE-056-07** (drag-drop reorder for Ready for Review), **BUG-056-08** (confirmed: Margin/EAC percent-fraction scaling bug in `lookbackJob.js`, also breaks auto-select criteria - likely the real explanation behind some of BUG-056-02's empty Green list). Not yet implemented. |
| 2026-09-09 | Spec update: added **BUG-056-09** (Opt a project in - button/dropdown/reason box no longer render; static review ruled out several candidates, root cause needs live diagnosis). Not yet implemented. |
| 2026-09-09 | Spec update: added **BUG-056-10** (owner shows "Unassigned" - `fos_agreements.owner_email`/`owner_name` are stale since the AM mirror only writes `assigned_owner_id`; confirmed via existing `lookupFosAgreementCurrentOwner_` fallback built for BUG-037-01, not applied to `lookbackJob.js` or several other consumers; also affects 037 Engagement Update creation, and needs a backfill for already-locked months, not just a live-code fix). Not yet implemented. |
| 2026-09-09 | Spec update: added **FEATURE-056-11** (replace the 4 plain Lookback project-detail KPI cards with PM Overview Project Performance's 7 tooltip-annotated KPI cards, reusing `buildProjectPerformanceBlock_` / `buildDeliveryProjectMonthlyPnLFromSupabase_` / `DELIVERY_KPI_TIPS_` verbatim). Decisions confirmed same day: all 7 cards freeze at lock/re-run time, never recompute live; Days remaining/% elapsed freeze as-of the last calendar day of the reporting month, not the lock timestamp. Not yet implemented. |
| 2026-09-09 | **v3.24.0:** **BUG-056-10** shared `resolveFosAgreementOwnerFromRow_` + Lookback/picker/snapshot/store consumers; **BUG-056-08** `scaleFractionToPercent_` in lookback evaluate; **BUG-056-09** `lbRenderMonth_` re-entrancy guard. **BUG-056-06** / **FEATURE-056-07** held for OPEN DECISION. |
| 2026-09-09 | **v3.25.0:** FEATURE-056-07 Ready for Review Admin reorder (sort_order replaces rank within Ready; mobile up/down). Decisions: who=Admin only; sort=A. BUG-056-06 still OPEN. |
| 2026-09-09 | **v3.25.1:** BUG-056-06 (A) Reviews tab Admin-only; EXEC/CE land on Lookback; New review unchanged. |
| 2026-09-09 | **v3.26.0:** FEATURE-056-11 Lookback project detail freezes PM Overview 7 Performance KPIs at lock/re-run; render from metrics blob only. |
| 2026-09-09 | Spec update: added **BUG-056-12** (initial hypothesis: Planned + Projected + EAC all N/A, systemic freeze failure) then **corrected same day** after a screenshot showed EAC hours/$ populated fine and the user confirmed PM Overview's live tab shows the identical N/A/"See tooltip" state for the same project. Closed as not-a-code-bug: Lookback is correctly reproducing a genuine SOW/current-rate coverage gap on that project's allocations. No fix queued. |
| 2026-09-11 | **v3.29.2:** CHANGE-056-13 shipped - Action Required Status/Owner filters use shared `fos-util-multi` dropdown (PM Overview widget); mobile filter sheet unchanged. |
| 2026-09-11 | Spec update: added **CHANGE-056-13** - Action Required's Status/Owner filters (FEATURE-056-05) currently render as native `<select multiple>` list boxes; replace with the same `fos_util-multi` trigger-button + checkbox-dropdown widget already used by PM Overview/Delivery and Expenses (`expensesUpdateMultiTrigger_`/`expensesPopulateMultiMenu_`) - presentation-only, reuse the existing shared component rather than building a new one. Not yet implemented. |
