# Implementation plan: Feature 041 - PM Overview rebrand

> **Feature spec:** [041-pm-overview-rebrand.md](041-pm-overview-rebrand.md)  
> **Status:** Shipped (**v3.7.0**)  
> **Feature ID:** **041**  
> **Ship type:** Enhancement (PATCH if shipped alone)

## Summary

Copy-only rename: **Projects & P&L** and **Delivery Dashboard** become **PM Overview**. Keep route id **`delivery`**.

## File touch list

| File | Change |
| --- | --- |
| `src/Code.js` | Nav child label `Projects & P&L` → `PM Overview` |
| `src/DashboardShell.html` | Panel H1; mobile nav friendly names; any user-visible "Delivery Dashboard" strings |
| `src/adminSettingsRegistry.js` | Panel group title if present |
| `docs/FOS-Dashboard-PRD.md` | FR copy references (optional at ship if product-visible) |

## Test plan

1. Grep for `Projects & P&L`, `Delivery Dashboard` in `src/` after change; expect zero user-visible leftovers (comments may stay).
2. Smoke: open Delivery panel desktop + mobile.

## Changelog (plan doc)

| Date | Note |
| --- | --- |
| 2026-08-14 | Shipped v3.7.0. |
