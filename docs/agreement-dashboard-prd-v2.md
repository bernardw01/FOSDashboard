# Product Requirements Document

## Revenue Operations Tool — System Specification

**Version:** 2.5
**Date:** March 2026
**Status:** Draft — Generalized / Development Reference
**Scope:** This document specifies the full requirements for building the Revenue Operations Tool against any state of data in a Fibery Agreement Management workspace. It is not tied to a specific data snapshot.
**v2.5 Changes:** Added Section 14 — Data Sync from Fibery (on-demand sync from admin panel, full replace, per-entity status and retry, last sync time).
**v2.4 Changes:** Switched UI and charting stack to shadcn/ui (Section 9.2) and Recharts (Section 9.4); replaced Chart.js throughout. Section 9 renumbered (9.2–9.8).

---

## Table of Contents

1. [Product Purpose](#1-product-purpose)
2. [Target Users](#2-target-users)
3. [Fibery Data Model Requirements](#3-fibery-data-model-requirements)
4. [Data Query Specification](#4-data-query-specification)
5. [Business Logic & Computed Values](#5-business-logic--computed-values)
6. [Alert & Flagging Rules](#6-alert--flagging-rules)
  6.8 [Site-wide Navigation & Pages](#68-site-wide-navigation--pages)
7. [Dashboard Component Specifications](#7-dashboard-component-specifications)
  - 7.1 Page Header · 7.2 KPI Summary Bar · 7.3 Status Donut · 7.4 Customer Bar · 7.5 Financial Table · 7.6 Customer Cards · 7.7 Attention Items · 7.8 Forward Pipeline · 7.9 Recognition Progress · 7.10 Type Mix Donut · **7.11 Revenue Flow Sankey Diagram**
8. [Configuration Reference](#8-configuration-reference)
9. [Technical Architecture](#9-technical-architecture)
  - 9.1 Delivery Format · 9.2 UI (shadcn) · 9.3 Generation · 9.4 Charting · 9.5 Design System · 9.6 Brand Identity · 9.7 Layout · 9.8 Browser
10. [Implementation Guide](#10-implementation-guide)
11. [Extensibility & Future Enhancements](#11-extensibility--future-enhancements)
12. [Glossary](#12-glossary)
13. [Changelog](#13-changelog)
14. [Data Sync from Fibery](#14-data-sync-from-fibery)

---

## 1. Product Purpose

The Revenue Operations Tool is a self-contained, interactive report that provides a real-time operational and financial view of all agreements within a Fibery-based agreement management system. It is designed to be regenerated on demand against any state of the underlying Fibery workspace data.

### 1.1 Problem Statement

Agreement data in Fibery spans multiple interconnected databases (Agreements, Companies, Revenue Items, Labor Costs, etc.). No native consolidated view exists to allow leadership to quickly assess:

- Portfolio health at a glance (how many agreements, in what states)
- Financial performance per engagement (planned vs. recognized revenue, margin)
- Concentration risk across customers
- Agreements with negative or deteriorating margin
- Forward billing pipeline for capacity and cash flow planning

### 1.2 Solution

A generated ShadCN based dashboard that is produced by querying the Fibery API, transforming the results, and rendering them as interactive charts, tables, and alert panels. The output file requires no server, authentication, or external dependency at view time — it opens directly in any modern browser.

---

## 2. Target Users


| User                    | Use Case                                                    |
| ----------------------- | ----------------------------------------------------------- |
| Executives / Leadership | Monthly portfolio review; concentration and risk assessment |
| Delivery Managers       | Margin and progress monitoring per engagement               |
| Finance                 | Revenue recognition tracking; forward pipeline planning     |
| Operations              | Agreement status and upcoming milestone visibility          |


---

## 3. Fibery Data Model Requirements

The dashboard is built against the following Fibery workspace schema. If field names or structures differ in a given workspace, the query layer (Section 4) must be updated to match.

### 3.1 Required Databases


| Database       | Space                | Purpose                                |
| -------------- | -------------------- | -------------------------------------- |
| `Agreements`   | Agreement Management | Core entity for all contract records   |
| `Companies`    | Agreement Management | Customer and client records            |
| `Revenue Item` | Agreement Management | Milestone-based billing records        |
| `Labor Costs`  | Agreement Management | Time-tracked labor cost entries        |
| `Contacts`     | Agreement Management | Customer contacts linked to agreements |


### 3.2 Agreements — Required Fields


| Field Name            | Fibery Field Path                                             | Type             | Notes                                                  |
| --------------------- | ------------------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| Name                  | `Agreement Management/Name`                                   | Text             | Agreement display name                                 |
| Workflow State        | `workflow/state` → `enum/name`                                | Enum             | See Section 3.5 for expected values                    |
| Agreement Type        | `Agreement Management/Agreement Type` → `enum/name`           | Enum             | See Section 3.6                                        |
| Agreement Progress    | `Agreement Management/Agreement Progress` → `enum/name`       | Enum             | See Section 3.7                                        |
| Customer              | `Agreement Management/Customer` → `Agreement Management/Name` | Relation         | Links to Companies                                     |
| Total Planned Revenue | `Agreement Management/Total Planned Revenue`                  | Number (formula) | Sum of all linked Revenue Item target amounts          |
| Rev Recognized        | `Agreement Management/Rev Recognized`                         | Number (formula) | Sum of Revenue Items where `Revenue Recognized = true` |
| Total Labor Costs     | `Agreement Management/Total Labor Costs`                      | Number (formula) | Sum of linked Labor Cost entries                       |
| Total Materials & ODC | `Agreement Management/Total Materials & ODC`                  | Number (formula) | Other direct costs                                     |
| Current Margin        | `Agreement Management/Current Margin`                         | Number (formula) | Computed — see Section 5.1                             |
| Target Margin         | `Agreement Management/Target Margin`                          | Number           | Agreed target margin at scoping                        |
| Duration              | `Agreement Management/Duration`                               | Date Range       | Agreement start and end dates                          |
| Execution Date        | `Agreement Management/Execution Date`                         | Date             | Contract signing date                                  |
| Clockify Project ID   | `Agreement Management/Clockify Project ID`                    | Text             | External time-tracking reference                       |


### 3.3 Companies — Required Fields


| Field Name                    | Fibery Field Path                                    | Type             | Notes                                               |
| ----------------------------- | ---------------------------------------------------- | ---------------- | --------------------------------------------------- |
| Name                          | `Agreement Management/Name`                          | Text             | Company display name                                |
| Funnel Stage                  | `Agreement Management/Funnel Stage` → `enum/name`    | Enum             | See Section 3.8                                     |
| Segment                       | `Agreement Management/Segment` → `enum/name`         | Enum             | Industry/vertical                                   |
| Lead Source                   | `Agreement Management/Lead Source` → `enum/name`     | Enum             | Origin of the relationship                          |
| Total Customer Contract Value | `Agreement Management/Total Customer Contract Value` | Number (formula) | Sum of planned revenue across all linked agreements |
| NDA Completed                 | `Agreement Management/NDA Completed`                 | Boolean          | Whether NDA is in place                             |


### 3.4 Revenue Item — Required Fields


| Field Name         | Fibery Field Path                                              | Type     | Notes                               |
| ------------------ | -------------------------------------------------------------- | -------- | ----------------------------------- |
| Name               | `Agreement Management/Name`                                    | Text     | Milestone name                      |
| Target Amount      | `Agreement Management/Target Amount`                           | Number   | Planned billing amount              |
| Actual Amount      | `Agreement Management/Actual Amount`                           | Number   | Amount actually invoiced            |
| Target Date        | `Agreement Management/Target Date`                             | Date     | Planned billing date                |
| Revenue Recognized | `Agreement Management/Revenue Recognized`                      | Boolean  | Whether revenue has been recognized |
| Workflow State     | `workflow/state` → `enum/name`                                 | Enum     | Billing status                      |
| Agreement          | `Agreement Management/Agreement` → `Agreement Management/Name` | Relation | Parent agreement                    |
| Customer           | `Agreement Management/Customer` → `Agreement Management/Name`  | Relation | Customer (via agreement)            |


### 3.5 Agreement Workflow States

The following workflow states are expected. Additional states may exist but the dashboard must handle at minimum:


| State                       | Dashboard Classification             |
| --------------------------- | ------------------------------------ |
| Identified Opportunity      | Pre-delivery / Pipeline              |
| First Client Call Completed | Pre-delivery / Pipeline              |
| Proposal Delivered          | Proposal                             |
| Closed-Won                  | Pre-delivery                         |
| Delivery In Progress        | Active                               |
| Contract Complete           | Complete                             |
| Closed-Lost                 | Inactive (exclude from active views) |


### 3.6 Agreement Types


| Value        | Display                                           |
| ------------ | ------------------------------------------------- |
| Subscription | Recurring / subscription revenue                  |
| Services     | Project-based professional services               |
| License      | Software license                                  |
| Internal     | Internal cost-tracking only — no external revenue |


### 3.7 Agreement Progress Values


| Value       | Meaning                    |
| ----------- | -------------------------- |
| Not Started | Delivery not yet begun     |
| In Progress | Active delivery underway   |
| Delayed     | Delivery behind schedule   |
| Closing     | Final stages               |
| Complete    | All deliverables fulfilled |


### 3.8 Company Funnel Stages


| Value    | Meaning                           |
| -------- | --------------------------------- |
| Lead     | Early-stage, no formal engagement |
| Prospect | Active sales pursuit              |
| Customer | At least one completed agreement  |
| Client   | Ongoing active engagement         |


---

## 4. Data Query Specification

All data is retrieved via the Fibery API (REST or MCP). The following queries define the minimum data set required to populate the dashboard. Queries should be re-run each time a dashboard refresh is requested.

### 4.1 Agreements Query

Fetch all agreements. Exclude `Closed-Lost` workflow state from default views. No hard limit — retrieve all records.

```
FROM: Agreement Management/Agreements
SELECT:
  - fibery/id
  - Agreement Management/Name
  - workflow/state → enum/name
  - Agreement Management/Agreement Type → enum/name
  - Agreement Management/Agreement Progress → enum/name
  - Agreement Management/Customer → Agreement Management/Name
  - Agreement Management/Total Planned Revenue
  - Agreement Management/Rev Recognized
  - Agreement Management/Total Labor Costs
  - Agreement Management/Total Materials & ODC
  - Agreement Management/Current Margin
  - Agreement Management/Target Margin
  - Agreement Management/Duration (start + end)
  - Agreement Management/Execution Date
WHERE: workflow/state ≠ "Closed-Lost"
ORDER BY: Agreement Management/Total Planned Revenue DESC
LIMIT: 1000
```

### 4.2 Companies Query

Fetch all companies except system/internal records (identified by segment or stage, configurable).

```
FROM: Agreement Management/Companies
SELECT:
  - fibery/id
  - Agreement Management/Name
  - Agreement Management/Funnel Stage → enum/name
  - Agreement Management/Segment → enum/name
  - Agreement Management/Lead Source → enum/name
  - Agreement Management/Total Customer Contract Value
  - Agreement Management/NDA Completed
LIMIT: 1000
```

### 4.3 Historical Revenue Items Query (Recognized)

Fetch all revenue items where `Revenue Recognized = true`. Used to validate recognized revenue totals and identify billing cadence.

```
FROM: Agreement Management/Revenue Item
SELECT:
  - fibery/id
  - Agreement Management/Name
  - Agreement Management/Target Amount
  - Agreement Management/Actual Amount
  - Agreement Management/Target Date
  - Agreement Management/Revenue Recognized
  - workflow/state → enum/name
  - Agreement Management/Agreement → Agreement Management/Name
  - Agreement Management/Customer → Agreement Management/Name
WHERE: Agreement Management/Revenue Recognized = true
ORDER BY: Agreement Management/Target Date DESC
LIMIT: 1000
```

### 4.4 Future Revenue Items Query (Pipeline)

Fetch all upcoming/unrecognized revenue items. Used to populate the forward pipeline visualization.

```
FROM: Agreement Management/Revenue Item
SELECT:
  - (same fields as 4.3)
WHERE:
  - Agreement Management/Revenue Recognized = false
  - Agreement Management/Target Date > [today]
ORDER BY: Agreement Management/Target Date ASC
LIMIT: 1000
```

---

## 5. Business Logic & Computed Values

### 5.1 Current Margin Calculation

Current margin is computed by Fibery as a formula field. The dashboard reads this value directly. The underlying formula is:

```
Current Margin (%) =
  (Rev Recognized − Total Labor Costs − Total Materials & ODC)
  ÷ Rev Recognized
  × 100
```

**Edge cases:**

- If `Rev Recognized = 0`, current margin is undefined (`null`) — display as `—`
- If the result is negative, this indicates cost overrun — flag per Section 6
- For `Internal` type agreements, margin is not meaningful — display as `—`

### 5.2 Portfolio Recognition Rate

Computed at render time from the agreements dataset:

```
Portfolio Recognition Rate (%) =
  SUM(Rev Recognized across all non-Internal agreements)
  ÷ SUM(Total Planned Revenue across all non-Internal agreements)
  × 100
```

### 5.3 Total Contract Value (Portfolio)

```
Portfolio Total Contract Value =
  SUM(Total Planned Revenue) across all non-Internal, non-Closed-Lost agreements
```

### 5.4 Customer Contract Value

Derived from the Companies query field `Total Customer Contract Value`. This is a formula computed by Fibery and does not need to be recalculated client-side.

### 5.5 Forward Monthly Pipeline (per Agreement)

For the forward pipeline visualization, the estimated monthly billing rate per agreement is derived from future revenue items:

```
Monthly Rate (agreement) =
  SUM(Target Amount of future Revenue Items for this agreement)
  ÷ COUNT of distinct calendar months spanned by those items
```

If no future revenue items exist for an agreement that is still `Delivery In Progress`, the agreement should appear in the pipeline section with a `—` monthly rate and an amber indicator.

### 5.6 Revenue Items Scheduling Status

For each agreement, derive a scheduling status from its future revenue items:


| Condition                                            | Status Label        | Dashboard Treatment            |
| ---------------------------------------------------- | ------------------- | ------------------------------ |
| All future items have `workflow/state = "Scheduled"` | Fully Scheduled     | Standard rendering             |
| Some items are `Not Scheduled`                       | Partially Scheduled | Amber indicator                |
| All future items are `Not Scheduled`                 | Not Scheduled       | Dimmed / amber, attention flag |
| No future items exist but agreement is active        | No Pipeline Items   | Warning flag                   |


---

## 6. Alert & Flagging Rules

The attention items panel is dynamically populated based on the following rules applied to live data. Rules are evaluated at render time — no hardcoded alert messages.

### 6.1 Rule: Negative Current Margin


| Trigger        | Current Margin < 0 for any non-Internal agreement                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity       | 🔴 Critical                                                                                                                                                             |
| Title template | `{Agreement Name} — Negative Margin ({Current Margin}%)`                                                                                                                |
| Body template  | `${Total Labor Costs} in labor costs logged against ${Rev Recognized} recognized. ${Total Planned Revenue} in planned revenue remaining. Immediate review recommended.` |


### 6.2 Rule: Low Margin Warning


| Trigger        | Current Margin ≥ 0 and < LOW_MARGIN_THRESHOLD (default: 35%) for any non-Internal agreement with Rev Recognized > 0              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Severity       | 🟡 Warning                                                                                                                       |
| Title template | `{Agreement Name} — Low Margin ({Current Margin}%)`                                                                              |
| Body template  | `Margin is below the {LOW_MARGIN_THRESHOLD}% threshold. Monitor labor pacing against remaining planned revenue of ${remaining}.` |


### 6.3 Rule: Unscheduled Revenue on Active Agreement


| Trigger        | Agreement status = `Delivery In Progress` AND all future Revenue Items have `workflow/state = "Not Scheduled"`        |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Severity       | 🟡 Warning                                                                                                            |
| Title template | `{Agreement Name} — Revenue Not Scheduled`                                                                            |
| Body template  | `This agreement is in active delivery but revenue milestones are not scheduled. Activate billing schedule in Fibery.` |


### 6.4 Rule: Internal Agreement with Significant Labor


| Trigger        | Agreement Type = `Internal` AND Total Labor Costs > INTERNAL_LABOR_THRESHOLD (default: $50,000)                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Severity       | 🟡 Warning                                                                                                                           |
| Title template | `{Agreement Name} (Internal) — ${Total Labor Costs} Unattributed Labor`                                                              |
| Body template  | `Internal agreement has significant labor costs with no associated revenue. Confirm these costs are captured in overhead budgeting.` |


### 6.5 Rule: Proposal with No Revenue Items


| Trigger        | Agreement status = `Proposal Delivered` AND no Revenue Items linked to agreement                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Severity       | 🟡 Warning                                                                                                                 |
| Title template | `{Agreement Name} — Proposal Pending Activation`                                                                           |
| Body template  | `Proposal is delivered but no revenue milestones have been created. Activate billing schedule if engagement is confirmed.` |


### 6.6 Rule: Renewal or Expiring Agreement


| Trigger        | Agreement Duration end date is within EXPIRY_WARNING_DAYS (default: 60) of today AND status = `Delivery In Progress` |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Severity       | 🟢 Informational                                                                                                     |
| Title template | `{Agreement Name} — Expiring {N} days`                                                                               |
| Body template  | `Agreement is approaching its end date. Initiate renewal discussion if applicable.`                                  |


### 6.7 Rule: No Alerts Present

If no alert rules are triggered, the attention items panel should display a single green informational card: "No attention items — all agreements within normal parameters."

---

## 6.8 Site-wide Navigation & Pages
The application includes a sticky site-wide menu bar at the top of every authenticated page.

Menu links:
- `Home` → `/`
- `Agreement Management Dashboard` → `/dashboard`
- `Settings` → `/settings` (admin-only)

Settings page requirements:
- The Settings panel is only available to admin users (`user.isAdmin = true`).
- The Settings page displays Fibery sync status and a “Sync from Fibery” button, reusing the existing Fibery sync capability.

Branding:
- All pages (including Home and Settings) adhere to the site-wide harpin.ai branding theme (colors, typography, and spacing tokens).
- The application brand name displayed in the site header is `Revenue Operations Tool`.

## 7. Dashboard Component Specifications

Each component is described with its data source, rendering logic, and behavior. All components should gracefully handle zero-data states (empty agreement list, no future pipeline items, etc.).

### 7.1 Page Header


| Element    | Value                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo       | harpin AI logo (`logo.svg`) rendered as `<img>` at 32px height, sourced from `https://harpin.ai/wp-content/uploads/logo.svg`. A thin vertical separator (`1px solid rgba(82,201,229,0.3)`, 28px tall) divides the logo from the title. Both are aligned horizontally via flexbox. The `<img>` includes `onerror="this.style.display='none'"` as a graceful fallback. |
| Title      | `Agreement Management Dashboard` (static) — displayed inline to the right of the logo and separator                                                                                                                                                                                                                                                                            |
| Subtitle   | `Portfolio state as of {today's date} · {N} agreements · {M} customers`                                                                                                                                                                                                                                                                                              |
| Date badge | Today's date, dynamically set at render time                                                                                                                                                                                                                                                                                                                         |


### 7.2 KPI Summary Bar

Six metric cards rendered in a responsive grid row. Each card has a color-coded top border, a label, a primary value, and a sub-label.


| Card                 | Value                                                                                                                      | Sub-label                                             | Color                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| Total Agreements     | COUNT of active agreements (non-Closed-Lost, non-Internal)                                                                 | "{M} external customers"                              | Blue                                   |
| Total Contract Value | SUM of Total Planned Revenue (non-Internal)                                                                                | "across all active SOWs"                              | Teal                                   |
| Revenue Recognized   | SUM of Rev Recognized (non-Internal)                                                                                       | "{portfolio recognition rate}% of portfolio realized" | Green                                  |
| In Delivery          | COUNT of agreements where status = "Delivery In Progress"                                                                  | "{N} proposals · {M} complete"                        | Yellow                                 |
| Top Customer         | Name + Total Customer Contract Value of the customer with the highest Total Customer Contract Value                        | "{N}% of portfolio · {M} SOWs"                        | Blue                                   |
| ⚠ Flagged Margin     | If any agreement has Current Margin < 0: show the worst margin value. If no negative margins: show lowest positive margin. | Agreement name                                        | Red (negative) / Yellow (low positive) |


**Tooltip behavior:** Each KPI card must include a tooltip (shown on hover) with a one-sentence description of what the metric represents.

**Number formatting:** KPI primary values (counts and currency) must automatically use compact notation so that the displayed number uses **4 or fewer digits (including a decimal point)**. Use thousands (K), hundreds of thousands, or millions (M) as appropriate (e.g. 1.23M, 12.3K, 999). This prevents overflow in the card and keeps values scannable.

### 7.3 Agreement Status Donut Chart

- **Data source:** Agreements query grouped by `workflow/state`
- **Chart type:** Doughnut (Recharts `Pie` with `innerRadius`)
- **Title:** Display a card title above the donut: "Agreement Status"
- **Center label:** Total agreement count
- **Color mapping:** Configurable per workflow state (see Section 8)
- **Legend:** Rendered below chart, listing each state and its count
- **Tooltip:** State name and count on hover
- **Empty state:** If no agreements, render empty donut with "No agreements" label

### 7.4 Customer Contract Value Bar Chart

- **Data source:** Companies query, filtered to companies with at least 1 active agreement
- **Chart type:** Horizontal bar (Recharts `BarChart` with `layout="vertical"`)
- **X-axis:** Total Customer Contract Value, formatted as currency
- **Y-axis:** Company names, sorted by contract value descending
- **Colors:** Assign from the color palette in Section 8, one color per customer, consistent across the entire dashboard
- **Tooltip:** Company name and formatted contract value
- **Exclude:** Internal companies (Type = Internal or Segment = Internal)

### 7.5 Financial Performance Table

- **Data source:** Agreements query (all statuses except Closed-Lost)
- **Layout:** Tabbed interface with 3 tabs:
  - **All Active** — all non-Internal agreements
  - **Top Customer** — agreements belonging to the customer with the highest contract value
  - **Other Customers** — all remaining agreements
- **Columns:** Agreement name + parent identifier, Customer name (hidden in customer-specific tab), Type badge, Status badge, Planned Revenue, Recognized Revenue, Current Margin bar
- **Margin bar rendering:**
  - Bar width = `min(max(Current Margin, 0), 100)%` of container
  - Color: Red if < 0, Yellow if 0–`LOW_MARGIN_THRESHOLD`, Teal if `LOW_MARGIN_THRESHOLD`–60%, Green if ≥ 60%
  - Numeric value rendered to the right of the bar
  - Null margins (Internal or unstarted) render as `—`
- **Sorting:** Default sort by Planned Revenue descending; columns should be sortable on click
- **Scrollable:** Max height of 400px; overflows with custom scrollbar

### 7.6 Customer Relationship Cards

- **Data source:** Companies query
- **Layout:** Scrollable vertical list of cards
- **Each card contains:**
  - Initials icon (first 2–3 characters of company name), colored from the customer color palette
  - Full company name
  - Agreement count (linked active agreements)
  - Funnel Stage
  - Segment
  - NDA status (green checkmark if `NDA Completed = true`)
  - Total Customer Contract Value (formatted as currency, or "Internal" for internal entities)
- **Sort order:** By Total Customer Contract Value descending; internal companies at the bottom

### 7.7 Attention Items Panel

- **Data source:** Alert rules evaluated against Agreements query (Section 6)
- **Layout:** Vertical stack of alert cards
- **Each card contains:**
  - Severity icon (🔴 / 🟡 / 🟢)
  - Title (generated from rule template)
  - Body text (generated from rule template with live values substituted)
- **Sort order:** Critical first, then Warning, then Informational
- **Empty state:** Single green "No attention items" card if no rules trigger

### 7.8 Forward Revenue Pipeline

- **Data source:** Future Revenue Items query (Section 4.4) — aggregated by agreement
- **Chart type:** Horizontal bar
- **Each bar represents one agreement** with future scheduled revenue items
- **Bar width:** Proportional to estimated monthly billing rate (Section 5.5), relative to the maximum monthly rate in the dataset
- **Bar label:** Formatted monthly rate + customer name + "(not scheduled)" suffix if scheduling status = Not Scheduled
- **Visual treatment for unscheduled:** Reduced opacity (0.4), dashed border
- **Color:** Inherited from customer color palette
- **Sort:** By monthly billing rate descending
- **Grouping header:** Optional grouping by customer if more than 8 agreements appear
- **Empty state:** "No forward pipeline data found" if no future revenue items exist

### 7.9 Revenue Recognition Progress (Stacked Bar)

- **Data source:** Agreements query
- **Chart type:** Horizontal stacked bar (Recharts `BarChart` with stacked `Bar`)
- **Each row = one agreement** (top N by planned revenue — default: 10, configurable)
- **Two segments per bar:**
  - Recognized: `Rev Recognized` — green
  - Remaining: `Total Planned Revenue − Rev Recognized` — dark surface color
- **Labels:** Agreement name (truncated to 25 characters with ellipsis if longer)
- **Tooltip:** Shows recognized and remaining amounts with formatting
- **Exclude:** Internal agreements (planned revenue = 0)
- **Sort:** By Total Planned Revenue descending

### 7.10 Agreement Type Mix Donut

- **Data source:** Agreements query grouped by `Agreement Type`
- **Chart type:** Doughnut (Recharts `Pie` with `innerRadius`)
- **Title:** Display a card title above the donut: "Agreement Type Mix"
- **Center label:** Total agreement count
- **Color mapping:** Configurable per type (see Section 8)
- **Legend:** Below chart, listing each type and count

### 7.11 Revenue Flow Sankey Diagram

The Sankey diagram provides a hierarchical view of how total planned revenue flows through three successive layers of classification: Agreement Status → Customer → Agreement Type. It reveals how revenue is distributed across workflow states, which customers sit within each status, and how the customer's revenue breaks down by agreement type.

#### 7.11.1 Position

Rendered as a full-width panel below Section 7.10 (Agreement Type Mix Donut), at the bottom of the dashboard. Minimum height: 400px; height scales with the number of nodes (see Section 7.11.4).

#### 7.11.2 Data Source

The Agreements query (Section 4.1), using `Total Planned Revenue` as the flow value. Agreements with `Total Planned Revenue = 0` or `null` (typically `Internal` type) are excluded unless a configuration flag explicitly includes them.

#### 7.11.3 Node Layers and Link Definitions

The diagram consists of three layers of nodes connected by two sets of directional links:

**Layer 1 — Agreement Status (source)**

One node per distinct `workflow/state` value present in the dataset. The node value equals the sum of `Total Planned Revenue` across all agreements in that state. Use the workflow state color mapping from Section 8.2.

**Layer 2 — Customer (intermediate)**

One node per distinct customer name. The node value equals the sum of `Total Planned Revenue` across all agreements for that customer. Use the customer color palette from Section 8.5 (same deterministic color assignment as all other dashboard components).

**Layer 3 — Agreement Type (target)**

One node per distinct `Agreement Type` value present in the dataset. The node value equals the sum of `Total Planned Revenue` across all agreements of that type.

| Node color | Use the Agreement Type color mapping from Section 8.3 |

**Link set 1 — Status → Customer**

For each unique combination of (Agreement Status, Customer), create one directed link. The link value equals the sum of `Total Planned Revenue` for all agreements matching that Status + Customer combination. Link color inherits from the source Agreement Status node (with configurable opacity, default: 0.35).

**Link set 2 — Customer → Type**

For each unique combination of (Customer, Agreement Type), create one directed link. The link value equals the sum of `Total Planned Revenue` for all agreements matching that Customer + Type combination. Link color inherits from the source Customer node (with configurable opacity, default: 0.35).

#### 7.11.4 Node and Diagram Sizing


| Parameter                                                | Requirement                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Node width                                               | 20px                                                                                             |
| Node padding (vertical gap between nodes in same column) | 12px                                                                                             |
| Diagram height                                           | `max(400, (total_node_count × 28))` pixels, capped at 900px                                      |
| Diagram width                                            | 100% of container width                                                                          |
| Node label position                                      | Right of Layer 1 (Status) nodes; right of Layer 2 (Customer) nodes; left of Layer 3 (Type) nodes |
| Node label format                                        | `{Name} · ${value formatted as abbreviated currency}` (e.g., `Delivery In Progress · $8.2M`)     |


#### 7.11.5 Tooltip Behavior

On hover over a **node**, display:

- Node name
- Total `Total Planned Revenue` flowing through node
- Percentage of portfolio total

On hover over a **link**, display:

- Source node name → Target node name
- Flow value (formatted as currency)
- Percentage of source node's total that this link represents

#### 7.11.6 Rendering Library

The Sankey diagram uses **D3 v7 + d3-sankey**. In the React app, install as npm dependencies (`d3`, `d3-sankey`) and render inside a React component (e.g. `useEffect` with a ref to an SVG or div container). The diagram is rendered as inline SVG inside a container (e.g. `<div id="sankeyChart">`). For a static HTML export, D3 and d3-sankey may be loaded from CDN or bundled into the output; see Section 9.4.

#### 7.11.7 Data Preparation

The input data for the Sankey must be constructed from the agreements dataset at render time. The following pseudocode defines the transformation:

```
nodes = []
links = []
nodeIndex = {}

function getNode(name, layer, color):
  key = layer + "::" + name
  if key not in nodeIndex:
    nodeIndex[key] = nodes.length
    nodes.push({ name, layer, color })
  return nodeIndex[key]

for each agreement in agreements where Total Planned Revenue > 0:
  statusIdx   = getNode(agreement.status,   "status",   statusColorMap[agreement.status])
  customerIdx = getNode(agreement.customer, "customer", customerColorMap[agreement.customer])
  typeIdx     = getNode(agreement.type,     "type",     typeColorMap[agreement.type])

  // Link: Status → Customer
  addOrMergeLink(statusIdx, customerIdx, agreement.planned)

  // Link: Customer → Type
  addOrMergeLink(customerIdx, typeIdx, agreement.planned)

function addOrMergeLink(source, target, value):
  existing = links.find(l => l.source == source and l.target == target)
  if existing:
    existing.value += value
  else:
    links.push({ source, target, value })
```

The `CONFIG` block (Section 10.4) must expose the prepared `sankeyData` constant:

```javascript
const sankeyData = {
  nodes: [
    { name: "Delivery In Progress", layer: "status",   color: "#52C9E5" },
    { name: "Princess Cruise Lines",layer: "customer", color: "#007FA7" },
    { name: "Services",             layer: "type",     color: "#007FA7" },
    // ... all nodes
  ],
  links: [
    { source: 0, target: 1, value: 5400000 },
    { source: 1, target: 2, value: 5400000 },
    // ... all links
  ]
};
```

#### 7.11.8 Edge Cases


| Condition                                    | Handling                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Only one Agreement Status in data            | Single left-column node; diagram still renders correctly as a two-layer flow (Status → Customer → Type)                         |
| Agreement with null Customer                 | Assign to a synthetic node labelled `(Unassigned)` with dim color `#4a5580`                                                     |
| Agreement with null Status                   | Assign to a synthetic node labelled `(No Status)`                                                                               |
| All agreements of one type have same status  | Single link from customer to status node; renders as a straight band                                                            |
| Total Planned Revenue = 0 for all agreements | Render empty state: "No revenue data available for Sankey visualisation"                                                        |
| More than 10 customers                       | Diagram still renders; vertical height scales per Section 7.11.4; horizontal scroll is not used — height expansion is preferred |


#### 7.11.9 Visual Treatment

- Node rectangles: `border-radius: 4px`; filled with the node's assigned color
- Link paths: D3 cubic Bezier curves; filled (not stroked) with source node color at configured opacity
- Selected state (click on node): Highlight all links connected to the selected node at full opacity; dim all unconnected links to 0.1 opacity
- Deselect: Click on empty canvas area resets all opacities
- Section title: `Revenue Flow — Type · Customer · Status` with the standard card heading style (see Section 9.5)

---

## 8. Configuration Reference

The following values should be defined as constants at the top of the dashboard generation script and/or rendered template. They control thresholds, colors, and display behavior.

### 8.1 Alert Thresholds


| Constant                   | Default | Description                                                           |
| -------------------------- | ------- | --------------------------------------------------------------------- |
| `LOW_MARGIN_THRESHOLD`     | 35      | Margin % below which a warning alert is triggered                     |
| `INTERNAL_LABOR_THRESHOLD` | 5000    | Labor cost ($) above which an internal agreement is flagged            |
| `EXPIRY_WARNING_DAYS`      | 60      | Days before end date at which an expiry alert is shown                |
| `TOP_N_RECOGNITION_BARS`   | 10      | Max agreements shown in revenue recognition chart                     |
| `SANKEY_LINK_OPACITY`      | 0.35    | Default fill opacity for Sankey flow path bands (0–1)                 |
| `SANKEY_INCLUDE_INTERNAL`  | false   | Whether `Internal` type agreements are included in the Sankey diagram |


Admin configuration:
- Admins can adjust persisted thresholds from the `/settings` page; values are stored in `DashboardThresholds` and read at render time by the dashboard logic.
- Changes are audit-logged in `DashboardThresholdChangeLog`, including the user who performed the update.
- Defaults used when no DB row exists:
  - `TOP_N_RECOGNITION_BARS` = 10
  - `LOW_MARGIN_THRESHOLD` = 35
  - `INTERNAL_LABOR_THRESHOLD` = 5000

### 8.2 Workflow State Color Mapping

Colors use the harpin.ai brand palette (see Section 9.6).


| State                       | Color                                                          |
| --------------------------- | -------------------------------------------------------------- |
| Delivery In Progress        | `#52C9E5` (harpin bright cyan)                                 |
| Proposal Delivered          | `#20B4C4` (harpin medium teal)                                 |
| Contract Complete           | `#43D6BA` (harpin green-teal)                                  |
| Closed-Won                  | `#007FA7` (harpin teal action)                                 |
| Identified Opportunity      | `#A0AEC0` (harpin grey-400)                                    |
| First Client Call Completed | `#a29bfe` (lavender — neutral accent, outside primary palette) |


### 8.3 Agreement Type Color Mapping

Colors use the harpin.ai brand palette (see Section 9.6).


| Type         | Color                                       |
| ------------ | ------------------------------------------- |
| Subscription | `#52C9E5` (harpin bright cyan)              |
| Services     | `#007FA7` (harpin teal action)              |
| Internal     | `#2a5a7a` (harpin text-dim — de-emphasised) |
| License      | `#20B4C4` (harpin medium teal)              |


### 8.4 Margin Color Thresholds


| Condition                          | Color                                                 |
| ---------------------------------- | ----------------------------------------------------- |
| Margin < 0                         | `#fc5c65` (red — retained as universal danger signal) |
| 0 ≤ Margin < LOW_MARGIN_THRESHOLD  | `#20B4C4` (harpin medium teal — caution)              |
| LOW_MARGIN_THRESHOLD ≤ Margin < 60 | `#007FA7` (harpin teal action — acceptable)           |
| Margin ≥ 60                        | `#43D6BA` (harpin green-teal — healthy)               |
| Null / N/A                         | `#2a5a7a` (harpin text-dim — de-emphasised)           |


### 8.5 Customer Color Palette

Assign colors from the following ordered palette, cycling if there are more customers than colors. The assignment must be deterministic (same customer always gets same color within a generated report). The palette leads with harpin.ai brand colors (see Section 9.6) followed by supplemental accent colors for additional customers:

```
#52C9E5, #007FA7, #20B4C4, #43D6BA, #fd9644,
#fc5c65, #a29bfe, #A0AEC0, #ee5a24, #0fb9b1
```

Color assignment order: sort customers by `Total Customer Contract Value` descending, then assign colors in order.

### 8.6 Internal Company Identification

Companies are identified as internal if **any** of the following are true:

- `Funnel Stage` is absent / null
- `Segment` = "Internal" (if this enum value exists)
- They have no `Total Customer Contract Value` and no external customers linked
- The company name matches a configurable `INTERNAL_COMPANY_NAMES` list (default: `["harpin.ai"]`)

---

## 9. Technical Architecture

### 9.1 Delivery Format

The dashboard is delivered as a **single self-contained `.html` file**. All JavaScript, CSS, data, and chart configurations are embedded inline. The file must:

- Open in any modern browser without a server (via `file://` protocol)
- Require no internet connection at view time (Recharts and D3 are bundled in the app build; for static HTML export, document any CDN or bundling approach)
- Be regeneratable on demand by re-running the generation process against fresh Fibery data

### 9.2 UI Component Library (shadcn/ui)

The dashboard UI is built with **shadcn/ui** for all non-chart components. shadcn/ui provides copy-paste React components (Card, Table, Tabs, Tooltip, Badge, ScrollArea, etc.) built on Radix UI and Tailwind. These are installed into the project and themed with the design tokens in Section 9.4 so that cards, tables, tabs, KPI cards, alert panels, and customer cards share consistent styling and accessibility. Charts (Section 9.4) are rendered inside shadcn Card or equivalent containers where appropriate.

### 9.3 Generation Process

The generation workflow is:

```
1. Query Fibery API (4 queries per Section 4)
2. Transform raw results into dashboard data model (Section 5)
3. Evaluate alert rules against transformed data (Section 6)
4. Render HTML template with data injected as inline JavaScript constants
5. Output single .html file
```

This process may be implemented as:

- A Python script using the Fibery REST API
- A Claude Cowork / MCP session that queries Fibery MCP and writes the HTML file
- A Make (Integromat) scenario triggered on a schedule

### 9.4 Charting Libraries

The dashboard uses two charting approaches, both integrated into the React app (bundled via npm, not CDN).

**Recharts** — all chart components except the Sankey. Recharts is a React-first charting library that composes well with shadcn and Tailwind theming.

- **Pie** (with `innerRadius` for doughnut) — Agreement Status donut (Section 7.3), Agreement Type Mix donut (Section 7.10).
- **BarChart** with `layout="vertical"` (horizontal bars) — Customer Contract Value bar (Section 7.4), Forward Revenue Pipeline (Section 7.8).
- **BarChart** with stacked **Bar** — Revenue Recognition Progress (Section 7.9).

Charts are themed using the design tokens (Section 9.5 Design System) so that segment and bar colors match the workflow state, agreement type, and customer color mappings (Sections 8.2, 8.3, 8.5).

**D3 v7 + d3-sankey** — Sankey diagram (Section 7.11) only. Installed as npm dependencies (`d3`, `d3-sankey`) and used inside a React component (e.g. via `useEffect` and a ref to the SVG container). D3 must be loaded/imported before d3-sankey. For a static HTML export, D3 and d3-sankey may be bundled into the output or loaded from CDN as documented.

### 9.5 Design System

All design tokens align with the harpin.ai brand identity (see Section 9.6 for full brand specification).


| CSS Variable   | Token             | Value                                           |
| -------------- | ----------------- | ----------------------------------------------- |
| `--bg`         | Background        | `#061B30` (harpin deep navy)                    |
| `--surface`    | Surface (card)    | `#092747` (harpin secondary dark)               |
| `--surface2`   | Surface (inner)   | `#0d2e4a`                                       |
| `--border`     | Border            | `#1a4060`                                       |
| `--accent`     | Primary accent    | `#52C9E5` (harpin bright cyan)                  |
| `--accent2`    | Secondary accent  | `#007FA7` (harpin teal action)                  |
| `--accent3`    | Tertiary accent   | `#20B4C4` (harpin medium teal)                  |
| `--accent4`    | Quaternary accent | `#43D6BA` (harpin green-teal)                   |
| `--text`       | Text primary      | `#FFFEFC` (harpin off-white)                    |
| `--text-muted` | Text muted        | `#A0AEC0` (harpin grey-400)                     |
| `--text-dim`   | Text dim          | `#2a5a7a`                                       |
| —              | Font stack        | `'Inter', system-ui, -apple-system, sans-serif` |
| —              | Base font size    | `14px`                                          |


**Google Fonts dependency:** Inter is loaded at render time via:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

If the dashboard must be rendered offline, Inter must be bundled or an equivalent system font substituted.

### 9.6 Brand Identity

The dashboard is branded for **harpin AI** (harpin.ai). All visual decisions — color, typography, logo — follow harpin.ai's design language as extracted from the public site at [https://harpin.ai](https://harpin.ai). shadcn/ui components and Recharts are themed to use this palette.

#### Color Palette


| Role               | Hex       | Name                                        |
| ------------------ | --------- | ------------------------------------------- |
| Background         | `#061B30` | Deep Navy                                   |
| Surface            | `#092747` | Secondary Dark                              |
| Primary Accent     | `#52C9E5` | Bright Cyan                                 |
| Action / Link      | `#007FA7` | Teal Action                                 |
| Secondary Accent   | `#20B4C4` | Medium Teal                                 |
| Positive / Success | `#43D6BA` | Green-Teal                                  |
| Text Primary       | `#FFFEFC` | Off-White                                   |
| Text Muted         | `#A0AEC0` | Grey-400                                    |
| Danger             | `#fc5c65` | Red (universal signal — not brand-specific) |


#### Typography


| Property         | Value                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| Primary typeface | **Inter** (Google Fonts)                                                  |
| Weights used     | 400 (regular), 500 (medium), 600 (semibold), 700 (bold), 800 (extra-bold) |
| Fallback stack   | `system-ui, -apple-system, sans-serif`                                    |


#### Logo Usage


| Variant                      | URL                                                           | Use Case                                                         |
| ---------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Light (for dark backgrounds) | `https://harpin.ai/wp-content/uploads/logo.svg`               | Dashboard header — rendered on `#061B30` background              |
| Dark (for light backgrounds) | `https://harpin.ai/wp-content/uploads/harpinAI-Logo-Blue.svg` | Not used in current dashboard; available for light-mode variants |


The logo is displayed at **32px height** in the page header, inline with the dashboard title. A thin vertical separator (1px, `rgba(82,201,229,0.3)`, 28px tall) provides visual separation between the logo and the title text. The `<img>` element must include `onerror="this.style.display='none'"` to gracefully degrade if the CDN is unavailable.

#### Design Principles

The harpin.ai brand uses a dark navy base with high-contrast cyan/teal accents — conveying technical sophistication and clarity. When extending the design system:

- Use deep navy surfaces, never pure black
- Prefer cyan/teal accent hierarchy for interactive elements and data highlights
- Use off-white (`#FFFEFC`) for primary text — not pure white
- Reserve red (`#fc5c65`) exclusively for error states and negative margin indicators

### 9.7 Layout

- CSS Grid for all multi-column layouts
- Two-column and three-column grids collapse to single column at ≤ 900px viewport
- Cards use consistent padding (`20px`), border-radius (`12px`), and border (`1px solid var(--border)`)
- All scrollable panels use a custom scrollbar (4px width, `var(--border)` track)

### 9.8 Browser Compatibility

The dashboard must render correctly in:

- Chrome 110+
- Safari 16+
- Firefox 110+
- Edge 110+

No support required for Internet Explorer.

---

## 10. Implementation Guide

This section provides step-by-step guidance for regenerating the dashboard against fresh data.

### 10.1 Step 1 — Query Fibery

Execute the four queries defined in Section 4 against the Fibery workspace. The Fibery MCP tool (if available) or the Fibery REST API (`POST /api/commands`) can be used.

Required endpoint format for REST:

```
POST https://{workspace}.fibery.io/api/commands
Authorization: Token {api_token}
Content-Type: application/json

Body: [{ "command": "fibery.entity/query", "args": { ... } }]
```

### 10.2 Step 2 — Transform Data

Apply the business logic from Section 5:

- Flag Internal agreements (Section 8.6)
- Compute Portfolio Recognition Rate
- Compute per-agreement monthly forward billing rate
- Derive scheduling status per agreement
- Assign customer colors from palette (Section 8.5)

### 10.3 Step 3 — Evaluate Alerts

Apply each alert rule from Section 6 in order. Collect triggered alerts with severity and generated text. Sort: Critical → Warning → Informational.

### 10.4 Step 4 — Render HTML

Inject all transformed data into the HTML template as JavaScript constants in a `<script>` block at the top of the `<body>`. Structure:

```javascript
const CONFIG = {
  // Default threshold values (admin-configurable via /settings; persisted in DashboardThresholds)
  LOW_MARGIN_THRESHOLD: 35,
  INTERNAL_LABOR_THRESHOLD: 5000,
  EXPIRY_WARNING_DAYS: 60,
  TOP_N_RECOGNITION_BARS: 10,
  SANKEY_LINK_OPACITY: 0.35,       // default opacity for Sankey flow paths
  SANKEY_INCLUDE_INTERNAL: false,  // whether Internal agreements appear in Sankey
  generatedAt: "2026-03-13"
};

const agreements    = [ /* ... */ ];
const customers     = [ /* ... */ ];
const futureRevenue = [ /* ... */ ];
const alerts        = [ /* ... */ ];

// Sankey data — pre-computed nodes and links (see Section 7.11.7)
const sankeyData = {
  nodes: [
    /* { name: string, layer: "type"|"customer"|"status", color: string } */
  ],
  links: [
    /* { source: nodeIndex, target: nodeIndex, value: number } */
  ]
};
```

All rendering logic reads from these constants. This separation ensures the template can be updated independently of the data, and vice versa. The `sankeyData` object is the only constant that is consumed exclusively by D3 — all other constants are consumed by Recharts (or equivalent) renderers or the alert panel.

### 10.5 Step 5 — Output

Write the complete HTML to a file named:

```
agreement-overview-{YYYY-MM-DD}.html
```

Store in the designated outputs folder. Prior versions should be retained for historical comparison.

### 10.6 Deployment Pipeline Dependencies (Fly.io)
The web application (including auth, dashboard pages, and admin settings) is deployed using **Fly.io** as the production deployment pipeline (via Wasp `deploy fly`).

Operational notes:
- Deployment creates/updates separate Fly images for the server and the web client.
- Required Fly secrets include at minimum `DATABASE_URL`, `FIBERY_WORKSPACE`, `FIBERY_API_TOKEN`, plus SMTP configuration for email delivery.
- This dashboard relies on Fly runtime configuration (Fly secrets/env vars) to enable server-side authentication and email sending in production.

### 10.7 SMTP Provider Dependency (Resend.com)
Email delivery is implemented using **Resend.com** as the SMTP provider.

Operational notes:
- Wasp is configured with `emailSender.provider = SMTP`.
- Wasp auth emails (email verification and password reset) use `auth.methods.email.fromField`; that sender domain must be verified in Resend for delivery to succeed.
- The current intended sender is `no-reply@sendmail.godeap.com` (updateable once the sender domain is verified in Resend).
---

## 11. Extensibility & Future Enhancements

The following enhancements are out of scope for v1.0 but are anticipated future requirement


| Priority | Enhancement                   | Notes                                                                                                                                                                     |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Live Fibery data connection   | Replace static injection with API calls at page load, using a server-side proxy to protect the Fibery API token                                                           |
| High     | Date-range filter             | Allow the user to select a "as of" date and recompute recognized revenue and margin based on items recognized before that date                                            |
| High     | Customer drill-down           | Click a customer card or bar to filter all dashboard components to that customer's agreements only                                                                        |
| High     | Sankey cross-filter           | Clicking a node in the Sankey diagram (Section 7.11) filters the Financial Performance Table and Attention Items Panel to only the agreements that flow through that node |
| Medium   | Margin trend chart            | Line chart showing `Current Margin` over time per agreement, computed from historical revenue item data                                                                   |
| Medium   | Revenue milestone calendar    | Month-by-month calendar view of upcoming revenue items with color-coded statuses                                                                                          |
| Medium   | Configurable alert thresholds | Admin interface to adjust `LOW_MARGIN_THRESHOLD` and other thresholds without editing code                                                                                |
| Low      | PDF export                    | Print-to-PDF styling (`@media print`) optimized for A3/Letter landscape                                                                                                   |
| Low      | Email digest                  | Automated weekly summary email triggered by a scheduled Make/Zapier scenario                                                                                              |
| Low      | Team member cost breakdown    | Expand labor cost view to show cost by team member or role per agreement                                                                                                  |
| Low      | Multi-workspace support       | Parameterize the Fibery workspace URL and API token to support multiple environments (e.g., staging vs. production)                                                       |


---

## 12. Glossary


| Term                       | Definition                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agreement                  | A formal contract or statement of work between the organization and a customer, tracked as a Fibery entity                                                                                                   |
| Current Margin             | `(Rev Recognized − Total Costs) ÷ Rev Recognized × 100`. Measures profitability of recognized revenue to date                                                                                                |
| Target Margin              | The margin percentage agreed at contract scoping. Used as a benchmark for Current Margin                                                                                                                     |
| Revenue Item               | A milestone-based billing record linked to an agreement. Represents a scheduled or completed invoice                                                                                                         |
| Rev Recognized             | Sum of Revenue Item `Target Amount` values where `Revenue Recognized = true`                                                                                                                                 |
| Total Planned Revenue      | Sum of all Revenue Item `Target Amount` values linked to an agreement, regardless of recognition status                                                                                                      |
| Funnel Stage               | CRM classification of a customer's relationship stage: Lead → Prospect → Customer → Client                                                                                                                   |
| Scheduling Status          | The billing readiness of future Revenue Items: Not Scheduled, Scheduled, Pending Approval, etc.                                                                                                              |
| SOW                        | Statement of Work — the formal document underlying an agreement                                                                                                                                              |
| Internal Agreement         | An agreement of type `Internal`, used to track costs for internal projects with no associated external revenue                                                                                               |
| Portfolio Recognition Rate | Ratio of total recognized revenue to total planned revenue across all non-Internal agreements                                                                                                                |
| Forward Pipeline           | The set of future (unrecognized) Revenue Items, used to estimate upcoming cash flow                                                                                                                          |
| MCP                        | Model Context Protocol — the API layer used by Claude to query Fibery directly                                                                                                                               |
| Sankey Diagram             | A flow diagram where the width of each band is proportional to the quantity it represents. Used here to visualise how `Total Planned Revenue` flows from Agreement Status through Customer to Agreement Type |
| d3-sankey                  | The D3.js plugin (`d3-sankey`) that provides the layout algorithm and path generation for Sankey diagrams                                                                                                    |
| Sankey Node                | A rectangular block in the Sankey diagram representing an Agreement Type, Customer, or Agreement Status                                                                                                      |
| Sankey Link                | A curved band connecting two nodes whose width is proportional to the combined `Total Planned Revenue` of the agreements that fall in both the source and target categories                                  |


---

*This document is the generalized system specification for the Revenue Operations Tool. It should be used as the development reference for any rebuild or regeneration of the dashboard, regardless of the specific customer or agreement data present in the workspace at the time of generation.*

---

## 14. Data Sync from Fibery

The dashboard database (SQLite) is hydrated with data from the Fibery platform. Sync runs **on demand** and is triggered from an **admin panel** in the application. The sync executes in the **application backend** (Wasp server), using the Fibery REST API with credentials stored in environment variables. No MCP is required at runtime; the Fibery MCP Server is available for Cursor/IDE integration only.

### 14.1 Purpose

- Load and replace Agreement Management data (Companies, Agreements, Revenue Items, Labor Costs, Contacts) from a configured Fibery workspace into the local SQLite database.
- Allow administrators to refresh data when needed (e.g. after Fibery updates) without redeploying or running external scripts.
- Provide clear per-entity sync status and optional retry per entity when a sync partially fails.

### 14.2 Trigger and Access


| Aspect       | Requirement                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Trigger**  | A single **"Sync from Fibery"** (or **"Refresh from Fibery"**) control in an **admin area** of the app.                                                                  |
| **Access**   | Only users with **admin** capability may open the admin area and run the sync. (Exact admin model — e.g. role on User, or allowlist — is defined in the implementation.) |
| **Location** | Dedicated admin UI (e.g. `/admin` or `/settings`) containing the sync control and sync status.                                                                           |


### 14.3 Sync Behavior


| Aspect        | Requirement                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope**     | One action syncs **all** relevant entities: **Companies**, **Agreements**, **Revenue Items**, **Labor Costs**, **Contacts**.                                                                              |
| **Strategy**  | **Full replace** per entity type: for each type, clear the relevant table(s) then insert all records returned from Fibery for that type.                                                                  |
| **Order**     | Sync order must respect foreign keys: e.g. **Companies** first, then **Agreements** (reference Companies), then **Revenue Items**, **Labor Costs**, and **Contacts** (reference Agreements or Companies). |
| **Execution** | Sync runs in the **Wasp backend** (server action or similar). The Fibery REST API is called from the server using the workspace URL and API token from environment variables.                             |


### 14.4 Fibery API and Credentials

- The backend uses the **Fibery REST API** (see [Fibery API overview](https://the.fibery.io/@public/User_Guide/Guide/Fibery-API-overview-279)) to query entities. The [Fibery MCP Server](https://the.fibery.io/@public/User_Guide/Guide/Fibery-MCP-Server-401) is for Cursor/IDE use only and is not invoked by the running application.
- **Credentials** must not be stored in source code. The backend reads at least:
  - Fibery workspace URL (e.g. `https://{workspace}.fibery.io`) or workspace name.
  - Fibery API token (e.g. `Authorization: Token {api_token}`).
- These are supplied via environment variables (e.g. `FIBERY_WORKSPACE`, `FIBERY_API_TOKEN` or equivalent). Documentation and deployment docs must describe the required variables.

### 14.5 Per-Entity Status and Retry


| Aspect     | Requirement                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status** | After a sync run, the admin UI shows **per-entity status** (e.g. "Companies: OK", "Agreements: failed", "Revenue Items: OK", …).                                           |
| **Retry**  | The admin UI provides an **optional retry per entity** (e.g. "Retry Agreements") so that a single failed entity type can be synced again without re-running the full sync. |
| **Errors** | Failures (e.g. API timeout, auth error, or validation error) are reported per entity type so that the user can correct configuration or retry.                             |


### 14.6 Last Sync Time

The admin UI displays the **last successful sync time** (and optionally the last sync attempt time and its overall status) so that users know how fresh the dashboard data is.

### 14.7 Data Model Alignment

Entities and fields written to SQLite must align with the schema defined in Section 3 and the `.cursor/rules` data model (e.g. `fiberyId`, required foreign keys, enum-like string fields). The mapping from Fibery API response shapes to Prisma models is an implementation concern; the PRD assumes the dashboard continues to read from SQLite via the existing queries (Section 4 / feature 030).

---

## 13. Changelog

A running log of all specification changes by version.

---

### Version 2.5 — March 2026

**Data Sync from Fibery (Section 14)**

Added new top-level **Section 14 — Data Sync from Fibery**. The dashboard database is hydrated on demand from Fibery via a backend sync triggered from an admin panel. Spec includes: single "Sync from Fibery" action that full-replaces all entities (Companies, Agreements, Revenue Items, Labor Costs, Contacts); sync order respecting FKs; per-entity status and optional retry per entity; display of last sync time; use of Fibery REST API and env-based credentials (Fibery MCP is for Cursor/IDE only). Implementation is tracked in feature 025.

---

### Version 2.4 — March 2026

**UI and charting stack: shadcn/ui + Recharts (Sections 9.2, 9.4)**

Replaced Chart.js with a React-native stack: **shadcn/ui** for all non-chart UI components (Card, Table, Tabs, Tooltip, Badge, ScrollArea, etc.), and **Recharts** for doughnut (Pie with innerRadius), horizontal bar, and stacked bar charts. Sankey diagram remains **D3 + d3-sankey** (bundled via npm in the React app). Added Section 9.2 (UI Component Library) and renumbered Section 9: 9.3 Generation Process, 9.4 Charting Libraries, 9.5 Design System, 9.6 Brand Identity, 9.7 Layout, 9.8 Browser Compatibility. All component specs (7.3, 7.4, 7.9, 7.10, 7.11.6) and delivery/implementation references now specify shadcn and Recharts.

---

### Version 2.3 — March 2026

**Sankey Diagram flow order reversed (Section 7.11)**

The Revenue Flow Sankey diagram layer succession was changed from `Agreement Type → Customer → Agreement Status` to `Agreement Status → Customer → Agreement Type`. This reordering surfaces delivery status as the primary dimension, allowing viewers to immediately assess how planned revenue is distributed across workflow states before drilling into customer and type breakdowns.

Affected sub-sections: 7.11 (intro), 7.11.3 (Layer definitions and Link sets), 7.11.4 (label position note), 7.11.7 (pseudocode and example `sankeyData`), 7.11.8 (edge case description), 12 (Glossary — Sankey Diagram entry).

Dashboard legend and layer header labels updated to match new left-to-right order (Status | Customer | Type). Legend solid swatches now represent Status nodes (source); dashed swatches represent Type nodes (target).

**Changelog section added (Section 13)**

Section 13 added to provide a running record of specification changes across all versions.

---

### Version 2.2 — March 2026

**Brand alignment — harpin.ai design system (Sections 8, 9)**

Updated the entire color palette to align with harpin.ai brand identity. All legacy dark-theme colors (deep charcoal `#1a1d27`, `#0f1117`, `#2e3350`, etc.) replaced with the harpin.ai palette anchored on Deep Navy (`#061B30`) and Bright Cyan (`#52C9E5`). Font stack updated from Segoe UI to Inter (loaded via Google Fonts).

Affected sections: 8.2 (Workflow State Color Mapping), 8.3 (Agreement Type Color Mapping), 8.4 (Margin Color Thresholds), 8.5 (Customer Color Palette), 9.4 (Design System — full CSS variable table and Google Fonts dependency added).

**Brand Identity section added (Section 9.5)**

New section documenting the harpin.ai brand specification as applied to the dashboard: full color palette table (7 tokens with hex and name), typography (Inter, weights 400–800, fallback stack), logo usage guide (light/dark variants, display dimensions, separator spec, graceful fallback), and design principles.

**Logo added to Page Header (Section 7.1)**

The harpin AI logo (`logo.svg`, sourced from `https://harpin.ai/wp-content/uploads/logo.svg`) is rendered at 32px height immediately left of the "Agreement Management Dashboard" title, separated by a 1px vertical rule at `rgba(82,201,229,0.3)`. An `onerror` handler hides the image gracefully if the CDN is unavailable.

---

### Version 2.1 — March 2026

**Sankey diagram added (Section 7.11)**

Introduced the Revenue Flow Sankey diagram as a new full-width panel below the Agreement Type Mix Donut (Section 7.10). Specified D3 + d3-sankey as the rendering library, defined node layers (Agreement Type → Customer → Agreement Status), link color inheritance rules, node sizing, tooltip behavior, edge cases, and visual treatment. Added `SANKEY_LINK_OPACITY` and `SANKEY_INCLUDE_INTERNAL` configuration parameters (Section 8.6).

---

### Version 2.0 — March 2026

**Initial generalized specification**

First version of the PRD written as a generalized, data-agnostic system specification. Covers all dashboard components (Sections 7.1–7.10), Fibery data model requirements, business logic, alert rules, configuration reference, technical architecture, implementation guide, extensibility notes, and glossary.