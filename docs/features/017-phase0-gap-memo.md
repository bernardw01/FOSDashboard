# Phase 0 gap memo - AI platform usage sync

> **Date:** 2026-06-08  
> **Org:** Harpin AI (`3f4ca16f-80b7-461e-b01e-a14f3d9a9817`)  
> **Sample window:** 2026-06-01 through 2026-06-07 (UTC), unless noted  
> **Tools:** Anthropic Admin MCP (`anthropic-admin`, read-only); Fibery MCP

## Executive summary

| Platform | API access | Sample pulled | Blocker for ingest |
| --- | --- | --- | --- |
| **Anthropic Console** | OK | Yes | Person match relies on **API key mapping**, not email (see below) |
| **claude.ai (subscription)** | OK endpoint | **No subscription rows** in 7-day window | Phase C may ingest zero rows until Teams seat usage appears in API |
| **OpenAI** | Not tested | **No** | Add `OPENAI_ADMIN_KEY` to `.env` (MCP) and `OPENAI_ADMIN_API_KEY` Script Property |

**Recommendation:** Proceed to **Phase A.2** (Fibery **`Usage`** schema) in parallel. Block **Phase B production schedule** until OpenAI sample is pulled and Fibery smoke test passes.

---

## Anthropic - `usage_report/messages`

**Request:** `group_by`: `account_id`, `api_key_id`, `workspace_id`, `model`; `bucket_width`: `1d`; 7 days.

| Metric | Value |
| --- | --- |
| Daily buckets | 7 |
| Result rows | **306** (~44/day average) |
| Rows with `account_id` | **0** |
| Rows with `api_key_id` | **306** |
| Rows with `service_account_id` | **0** |
| Distinct models | 7 |
| `workspace_id` populated | Rare (mostly null in sample) |

**Implication:** Console message usage is keyed by **`api_key_id`**, not OAuth email. Ingest MUST:

1. Store `Actor External Id` = `api_key_id`.
2. Set `Actor Type` = **API key**.
3. Resolve people via **`Actor Mapping`** (and optional `list_api_keys` name hints), not email match alone.

**Recommended ingest `group_by`:** `api_key_id`, `model` (add `workspace_id` when non-null rate increases).

**Cardinality (estimate):** ~40-60 **`Usage`** rows/day for messages at current volume; scale with key count.

Redacted structure: [017-samples/anthropic-messages-result.json](017-samples/anthropic-messages-result.json)

---

## Anthropic - `cost_report`

**Ungrouped (7 days):** 7 buckets, 1 org-total line per day (USD already converted by MCP wrapper).

**Grouped** (`workspace_id`, `description`): **496** result lines over 7 days (~71/day).

Sample dimensions present: `description`, `model`, `cost_type`, `token_type`, `service_tier`, `context_window`, `workspace_id` (often null).

**Implication:** Use **grouped** cost_report for Fibery **`Usage`** rows (Source Dataset = **Anthropic Cost**). Idempotency key should include `description`, `token_type`, `model`, and date bucket.

**Recommended ingest `group_by`:** `description`, `model` (add `workspace_id` when populated).

Redacted structure: [017-samples/anthropic-cost-result.json](017-samples/anthropic-cost-result.json)

---

## Anthropic - `usage_report/claude_code` (Console + claude.ai)

**API constraint:** `starting_at` must be **`YYYY-MM-DD`** (date only), one UTC day per request; paginate with `next_page`.

**Sampled days:** 2026-05-28, 2026-06-01, 2026-06-03, 2026-06-07.

| Metric | Value |
| --- | --- |
| Actor types seen | **`api_actor` only** |
| `customer_type` | **`api` only** (no `subscription`) |
| `actor.email_address` | **Not present** (uses `actor.api_key_name`) |
| `model_breakdown[]` | 1-2 models per actor typical |

**Implication for claude.ai (Platform 2):** No subscription / Teams rows returned in the sample window. Either:

- harpin claude.ai seat usage is not routed through this endpoint yet, or
- subscription usage was zero on sampled days.

**Fallback:** Manual CSV from `claude.ai/analytics/claude-code` for reconciliation; re-sample monthly.

**Implication for Console Claude Code:** Same as messages - map **`api_key_name`** / key id via **`Actor Mapping`**. Flatten **`model_breakdown[]`** to one **`Usage`** row per model (confirmed).

**Cardinality (estimate):** ~5-15 actor rows/day, ~10-30 **`Usage`** rows/day after model flatten (varies heavily).

Redacted structure: [017-samples/anthropic-claude-code-result.json](017-samples/anthropic-claude-code-result.json)

---

## OpenAI - `GET /organization/costs`

**Status:** **Not sampled.**

**Blocker:** `OPENAI_ADMIN_KEY` is not in project `.env`; OpenAI MCP server was not connected in Cursor at sample time.

**Next step:** Add admin key from [platform.openai.com/settings/organization/admin-keys](https://platform.openai.com/settings/organization/admin-keys) (Usage read). Re-run MCP `costs` for 7 days with `group_by=project_id,line_item` or use `_diag_sampleAiUsageOpenAi_(date)` in Apps Script after Script Property is set.

---

## Fibery join target (unchanged)

**`Agreement Management/Clockify Users`:** `Clockify User Email`, `Clockify User ID`, `Name` - verified.

Email match will work for vendors that expose **`actor.email_address`** or OpenAI `user_id` resolved to email. **Current Anthropic samples do not expose email** on messages or Claude Code API rows.

---

## Fibery schema state

| Item | Status |
| --- | --- |
| App **`AI Usage Data`** | Exists |
| **`AI Usage Data/Database 1`** | Default placeholder only |
| **`AI Usage Data/Usage`** | **Not created** - follow [017-fibery-schema-setup.md](017-fibery-schema-setup.md) |

---

## Phase 0 exit checklist

| Criterion | Status |
| --- | --- |
| Anthropic live samples | **Done** (messages, cost, claude_code) |
| OpenAI live sample | **Blocked** (no admin key configured) |
| claude.ai subscription spike | **Gap** (zero subscription rows in window) |
| Signed **`Usage`** field catalog | **Done** (feature spec unified model) |
| Gap memo | **This document** |
| Script Properties (production keys) | **Manual** - operator must set in Apps Script (see diagnostics module) |
| Product sign-off | **Pending** |

---

## Recommended implementation adjustments

1. **Ship Actor Mapping early** (Phase B or before): preload from Admin API `list_api_keys` name + `created_by` where helpful.
2. **Do not depend on email match** for Anthropic Console paths in v1.
3. **Ingest cost_report with grouping**; skip ungrouped org totals (not attributable).
4. **Claude Code API:** loop one request per UTC day in sync job (`starting_at=YYYY-MM-DD`).
5. **OpenAI:** complete sample before enabling scheduled multi-platform sync.
