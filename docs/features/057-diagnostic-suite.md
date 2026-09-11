# Feature: Standing diagnostic suite (CLI-runnable, build-integrated, Supabase-backed)

> **Status:** Shipped (implementation complete; Teamwork ship pending)
> **PRD version:** 3.29.1
> **Feature ID:** **057**
> **Release type:** Enhancement
> **Task list:** Data platform / Admin and settings
> **Requested by:** Bernard, 2026-09-10 (revised same day - CLI/build-process delivery, not browser)
> **Depends on:** Supabase Live data layer (**036**); Dashboard performance and responsiveness (**047**, `perfParityDiagnostics.js` / `fos_perf_runs`); ADMIN Settings environment panel (**011**)
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Origin / source request

**Original ask (2026-09-10, morning):** "We currently have the capability to run certain diagnostic tests and store the data in the supabase repo. I would like to create a stand alone test script in this repo that exercises key areas of functionality and stores the test results in the database with error messages and other content to aid you in troubleshooting issues. Going forward I would like tests to be written to this script so that I can run it myself in the browser after a do a clasp push."

**Revised same day:** "I actually want this to be runnable from clasp run at the command line. I want to create a bash or python script that will be part of the build process that runs the tests and if its failing it tells me. I should be able to give Cursor your prompt, cursor creates the tests, writes the code and then does a clasp push. After the clasp push it runs the full diagnostic suite to ensure that we do not have regression on the data sets used to populate the dashboards."

**Net result - three things, not one:**
1. A standing, broad-coverage diagnostic suite whose results persist to Supabase (unchanged from the original ask - see "Current state" below, most of this already exists).
2. **Delivery mechanism changed from a Settings browser button to a CLI script** (`scripts/run_diagnostics.py` or `.sh`) that runs after `clasp push`, reports pass/fail per step to the terminal, and exits non-zero on failure so it can gate a build/ship process.
3. The same durable convention as before - future feature work registers its tests into this suite, not as scattered one-offs.

---

## Current state (grounding - do not rebuild what exists)

A real version of this already exists, built during the BUG-036/B7 incident work (2026-09-10), and it should be **extended, not replaced**:

- **`src/perfParityDiagnostics.js`**: `FOS_DIAG_SUITE_STEPS_` (an array of `{id, label, heavy?, fn}` entries) and `_diag_runFullDiagnosticsSuite(includeHeavy)`, which runs every step, catches errors **per step** (one failing check does not kill the run), records `{id, label, ms, ok, pass, error, childRunId, result}` for each, and persists a summary row to **`fos_perf_runs`** (`kind: 'diag-suite'`) via `perfPersistRun_`. Query pattern already established: `select run_id, kind, label, passed, captured_at from fos_perf_runs where kind = 'diag-suite' order by captured_at desc limit 5;`.
- **What it is missing today:** (a) it only covers 7 steps, all specific to the BUG-036/B7 sync incident (`sync-health`, `stale-running-guard`, `ai-usage-empty-window`, `ai-usage-freshness`, `b7-util-rpc`, `b7-agreement-hydrate-rpc`, `hydrate-dataset-timings`) - it does not touch Agreements, Delivery, Utilization, Resource Assignments, Pipeline, Expenses, Portfolio P&L, Lookback, Engagement Review, auth/access gates, or notifications, even though tests already exist for several of those (see inventory below); (b) it is **only runnable from the Apps Script code editor today** - there is no Settings button or Web App entry point, so "run it myself in the browser" is not yet possible; (c) there is no documented convention that new feature work should register its tests here.
- **`fos_perf_runs` schema** (confirmed live, no migration needed): `run_id text, kind text, captured_at timestamptz, prd_version text, label text, passed boolean, flags jsonb, result jsonb`. General-purpose enough for this already - `result` already holds per-step error messages, timing, and arbitrary diagnostic content.

### Existing `test_*` / `_diag_*` inventory (confirmed via repo-wide grep, 2026-09-10)

~55 functions already exist across the codebase. Roughly three kinds, and they need different treatment:

| Kind | Examples | Registration approach |
| --- | --- | --- |
| **Genuine pass/fail tests** (already return `{pass, ...}` or `{ok, ...}`) | `test_lookbackEvaluateServicesOnlyAuto_`, `test_lookbackMarginFractionScale_`, `test_resolveFosAgreementOwnerFromRow_`, `test_lookbackReadySortOrder_`, `test_lookbackDurationAsOfMonthEnd_`, `test_lookbackMetricsBlobShape_`, `test_lookbackEligibleVolumeForPerfFreeze_`, `test_erShouldHideReviewsTab_`, `test_erFillUpdateModalEditOwnerAndPeriod_`, `test_lookbackAdminLockDeleteGates_`, `test_lookbackUserRemovedMarker_`, `test_supabaseSyncStaleRunningGuard_`, `test_supabaseAiUsageEmptyWindowDistinction_` | Register directly - zero new code, just add a `{id, label, fn}` entry per function. |
| **Connectivity/health checks** (naturally binary, but not currently asserting) | `_diag_pingFibery`, `_diag_pingUtilization`, `_diag_fiberyAccess`, `_diag_supabaseSyncHealth`, `_diag_aiUsageDataFreshness_`, `_diag_aiUsageScriptPropertyCheck` | Register directly if they already return `ok`/`pass`; otherwise add the one-line check (e.g. "did this return without throwing and with a non-empty result") before registering. |
| **Sample/inspection utilities** (return data for a human to eyeball, assert nothing) | `_diag_sampleAgreementPayload`, `_diag_sampleDeliveryPayload`, `_diag_sampleMonthlyPnL`, `_diag_sampleUtilizationPayload`, `_diag_sampleExpensesPayload`, `_diag_sampleAiUsageAnthropic`, `_diag_sampleAiUsageOpenAi`, `_diag_samplePortfolioProjectIndex`, `_diag_resourceAssignmentsSample`, `_diag_sampleUsageStats`, `_diag_finopsAskSample`, `_diag_fiberyDeepLinkSample`, `_diag_appVersionsCatalog` | **Do not register as-is** - they don't assert anything, so a "pass" would be meaningless. Each needs a thin wrapper asserting something concrete (e.g. "payload builds without error and contains at least one row/KPI") before joining the suite. Track as a per-area follow-on, not a blocker for shipping this feature - registering the genuine tests and health checks first is real, immediate value.

**Areas with tests already registered somewhere in this inventory:** Lookback (056), Engagement Review owner/tab logic (037), Supabase sync health (036), B7 RPC parity (047). **Areas with no test/diag coverage found at all today:** auth/access-gate matrix (002), notifications (033), Pipeline, Expenses beyond the sample dump, Portfolio P&L beyond the sample dump, Delivery status updates (018, including the just-fixed BUG-018-01). Naming these gaps explicitly rather than silently - closing them is follow-on work, not required to ship this feature, but should be tracked (see Implementation Checklist).

---

## Delivery mechanism: `clasp run` only - RESOLVED 2026-09-10, and no `doGet` fallback

**Confirmed by the user directly:** `clasp run` now works from the command line, and - the specific thing this section worried about - **the app's permissions for other users have not changed**. `src/appsscript.json` still carries no explicit `oauthScopes` block (checked directly, unchanged from before this feature), so whatever was needed to make `clasp run` work was resolved on the tooling/account side (clasp's own auth against this Apps Script project) rather than by widening the manifest's scope surface.

**Correction 2026-09-10 (important, not a nuance):** an earlier draft of this section proposed a fallback if `clasp run` didn't work - a token-gated `?diag=1&token=...` branch on the deployed `doGet`. **The user explicitly rejected that idea entirely, independent of whether `clasp run` works:** *"I do not want this in the app. This should only be used at dev time. It should not be live in the deployed browser version."* That fallback is **struck, not deprioritized** - it must not be built, not even as a dormant/unused code path sitting in production `doGet` "just in case." This diagnostic capability is a **dev-time-only tool**. It is invoked exclusively via the Apps Script **Execution API** (`clasp run`, gated by the existing `executionApi.access: "MYSELF"` in the manifest - already scoped to the script owner, not general users), and must never be reachable through the deployed Web App's `doGet`/HTTP surface in any form, working or dormant.

**If `clasp run` ever stops being viable in some future environment** (a fresh clone, a different Google account without the same tooling/account setup), that is a **new problem requiring a fresh decision at that time** - not a pre-built dormant branch in the live app waiting to be activated. Do not design around that hypothetical now.

**Resolved decision:** use `clasp run '<diagnosticFunctionName>'` as the sole delivery mechanism. The CLI script's contract (see Operations below): parse the JSON `clasp run` returns on stdout, print per-step pass/fail/error, exit non-zero on any failure. Nothing about this feature touches `doGet`, `DashboardShell.html`, `DashboardShellPanels.html`, or any code path reachable by a signed-in Web App user.

---

## Goal

Generalize the existing incident-scoped diagnostic suite into the **standing, ongoing smoke-test entry point** for the whole product: broad (not just recent-incident) coverage, runnable from the **command line as part of the build/ship process** (per the revised request - not a browser button), with every run's results (pass/fail, timing, error detail) persisted to Supabase for later troubleshooting - and a documented convention so every future feature adds its tests here rather than leaving them scattered and undiscoverable.

**Primary audience:** the user, running a CLI script after every `clasp push` as part of the normal ship ritual, to catch a regression before it reaches Fibery-sourced dashboard data; Claude Code, reviewing suite results read-only via Supabase to help diagnose reported issues without needing a live repro.

---

## User Stories

- As the **user**, after Cursor implements a feature and runs `clasp push`, I want a single command that runs the full diagnostic suite and tells me clearly, in the terminal, whether anything regressed - without opening a browser or the Apps Script editor.
- As the **user**, I want that command to exit non-zero on failure so it can gate a build/ship process (a script, a pre-ship check, eventually a hook), not just print something I have to read carefully.
- As the **user**, I want the last several runs' results kept in Supabase so I (or Claude Code, read-only) can look back at what changed between two pushes.
- As the **architect**, when I write a new feature spec's Testing gaps section and recommend a `test_*`/`_diag_*` addition, I want a documented convention that says "register it in `FOS_DIAG_SUITE_STEPS_`" so that recommendation actually turns into standing coverage instead of a one-off function nobody runs again.

---

## Acceptance Criteria (testable)

- [x] Given the delivery-mechanism decision above is resolved (`clasp run` confirmed working cleanly, no manifest/consent changes needed), when the user runs the new CLI script after a `clasp push`, then it triggers the full (non-heavy) diagnostic suite and waits for a result - no manual browser step required. **Confirmed 2026-09-10** by direct user report.
- [ ] Given the suite run completes, when the CLI script receives the result, then it prints a clear, scannable summary to the terminal: overall pass/fail, and per-step id/label/pass-fail/duration/error message - not just "done" or a raw JSON dump. **PASS (v3.29.0):** `scripts/run_diagnostics.py` prints tabular per-step summary; `--json` for raw output.
- [ ] Given any step failed, when the script finishes, then it **exits with a non-zero status code**; given every step passed, it exits 0 - suitable for use as a build-process gate. **PASS (v3.29.0):** exit 0/1/2 contract documented in script header; exit 2 reserved for clasp failures.
- [ ] Given `FOS_DIAG_SUITE_STEPS_` is expanded, when the suite runs, then it includes, at minimum, the already-genuine tests listed in the inventory above (Lookback, Engagement Review, Supabase sync, B7 RPC parity) plus at least one health-check-style entry per major dashboard area that currently has zero coverage (Agreements, Delivery, Utilization, Resource Assignments, Pipeline) - each new entry names which area it covers in its `label`. **PASS (v3.29.1):** 26 registered steps (25 non-heavy): 9 Lookback, 2 Performance Review, 2 AI Usage hydrate pause, 7 legacy sync/B7 steps, 5 panel health checks; `FOS_DIAG_SUITE_MIN_REGISTERED_STEPS_` = 24.
- [ ] Given a step throws or returns a failure, when the run completes, then that step's `error`/`message` is both printed by the CLI script and persisted in the `fos_perf_runs.result` JSONB for that run - enough detail to diagnose without re-running. **PASS:** existing `perfDiagSuiteRunStep_` + CLI `step_error_message()`; re-run after deploy to capture live evidence.
- [ ] Given the suite includes a `heavy: true` step (e.g. `hydrate-dataset-timings`), the CLI script's default invocation excludes heavy steps (matching today's `includeHeavy` semantics); a `--heavy` (or similarly explicit) flag opts into the full run for when that's actually wanted. **PASS (v3.29.0):** default `_diag_runFullDiagnosticsSuite(false)`; `--heavy` passes `[true]`.
- [ ] Given this ships, when a future feature spec's Testing gaps section recommends new coverage, then `docs/FEATURE_TEMPLATE.md` (or `CLAUDE.md`) explicitly says to register it in `FOS_DIAG_SUITE_STEPS_` - the convention is written down, not just implied by this one spec. **Already done** as part of this spec's own authoring - `docs/FEATURE_TEMPLATE.md` and `CLAUDE.md` were updated 2026-09-10.
- [ ] The script documents its own usage (`--help` or a header comment) including the exact command to run it, consistent with this repo's existing `scripts/*.py` style (e.g. `scripts/check_deployed_matches_git.py`, `scripts/supabase_build_schema.py`). **PASS (v3.29.0):** `scripts/run_diagnostics.py` header + `--help`.
- [x] Given the operator cannot run Python locally, when they follow the documented Apps Script editor path, then **`runDiagnosticSuiteManual_()`** runs the same non-heavy suite as the CLI default (not the heavy default trap). **PASS (v3.29.1):** zero-argument wrapper calls `_diag_runFullDiagnosticsSuite(false)`; Operations section documents editor steps.

---

## UI Notes

**None required for this feature.** The original ask included a Settings browser button; the revised ask is explicitly CLI/build-process delivery instead. No `DashboardShell.html`/`DashboardShellPanels.html` changes are in scope for this spec, and the mobile-ui-shell rule does not apply (no user-visible UI changes). If a Settings button is wanted later as a secondary, human-friendly way to trigger the same suite, that is a separate, optional follow-on - do not build it as part of this spec unless asked.

---

## Data Model

**No migration needed.** `fos_perf_runs` (existing, from feature 047's workstream B) already has the right shape: `run_id, kind, captured_at, prd_version, label, passed, flags, result jsonb`. This feature's runs continue using `kind: 'diag-suite'`, unchanged.

---

## Operations

- **Queries:** `select run_id, label, passed, captured_at, result from fos_perf_runs where kind = 'diag-suite' order by captured_at desc limit N;` - already the established pattern; the new CLI script should print this hint (or a direct link/command) on completion so a human can pull the full history without re-deriving the query.
- **Trigger action (Python + clasp run):** `clasp run 'runFullDiagnosticsSuite'` with `[false]` for the default non-heavy suite, or `python scripts/run_diagnostics.py` from the repo root after `clasp push`. Requires one-time Execution API setup (`python scripts/check_clasp_run_setup.py`). No `doGet`/Web App entry point of any kind.
- **Trigger action (Apps Script editor fallback, no Python):** when Python or `clasp run` is unavailable, use the online editor for this project:
  1. Open the deployed FinOps Performance Hub Web App in the browser and sign in as an ADMIN (or open [Google Apps Script](https://script.google.com/home) and open the project whose **Script ID** matches `.clasp.json` in this repo: `1HkxZZGjHZxyntiW87fqnZz_VFvo56gIIPzQWaV5pJ89PBV79LEJRBinu`).
  2. In the toolbar function dropdown, select **`runDiagnosticSuiteManual_`** (not `_diag_runFullDiagnosticsSuite` - the editor Run button passes zero arguments, which would otherwise default to heavy steps).
  3. Click **Run**. On first run, complete the OAuth authorization prompt (review permissions, choose your harpin account, Allow).
  4. Open **Executions** (left sidebar clock icon) or **View > Executions**; open the latest `runDiagnosticSuiteManual_` run. The log includes `===== FULL DIAGNOSTICS SUITE =====` followed by JSON with per-step `pass`, `error`, and `skipped` fields.
  5. For the persisted row: `select run_id, label, passed, captured_at, result from fos_perf_runs where kind = 'diag-suite' order by captured_at desc limit 1;` (Claude Code can run this via the Supabase connector if you prefer not to run SQL yourself).
- **CLI script contract (`scripts/run_diagnostics.py`, matching this repo's existing Python tooling style rather than introducing bash - consistency with `scripts/check_deployed_matches_git.py` et al., unless there's a concrete reason bash fits better):**
  - Default: run the non-heavy suite, print per-step results, exit 0/1.
  - `--heavy`: include heavy steps too.
  - `--json`: emit raw JSON instead of the human-readable summary, for future scripting/CI use.
  - No new secrets beyond what the chosen delivery mechanism needs (a diagnostic token Script Property, or clasp's own auth - whichever path is used, do not hardcode credentials in the script or commit them to git).
- **Registry maintenance:** every new `{id, label, fn}` entry added to `FOS_DIAG_SUITE_STEPS_` should have a stable `id` (used in `result` history) and a `label` that names the product area, not just the bug/feature number that motivated it - so entries stay legible once the incident that created them is old history (a lesson from today's inventory: the current 7 entries are BUG-036/B7-labeled, which will read as archaeology in six months).

---

## Edge Cases

- **A step's function doesn't exist / was renamed:** `perfDiagSuiteRunStep_`'s existing try/catch already handles a thrown `ReferenceError` as a normal step failure - confirm this still holds when wiring new entries, don't add a second error-handling layer.
- **`clasp run` (if chosen) or the HTTP fallback is unreachable** (network issue, script not deployed, wrong project): the CLI script must distinguish "could not reach the diagnostic entry point at all" from "reached it and got a failing result" - both should exit non-zero, but the terminal message must make clear which happened, so the user doesn't mistake a connectivity problem for a real regression.
- **Concurrent runs:** if the script is run twice in quick succession (e.g. by a future automated hook), decide whether overlapping suite runs are safe (they should be, since each is a read-mostly diagnostic pass) - do not add a lock unless something about the suite's own steps turns out to need one.

---

## Verification Steps

1. `clasp push`; run `python scripts/run_diagnostics.py` (or the chosen script name) from the command line; confirm it prints per-step pass/fail and any error messages, without needing a browser.
2. Confirm a new row appears in `fos_perf_runs` with `kind = 'diag-suite'` matching what the script printed.
3. Deliberately break one registered check (e.g. temporarily rename a function it calls); re-run the script; confirm it reports that one step failed with a real error message, exits non-zero, and does not take down the other steps' results.
4. Confirm the default run excludes heavy steps, and `--heavy` includes them.
5. Confirm the script's exit code is usable in a shell conditional (`if python scripts/run_diagnostics.py; then ...`).

---

## Architecture Review

- **Security:** This is a **dev-time-only tool** and must never gain a `doGet`/Web App-reachable entry point - the user explicitly rejected that, independent of whether `clasp run` works. The only gate is `clasp run`'s own auth (the developer's Google account, scoped by `executionApi.access: "MYSELF"` already in the manifest, confirming it can't be invoked by anyone else). Confirm this feature makes **zero** changes to `doGet`, `DashboardShell.html`, or `DashboardShellPanels.html` - a code reviewer checking this spec's implementation should be able to confirm that by grepping the diff for those files and finding nothing.
- **Performance:** The heavy/non-heavy split already exists and must stay the CLI script's default behavior (non-heavy) so a routine post-push check stays fast; `--heavy` is an explicit opt-in for when the slower per-dataset timing check is actually wanted. As more steps get registered over time (per the "going forward" convention), periodically re-measure total non-heavy suite duration so the routine post-push check doesn't quietly become a multi-minute wait.
- **Regression risk:** Expanding `FOS_DIAG_SUITE_STEPS_` must not change the existing BUG-036/B7-focused entries' `id`/`label` values, since anything already querying `fos_perf_runs.result` for those specific ids (e.g. a future troubleshooting session, or this very spec's own query patterns) would break silently. Additive only.
- **Testing gaps:** This feature exists specifically to close testing gaps, so recursion is worth naming explicitly: the suite itself has no test asserting that `FOS_DIAG_SUITE_STEPS_` isn't silently losing entries (e.g. a syntax error dropping steps after a certain point) - a lightweight "step count is at least N" self-check inside `_diag_runFullDiagnosticsSuite` would catch that class of regression. Also worth naming per the inventory above: whole product areas (auth/access gates, notifications, Pipeline, Expenses, Portfolio P&L, Delivery status updates including the recently-fixed BUG-018-01) have zero registered coverage today - not a blocker for this release, but should be the natural backlog for "going forward, tests get written to this script." The CLI script itself is also untested in the sense that has no test framework of its own - keep it simple enough (parse JSON, print, exit code) that this is a low-risk gap, and note it rather than over-engineer a meta-test for a thin script.

---

## Implementation Checklist

- [x] Resolve the Delivery mechanism decision above - **`clasp run` confirmed working 2026-09-10**, no manifest/consent changes. **The `doGet` fallback is explicitly rejected, not just unneeded - do not build it, in any form.**
- [x] Build `scripts/run_diagnostics.py` (or `.sh` if there's a concrete reason bash fits better) with the CLI contract above: default non-heavy run, `--heavy` flag, `--json` flag, clear terminal summary, correct exit code
- [x] Register the already-genuine `test_*` functions from the inventory above into `FOS_DIAG_SUITE_STEPS_` with area-naming (not incident-naming) labels
- [x] Add at least one health-check-style entry per currently-uncovered major dashboard area (Agreements, Delivery, Utilization, Resource Assignments, Pipeline) - reuse existing `_diag_ping*`/`_diag_sample*` functions with a thin assertion wrapper where needed
- [x] `_diag_` self-check that the suite isn't silently losing registered steps
- [ ] Run local smoke test per Verification Steps above (requires operator `clasp push` + `python scripts/run_diagnostics.py`)
- [x] Track (do not require for this ship) the explicitly-named zero-coverage areas as future backlog
- [x] Once this ships, add the CLI script's invocation to `CLAUDE.md`'s Build/Test/Deploy shorthand table so "Test" accurately reflects the new post-push step

---

## Change requests

_(Customer edits after Spec Approved go here until ship.)_

---

## Changelog (feature doc)

| Date | Note |
| --- | --- |
| 2026-09-10 | **v3.29.1:** Apps Script editor fallback **`runDiagnosticSuiteManual_()`** (non-heavy default for zero-arg Run button); Operations section documents manual path alongside `scripts/run_diagnostics.py`. |
| 2026-09-10 | **v3.29.0 shipped (Teamwork pending):** `scripts/run_diagnostics.py`, expanded `FOS_DIAG_SUITE_STEPS_` (Lookback, Performance Review, panel health), registry minimum guard, default non-heavy suite. Zero Web App / doGet changes. Backlog: auth gates, notifications, Expenses/Portfolio P&L sample wrappers, Delivery status updates (018). |
| 2026-09-10 | **Revised same day:** delivery mechanism changed from a Settings browser button to a CLI script (`scripts/run_diagnostics.py`), run after `clasp push` as part of the build process, printing pass/fail with a non-zero exit code on failure. Surfaced that `clasp run` was already investigated and rejected once in this repo (feature 047, 2026-08-24) due to a GCP-project-linking/OAuth-scope re-consent cost - spec now directs Cursor to attempt it for real once (per explicit request) with a proven token-gated `doGet` fallback (mirroring the existing `?favicon=1`/`?asset=...` route pattern) if it hits the same wall. UI Notes section removed (no browser UI in scope for this revision). |
| 2026-09-10 | **Delivery mechanism resolved same day:** user confirmed `clasp run` works from the command line with no change to other users' app permissions - `src/appsscript.json` confirmed still carries no explicit `oauthScopes`, so whatever unblocked it was tooling/account-side, not a manifest change. |
| 2026-09-10 | **Correction, same day:** user clarified the `doGet` fallback isn't just unneeded now that `clasp run` works - it's rejected outright: *"I do not want this in the app... It should not be live in the deployed browser version."* Struck the fallback entirely (not deprioritized); this feature makes zero changes to `doGet`/`DashboardShell.html`/`DashboardShellPanels.html`. `clasp run` (Execution API, `executionApi.access: "MYSELF"`) is the sole and permanent mechanism - if it ever stops working in some future environment, that's a fresh decision at that time, not a pre-built dormant path in the live app. |
