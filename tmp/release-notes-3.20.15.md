# Release 3.20.15 - PM Overview default Project Performance tab

**Feature:** 052 - PM Overview default Project Performance tab on project select  
**Release type:** Enhancement  
**Inbox:** [40926670](https://win.godeap.io/app/tasks/40926670)

## Problem

PMs had to click **Project Performance** every time they selected a project; only CLIENT-ENGAGEMENT team defaulted to that tab.

## Solution

- Default tab is **Project Performance** for all users except team **FINANCE** (Accounting P&L).
- Session tab choice in the browser still overrides when switching projects.
- Applied on project select so the correct tab is active before P&L loads.

## Benefit

PMs land on performance KPIs and resource rows immediately when reviewing a project.
