# Feature: Alert emails from shared or group address

> **PRD version 3.20.17** - sync with `docs/FOS-Dashboard-PRD.md`  
> **Teamwork notebook:** [Feature 054 - Alert emails from shared or group address](https://win.godeap.io/app/projects/1615262/notebooks/313632)  
> **Release task:** [Feature 054 - Alert emails from shared or group address](https://win.godeap.io/app/tasks/40953593)  
> **Inbox source:** [40507255](https://win.godeap.io/app/tasks/40507255)  
> **Extends:** [033](033-user-profile-alert-email-notifications.md) (alert email digests)

## Goal

Let FinOps Performance Hub alert digests send from a **shared mailbox or Google Group** address (for example `finops-alerts@harpin.ai`) instead of the personal Google account that owns the Apps Script project. Recipients should see a product-appropriate From address while keeping the existing display name (`NOTIFICATIONS_FROM_NAME`).

## User Stories

- As an **ADMIN**, I want to configure a shared From email in Settings so alert digests do not appear to come from an individual operator's inbox.
- As a **digest subscriber**, I want notification emails to show a recognizable group or shared address so I can filter and trust the sender.
- As an **ADMIN**, I want hydrate-failure admin emails to use the same From identity as alert digests for consistency.

## Acceptance Criteria (testable)

- [ ] Given `NOTIFICATIONS_FROM_EMAIL` is **empty**, when Hourly/Daily/Weekly jobs or **Run hourly now** sends a digest, then `MailApp.sendEmail` runs with `NOTIFICATIONS_FROM_NAME` only (current behavior).
- [ ] Given `NOTIFICATIONS_FROM_EMAIL` is set to an address configured as a **Send mail as** alias on the script owner's Gmail account, when a digest sends, then `GmailApp.sendEmail` uses that address as `from` with the configured display name.
- [ ] Given `NOTIFICATIONS_FROM_EMAIL` is set but the alias is **not** configured in Gmail, when a send is attempted, then the job logs a clear error, Notification Log row status is `error`, and the message is **not** silently sent from the personal account.
- [ ] Given a Datastore hydrate failure notification, when admins are emailed, then the same shared From helper is used (not a hard-coded `MailApp` path).
- [ ] **Mobile:** N/A (ADMIN Settings only; no new dashboard panel UI).

## UI Notes

- **Settings** (ADMIN): new Script Property **`NOTIFICATIONS_FROM_EMAIL`** in the Notifications group, below **Email from name**.
- Tooltip documents the Gmail **Send mail as** prerequisite and that the property must match the alias exactly.
- No `DashboardShell.html` panel changes.

## Data Model

- New Script Property: `NOTIFICATIONS_FROM_EMAIL` (string, default empty).
- No Profile JSON or Notification Log schema changes.

## Operations

### Prerequisites (Google Workspace / Gmail)

1. Create or designate a Google Group or shared mailbox for notifications.
2. On the account that **owns** the Apps Script project and notification triggers, add that address under Gmail **Settings → Accounts → Send mail as** and complete verification.
3. Set `NOTIFICATIONS_FROM_EMAIL` in ADMIN Settings to the verified alias.

### Queries / diagnostics

- `_diag_notificationFromEmail_()` reports configured From email, display name, and `GmailApp.getAliases()` for alias verification.

## Edge Cases

- **Empty `NOTIFICATIONS_FROM_EMAIL`:** backward compatible MailApp path.
- **Invalid email format in Settings:** registry validation rejects save (basic `@` check).
- **Gmail API quota / send failure:** same error handling as today (Notification Log `error`, `console.warn`).
- **Triggers run as script owner:** alias must exist on the **owner** account, not the accessing user (Web App `executeAs: USER_ACCESSING` does not affect time-driven jobs).

## Verification Steps

1. With `NOTIFICATIONS_FROM_EMAIL` blank, run **Settings → Run hourly now** for a test user; confirm send works and From is the script owner address with display name.
2. Configure a verified Send-as alias; set `NOTIFICATIONS_FROM_EMAIL`; run hourly job again; confirm recipient sees the group/shared address.
3. Run `_diag_notificationFromEmail_()` in the Apps Script editor; confirm `aliasConfigured: true`.
4. Temporarily set an unverified address; confirm send fails with logged error and no personal fallback.

## Implementation Checklist

- [ ] `NOTIFICATIONS_FROM_EMAIL` in `adminSettingsRegistry.js`
- [ ] Shared `sendNotificationEmail_()` in `notificationJobs.js`
- [ ] Alert jobs and hydrate-failure email use the helper
- [ ] PRD FR/AC + version bump
- [ ] Teamwork notebook + release task (Feature 054)

## Technical appendix

| File | Change |
| --- | --- |
| `src/notificationJobs.js` | `notificationFromIdentity_`, `sendNotificationEmail_`, `_diag_notificationFromEmail_` |
| `src/supabaseSyncJob.js` | hydrate failure email uses helper |
| `src/adminSettingsRegistry.js` | new property |
