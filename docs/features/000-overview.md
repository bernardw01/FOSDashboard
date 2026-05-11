# Overview

> **PRD version 1.6** — see `docs/FOS-Dashboard-PRD.md` (must match `src/` file headers and `FOS_PRD_VERSION` in `Code.js`).

## Goal

Ship the **Harpin FOS (Finance & Operations Snapshot) Dashboard**: a **Google Apps Script** Web App (HtmlService) that gives authorized Workspace users one place to see **key metrics, KPIs, and financial performance** aggregated from harpin’s existing tools (for example curated **Google Sheets** metric layers, **Fibery**, **Clockify**, accounting APIs, and other connectors as we add them).

The dashboard **reads and presents** data; it sits alongside—does not replace—pipelines that move data into systems of record (for example Clockify → Sheets → Fibery sync work documented in `docs/PRD.md`).

Requirements baseline: **`docs/FOS-Dashboard-PRD.md`**.

## Non-goals

- **Full BI / ad-hoc analytics** (no generic explorer for arbitrary dimensions in v1).
- **System of record** for money or time (no replacing the ledger or sync destinations).
- **Write-back** from the dashboard into external systems (unless explicitly scoped later).
- **Non–Workspace-first hosting** (v1 is Apps Script + published Web App).

## Definition of Done

- Published Web App loads for **allowed-domain** users with a stable **dashboard shell** (layout, sections, loading/error states).
- At least one **end-to-end metric path** works server-side (e.g. Sheets-backed or one API connector), with **freshness** or “last updated” surfaced in the UI.
- **Manual refresh** (and/or scheduled snapshot refresh, if implemented) completes within Apps Script limits and updates the UI without exposing secrets to the client.
- **Operational visibility**: admins can see whether a refresh succeeded or which connector failed (e.g. log sheet or equivalent), without secrets in logs.
- Source managed with **clasp** (`rootDir: src`); **`clasp push`** / **`clasp pull`** documented for the team.
