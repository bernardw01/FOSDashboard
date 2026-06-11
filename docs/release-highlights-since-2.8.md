# FOS Dashboard — What's New Since Version 2.8

**Audience:** Harpin leadership, delivery, finance, and client engagement teams  
**Coverage:** Versions **2.8.0** through **2.12.5** (current)  
**Last updated:** May 28, 2026

This summary highlights new capabilities and improvements shipped since version 2.8. Each item is written as **what you can do** and **why it matters** — without technical implementation detail.

---

## Historical snapshots — Expenses & Pipeline

**Feature:** When you switch the dashboard to a **past snapshot date**, the **Expenses** and **Sales Pipeline** views now load from that saved point in time — the same way Agreement, Utilization, and Delivery already did.

**Benefit:** You can review month-end or quarter-end financial and sales pictures exactly as they were captured, without live data shifting underneath you. Finance and sales leadership get a consistent “as of” view for retrospectives, board prep, and variance conversations.

---

## Operations — Clearer utilization alerts

**Feature:** The Utilization alerts panel now focuses on **under-utilization** and **over-allocation** only. Alerts tied to outdated time-approval workflows have been removed.

**Benefit:** The alerts you see are directly actionable for capacity planning — less noise, faster triage when someone is underbooked or overloaded.

---

## Operations — Simplified labor view

**Feature:** The Operations (Utilization) dashboard no longer tracks or displays **pending time approvals**. Related KPIs, table columns, and sidebar widgets for approval status have been removed.

**Benefit:** The Operations view is leaner and centered on hours, cost, and utilization — the metrics teams use for staffing and delivery health. Less clutter when reviewing how people and projects are performing.

---

## Operations — Easier-to-read utilization heatmap

**Feature:** The person-by-week utilization heatmap now uses a **fixed cell size** with horizontal scrolling when there are many weeks or people.

**Benefit:** Labels and color blocks stay readable instead of shrinking to fit the screen. Easier to scan patterns across the team at a glance.

---

## Sales Pipeline — More accurate deal stages

**Feature:** Deal stage grouping now recognizes **Qualifying** deals in the prospecting bucket and treats **Negotiating** as its own stage in the pipeline funnel.

**Benefit:** Stage totals, funnel shape, and revenue forecasts better match how your sales team actually moves deals — so pipeline reviews reflect reality, not mis-bucketed counts.

---

## Delivery — Filter projects by customer, type, and status

**Feature:** The Delivery **Projects & P&L** table adds multi-select filters for **Customer**, **Agreement type**, and **Agreement status**. Your filter choices are remembered between visits.

**Benefit:** Large project portfolios are easier to narrow down for standups, QBRs, and account reviews — find the slice you care about without scrolling through every row.

---

## Expenses — Clearer submission-cycle chart

**Feature:** The chart showing **average days from purchase to expense submission** now displays **employee names** reliably on the vertical axis.

**Benefit:** Finance and managers can see who is consistently slow to submit expenses — supporting coaching and process improvements without guessing who a bar represents.

---

## Delivery — Project status updates on the P&L card

**Feature:** When you select a project in **Projects & P&L**, you now see a **traffic-light status** (On Track, At Risk, or Off Trajectory) with the latest update summary, who submitted it, and when. You can **add a new status update** directly from the dashboard — status plus written notes — without opening Fibery.

**Benefit:** Weekly delivery reviews stay in one place: financial performance and delivery narrative side by side. Project managers capture status where leadership already looks at margin and pacing.

---

## Delivery — View full status history

**Feature:** A **View updates** button opens a slide-out panel listing **all previous status updates** for the selected project, newest first, with the same color-coded status indicators.

**Benefit:** You can trace how a project’s health evolved over time — useful for escalations, handoffs, and understanding what changed between review cycles.

---

## Behind the scenes — AI usage tracking (foundation)

**Feature:** A scheduled job now pulls **Anthropic (Claude) platform usage and cost** into Fibery, matched to people in your time-tracking roster where possible.

**Benefit:** Harpin is building a single place to understand AI spend by person and day — groundwork for finance and leadership to eventually tie AI costs to teams, projects, and allocation decisions. *(Dashboard reporting for AI spend is planned; data collection is live.)*

---

## Reliability and polish (status updates)

Several follow-on releases improved the status-update experience:

| Improvement | Benefit |
| --- | --- |
| Status notes save correctly and appear immediately after submit | Less friction during live project reviews; no “did it stick?” uncertainty |
| Full update text loads when you open a project | You see the real narrative, not an empty or truncated summary |
| History panel populates when you open **View updates** | The slide-out reliably shows past updates instead of a blank panel |

---

## How to explore these changes

1. **Delivery status updates** — Open **Delivery → Projects & P&L**, select a project, and look for the status chip next to Margin. Use **Add status update** or **View updates**.
2. **Project filters** — On the same Delivery panel, use the Customer, Agreement type, and Agreement status filters above the project table.
3. **Historical view** — In the sidebar, change **Data source** from Live data to a snapshot date; Expenses and Pipeline are included for dates after this release.
4. **Pipeline stages** — Open **Sales → Pipeline** and confirm Qualifying and Negotiating deals appear in the expected funnel sections.
5. **Operations** — Open **Operations** and note the streamlined alerts and heatmap; approval-related columns are no longer shown.

---

## Version reference

| Version | Theme |
| --- | --- |
| 2.8.0 | Expenses and Pipeline available in historical snapshots |
| 2.8.1 | Utilization alerts focused on capacity (under / over) |
| 2.10.0 | Anthropic AI usage synced to Fibery |
| 2.11.0 | Operations view simplified (no time-approval tracking) |
| 2.11.1 | Pipeline stage map; utilization heatmap readability |
| 2.11.2 | Delivery filters; expenses chart employee names |
| 2.12.0 | Status updates on Delivery P&L (read + submit) |
| 2.12.1 – 2.12.5 | Status update reliability and history drawer fixes |

For full technical requirements and acceptance criteria, see `docs/FOS-Dashboard-PRD.md`.
