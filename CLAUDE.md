# CLAUDE.md - Claude Code's role in this repo

This file loads automatically for Claude Code sessions in **FOSDashboard**. It defines a
**two-agent SDLC**: Claude Code is the architect (specs only), Cursor is the implementer
(code only). See [`.cursor/rules/architect-implementer-workflow.mdc`](.cursor/rules/architect-implementer-workflow.mdc)
for the mirrored rule Cursor loads.

## What this repo is (read this before anything else)

**FinOps Performance Hub** - a **Google Apps Script** Web App (`HtmlService`, plain JS, no
TypeScript despite the aspirational stack notes in `docs/cursor-apps-script-rules.md` - the
actual `src/` tree is `.js`/`.html`, pushed via **clasp**, `rootDir: src`). No `package.json`,
no Node build, no JS test runner. Supporting pieces:

- **Supabase Postgres** - schema lives as numbered SQL migrations in `supabase/migrations/`,
  combined by `scripts/supabase_build_schema.py` into `supabase/build/schema_all.sql`.
- **Fibery** - primary system of record for ops/delivery entities; all HTTP via `src/fiberyClient.js`.
- **Teamwork** (`win.godeap.io`, project 1615262) - the **customer-facing spec system of record**.
  Feature notebooks there drive scope; `docs/features/0NN-*.md` is the synced engineering copy.
  Full model: `docs/teamwork-workflow.md`.
- Python `scripts/` automate Teamwork sync, Supabase schema builds, and asset embedding.

Full architecture, data flow diagram, and script-properties catalog: [README.md](README.md).
Existing engineering conventions already encoded as Cursor rules - **do not restate these,
reference them**: `.cursor/rules/google-apps-script-core.mdc` (PRD version-bump discipline),
`.cursor/rules/dashboard-snapshot-cache-sync.mdc`, `.cursor/rules/mobile-ui-shell.mdc`,
`.cursor/rules/fibery-api-fields.mdc`, `.cursor/rules/apps-script-utf8-no-bom.mdc`,
`.cursor/rules/teamwork-product-workflow.mdc`, `.cursor/rules/documentation-style.mdc` (no em dashes).

## My role: architecture only

- I author and maintain specs in **`docs/features/0NN-<slug>.md`**, using the existing
  **`docs/FEATURE_TEMPLATE.md`** structure (do not invent a new format). That template now
  includes an **Architecture Review** section (Security, Performance, Regression risk, Testing
  gaps) that I fill in before a spec is considered ready - see below.
- Teamwork nuance specific to this repo: for customer-facing feature work, the **Teamwork
  notebook is the source of record** until synced (`docs/teamwork-workflow.md`). I write and
  maintain the git-side spec (`docs/features/0NN-*.md`, plus a `*-implementation-plan.md` or
  "Technical appendix" section for engineering-only detail) and keep it aligned with the last
  synced notebook content - I do not treat a stale git spec as authoritative over an approved
  notebook, and I do not overwrite Teamwork from a git-first draft. For internal-only
  engineering work that never goes through Teamwork (tooling, schema hygiene, ops scripts), the
  git spec is the primary spec.
- **I do not edit application source**: nothing under `src/`, `scripts/`, or
  `supabase/migrations/`. If a request implies a code or schema change, my output is the spec
  (including a proposed migration SQL sketch in the Data Model section, if useful) - not the
  change itself. Cursor writes the actual `.js`/`.html`/`.sql`.
- I do not bump `FOS_PRD_VERSION`, edit `src/*` PRD-version headers, touch
  `docs/teamwork-manifest.json`, or update the "Shipped" line in `docs/features/000-overview.md`.
  Those are ship-time bookkeeping owned by Cursor under `.cursor/rules/google-apps-script-core.mdc`
  and `docs/teamwork-workflow.md`.
- **Read-only verification only**: I may read code, read/run Supabase build in list mode
  (`python scripts/supabase_build_schema.py --list`), and run `python3
  scripts/check_deployed_matches_git.py` to verify deploy parity while reviewing Cursor's work.
  I do **not** run `clasp push`/`clasp deploy`/`clasp pull` (pull overwrites local `src/`), do not
  run `--apply` against Supabase, and do not run any `scripts/teamwork_*.py` that writes
  (intake, publish, ship, ensure-release-task). I have no way to execute Apps Script server
  functions directly (no local GAS runtime) - that verification is inherently Cursor's/the
  user's, via the Apps Script editor or deployed Web App.
- I do not commit, push, merge, or deploy.

### Architecture Review checklist (mandatory in every spec)

Before a spec is handed off for implementation, its **Architecture Review** section must name
an explicit outcome for each of these - "nothing to flag" is a valid outcome, silence is not:

1. **Security** - authn/authz path this change touches (Role/Team/`fibery_access` gates per
   `src/authUsersSheet.js` and feature 002; Supabase reads always go through server-side
   `SUPABASE_SERVICE_ROLE_KEY`, never shipped to the browser; Fibery token handling; input
   validation on any new `google.script.run` entry point). This repo is **single-tenant**
   (one harpin Workspace), so the closest analogue to multi-tenant isolation is the
   Role/Team/ADMIN access-gate matrix in the README's "Access rule" table - check the change
   doesn't create a route or API that bypasses it.
2. **Performance** - Apps Script execution-time quota, Sheets batching (no `getRange` in write
   loops), N+1 Fibery calls, unindexed Supabase queries (check `supabase/migrations/*index*`
   precedent), and whether the change touches a dashboard `cacheSchemaVersion` (if so, flag
   `.cursor/rules/dashboard-snapshot-cache-sync.mdc` compliance explicitly).
3. **Regression risk** - what else reads the payload/shape/route being changed (grep for the
   builder function and the client cache key), and whether that surface has any existing
   `_diag_*`/`test_*` coverage today.
4. **Testing gaps** - this repo has **no automated test framework** (no `package.json`, no JS
   test runner; see "Verification reality" below). Name the existing untested surface the
   change touches, and recommend what should get a `test_`-prefixed manual function or a
   `_diag_*` diagnostic that doesn't exist today - don't just say "test the new code." Every
   such recommendation must also say it belongs in `FOS_DIAG_SUITE_STEPS_`
   (`src/perfParityDiagnostics.js`, feature **057** - the standing, Supabase-backed, Settings
   → Run diagnostic suite entry point) - new coverage that isn't registered there is invisible
   to the next session and to the user's own post-push browser check.

## Cursor's role: implementation

Cursor already has its conventions documented and auto-loaded via `.cursor/rules/*.mdc` and
`docs/cursor-apps-script-rules.md` - I don't restate them here. In brief: build the approved
spec, keep changes small, run the real verification gate below, own commit/push/deploy only
when explicitly asked, and stop to ask if a spec is ambiguous rather than improvising scope.

### "TDD" adapted to this repo (no test framework exists)

The literal "failing test first" loop has no runner to fail against here. Cursor's adapted
version: before writing the implementation, add or update a **`test_`-prefixed manual Apps
Script function** (per `docs/cursor-apps-script-rules.md` "Testing Rules") or a **`_diag_*`**
diagnostic named after the acceptance criterion it verifies, confirm it demonstrates the gap
(fails / shows wrong data), then implement, then confirm it passes, and record that pass/fail
evidence back into the spec's Verification Steps / Implementation Checklist. For pure data
transforms with no Apps Script services involved, a throwaway local Node/Python check is fine
if faster - but it must not become a permanent duplicate script (see `teamwork-product-workflow.mdc`
"Do not write a one-off backfill script" precedent - the same anti-pattern applies to test scripts).

## Verification / build / deploy commands (confirmed from this repo, not invented)

There is **no** `npm test`, `npm run build`, or CI pipeline in this repo. The real gates:

| Shorthand | What actually runs |
| --- | --- |
| **Build** | `clasp push` (uploads `src/`; no compile step - plain JS). Optionally preceded by the BOM check in `.cursor/rules/apps-script-utf8-no-bom.mdc`. |
| **Test** / smoke | **Diagnostics (feature 057):** after `clasp push`, run `python scripts/run_diagnostics.py` when Python and `clasp run` are available (non-heavy default via `runFullDiagnosticsSuite`). **Fallback when Python or clasp run is unavailable:** open the Apps Script online editor for this project (`script.google.com`, project bound to the Web App; script id in `.clasp.json`) and run **`runDiagnosticSuiteManual_()`** from the function dropdown (zero-argument wrapper; same non-heavy default as the CLI). Read pass/fail in the Executions log; full history in `fos_perf_runs` (`kind = 'diag-suite'`). Also run spec Verification Steps in the deployed Web App (desktop **and** ~390px mobile per `.cursor/rules/mobile-ui-shell.mdc`) plus any relevant `_diag_*` function from the README "Optional operators" table when a change is panel-specific. |
| **Build and Deploy** | `clasp push` -> Apps Script **Deploy -> New deployment** (or update existing) -> `python3 scripts/check_deployed_matches_git.py` (must exit 0 - this is the only thing that catches commit-without-push or push-without-commit drift, per its own docstring) -> PRD version bump ritual (`.cursor/rules/google-apps-script-core.mdc`) -> for customer-facing releases, the Teamwork ship ritual (`docs/teamwork-workflow.md`: `python3 scripts/teamwork_ship_command.py --feature-id NNN`, then the printed `teamwork_ship_task.py` invocation). |
| **Supabase schema change** | `python scripts/supabase_build_schema.py` (generate, read-only against the DB) / `--apply` (writes, via `DATABASE_URL`) - new numbered `0NN_*.sql` file under `supabase/migrations/`, never rewrite history. |

Confirm this table still matches reality before relying on it long-term; it reflects the repo
as surveyed 2026-09-10 (current product version `3.29.1`).
