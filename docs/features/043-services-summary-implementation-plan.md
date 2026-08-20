# Services Summary - implementation plan

> **PRD version 3.8.0** - feature [043](043-services-summary.md).  
> **Status:** Shipped (**v3.8.0**)  
> **Teamwork notebook:** [Feature 043 - Implementation plan (Services Summary)](https://win.godeap.io/app/projects/1615262/notebooks/313389)  
> **Feature notebook:** [Feature 043 - Services Summary](https://win.godeap.io/app/projects/1615262/notebooks/313388)  
> **Release task:** [v3.8.0 - Services Summary](https://win.godeap.io/app/tasks/40848296)

## Scope (R1)

1. Nav: Delivery child `services-summary` / **Services Summary**.
2. Server: `src/servicesSummaryDashboard.js` `getServicesSummaryDashboardData()`.
3. Client: `#panel-services-summary` filters, KPIs, table/cards.
4. Ask AI + activity events + PRD FR-140 / AC-101.

## Out of scope

- Additional filters beyond Customer.
- New Drive snapshot artifact.
- shadcn/ui (Apps Script + Bootstrap shell).

## Files

- `src/servicesSummaryDashboard.js` (new)
- `src/Code.js` nav
- `src/DashboardShell.html` panel + client
- `src/userActivityLog.js`, `src/finopsAsk.js`, `src/userActivityStats.js`
- `docs/FOS-Dashboard-PRD.md`, `docs/features/000-overview.md`, this spec
