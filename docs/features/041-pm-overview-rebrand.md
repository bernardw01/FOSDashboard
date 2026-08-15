# Feature: PM Overview rebrand (Delivery)

> **Status:** Shipped (**v3.7.0**)  
> **PRD version:** **3.7.0** (`FR-138`, `AC-100`)  
> **Feature ID:** **041**  
> **Release type:** Enhancement  
> **Task list:** Delivery  
> **Shipped with:** Feature **042** (same **v3.7.0** release)  
> **Extends:** [Feature 006](006-delivery-project-pnl.md), [Feature 001](001-dashboard-shell-navigation.md)  
> **Implementation plan:** [041-pm-overview-rebrand-implementation-plan.md](041-pm-overview-rebrand-implementation-plan.md)  
> **Teamwork:** [Release task](https://win.godeap.io/app/tasks/40793088) · [Notebook](https://win.godeap.io/app/projects/1615262/notebooks/313282)  
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Goal

Rename the Delivery workspace from **Projects & P&L** / **Delivery Dashboard** to **PM Overview** (title case) so project managers see a label that matches how they think about the surface.

---

## Locked product decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Label casing | **PM Overview** (title case) everywhere user-visible. |
| 2 | Route id | **`pm-overview`**; legacy **`delivery`** nav id redirects client-side. |
| 3 | Nav group | **Delivery** sidebar group unchanged; child item only renamed. |
| 4 | Release packaging | Shipped in **v3.7.0** with Feature **042**. |

---

## User stories

- As a **project manager**, I want the sidebar and page title to say **PM Overview** so I know this is my primary project health workspace.
- As a **returning user**, I want legacy **`delivery`** bookmarks to keep working via client redirect to **`pm-overview`**.

---

## Acceptance criteria (testable)

### Labels

- [x] Sidebar Delivery child label reads **PM Overview**.
- [x] Panel H1 reads **PM Overview**.
- [x] Mobile bottom nav / quick access use **PM Overview**.

### Route and activity

- [x] Nav route id is **`pm-overview`**; panel id **`#panel-pm-overview`**.
- [x] Legacy **`delivery`** deep links redirect to **`pm-overview`**.
- [x] New activity log events use route **`pm-overview`**.
- [x] Admin Settings group title updated to **Delivery - PM Overview**.

### Mobile

- [x] **Given** viewport width **&lt; 768px**, PM Overview label appears in mobile chrome.

---

## UI notes

| Surface | Before | After |
| --- | --- | --- |
| Sidebar nav id / label | `delivery` / Projects & P&L | `pm-overview` / PM Overview |
| Panel | `#panel-delivery` / Delivery Dashboard | `#panel-pm-overview` / PM Overview |
| Activity route (new events) | `delivery` | `pm-overview` |

Internal element ids (`delivery-*`) unchanged where not user-visible.

---

## Data model

No payload or cache changes.

---

## Verification steps

1. Desktop: sidebar and panel title **PM Overview**.
2. Mobile (~390px): bottom nav shows **PM Overview**.
3. Legacy nav id **`delivery`** opens PM Overview panel.
4. Settings registry Delivery group label updated.

---

## Implementation checklist

- [x] Copy and route changes in `Code.js`, `DashboardShell.html`, `adminSettingsRegistry.js`, `finopsAsk.js`
- [x] PRD **FR-138**, **AC-100**, version **3.7.0**
- [x] Teamwork notebook synced at ship

---

## Changelog (feature doc)

| Date | Note |
| --- | --- |
| 2026-08-14 | Spec Draft + intake. |
| 2026-08-14 | Shipped **v3.7.0** with Feature **042**. |
