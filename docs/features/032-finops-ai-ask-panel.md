# Feature: FinOps Ask (panel-scoped AI Q&A)

> **Status:** Shipped (**v2.27.0**; Ask context patch **v3.0.7**; Ask UX patch **v3.0.6** markdown + in-transcript Thinking; model default **v3.0.5**).  
> **PRD version:** 3.0.8  
> **Release task:** [v2.27.0 - FinOps Ask (panel-scoped AI Q&A)](https://win.godeap.io/app/tasks/40429663)  
> **Teamwork notebook:** [Feature 032](https://win.godeap.io/app/projects/1615262/notebooks/312389)  
> **Implementation plan:** [032-finops-ai-ask-panel-implementation-plan.md](032-finops-ai-ask-panel-implementation-plan.md)  
> **Related:** [001 - Dashboard shell and navigation](001-dashboard-shell-navigation.md); [029 - Mobile shell](029-mobile-shell-phase-ab.md); [017 - AI platform usage sync](017-ai-platform-usage-fibery-sync.md) (Anthropic key patterns); [009 - Historical snapshots](009-dashboard-historical-snapshots.md); [002](002-spreadsheet-user-authorization.md) / [033](033-user-profile-alert-email-notifications.md) Users tab columns.

## Goal

Add a **read-only, in-app assistant (Ask AI)** so authorized users can ask **natural-language questions about the dashboard they are currently viewing**. Answers are grounded in the **same filtered data already loaded** for that panel (Approach 1: panel-scoped context), with clear **citations** (panel name, filters, data source, as-of date) and **no write-back** to Fibery or other systems.

**Primary audience:** Finance, operations, and executive users who want quick interpretation of KPIs and tables without exporting CSV or hunting across panels.

**Phase 1 scope:** Panel-scoped Q&A only. Cross-panel tool-calling (Approach 2) is a follow-on release.

## User stories

- As a **finance reviewer** on Portfolio P&L, I want to ask "Which three projects have the worst trailing margin?" and get names I can verify against the table so I can prioritize follow-up.
- As an **operations lead** on Utilization, I want to ask "Who is under target this week?" and get a list that respects my active Person and date-range filters.
- As an **executive** viewing Agreements in **snapshot mode**, I want answers to state the **snapshot date** explicitly so I do not confuse historical data with live Fibery.
- As a **user**, I want **Ask AI** in the left sidebar above Dashboards so I can open a companion pane beside my current dashboard cards and chat without leaving the view.
- As a **mobile user**, I want Ask AI usable at phone width (full-width sheet or overlay) with ≥ 44px targets.
- As an **admin**, I want Ask **disabled or rate-limited** via Settings when API cost or abuse is a concern.
- As a **user without access** to a panel, I must **not** be able to ask questions about that panel's data (same gates as navigation).

## Acceptance criteria (testable)

### Access and placement

- [ ] **Given** an authorized user, **when** they click sidebar **Ask AI** (above Dashboards), **then** a companion pane opens in the main window **to the right of** the current dashboard cards (desktop) without unloading the active panel.
- [ ] **Given** a user who **cannot** open a panel via navigation (role/team gate), **when** they attempt Ask for that panel, **then** the server rejects the request with a safe message (no data leakage).
- [ ] **Given** Settings / Profile or a panel with no data loaded yet, **when** Ask is submitted, **then** the UI shows helper text ("Load data first" / "Not available on this screen") and does not call the LLM with empty inventable context.

### Context and grounding (Approach 1)

- [ ] **Given** the user is on **Utilization** with Person filter "Alice" and date range Mar 1-31, **when** they ask a question, **then** the server receives a **summarized slice** of the **current client payload** plus metadata: `panelId`, `dataSource` (Live or snapshot date), `filters`, `fetchedAt`.
- [ ] **Given** a successful answer, **when** the response renders, **then** the pane shows a **context strip**: panel label, Live vs snapshot, as-of / fetched time, and active filter summary.
- [ ] **Given** the model cannot answer from supplied context, **when** the response returns, **then** the assistant says so plainly (no invented numbers).

### Supported panels (v1)

- [ ] **v1 MUST support Ask on:** Home (`home`), Agreements (`agreement-dashboard`), Utilization (`operations`), Labor hours (`labor-hours`), Resource assignments (`resource-assignments`), Delivery Projects and P&L (`delivery`, including **loaded** per-project P&L cards), Revenue review (`revenue-review`), Portfolio P&L (`portfolio-pnl`), Expenses (`expenses`), Pipeline (`pipeline`), AI Usage (`ai-usage`).
- [ ] **v1 excludes:** Settings (`settings`), Profile (`profile`).

### Trust and safety

- [ ] **Given** any answer, **when** displayed, **then** copy includes grounding against panel / data source / filters and optional entity citations from context.
- [ ] **Given** a server or model error, **when** Ask fails, **then** the user sees a friendly message; secrets and stack traces are **not** shown.
- [ ] **Given** Ask runs, **when** complete, **then** User Activity logs `finops_ask_submit` or `finops_ask_error` including **question text**, panel id, and data source.

### Operations and cost

- [ ] **Given** **ADMIN** opens Settings, **when** FinOps Ask settings exist, **then** they can configure: enable/disable Ask, daily question cap (default **20**), model id, Messages API key (write-only), and optional Drive folder for chat logs.
- [ ] **Given** a user exceeds **20** questions for the calendar day, **when** they submit, **then** they see a clear limit message and Users-tab **`ai_query_count`** is not incremented further.
- [ ] **Given** a successful or failed Ask attempt that consumed quota, **when** the job finishes, **then** Users **`ai_query_count`** / **`ai_query_date`** reflect today’s count, and a Drive chat log line is appended under `finops-ask-chats/YYYY/MM/YYYY-MM-DD.jsonl`.

### Transcript

- [ ] **Given** an open Ask transcript, **when** the user switches dashboard panels, **then** the transcript remains and the context strip updates to the new panel.
- [ ] **Given** a full page reload, **when** Ask opens again, **then** the UI transcript is empty (Drive/Activity history remain).

### Mobile

- [ ] **Given** viewport width **&lt; 768px**, **when** the user opens Ask AI, **then** the companion UI is full-width overlay or ~70vh sheet (not an unusable side-by-side squeeze), input/send ≥ **44px**, context strip visible.
- [ ] **Given** mobile width, **when** the user switches panels via bottom nav, **then** context updates and transcript persists for the session.

## UI notes

### Routes and components

| Area | Change |
| --- | --- |
| **Shell** | Sidebar **Ask AI** above Dashboards; `#fos-ask-pane` companion pane right of `#main-panel` cards; bottom composer; rich-text transcript |
| **Server** | `finopsAsk.js`, `finopsAskAnthropic.js`, `finopsAskQuota.js`, `finopsAskChatLog.js`, summarizers |
| **Users sheet** | Columns `ai_query_count`, `ai_query_date` |
| **Settings registry** | `FINOPS_ASK_*` Script Properties |
| **Activity** | `finops_ask_*` events with question text |
| **Drive** | `finops-ask-chats/YYYY/MM/YYYY-MM-DD.jsonl` |

### Desktop

- Sidebar link with AI icon above the Dashboards heading.
- Main window: dashboard cards left; Ask AI pane right (~360–420px).
- Pane: context strip, scrollable rich transcript, chat input at bottom.

### Mobile (`&lt; 768px`)

- Ask AI in sidebar / More; pane as overlay or bottom sheet.
- No horizontal-only chat layout.

### Out of scope (v1 UI)

- Cross-panel tool-calling assistant.
- Voice input.
- Persisting UI transcript across browser reloads (Drive archive is the durable log).

## Data model

- **No Fibery schema changes.**
- **No dashboard `cacheSchemaVersion` bumps.**
- **Users tab:** `ai_query_count` (int), `ai_query_date` (`YYYY-MM-DD`).
- **Client → server:** `panelId`, `question`, `dataSource`, `filters`, `fetchedAt`, `contextSummary`, optional `conversationTurns`.
- **Server → client:** `ok`, `answer` (rich text / markdown subset), `contextLabel`, `citations[]`, `warnings[]`, `usageMeta?`, `quotaRemaining?`.

## Operations

- `askFinOpsQuestion(request)` - authorized, quota-gated, Messages API, Activity + Drive log.
- `_diag_finopsAskSample(panelId)` for ADMIN smoke tests.

## Edge cases

| Case | Behavior |
| --- | --- |
| Panel loading / error | Ask submit blocked with message |
| Empty payload | Honest empty explanation |
| Snapshot mode | Cite snapshot date; do not invent live Fibery |
| Quota exceeded | Friendly block; no LLM call |
| Missing API key / disabled | "Ask is not configured" / turned off |
| Drive log failure | Warn in logs; still return answer if LLM succeeded |
| Missing Users columns | Clear ops error until headers exist |

## Verification steps

1. Configure Messages API key; enable Ask; confirm Users columns exist.
2. Desktop: open Ask AI beside Utilization; ask a filtered question; confirm rich answer + context strip.
3. Switch panels; confirm transcript persists and context updates.
4. Reload; confirm UI transcript cleared; Drive file and Activity still have prior turns.
5. Hit 20 asks; confirm block and `ai_query_count`.
6. Snapshot mode on Revenue review; confirm snapshot citation.
7. Mobile ~390px: Ask usable as sheet/overlay.
8. Access: Finance-gated panel Ask rejected for unauthorized user.

## Implementation checklist

- [x] Decisions locked (2026-07-17)
- [ ] Teamwork Spec Approved + notebook sync
- [ ] Phase A (shell + quota + stub)
- [ ] Phase B (Messages + Utilization + Drive + Activity)
- [ ] Phase C (remaining panels)
- [ ] Phase D (PRD + ship)
- [ ] Mobile AC verified

## Follow-on (not v1)

- Approach 2 tool-calling; Approach 3 metrics catalog; snapshot briefs.

## Change requests

| Date | Request | Resolution |
| --- | --- | --- |
| 2026-07-17 | Daily cap 20; Users `ai_query_count` (+ `ai_query_date`); Activity question logging; separate Messages key; include Home / RA / per-project P&L; sidebar Ask AI + right companion pane; rich text; Drive year/month/day logs; transcript across panels / clear on reload; Spec Approved before code | **Accepted** |
