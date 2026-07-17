# Feature: Collapsible sidebar navigation sections

> **Status:** Shipped (**v2.26.2**).  
> **PRD version:** 2.26.2  
> **Feature ID:** **035**  
> **Release type:** Enhancement  
> **Task list:** Platform and shell  
> **Related:** [001 - Dashboard shell and navigation](001-dashboard-shell-navigation.md); [012 - Settings collapsible groups](012-admin-settings-usage-analytics-collapsible.md) (pattern reference; Settings intentionally does **not** persist collapse); [029 - Mobile shell](029-mobile-shell-phase-ab.md).  
> **Implementation plan:** [035-collapsible-sidebar-nav-sections-implementation-plan.md](035-collapsible-sidebar-nav-sections-implementation-plan.md)  
> **Teamwork notebook:** [Feature 035 - Collapsible sidebar navigation sections](https://win.godeap.io/app/projects/1615262/notebooks/312686)  
> **Implementation plan notebook:** [Feature 035 - Implementation plan (collapsible nav sections)](https://win.godeap.io/app/projects/1615262/notebooks/312687)  
> **Release task (shipped):** [v2.26.2 - Collapsible sidebar navigation sections](https://win.godeap.io/app/tasks/40521287)

## Goal

Let users **collapse and expand** the left-sidebar section headings **Sales**, **Operations**, **Delivery**, and **Finance** so the nav stays scannable as the menu grows. Persist each section’s open/closed state in **`sessionStorage`** so a **page refresh** in the same browser tab restores the user’s layout. Closing the tab (or ending the session) clears the preference (by design).

**Primary audience:** Any authorized FinOps Performance Hub user who uses the desktop sidebar or the mobile **More** offcanvas menu.

## Locked product decisions (for review)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Collapsible headings | **Sales**, **Operations**, **Delivery**, **Finance** only (existing `type: 'group'` rows from `buildNavigationModel_()`). |
| 2 | Non-collapsible | **Home** stays a top-level button. Sidebar footer (**Profile**, **Settings**, version) unchanged. |
| 3 | Default (no stored state) | All groups **collapsed** on first visit in a session (same scannable default as Settings groups). |
| 4 | Persistence | **`sessionStorage` only** (not `localStorage`, not Profile JSON, not Script Properties). |
| 5 | Storage key | Versioned key **`fos_nav_group_collapse_v1`** (bump suffix if shape changes). Envelope stores **`expanded`** group ids; missing ids mean collapsed. |
| 6 | Navigate into collapsed group | If the user opens a route in a collapsed group (bottom nav, Home quick access, deep link, or any `setActiveNav`), **auto-expand** that group so the active child is visible, and **persist** the expanded state. |
| 7 | Access gating | Unchanged: groups/items the user cannot see are omitted by the server; collapse UI only applies to groups actually rendered. |
| 8 | Activity logging | **No** User Activity event for expand/collapse toggles. |
| 9 | Animation | Bootstrap **collapse** show/hide animation on group bodies. |
| 10 | Server / nav model | **No** API change required; reuse existing group `id` values (`sales-group`, `operations-group`, `delivery-group`, `finance-group`). |

## User stories

- As an **authorized user**, I want to **collapse** nav sections I am not using so the sidebar is shorter and easier to scan.
- As an **authorized user**, I want my expand/collapse choices to **survive a refresh** in the same tab so I do not re-collapse sections every time.
- As a **mobile user**, I want the same collapse behavior when I open **More** (sidebar offcanvas), so the full menu is manageable on a narrow screen.
- As a **user who lands via bottom nav or deep link**, I want the section that contains my active dashboard to **open automatically** if it was collapsed, so I can see which item is selected.

## Acceptance criteria (testable)

### Desktop sidebar (≥ 768px)

- [x] **Given** an authorized session with at least one nav group visible, **when** the sidebar renders, **then** each of **Sales**, **Operations**, **Delivery**, and **Finance** (when present) is a **clickable heading** with a clear expand/collapse affordance (chevron) and correct **`aria-expanded`**.
- [x] **Given** a group heading, **when** the user clicks it, **then** the group’s child nav buttons are shown or hidden without navigating to a dashboard.
- [x] **Given** no `sessionStorage` entry (fresh session), **when** the shell loads, **then** all visible groups are **collapsed**.
- [x] **Given** the user expands **Operations** (or any group), **when** they refresh the page in the same tab, **then** that group remains **expanded**.
- [x] **Given** a collapsed group that contains the active route, **when** navigation selects that route (including after refresh if the hash/deep link re-opens it), **then** that group becomes **expanded** and the child shows the active style.
- [x] **Given** desktop width, **when** groups collapse/expand, **then** Home, data source, Profile, and Settings layout remain unchanged.
- [x] **Given** a group heading toggle, **when** the body opens or closes, **then** Bootstrap **collapse** animation runs (not an instant `d-none` flip only).

### Mobile (&lt; 768px)

- [x] **Given** viewport width **&lt; 768px**, **when** the user opens **More** (sidebar offcanvas), **then** the same collapsible group headings work with **≥ 44px** touch targets on the heading control.
- [x] **Given** mobile bottom nav, **when** the user taps a primary route whose group was collapsed, **then** the group auto-expands (persisted) so if they open **More** they still see the active item.
- [x] **Given** desktop width **≥ 768px**, **when** the shell renders, **then** bottom nav remains hidden (feature **029** unchanged).

### Persistence edge cases

- [x] **Given** `sessionStorage` is unavailable or quota fails, **when** the user toggles a group, **then** collapse still works for the current paint and does **not** break navigation (best-effort persist).
- [x] **Given** corrupt JSON in the storage key, **when** the shell loads, **then** the client ignores it and falls back to **all collapsed**.
- [x] **Given** a group id in storage that is not in the current nav model (e.g. Finance hidden for this user), **when** the shell loads, **then** unknown keys are ignored without error.

## UI Notes

### Routes / surfaces

- **Desktop:** `#fosSidebar` / `.fos-sidebar-nav` / `#navList` (or current `els.navList`) built by `renderNav(model)` in `DashboardShell.html`.
- **Mobile:** Same DOM inside the offcanvas opened by **More** (feature **029**).

### Components to edit

| Area | Change |
| --- | --- |
| `src/DashboardShell.html` `renderNav` | Replace static group label `<div>` with a **button** header + Bootstrap **collapse** (or equivalent `d-none` / height toggle) wrapping children. |
| CSS | Styles for `.fos-nav-group-header`, chevron rotation when expanded (mirror Settings `.fos-settings-group-header` / `.fos-settings-chevron`, scoped to sidebar). |
| Client helpers | `readNavGroupCollapseState_()`, `writeNavGroupCollapseState_()`, `isNavGroupCollapsed_(groupId)`, `setNavGroupCollapsed_(groupId, collapsed)`, `ensureNavGroupExpandedForRoute_(routeId)`. |

### Visual / a11y

- Heading: uppercase secondary label look retained; add chevron (Bootstrap Icons `bi-chevron-right` / rotate when expanded).
- Header is a `<button type="button">` (not a nav route).
- `aria-expanded`, `aria-controls` pointing at the collapse body id.
- Keyboard: heading activatable with Enter/Space (native button).
- Do **not** use cards, pills, or heavy chrome; match existing sidebar density.

### Desktop vs mobile

- **Desktop:** collapse lives in the always-visible sidebar.
- **Mobile:** same controls in the offcanvas; bottom nav / Home quick access unchanged.

## Data model

### sessionStorage envelope

Key: **`fos_nav_group_collapse_v1`**

```javascript
{
  schemaVersion: 1,
  expanded: {
    "sales-group": true,
    "operations-group": true
  }
}
```

- **`expanded[groupId] === true`** means the section is open.
- Missing keys default to **collapsed**.
- Only known group ids from the current render pass are applied.

### Server

No change to `getDashboardNavigation()` / `buildNavigationModel_()` for v1. Group ids already present:

| Group id | Label |
| --- | --- |
| `sales-group` | Sales |
| `operations-group` | Operations |
| `delivery-group` | Delivery |
| `finance-group` | Finance |

## Operations

- **Queries / Actions:** None (client-only).
- **Deploy:** `clasp push` + normal Web App verification; no Script Properties, no spreadsheet columns.

## Edge cases

| Case | Behavior |
| --- | --- |
| User lacks Sales or Finance | Group omitted; no header rendered. |
| Operations without Resource assignments | Group still collapsible; fewer children. |
| Single-child group (e.g. Sales → Pipeline) | Still collapsible (user may hide Pipeline). |
| Active route inside collapsed group after refresh | Auto-expand on `setActiveNav` / deep-link apply. |
| HtmlService iframe storage | Same-tab refresh keeps `sessionStorage`; new tab starts expanded defaults. |

## Verification steps

1. **Desktop:** Open deployed Web App; confirm all visible groups **collapsed**; expand **Finance**; refresh; Finance still expanded; collapse again; refresh; Finance collapsed.
2. **Desktop:** Leave **Operations** collapsed; open **Utilization** via any path that calls nav; confirm Operations expands with animation and Utilization is active.
3. **Mobile (~390px):** Open **More**; expand **Delivery**; refresh; open **More** again; Delivery still expanded; collapse it; tap bottom **Delivery**; open **More**; Delivery expanded with active child.
4. Confirm Home, Profile, Settings, and data source still work; no console errors on corrupt storage (DevTools: set key to `not-json`).

## Implementation checklist

- [x] Update this feature spec checkboxes as implemented
- [x] **Mobile UI** per `.cursor/rules/mobile-ui-shell.mdc` (same change set as desktop)
- [x] Client helpers + `renderNav` wiring in `DashboardShell.html`
- [x] CSS for header / chevron; ≥ 44px mobile touch target on heading
- [x] Auto-expand on active route
- [x] Bootstrap collapse animation
- [x] PRD bump + **FR-131** / **AC-93**
- [x] Sync Teamwork notebook + rename release task at ship
- [ ] Manual smoke on deployed Web App (desktop + ~390px)
- [ ] Commit message: `feat: collapsible sidebar nav sections with session persistence`

## Out of scope (v1)

- Persisting collapse state across browser sessions (`localStorage`) or in Profile JSON.
- Collapsing Home, Profile, or Settings.
- Accordion mode (only one group open at a time).
- Remembering scroll position in the sidebar.
- Activity-log events for collapse toggles.
- Changing group membership, labels, or access rules.

## PRD alignment (at ship)

- **FR-131:** Sidebar nav groups Sales / Operations / Delivery / Finance MUST be collapsible with Bootstrap collapse animation; state MUST persist in `sessionStorage` for the tab session; default **collapsed**; auto-expand when navigating to a child.
- **AC-93:** Given/When/Then covering refresh persistence + mobile More + auto-expand + animation.

## Change requests

*(Post-approval customer edits land here until ship.)*

## Changelog

| Date | Note |
| --- | --- |
| 2026-07-17 | Spec draft: collapsible Sales / Operations / Delivery / Finance; `sessionStorage` persistence; implementation plan for review. |
| 2026-07-17 | Review decisions: default **collapsed**; auto-expand on navigate; Bootstrap animation; no toggle logging. Implemented **v2.26.2**. |
