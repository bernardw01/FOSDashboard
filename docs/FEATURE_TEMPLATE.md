# Feature: <short name>

> **Teamwork:** Create this spec first as a notebook in [FOS Dashboard Development](https://win.godeap.io/app/projects/1615262) using these sections. Sync to `docs/features/0NN-<slug>.md` at approval and again at ship. See `docs/teamwork-workflow.md`.

## Goal
What outcome does this feature provide?

## User Stories
- As a <user>, I want <capability> so that <benefit>.

## Acceptance Criteria (testable)
- [ ] Given/When/Then style criterion 1
- [ ] Criterion 2
- [ ] **Mobile:** Given viewport width **&lt; 768px**, when the user uses the new/changed UI, then … (scannable layout, bottom sheet or cards, touch targets, access gates unchanged)

## UI Notes
- Routes/pages impacted
- Components to create/edit
- **Desktop:** layout, toolbars, tables/charts
- **Mobile (`DashboardShell.html`, &lt; 768px):** KPI grid or cards, filter bottom sheet vs inline tabs, sections behind **Show charts/details** toggle, bottom nav / quick access updates if a new primary route. See **`.cursor/rules/mobile-ui-shell.mdc`** and **feature 029**.

## Data Model
- Entities/fields/relations
- Migration notes

## Operations
- Queries:
- Actions:

## Edge Cases
- Errors, empty states, auth states

## Verification Steps
Exact commands + manual steps:
1) Desktop: …
2) **Mobile (~390px):** open deployed Web App in device mode; confirm panel is usable without sidebar-only controls
3) …

## Architecture Review (required before implementation starts)
Author: Claude Code. Name an explicit outcome for each - "nothing to flag" is valid, an empty
or placeholder line is not.
- **Security:** authn/authz path touched (Role / Team / `fibery_access` gate per
  `src/authUsersSheet.js` and feature 002), input validation on any new `google.script.run`
  entry point, secrets handling (Fibery token, `SUPABASE_SERVICE_ROLE_KEY` stay server-side).
  This product is single-tenant (one Workspace); check the change against the Role/Team/ADMIN
  access matrix in `README.md` rather than multi-tenant isolation.
- **Performance:** Apps Script execution-time quota, Sheets batching, N+1 Fibery calls,
  unindexed Supabase queries, and whether a dashboard `cacheSchemaVersion` is affected (if so,
  see `.cursor/rules/dashboard-snapshot-cache-sync.mdc`).
- **Regression risk:** what else reads the payload/route/shape being changed, and whether that
  surface has any existing `_diag_*` / `test_*` coverage today.
- **Testing gaps:** this repo has no automated test framework. Name the existing untested
  surface the change touches and what `test_*` / `_diag_*` coverage should be added, not just
  "test the new code." Any new `test_*`/`_diag_*` function this spec calls for MUST also be
  registered as a `{id, label, fn}` entry in `FOS_DIAG_SUITE_STEPS_`
  (`src/perfParityDiagnostics.js`, feature **057**) so it becomes part of the standing,
  browser-runnable diagnostic suite (Settings → Run diagnostic suite) rather than an
  undiscoverable one-off function nobody runs again.

## Implementation Checklist
- [ ] Update feature spec checkboxes as implemented
- [ ] **Mobile UI** per `.cursor/rules/mobile-ui-shell.mdc` (same PR as desktop)
- [ ] Add/update tests (if applicable)
- [ ] Run local smoke test
- [ ] Commit with message: feat: ...