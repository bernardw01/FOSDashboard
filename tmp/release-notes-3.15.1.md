# v3.15.1 - Labor Hours Active roster and harpin orange exemption

## Problem
- Labor Hours zero-hours chips could still list Clockify Users whose Fibery work status is **In-Active**, when stale labor-row status said Active.
- Projects for customer **harpin.ai** were orange-highlighted for missing or non-billable resource allocations, which is noise for internal work.

## Fix
- Utilization `laborHours` config now carries authoritative Active ids/emails/names from `fos_clockify_users`; zero-hours prefers that roster and normalizes work status tokens.
- Resource Assignments, Delivery P&L, and Project Performance skip no-allocation orange when the customer name contains **harpin**; client paint paths apply the same rule so cached P&L clears immediately.

## Benefit
Cleaner zero-hours ops signal and no false orange on harpin internal projects.
