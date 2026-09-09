# Monthly Lookback Meeting Guide (Ops)

**Audience:** Ops Manager (Jess) and facilitators running the Monthly Client Financial Performance Review  
**Product:** Performance Hub → Delivery → **Project performance review** → **Lookback** tab  
**Feature:** 056 (shipped in Hub v3.21.0; Admin redo/delete in v3.22.0)  
**Last updated:** 2026-09-09

This guide is the day-to-day playbook. It is not the full product spec. For selection rules and engineering detail, see `docs/features/056-monthly-lookback-financial-review.md`.

---

## What Lookback is (in one minute)

Each reporting month, after time close, Hub **locks** a financial snapshot for Delivery projects, **auto-selects** projects that need discussion, and gives Project Owners a short window to write narratives and attach evidence. Your Lookback meeting always uses that **locked** view. Live PM Overview / P&L can keep moving; the meeting does not chase live time.

Lookback lives **inside Project performance review** as a second mode (Reviews | Lookback). It does **not** replace calendar invites, meeting notes, recordings, or AI synopsis on the existing Performance Review workspace.

**Email alerts are deferred for the first cycles.** You (and owners) drive the cadence in person and via your usual agenda / chat.

---

## Roles at a glance

| Who | What they do in Lookback |
| --- | --- |
| **You (Ops / Client Engagement)** | Confirm lock happened; chase owner narratives; opt projects in when needed; facilitate the meeting from Ready / Action Required / Green lists; can fill or fix narratives for any selected project |
| **Project Owners** | Complete narratives + evidence for their selected / opted-in projects within the owner window |
| **Guy (or named opt-in allowlist)** | May manually opt a green project in with a required Reason |
| **Assigned PM** | May opt in their own green projects with a required Reason |
| **Admin** | Can force **Lock month now** if the job missed; can **Re-run recommended list** (refresh Automatic picks/metrics; keep Manual opt-ins and narratives); can **Delete Lookback** (confirm; removes the month); can **Close cycle** (archive / read-only) after the meeting |

You cannot remove an **Automatic** selection. Opt-in only adds projects; it does not delete Hub’s auto picks.

---

## Monthly cadence (clock you run against)

All lock timing uses **Pacific Time** (`America/Los_Angeles`) and skips **US federal holidays** (weekends and observed holidays are not business days).

1. **Month ends** (calendar month).
2. **Time-entry deadline:** first **Sunday** on or after month-end (team submits time).
3. **Ops chase day:** the next **business day** after that Sunday. Use this day to chase missing time.
4. **Lock:** **11:59 PM Pacific** at the end of that chase business day. Hub captures and locks the Lookback for that reporting month.
5. **Owner window:** **four business days** after the lock date for owners to finish narratives and evidence.
6. **Meeting:** schedule after the owner window (or as calendars allow). Always discuss from the **locked** Lookback tab, not live dashboards.

### Example dates (2026)

| Reporting month | Time deadline (Sun) | Lock date | Owner window (4 biz days) | Typical meeting week |
| --- | --- | --- | --- | --- |
| July 2026 | Sun 2 Aug | Mon 3 Aug | Tue 4 Aug – Fri 7 Aug | Week of 10 Aug |
| August 2026 | Sun 6 Sep | **Tue 8 Sep** (skips Labor Day Mon 7 Sep) | Wed 9 Sep – Mon 14 Sep | After 14 Sep |
| September 2026 | Sun 4 Oct | Mon 5 Oct | Tue 6 Oct – Fri 9 Oct | Week of 12 Oct |

Header text in Hub shows the lock timestamp and **Owner window through YYYY-MM-DD** for the open month.

---

## Phase checklist (copy this each month)

### A. Before lock (Ops chase day)

- [ ] Remind teams: time for the prior month must be in by the Sunday deadline.
- [ ] On the chase business day, follow up on missing time (your normal process).
- [ ] Do **not** expect Lookback numbers to exist yet for that month until after lock.

### B. Confirm the lock (day after lock, or next morning)

1. Open Performance Hub (Web App).
2. Go to **Delivery → Project performance review**.
3. Click **Lookback** (next to Reviews).
4. Choose the **reporting month** in the month picker.
5. Confirm the header shows the month **locked** (timestamp) and an owner-window end date.
6. Scan KPIs: **Selected**, **Automatic**, **Manual**, **Complete**.

If the month is missing or still empty after the lock date:

- Ask an **Admin** to use **Admin lock → Lock month now** for that reporting month (or retry the lock job).
- Do not start owner chase until the month exists and shows locked.

### C. Owner window (four business days)

Goal: move selected projects from **Action Required** into **Ready for Review**.

1. Open Lookback for the locked month.
2. Work the **Action Required** list first (narratives not Complete).
3. For each project, note the **Assigned Owner** and why it was selected (Automatic criteria or Manual Reason).
4. Chase owners (meeting agenda, Slack, email as you prefer). Remind them:
   - Open Hub → Project performance review → **Lookback** → their project.
   - Fill required narrative fields (below).
   - Set status to **Complete**.
   - Upload screenshot evidence if useful.
5. Use **Opt a project in** when something important is still on the **Green** list (red health, change order, leadership ask, etc.). Reason is **required**.
6. As Client Engagement you may open any selected project and complete or correct the narrative yourself if an owner is blocked.

**Narrative fields (required for Complete):**

| Field | Required? |
| --- | --- |
| What happened? | Yes |
| Why did it happen? | Yes |
| Recovery plan and next steps | Yes |
| Leadership support needed | Optional |
| Additional details | Optional |

Hub will not accept **Complete** until the three required fields are filled.

**Evidence:** image uploads on the project detail (screenshots). Prefer attaching before the meeting so the call can stay on the locked record.

### D. Prep the meeting agenda (day before / morning of)

From the Lookback month view, build a simple agenda:

1. **Header facts:** reporting month + lock time (read from the page header).
2. **Ready for Review:** walk completed narratives (Automatic first, then Manual, as listed).
3. **Action Required:** call out anything still incomplete; decide live whether to discuss anyway or park.
4. **Green (not selected):** quick scan only. Metrics are read-only. Opt in during prep if a green project must be discussed; do not invent live “refresh” numbers for the locked month.

Optional: keep using the **Reviews** side of Project performance review for calendar, notes, recordings, and synopsis for the same meeting series. Lookback supplies the **locked financial cohort**; Reviews supplies the **meeting workspace**.

### E. During the meeting

1. Share screen on **Lookback** for the correct reporting month (not live PM Overview as the source of truth).
2. For each Ready project: open the row → read trigger (why selected) → read narrative → skim evidence.
3. Capture decisions in your usual notes (Performance Review notes or team notes). Lookback does not auto-email outcomes.
4. End with Action Required leftovers and any follow-ups (opt-ins for next month, Fibery updates, staffing, etc.).

### F. After the meeting

- [ ] Confirm owners finish any remaining Action Required items if the cycle stays open.
- [ ] Ask an **Admin** to click **Close cycle** when the month should become permanent **read-only** (archived). After that, narratives and evidence cannot be edited.
- [ ] Prior months remain available in the month picker as archive (read-only once closed).

---

## How to use the Hub UI (step by step)

### Open Lookback

1. Sign in to Performance Hub with your Google / Hub login.
2. **Delivery** in the left nav → **Project performance review**.
3. Click **Lookback**.

On a phone (&lt; 768px): use **Choose month** (bottom sheet). Project lists render as cards.

### Read the month board

| Section | Meaning |
| --- | --- |
| KPI strip | Counts of selected / automatic / manual / complete narratives |
| **Ready for Review** | Selected projects with narrative status **Complete** |
| **Action Required** | Selected but not Complete |
| **Green (not selected)** | Eligible executed Delivery projects that did not meet auto rules; metrics only |

Click a project name to open detail: locked margins, selection trigger, narrative, evidence.

### Opt a project in (Manual)

Use when auto-select missed something you still need on the agenda (for v1 this includes **red project health** and **change orders**; those are not auto-detected yet).

1. On the month board, click **Opt a project in**.
2. Choose the project from the green list.
3. Enter a **Reason** (required).
4. Click **Opt in**.

The project moves to the selected list as **Manual**. Automatic rows cannot be converted or removed.

Who can opt in: Assigned Owner (their projects), Guy / emails on the Lookback allowlist, Exec, Admin, and Client Engagement (you).

### Edit a narrative (owner or CE override)

1. Open the selected project.
2. Fill What / Why / Recovery (and optional fields).
3. Set **Narrative status** to **In Progress** or **Complete**.
4. **Save narrative**.
5. Optionally **Upload image** under Evidence.

If the month was **Close cycle**’d (archived), fields are read-only.

---

## What Hub auto-selects at lock (so you can explain “why”)

Eligible pool: **executed** contracts (`execution_date` set), **Delivery In Progress** *or* **closed during the reporting month**, excluding Internal type.

A project is **Automatic** when any of these fire at lock:

| Rule | Plain language |
| --- | --- |
| EAC margin below threshold | Projected / EAC margin under the Lookback floor (default **50%**; Setting `LOOKBACK_MARGIN_THRESHOLD`). This is **not** the Agreement Attention 35% actual-margin alert. |
| Closed in month | Left Delivery In Progress during the reporting month |
| Actual vs plan margin ≥ 5 pts | Actual margin vs planned target gap |
| Month-over-month EAC ≥ 3 pts | Starts on the **second** locked month (needs a prior Lookback) |

Locked metrics in v1 show **project-to-date** margins (actual / planned / EAC). Hours tiles are **N/A** in this release. Live dashboards are separate.

---

## What you should *not* expect (v1)

- Automatic emails when a month locks or a project is selected (deferred; chase manually).
- Auto-detect of red health, missed milestones, or change orders (use **Opt in** + Reason).
- Refreshing Lookback numbers after lock (by design).
- Using **Data source → historical snapshot** dates as the Lookback archive (Lookback has its own month picker).
- Removing an Automatic project from the agenda list inside Hub.

---

## Who to ping when something is stuck

| Problem | Who |
| --- | --- |
| Month never appears after lock date | Admin: **Lock month now**, or engineering if lock job / Datastore failed |
| Guy cannot opt in | Admin: confirm his Hub email is on Setting **`LOOKBACK_OPT_IN_EMAILS`** |
| Owner cannot see Lookback | They need Hub login; assigned owners and allowlisted users can open Lookback even without full Performance Review create rights |
| Need the month frozen after the meeting | Admin: **Close cycle** |
| Recommended list looks wrong after lock | Admin: **Re-run recommended list** (keeps Manual opt-ins and narratives) |
| Need to scrap a bad Lookback month | Admin: **Delete Lookback** (confirm), then **Lock month now** again |
| Numbers look wrong vs Fibery | Treat lock as official for the meeting; file a data issue; Admin may re-run selection or delete and re-lock if the month is still open |

---

## First-cycle tips

1. Walk one locked month in Hub with a Project Owner before the full meeting so they know where to type.
2. Send a short owner checklist (three required fields + Complete + optional screenshot) in your usual channel; Hub will not email it yet.
3. Keep the green list scan short: “anything missing we should opt in?” then move on.
4. After the second locked month, expect **MoM ±3 pts** auto-selects to appear; call that out once so owners are not surprised.

---

## Quick reference card

```
Month end
  -> First Sunday = time deadline
  -> Next business day = Ops chase time, then 11:59 PT lock
  -> 4 business days = owner narratives
  -> Meeting = Lookback tab (locked month)
  -> Admin Close cycle when done

Hub path: Delivery -> Project performance review -> Lookback
Agenda order: Ready -> Action Required -> Green scan
Opt-in: green project + required Reason (CE / owner / Guy)
Complete needs: What + Why + Recovery
```
