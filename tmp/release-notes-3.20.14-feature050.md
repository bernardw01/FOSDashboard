# Release 3.20.14 - PM Overview perf allocation drill-down (backfill)

**Feature:** 050 - PM Overview perf allocation info on Project Performance drill-down  
**Release type:** Enhancement  
**Requestor:** jess.williams@harpin.ai

## Problem

When a PM drills into a person on Project Performance (feature 045), the modal showed daily logged time and an orange banner but no allocation context, so they could not see duration, Allocated & Billable, % allocation, or Role on SOW without leaving the Hub.

## Solution

- Extend the person time-entry modal with a **Resource allocation** summary (Duration, Allocated & Billable, % allocation, Role on SOW).
- Add `roleOnSow` to `resourceAllocations.assignments[]` from Fibery.
- Allocation rows are not filtered by the Project Performance date range (logged time still is).
- Mobile: same modal with allocation summary above daily time.

## Benefit

PMs can see why a row is orange in the same drill-down as daily hours.

**Note:** Code shipped in the same deploy as v3.20.14 (feature 051). Teamwork release task backfilled 2026-08-31.
