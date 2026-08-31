# Release 3.20.14 - PM Overview contract duration

**Feature:** 051 - PM Overview contract duration on project select  
**Release type:** Enhancement  
**Requestor:** jess.williams@harpin.ai

## Problem

Contract duration was buried in the Project financials subtitle as raw ISO dates and was easy to miss. PMs wanted the engagement window and timing context visible as soon as they select a project.

## Solution

- **Project financials subtitle:** Bold US short-month contract date range (or **Not set**).
- **Project Performance:** **Days remaining** and **% elapsed** KPI chips prepended before Planned margin (or **Not set** chip with Fibery guidance when Duration is empty).
- Client-only; uses existing `durStart`, `durEnd`, and `executionDate` on delivery project rows. No cache schema bump.
- Mobile: subtitle and Performance chips wrap at &lt; 768px.

## Benefit

PMs see contract timing immediately on project select without opening Fibery or waiting for monthly P&L data.
