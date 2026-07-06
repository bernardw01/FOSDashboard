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

## Implementation Checklist
- [ ] Update feature spec checkboxes as implemented
- [ ] **Mobile UI** per `.cursor/rules/mobile-ui-shell.mdc` (same PR as desktop)
- [ ] Add/update tests (if applicable)
- [ ] Run local smoke test
- [ ] Commit with message: feat: ...