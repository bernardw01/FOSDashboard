# Feature: FinOps Ask (panel-scoped AI Q&A)

> **Status:** Spec draft for customer review (Teamwork notebook is source of record until approved).
>
> **Related:** [001 - Dashboard shell and navigation](001-dashboard-shell-navigation.md); [029 - Mobile shell](029-mobile-shell-phase-ab.md); [017 - AI platform usage sync](017-ai-platform-usage-fibery-sync.md) (Anthropic key patterns); [009 - Historical snapshots](009-dashboard-historical-snapshots.md) (Live vs snapshot data source).

## Goal

Add a **read-only, in-app assistant** so authorized users can ask **natural-language questions about the dashboard they are currently viewing**. Answers are grounded in the **same filtered data already loaded** for that panel (Approach 1: panel-scoped context), with clear **citations** (panel name, filters, data source, as-of date) and **no write-back** to Fibery or other systems.

**Primary audience:** Finance, operations, and executive users who want quick interpretation of KPIs and tables without exporting CSV or hunting across panels.

**Phase 1 scope:** Panel-scoped Q&A only. Cross-panel questions and structured tool-calling (Approach 2) are follow-on releases.

## User stories

- As a **finance reviewer** on Portfolio P&L, I want to ask "Which three projects have the worst trailing margin?" and get names I can verify against the table so I can prioritize follow-up.
- As an **operations lead** on Utilization, I want to ask "Who is under target this week?" and get a list that respects my active Person and date-range filters.
- As an **executive** viewing Agreements in **snapshot mode**, I want answers to state the **snapshot date** explicitly so I do not confuse historical data with live Fibery.
- As a **mobile user**, I want to open **Ask** from the top bar and use a **bottom sheet** chat so I can question data on my phone without desktop-only controls.
- As an **admin**, I want Ask **disabled or rate-limited** via Settings when API cost or abuse is a concern.
- As a **user without access** to a panel, I must **not** be able to ask questions about that panel's data (same gates as navigation).

## Acceptance criteria (testable)

### Access and placement

- [ ] **Given** an authorized user on any **supported** dashboard panel, **when** they open **Ask**, **then** a chat drawer (desktop) or bottom sheet (mobile) opens without leaving the current route.
- [ ] **Given** a user who **cannot** open a panel via navigation (role/team gate), **when** they attempt Ask for that panel, **then** the server rejects the request with a safe message (no data leakage).
- [ ] **Given** **Settings** or panels with no data loaded yet, **when** Ask is unavailable, **then** the control is hidden or disabled with helper text ("Load data first" / "Not available on this screen").

### Context and grounding (Approach 1)

- [ ] **Given** the user is on **Utilization** with Person filter "Alice" and date range Mar 1-31, **when** they ask a question, **then** the server sends a **summarized slice** of the **current client payload** (or re-fetches the same server API with identical range/filters) plus metadata: `panelId`, `dataSource` (Live or snapshot date), `filters`, `fetchedAt`.
- [ ] **Given** a successful answer, **when** the response renders, **then** the UI shows a **context strip**: panel label, Live vs snapshot, as-of / fetched time, and active filter summary.
- [ ] **Given** the model cannot answer from supplied context, **when** the response returns, **then** the assistant says so plainly and suggests opening a specific table or narrowing the question (no invented numbers).

### Supported panels (v1)

- [ ] **v1 MUST support Ask on:** Agreements (`agreement-dashboard`), Utilization (`operations`), Labor hours (`labor-hours`), Delivery Projects and P&L (`delivery`), Revenue review (`revenue-review`), Portfolio P&L (`portfolio-pnl`), Expenses (`expenses`), Pipeline (`pipeline`), AI Usage (`ai-usage`).
- [ ] **v1 MAY defer:** Home (`home`), Resource assignments (`resource-assignments`), Settings (`settings`), and per-project P&L lazy cards until a follow-on patch (document in Change requests if deferred).

### Trust and safety

- [ ] **Given** any answer, **when** displayed, **then** copy includes **"Based on [panel], [data source], [filter summary]"** and optional **entity citations** (agreement name, person name, project name) drawn from context keys present in the payload.
- [ ] **Given** a server or model error, **when** Ask fails, **then** the user sees a friendly message; secrets, stack traces, and raw API responses are **not** shown.
- [ ] **Given** Ask runs, **when** complete, **then** an activity event `finops_ask_submit` (and `finops_ask_error` on failure) is logged with panel id and data source (not full question text if policy restricts; confirm at implementation).

### Operations and cost

- [ ] **Given** **ADMIN** opens Settings, **when** FinOps Ask settings exist, **then** they can configure: enable/disable Ask, daily question cap per user (default TBD), and Anthropic API key for Messages API (write-only, never returned to client).
- [ ] **Given** a user exceeds the daily cap, **when** they submit a question, **then** they see a clear limit message.

### Mobile

- [ ] **Given** viewport width **&lt; 768px**, **when** the user taps **Ask** in the top bar, **then** a **bottom sheet** chat opens (reuse filter-sheet patterns), input and send meet **44px** touch targets, and the context strip remains visible above the transcript.
- [ ] **Given** mobile width, **when** the user switches panels via bottom nav, **then** the chat context updates to the new panel (or prompts to start a new conversation for the new view).

## UI notes

### Routes and components

| Area | Change |
| --- | --- |
| **Shell** | `src/DashboardShell.html`: top-bar **Ask** button (desktop + mobile); chat drawer `#fos-ask-drawer`; mobile bottom sheet variant |
| **Server** | New module e.g. `src/finopsAsk.js`: `askFinOpsQuestion(payload)` with `requireAuthForApi_()` |
| **Settings registry** | `src/adminSettingsRegistry.js`: Ask enable flag, model id, daily cap, Messages API key property |
| **Activity** | `src/userActivityLog.js`: whitelist `finops_ask_*` events |

### Desktop

- **Ask** control in the top bar (right cluster, near data source / refresh affordances).
- Slide-over drawer (~400px) from the right: context strip, scrollable transcript, single-line input + Send.
- **New conversation** clears transcript; context strip always reflects current panel state.

### Mobile (`&lt; 768px`)

- Same **Ask** entry in mobile top bar (`fos-mobile-only` if needed).
- Bottom sheet (~70vh) instead of right drawer; keyboard-safe input area.
- No horizontal-only transcript layout.

### Out of scope (v1 UI)

- Floating cross-panel "global" assistant.
- Voice input.
- Saving or sharing conversation history across sessions (optional local session-only transcript is acceptable).

## Data model

- **No Fibery schema changes.**
- **No dashboard `cacheSchemaVersion` bumps** unless the Ask summarizer requires new fields (prefer summarizing existing payloads server-side).
- **Client → server request shape (conceptual):**
  - `panelId` (route id)
  - `question` (string, max length TBD, e.g. 500 chars)
  - `dataSource`: `{ mode: 'live' | 'snapshot', snapshotDate?: 'YYYY-MM-DD' }`
  - `contextSummary`: server-trusted summary object OR `refetch: true` with panel-specific params (date range, filters) so the server rebuilds from existing `get*DashboardData()` builders
  - `conversationTurns` (optional, last N turns for follow-up, capped)

- **Server → client response:**
  - `ok`, `answer` (markdown subset), `contextLabel`, `citations[]`, `warnings[]`, `usageMeta` (optional token estimate for admins)

## Operations

### Queries (read-only)

- Reuse existing dashboard builders where `refetch: true` (same paths as live panels and snapshot bundle loaders).
- **Summarization:** Before calling the LLM, reduce payload to KPIs + top-N rows relevant to panel (configurable ceilings to stay within Apps Script `UrlFetch` and time limits).

### Actions

- `askFinOpsQuestion(request)` - authorized, rate-limited, calls Anthropic **Messages API** server-side only.
- Optional diagnostic: `_diag_finopsAskSample(panelId)` in Apps Script editor (ADMIN).

## Edge cases

| Case | Behavior |
| --- | --- |
| Panel loading / error state | Ask disabled; message references panel error |
| Empty payload (no rows) | Assistant explains empty state; no fabricated metrics |
| Snapshot selected but artifact missing | Same inline message as panel; Ask does not call Fibery |
| Stale client cache | Context strip shows `fetchedAt`; optional "Refresh panel first" hint if TTL exceeded |
| Question about another panel | Assistant explains v1 is limited to current panel; suggest navigating there |
| Payload too large | Server summarizes more aggressively; if still too large, ask user to narrow filters |
| Missing API key | Admin-visible Settings warning; users see "Ask is not configured" |
| Non-ADMIN on Settings | No Ask configuration UI |

## Verification steps

1. **Configure:** Set Messages API key in Settings (ADMIN); enable Ask.
2. **Desktop - Utilization:** Load Live data, filter to one person, ask "Who has the lowest utilization this period?"; confirm answer references filter and matches table sort.
3. **Desktop - Agreements:** Ask about KPI totals; confirm numbers match KPI strip.
4. **Snapshot:** Select a historical snapshot; ask on Revenue review; confirm answer cites snapshot date.
5. **Access:** Log in as a user without Finance access; confirm Portfolio P&L Ask is not reachable.
6. **Rate limit:** Exceed daily cap; confirm friendly block.
7. **Mobile (~390px):** Open Ask from top bar; confirm bottom sheet, send a question, confirm context strip.
8. **Activity:** Confirm `finops_ask_submit` row in User Activity (ADMIN Usage section optional).

## Implementation checklist

- [ ] Customer approves notebook in Teamwork (**Spec Approved**)
- [ ] Sync notebook to this git file before coding
- [ ] Server: `finopsAsk.js` + summarizers per panel
- [ ] Client: drawer + mobile sheet in `DashboardShell.html`
- [ ] Admin settings + registry entries
- [ ] Activity whitelist
- [ ] Mobile UI per `.cursor/rules/mobile-ui-shell.mdc`
- [ ] PRD FR/AC + version bump at ship
- [ ] Teamwork ship ritual (`teamwork_ship_task.py`)

## Follow-on (not v1)

- **Approach 2:** Tool-calling across panels (`get_agreement_kpis`, `get_utilization_by_person`, etc.).
- **Approach 3:** Metrics catalog for consistent definitions.
- **Snapshot briefs:** Pre-generated daily narratives in the snapshot job.

## Change requests

_(Customer edits during review go here until ship.)_
