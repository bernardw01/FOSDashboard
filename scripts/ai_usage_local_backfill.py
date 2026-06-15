#!/usr/bin/env python3
"""Local Anthropic → Fibery backfill (mirrors src/aiUsage*.js pipeline).

Uses ANTHROPIC_ADMIN_KEY / ANTHROPIC_ADMIN_API_KEY from .env and Fibery REST
/api/commands. Fibery token: FIBERY_API_TOKEN env, or fibery-mcp-server args in
~/.cursor/mcp.json (local dev only; never commit tokens).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
FIBERY_APP = "AI Usage Data"
USAGE_DB = f"{FIBERY_APP}/Usage"
SYNC_RUNS_DB = f"{FIBERY_APP}/Sync Runs"
ANTHROPIC_BASE = "https://api.anthropic.com"
DEFAULT_HOST = "harpin-ai.fibery.io"
BATCH = 20
LOOKUP_CHUNK = 50
THROTTLE_SECONDS = 0.0
LAST_ANTHROPIC_CALL = 0.0

ENUM_DATABASES = {
    "sourcePlatform": "AI Usage Data/Source Platform_AI Usage Data/Usage",
    "sourceDataset": "AI Usage Data/Source Dataset_AI Usage Data/Usage",
    "actorType": "AI Usage Data/Actor Type_AI Usage Data/Usage",
    "customerType": "AI Usage Data/Customer Type_AI Usage Data/Usage",
    "subscriptionTier": "AI Usage Data/Subscription Tier_AI Usage Data/Usage",
    "mappingStatus": "AI Usage Data/Mapping Status_AI Usage Data/Usage",
    "allocationCategory": "AI Usage Data/Allocation Category_AI Usage Data/Usage",
    "syncStatus": "AI Usage Data/Status_AI Usage Data/Sync Runs",
    "syncTrigger": "AI Usage Data/Trigger_AI Usage Data/Sync Runs",
}


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def load_anthropic_key() -> str:
    for name in ("ANTHROPIC_ADMIN_API_KEY", "ANTHROPIC_ADMIN_KEY"):
        v = os.environ.get(name, "").strip()
        if v:
            return v
    raise SystemExit("Missing ANTHROPIC_ADMIN_API_KEY or ANTHROPIC_ADMIN_KEY in .env")


def load_fibery_config() -> tuple[str, str]:
    host = os.environ.get("FIBERY_HOST", DEFAULT_HOST).strip()
    token = os.environ.get("FIBERY_API_TOKEN", "").strip()
    if token:
        return host, token
    mcp_path = Path.home() / ".cursor" / "mcp.json"
    if mcp_path.exists():
        data = json.loads(mcp_path.read_text(encoding="utf-8"))
        for server in (data.get("mcpServers") or {}).values():
            args = server.get("args") or []
            for i, arg in enumerate(args):
                if arg == "--fibery-host" and i + 1 < len(args):
                    host = args[i + 1]
                if arg == "--fibery-api-token" and i + 1 < len(args):
                    token = args[i + 1]
    if not token:
        raise SystemExit("Missing FIBERY_API_TOKEN (env or ~/.cursor/mcp.json fibery-mcp-server)")
    return host.replace("https://", "").strip("/"), token


def build_query(body: dict[str, Any], *, bracket_arrays: bool = False) -> str:
    parts: list[str] = []
    for k, v in body.items():
        if v is None or v == "":
            continue
        if isinstance(v, list):
            for item in v:
                key = f"{k}[]" if bracket_arrays else k
                parts.append(f"{urllib.parse.quote(key)}={urllib.parse.quote(str(item))}")
        else:
            parts.append(f"{urllib.parse.quote(k)}={urllib.parse.quote(str(v))}")
    return "&".join(parts)


def set_throttle(seconds: float) -> None:
    global THROTTLE_SECONDS
    THROTTLE_SECONDS = max(0.0, seconds)


def _throttle_before_anthropic_call() -> None:
    global LAST_ANTHROPIC_CALL
    if THROTTLE_SECONDS <= 0:
        return
    elapsed = time.time() - LAST_ANTHROPIC_CALL
    wait_s = THROTTLE_SECONDS - elapsed
    if wait_s > 0:
        time.sleep(wait_s)


def _mark_anthropic_call() -> None:
    global LAST_ANTHROPIC_CALL
    LAST_ANTHROPIC_CALL = time.time()


def anthropic_get(path: str, key: str, query: dict[str, Any]) -> dict[str, Any]:
    url = ANTHROPIC_BASE + path + ("?" + build_query(query, bracket_arrays=True) if query else "")
    last_err: Exception | None = None
    for attempt in range(100 if THROTTLE_SECONDS > 0 else 12):
        _throttle_before_anthropic_call()
        req = urllib.request.Request(
            url,
            headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                _mark_anthropic_call()
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            _mark_anthropic_call()
            last_err = e
            if e.code == 429:
                retry_after = e.headers.get("Retry-After") if e.headers else None
                retry_after_s = int(retry_after) if retry_after and str(retry_after).isdigit() else 0
                max_attempts = 100 if THROTTLE_SECONDS > 0 else 12
                if attempt < max_attempts - 1:
                    if THROTTLE_SECONDS > 0:
                        wait_s = max(retry_after_s, 120, 30 * (attempt + 1))
                        wait_s = min(wait_s, 600)
                    else:
                        wait_s = retry_after_s or min(120, 5 * (attempt + 1))
                    print(
                        f"  Anthropic 429; waiting {wait_s}s (attempt {attempt + 1}/{max_attempts})",
                        file=sys.stderr,
                    )
                    time.sleep(wait_s)
                    continue
            raise
        except Exception as e:
            _mark_anthropic_call()
            last_err = e
            raise
    raise last_err or RuntimeError("anthropic_get failed")


def add_days_ymd(ymd: str, delta: int) -> str:
    d = datetime.strptime(ymd, "%Y-%m-%d").date()
    return (d + timedelta(days=delta)).isoformat()


def day_span(start: str, end: str) -> int:
    return (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days + 1


def safe_key_part(value: Any) -> str:
    return str(value if value is not None else "").replace(":", "_").strip()


def date_from_iso(iso: str | None) -> str | None:
    if not iso:
        return None
    s = str(iso)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    return s[:10] if len(s) >= 10 else None


def fibery_commands(host: str, token: str, commands: list[dict[str, Any]]) -> list[Any]:
    url = f"https://{host}/api/commands"
    req = urllib.request.Request(
        url,
        data=json.dumps(commands).encode("utf-8"),
        headers={"Authorization": f"Token {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read().decode())
    if not isinstance(body, list):
        raise RuntimeError(f"Unexpected Fibery response: {body!r}")
    results: list[Any] = []
    for item in body:
        if not item or not item.get("success"):
            msg = (item or {}).get("result", {}).get("message", "Fibery command failed")
            raise RuntimeError(msg)
        results.append(item["result"])
    return results


def fibery_query(
    host: str,
    token: str,
    query: dict[str, Any],
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    payload = [{"command": "fibery.entity/query", "args": {"query": query, "params": params or {}}}]
    return fibery_commands(host, token, payload)[0]


def lookup_existing(host: str, token: str, source_ids: list[str]) -> dict[str, str]:
    """Return map sourceRecordId -> fibery/id. Empty when q/in lookup is unavailable."""
    if not source_ids:
        return {}
    field = fibery_field("Source Record Id")
    out: dict[str, str] = {}
    for i in range(0, len(source_ids), LOOKUP_CHUNK):
        chunk = source_ids[i : i + LOOKUP_CHUNK]
        try:
            hits = fibery_query(
                host,
                token,
                {
                    "q/from": USAGE_DB,
                    "q/select": {"Id": ["fibery/id"], "SourceRecordId": [field]},
                    "q/where": ["q/in", [field], "$ids"],
                    "q/limit": len(chunk),
                },
                {"$ids": chunk},
            )
        except RuntimeError:
            return {}
        for hit in hits:
            if hit.get("SourceRecordId") and hit.get("Id"):
                out[str(hit["SourceRecordId"])] = str(hit["Id"])
    return out


def load_enum_maps(host: str, token: str) -> dict[str, dict[str, str]]:
    maps: dict[str, dict[str, str]] = {}
    for key, db in ENUM_DATABASES.items():
        hits = fibery_query(
            host,
            token,
            {
                "q/from": db,
                "q/select": {"Name": ["enum/name"], "Id": ["fibery/id"]},
                "q/limit": 50,
            },
        )
        maps[key] = {str(row["Name"]): str(row["Id"]) for row in hits if row.get("Name") and row.get("Id")}
    return maps


def enum_ref(maps: dict[str, dict[str, str]], group: str, name: str | None) -> dict[str, str] | None:
    if not name:
        return None
    enum_id = maps.get(group, {}).get(name)
    if not enum_id:
        raise RuntimeError(f"Unknown enum {group} value: {name!r}")
    return {"fibery/id": enum_id}


def fibery_field(suffix: str) -> str:
    return f"{FIBERY_APP}/{suffix}"


def fibery_doc(value: Any) -> dict[str, str]:
    text = json.dumps(value or {})
    if len(text) > 120000:
        text = text[:120000] + "..."
    return {"fibery/document-content": text}


def build_title(row: dict[str, Any]) -> str:
    parts = [
        row.get("usageDate") or "",
        row.get("sourcePlatform") or "",
        row.get("actorLabel") or row.get("actorEmail") or row.get("actorExternalId") or "unknown",
        row.get("model") or row.get("sourceDataset") or "",
    ]
    return " | ".join(p for p in parts if p)


def safe_int(val: Any) -> int | None:
    if val is None or val == "":
        return None
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def row_to_entity(
    row: dict[str, Any],
    sync_run_id: str,
    ingested_at: str,
    enum_maps: dict[str, dict[str, str]],
    *,
    include_name: bool = True,
) -> dict[str, Any]:
    entity: dict[str, Any] = {
        fibery_field("Source Record Id"): row["sourceRecordId"],
        fibery_field("Usage Date"): row["usageDate"],
        fibery_field("Source Platform"): enum_ref(enum_maps, "sourcePlatform", row["sourcePlatform"]),
        fibery_field("Source Dataset"): enum_ref(enum_maps, "sourceDataset", row["sourceDataset"]),
        fibery_field("Actor Type"): enum_ref(enum_maps, "actorType", row["actorType"]),
        fibery_field("Customer Type"): enum_ref(enum_maps, "customerType", row.get("customerType") or "N/A"),
        fibery_field("Subscription Tier"): enum_ref(enum_maps, "subscriptionTier", row.get("subscriptionTier") or "N/A"),
        fibery_field("Currency"): row.get("currency") or "USD",
        fibery_field("Mapping Status"): enum_ref(enum_maps, "mappingStatus", row.get("mappingStatus") or "Unmatched"),
        fibery_field("Allocation Category"): enum_ref(
            enum_maps, "allocationCategory", row.get("allocationCategory") or "Shared / unallocated"
        ),
        fibery_field("Sync Run Id"): sync_run_id,
        fibery_field("Ingested At"): ingested_at,
    }
    if include_name:
        entity[fibery_field("Name")] = build_title(row)
    optional = {
        "Period Start": row.get("periodStart"),
        "Period End": row.get("periodEnd"),
        "Org External Id": row.get("orgExternalId"),
        "Actor Email": row.get("actorEmail"),
        "Actor External Id": row.get("actorExternalId"),
        "Actor Label": row.get("actorLabel"),
        "Model": row.get("model"),
        "Workspace or Project": row.get("workspaceOrProject"),
        "Service Tier": row.get("serviceTier"),
        "Cost Type": row.get("costType"),
        "Token Type": row.get("tokenType"),
        "Context Description": row.get("description"),
        "Terminal Type": row.get("terminalType"),
        "Input Tokens": row.get("inputTokens"),
        "Output Tokens": row.get("outputTokens"),
        "Cache Read Tokens": row.get("cacheReadTokens"),
        "Cache Write Tokens": row.get("cacheWriteTokens"),
        "Request Count": row.get("requestCount"),
        "Quantity": row.get("quantity"),
        "Cost USD": row.get("costUsd"),
    }
    for suffix, val in optional.items():
        if val is None or val == "":
            continue
        if suffix in (
            "Input Tokens",
            "Output Tokens",
            "Cache Read Tokens",
            "Cache Write Tokens",
            "Request Count",
            "Quantity",
        ):
            parsed = safe_int(val)
            if parsed is not None:
                entity[fibery_field(suffix)] = parsed
        else:
            entity[fibery_field(suffix)] = val
    return entity


def fetch_api_key_index(key: str) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    page = None
    for _ in range(50):
        query: dict[str, Any] = {"limit": 100}
        if page:
            query["page"] = page
        payload = anthropic_get("/v1/organizations/api_keys", key, query)
        for row in payload.get("data") or []:
            if row.get("id"):
                index[str(row["id"])] = {
                    "name": str(row.get("name") or row["id"]),
                    "createdByUserId": (row.get("created_by") or {}).get("id"),
                }
        page = payload.get("next_page") if payload.get("has_more") else None
        if not page:
            break
    return index


def fetch_messages_range(key: str, start_ymd: str, end_ymd: str) -> list[dict[str, Any]]:
    start_iso = f"{start_ymd}T00:00:00Z"
    end_iso = f"{add_days_ymd(end_ymd, 1)}T00:00:00Z"
    rows: list[dict[str, Any]] = []
    page = None
    for _ in range(50):
        query: dict[str, Any] = {
            "starting_at": start_iso,
            "ending_at": end_iso,
            "bucket_width": "1d",
            "group_by": ["api_key_id", "model"],
            "limit": min(31, day_span(start_ymd, end_ymd)),
        }
        if page:
            query["page"] = page
        payload = anthropic_get("/v1/organizations/usage_report/messages", key, query)
        for bucket in payload.get("data") or []:
            for result in bucket.get("results") or []:
                rows.append({"bucket": bucket, "result": result})
        page = payload.get("next_page") if payload.get("has_more") else None
        if not page:
            break
    return rows


def fetch_messages_day(key: str, date_ymd: str) -> list[dict[str, Any]]:
    return fetch_messages_range(key, date_ymd, date_ymd)


def fetch_cost_range(key: str, start_ymd: str, end_ymd: str) -> list[dict[str, Any]]:
    start_iso = f"{start_ymd}T00:00:00Z"
    end_iso = f"{add_days_ymd(end_ymd, 1)}T00:00:00Z"
    rows: list[dict[str, Any]] = []
    page = None
    for _ in range(50):
        query: dict[str, Any] = {
            "starting_at": start_iso,
            "ending_at": end_iso,
            "group_by": ["workspace_id", "description"],
            "limit": min(31, day_span(start_ymd, end_ymd)),
        }
        if page:
            query["page"] = page
        payload = anthropic_get("/v1/organizations/cost_report", key, query)
        for bucket in payload.get("data") or []:
            for result in bucket.get("results") or []:
                rows.append({"bucket": bucket, "result": result})
        page = payload.get("next_page") if payload.get("has_more") else None
        if not page:
            break
    return rows


def fetch_cost_day(key: str, date_ymd: str) -> list[dict[str, Any]]:
    return fetch_cost_range(key, date_ymd, date_ymd)


def fetch_claude_code_day(key: str, date_ymd: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = None
    for _ in range(50):
        query: dict[str, Any] = {"starting_at": date_ymd, "limit": 100}
        if page:
            query["page"] = page
        payload = anthropic_get("/v1/organizations/usage_report/claude_code", key, query)
        rows.extend(payload.get("data") or [])
        page = payload.get("next_page") if payload.get("has_more") else None
        if not page:
            break
    return rows


def normalize_message(entry: dict[str, Any], org_id: str, api_key_index: dict[str, dict[str, Any]]) -> dict[str, Any]:
    bucket = entry.get("bucket") or {}
    result = entry.get("result") or {}
    starting_at = bucket.get("starting_at") or ""
    actor_type = "Unknown"
    if result.get("service_account_id"):
        actor_type = "Service account"
    elif result.get("api_key_id"):
        actor_type = "API key"
    elif result.get("account_id"):
        actor_type = "User"
    api_meta = api_key_index.get(str(result.get("api_key_id") or ""))
    cache_creation = result.get("cache_creation") or {}
    cache_write = (cache_creation.get("ephemeral_1h_input_tokens") or 0) + (
        cache_creation.get("ephemeral_5m_input_tokens") or 0
    )
    source_record_id = ":".join(
        [
            "anthropic:messages",
            safe_key_part(starting_at),
            safe_key_part(result.get("account_id") or result.get("api_key_id") or "none"),
            safe_key_part(result.get("workspace_id") or "none"),
            safe_key_part(result.get("model") or "none"),
            safe_key_part(result.get("service_tier") or "none"),
        ]
    )
    return {
        "sourceRecordId": source_record_id,
        "usageDate": date_from_iso(starting_at) or date_from_iso(bucket.get("ending_at")),
        "periodStart": starting_at or None,
        "periodEnd": bucket.get("ending_at") or None,
        "sourcePlatform": "Anthropic Console",
        "sourceDataset": "Anthropic Messages",
        "orgExternalId": org_id or None,
        "actorType": actor_type,
        "actorEmail": None,
        "actorExternalId": str(result.get("account_id") or result.get("api_key_id") or result.get("service_account_id") or "") or None,
        "actorLabel": api_meta["name"] if api_meta else None,
        "customerType": "API",
        "subscriptionTier": "N/A",
        "model": result.get("model"),
        "workspaceOrProject": result.get("workspace_id"),
        "serviceTier": result.get("service_tier"),
        "inputTokens": result.get("uncached_input_tokens"),
        "outputTokens": result.get("output_tokens"),
        "cacheReadTokens": result.get("cache_read_input_tokens"),
        "cacheWriteTokens": cache_write or None,
        "mappingStatus": "Unmatched",
        "allocationCategory": "Shared / unallocated",
        "currency": "USD",
        "rawMetrics": {
            "server_tool_use": result.get("server_tool_use"),
            "context_window": result.get("context_window"),
            "inference_geo": result.get("inference_geo"),
        },
        "vendorPayload": {"bucket": bucket, "result": result},
    }


def normalize_cost(entry: dict[str, Any], org_id: str) -> dict[str, Any]:
    bucket = entry.get("bucket") or {}
    result = entry.get("result") or {}
    starting_at = bucket.get("starting_at") or ""
    source_record_id = ":".join(
        [
            "anthropic:cost",
            safe_key_part(starting_at),
            safe_key_part(result.get("workspace_id") or "none"),
            safe_key_part(result.get("description") or "none"),
            safe_key_part(result.get("token_type") or "none"),
            safe_key_part(result.get("model") or "none"),
        ]
    )
    return {
        "sourceRecordId": source_record_id,
        "usageDate": date_from_iso(starting_at) or date_from_iso(bucket.get("ending_at")),
        "periodStart": starting_at or None,
        "periodEnd": bucket.get("ending_at") or None,
        "sourcePlatform": "Anthropic Console",
        "sourceDataset": "Anthropic Cost",
        "orgExternalId": org_id or None,
        "actorType": "Unknown",
        "customerType": "N/A",
        "subscriptionTier": "N/A",
        "model": result.get("model"),
        "workspaceOrProject": result.get("workspace_id"),
        "costType": result.get("cost_type"),
        "tokenType": result.get("token_type"),
        "description": result.get("description"),
        "serviceTier": result.get("service_tier"),
        "costUsd": float(result["amount"]) if result.get("amount") is not None else None,
        "currency": result.get("currency") or "USD",
        "mappingStatus": "Unmatched",
        "allocationCategory": "Shared / unallocated",
        "rawMetrics": {
            "context_window": result.get("context_window"),
            "inference_geo": result.get("inference_geo"),
        },
        "vendorPayload": {"bucket": bucket, "result": result},
    }


def claude_code_actor_key(actor: dict[str, Any]) -> str:
    if actor.get("email_address"):
        return str(actor["email_address"]).lower()
    if actor.get("api_key_id"):
        return str(actor["api_key_id"])
    if actor.get("api_key_name"):
        return str(actor["api_key_name"])
    return str(actor.get("type") or "unknown")


def normalize_claude_code(row: dict[str, Any], org_id: str) -> list[dict[str, Any]]:
    usage_date = date_from_iso(row.get("date")) or str(row.get("date") or "")[:10]
    actor = row.get("actor") or {}
    actor_key = claude_code_actor_key(actor)
    actor_type = "User" if actor.get("type") == "user_actor" else "API key" if actor.get("type") == "api_actor" else "Unknown"
    customer_type = "Subscription" if row.get("customer_type") == "subscription" else "API"
    source_platform = "Claude.ai" if row.get("customer_type") == "subscription" else "Anthropic Console"
    subscription_tier = "N/A"
    if row.get("subscription_type") == "team":
        subscription_tier = "Team"
    elif row.get("subscription_type") == "enterprise":
        subscription_tier = "Enterprise"
    actor_email = actor.get("email_address")
    actor_external_id = actor.get("api_key_id") or actor.get("api_key_name") or actor.get("email_address") or actor_key
    actor_label = actor.get("api_key_name") or actor.get("email_address")
    out: list[dict[str, Any]] = []
    for model_row in row.get("model_breakdown") or []:
        model = model_row.get("model") or "unknown"
        tokens = model_row.get("tokens") or {}
        estimated = model_row.get("estimated_cost") or {}
        cost_usd = float(estimated["amount"]) / 100 if estimated.get("amount") is not None else None
        source_record_id = ":".join(
            [
                "anthropic:claude_code",
                safe_key_part(usage_date),
                safe_key_part(actor_key),
                safe_key_part(model),
            ]
        )
        out.append(
            {
                "sourceRecordId": source_record_id,
                "usageDate": usage_date,
                "periodStart": row.get("date") or None,
                "periodEnd": None,
                "sourcePlatform": source_platform,
                "sourceDataset": "Anthropic Claude Code",
                "orgExternalId": row.get("organization_id") or org_id or None,
                "actorType": actor_type,
                "actorEmail": actor_email,
                "actorExternalId": str(actor_external_id) if actor_external_id else None,
                "actorLabel": actor_label,
                "customerType": customer_type,
                "subscriptionTier": subscription_tier,
                "model": model,
                "terminalType": row.get("terminal_type"),
                "inputTokens": tokens.get("input"),
                "outputTokens": tokens.get("output"),
                "cacheReadTokens": tokens.get("cache_read"),
                "cacheWriteTokens": tokens.get("cache_creation"),
                "costUsd": cost_usd,
                "currency": estimated.get("currency") or "USD",
                "mappingStatus": "Unmatched",
                "allocationCategory": "Shared / unallocated",
                "rawMetrics": {"core_metrics": row.get("core_metrics"), "tool_actions": row.get("tool_actions")},
                "vendorPayload": {"row": row, "model_breakdown": model_row},
            }
        )
    return out


def normalize_day(key: str, date_ymd: str, org_id: str, api_key_index: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for entry in fetch_messages_day(key, date_ymd):
        rows.append(normalize_message(entry, org_id, api_key_index))
    for entry in fetch_cost_day(key, date_ymd):
        rows.append(normalize_cost(entry, org_id))
    for entry in fetch_claude_code_day(key, date_ymd):
        rows.extend(normalize_claude_code(entry, org_id))
    return rows


def normalize_month_chunk(
    key: str,
    chunk_start: str,
    chunk_end: str,
    org_id: str,
    api_key_index: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fetch one calendar month: batched messages + cost, per-day claude_code."""
    rows: list[dict[str, Any]] = []
    for entry in fetch_messages_range(key, chunk_start, chunk_end):
        rows.append(normalize_message(entry, org_id, api_key_index))
    for entry in fetch_cost_range(key, chunk_start, chunk_end):
        rows.append(normalize_cost(entry, org_id))
    for day in iter_days(chunk_start, chunk_end):
        for entry in fetch_claude_code_day(key, day):
            rows.extend(normalize_claude_code(entry, org_id))
    return rows


def upsert_rows(
    host: str,
    token: str,
    rows: list[dict[str, Any]],
    sync_run_id: str,
    enum_maps: dict[str, dict[str, str]],
    *,
    create_only: bool = False,
) -> tuple[int, int, int]:
    if not rows:
        return 0, 0, 0
    ingested_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    existing: dict[str, str] = {}
    if not create_only:
        existing = lookup_existing(host, token, [r["sourceRecordId"] for r in rows])
    created = updated = failed = 0
    for i in range(0, len(rows), BATCH):
        slice_rows = rows[i : i + BATCH]
        commands: list[dict[str, Any]] = []
        for row in slice_rows:
            fibery_id = existing.get(row["sourceRecordId"])
            entity = row_to_entity(
                row,
                sync_run_id,
                ingested_at,
                enum_maps,
                include_name=not fibery_id,
            )
            if fibery_id:
                entity["fibery/id"] = fibery_id
                commands.append({"command": "fibery.entity/update", "args": {"type": USAGE_DB, "entity": entity}})
            else:
                commands.append({"command": "fibery.entity/create", "args": {"type": USAGE_DB, "entity": entity}})
        try:
            fibery_commands(host, token, commands)
            for row in slice_rows:
                if existing.get(row["sourceRecordId"]):
                    updated += 1
                else:
                    created += 1
        except Exception as exc:
            failed += len(slice_rows)
            print(f"  batch failed: {exc}", file=sys.stderr)
        time.sleep(0.15)
    return created, updated, failed


def write_sync_run(
    host: str,
    token: str,
    sync_run_id: str,
    start: str,
    end: str,
    enum_maps: dict[str, dict[str, str]],
    *,
    rows_fetched: int,
    rows_upserted: int,
    rows_failed: int,
    status: str,
    started_at: str,
) -> None:
    entity = {
        fibery_field("Name"): sync_run_id,
        fibery_field("Started At"): started_at,
        fibery_field("Completed At"): datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        fibery_field("Trigger"): enum_ref(enum_maps, "syncTrigger", "backfill"),
        fibery_field("Status"): enum_ref(enum_maps, "syncStatus", status),
        fibery_field("Range Start"): start,
        fibery_field("Range End"): end,
        fibery_field("Rows Fetched"): rows_fetched,
        fibery_field("Rows Upserted"): rows_upserted,
        fibery_field("Rows Failed"): rows_failed,
    }
    fibery_commands(
        host,
        token,
        [{"command": "fibery.entity/create", "args": {"type": SYNC_RUNS_DB, "entity": entity}}],
    )


def iter_days(start: str, end: str):
    d = datetime.strptime(start, "%Y-%m-%d").date()
    end_d = datetime.strptime(end, "%Y-%m-%d").date()
    while d <= end_d:
        yield d.isoformat()
        d += timedelta(days=1)


def iter_month_chunks(start: str, end: str):
    d = datetime.strptime(start, "%Y-%m-%d").date()
    end_d = datetime.strptime(end, "%Y-%m-%d").date()
    while d <= end_d:
        if d.month == 12:
            month_end = date(d.year + 1, 1, 1) - timedelta(days=1)
        else:
            month_end = date(d.year, d.month + 1, 1) - timedelta(days=1)
        chunk_end = min(month_end, end_d)
        yield d.isoformat(), chunk_end.isoformat()
        d = chunk_end + timedelta(days=1)


def chunk_label(chunk_start: str) -> str:
    return chunk_start[:7]


def load_state(path: Path, start: str, end: str) -> dict[str, Any]:
    if path.exists():
        state = json.loads(path.read_text(encoding="utf-8"))
        if state.get("start") == start and state.get("end") == end:
            return state
    return {
        "start": start,
        "end": end,
        "completed_chunks": [],
        "created": 0,
        "updated": 0,
        "failed": 0,
        "sync_run_id": None,
    }


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, int]:
    by_dataset: dict[str, int] = {}
    for row in rows:
        ds = row.get("sourceDataset") or "?"
        by_dataset[ds] = by_dataset.get(ds, 0) + 1
    return by_dataset


def main() -> None:
    parser = argparse.ArgumentParser(description="Anthropic usage backfill into Fibery AI Usage Data/Usage")
    parser.add_argument("--start", required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="End date YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="Fetch + normalize only; no Fibery writes")
    parser.add_argument(
        "--create-only",
        action="store_true",
        help="Skip upsert lookup; create all rows (use for empty Fibery backfill)",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Fetch and write one day at a time (resumable; gentler on Anthropic rate limits)",
    )
    parser.add_argument(
        "--historical",
        action="store_true",
        help="Month-batched fetch with throttle (messages/cost per month, claude_code per day)",
    )
    parser.add_argument(
        "--delay-seconds",
        type=float,
        default=65.0,
        help="Minimum seconds between Anthropic API calls (default 65 in --historical mode)",
    )
    parser.add_argument(
        "--state-file",
        default="scripts/.ai-usage-backfill-state.json",
        help="Checkpoint file for --historical resume",
    )
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.start) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.end):
        raise SystemExit("Dates must be YYYY-MM-DD")
    if args.start > args.end:
        raise SystemExit("start must be <= end")
    if args.historical and args.incremental:
        raise SystemExit("Use --historical or --incremental, not both")

    load_dotenv()
    if args.historical:
        set_throttle(args.delay_seconds)
    anthropic_key = load_anthropic_key()
    host, fibery_token = load_fibery_config()
    enum_maps = load_enum_maps(host, fibery_token)
    print("Fibery enum maps loaded")

    org = anthropic_get("/v1/organizations/me", anthropic_key, {})
    org_id = str(org.get("id") or "")
    print(f"Anthropic org: {org.get('name')} ({org_id})")
    api_key_index = fetch_api_key_index(anthropic_key)
    print(f"API keys indexed: {len(api_key_index)}")

    state_path = Path(args.state_file)
    if not state_path.is_absolute():
        state_path = ROOT / state_path

    if args.historical:
        state = load_state(state_path, args.start, args.end)
        sync_run_id = state.get("sync_run_id") or (
            f"ai-usage:local:{datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')}"
        )
        state["sync_run_id"] = sync_run_id
        started_at = sync_run_id.split(":", 2)[2]
        total_created = int(state.get("created") or 0)
        total_updated = int(state.get("updated") or 0)
        total_failed = int(state.get("failed") or 0)
        completed = set(state.get("completed_chunks") or [])
        chunks = list(iter_month_chunks(args.start, args.end))
        print(
            f"Historical mode: {args.start}..{args.end}, "
            f"{len(chunks)} month chunk(s), throttle={args.delay_seconds}s, "
            f"resume={len(completed)} done"
        )
        for chunk_start, chunk_end in chunks:
            label = chunk_label(chunk_start)
            if label in completed:
                print(f"  {label} ({chunk_start}..{chunk_end}): skipped (checkpoint)")
                continue
            print(f"  {label} ({chunk_start}..{chunk_end}): fetching...")
            chunk_rows = normalize_month_chunk(anthropic_key, chunk_start, chunk_end, org_id, api_key_index)
            print(f"    fetched {len(chunk_rows)} rows: {json.dumps(summarize_rows(chunk_rows))}")
            if args.dry_run:
                completed.add(label)
                state["completed_chunks"] = sorted(completed)
                save_state(state_path, state)
                continue
            c, u, f = upsert_rows(
                host,
                fibery_token,
                chunk_rows,
                sync_run_id,
                enum_maps,
                create_only=args.create_only,
            )
            total_created += c
            total_updated += u
            total_failed += f
            print(f"    wrote: created={c} updated={u} failed={f}")
            completed.add(label)
            state.update(
                {
                    "completed_chunks": sorted(completed),
                    "created": total_created,
                    "updated": total_updated,
                    "failed": total_failed,
                }
            )
            save_state(state_path, state)
        if args.dry_run:
            print(f"Dry-run complete; checkpoint: {state_path}")
            return
        status = "complete" if total_failed == 0 else ("partial" if total_created + total_updated else "failed")
        write_sync_run(
            host,
            fibery_token,
            sync_run_id,
            args.start,
            args.end,
            enum_maps,
            rows_fetched=total_created + total_updated + total_failed,
            rows_upserted=total_created + total_updated,
            rows_failed=total_failed,
            status=status,
            started_at=started_at,
        )
        print(
            f"Fibery upsert: created={total_created} updated={total_updated} "
            f"failed={total_failed} status={status}"
        )
        print(f"Review: https://{host}/AI_Usage_Data/Usage")
        return

    sync_run_id = f"ai-usage:local:{datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')}"
    started_at = sync_run_id.split(":", 2)[2]
    all_rows: list[dict[str, Any]] = []
    total_created = total_updated = total_failed = 0

    for day in iter_days(args.start, args.end):
        day_rows = normalize_day(anthropic_key, day, org_id, api_key_index)
        print(f"  {day}: fetched {len(day_rows)} normalized rows")
        if args.dry_run:
            all_rows.extend(day_rows)
            time.sleep(1.5)
            continue
        if args.incremental:
            c, u, f = upsert_rows(
                host,
                fibery_token,
                day_rows,
                sync_run_id,
                enum_maps,
                create_only=args.create_only,
            )
            total_created += c
            total_updated += u
            total_failed += f
            print(f"    wrote: created={c} updated={u} failed={f}")
            time.sleep(5)
            continue
        all_rows.extend(day_rows)
        time.sleep(1.5)

    if args.dry_run:
        print(f"Total normalized rows: {len(all_rows)}")
        by_dataset: dict[str, int] = {}
        for row in all_rows:
            ds = row.get("sourceDataset") or "?"
            by_dataset[ds] = by_dataset.get(ds, 0) + 1
        print("By dataset:", json.dumps(by_dataset, indent=2))
        return

    if args.incremental:
        status = "complete" if total_failed == 0 else ("partial" if total_created + total_updated else "failed")
        write_sync_run(
            host,
            fibery_token,
            sync_run_id,
            args.start,
            args.end,
            enum_maps,
            rows_fetched=total_created + total_updated + total_failed,
            rows_upserted=total_created + total_updated,
            rows_failed=total_failed,
            status=status,
            started_at=started_at,
        )
        print(
            f"Fibery upsert: created={total_created} updated={total_updated} "
            f"failed={total_failed} status={status}"
        )
        print(f"Review: https://{host}/AI_Usage_Data/Usage")
        return

    print(f"Total normalized rows: {len(all_rows)}")
    created, updated, failed = upsert_rows(
        host, fibery_token, all_rows, sync_run_id, enum_maps, create_only=args.create_only
    )
    status = "complete" if failed == 0 else ("partial" if created + updated else "failed")
    write_sync_run(
        host,
        fibery_token,
        sync_run_id,
        args.start,
        args.end,
        enum_maps,
        rows_fetched=len(all_rows),
        rows_upserted=created + updated,
        rows_failed=failed,
        status=status,
        started_at=started_at,
    )
    print(f"Fibery upsert: created={created} updated={updated} failed={failed} status={status}")
    print(f"Review: https://{host}/AI_Usage_Data/Usage")


if __name__ == "__main__":
    main()
