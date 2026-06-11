# FOS Dashboard - Teamwork product workflow

> **Teamwork project:** [FOS Dashboard Development](https://win.godeap.io/app/projects/1615262) on `win.godeap.io` (project id `1615262`).
>
> **Spec template:** `docs/FEATURE_TEMPLATE.md` (mirrored in Teamwork notebooks).
>
> **Current product version:** see `FOS_PRD_VERSION` in `src/Code.js`.

## Principles

1. **Teamwork is the customer-facing system of record** for feature specs, release status, and portfolio visibility.
2. **Git is the engineering archive**, synced from Teamwork when a release ships (version bump in the same commit).
3. **One Teamwork task = one release** (enhancement MINOR or bug-fix PATCH). **Feature id is known at intake; product version is not** (see [Release task naming](#release-task-naming)).
4. **Notebooks hold feature documentation** using `docs/FEATURE_TEMPLATE.md` sections. Tasks link to the notebook pages they implement or update.

## Task lists (functional areas)

| Task list | Application area | Example releases |
| --- | --- | --- |
| Platform and shell | Home, navigation, auth, data source, snapshots infra | v2.8.0 snapshots |
| Agreement | Agreement dashboard, revenue review | Revenue review phases |
| Operations | Utilization, labor hours, alerts | v2.11.0 utilization simplification |
| Delivery | Projects and P&L, status updates | v2.12.0 status updates |
| Finance | Expenses dashboard | v2.11.2 expenses chart labels |
| Sales | Pipeline dashboard | v2.11.1 pipeline stages |
| Admin and settings | Settings UI, app versions, usage analytics | v2.3.0 admin settings |
| Data platform | Fibery integrations, AI usage sync, snapshot jobs | v2.10.0 Anthropic ingest |
| Scenario planning | Exec FP&A route (future) | v2.14.0 R1 foundation |

## Task workflow (AI Dev Workflow)

Workflow id **83492** on this project. New tasks land in **Backlog** (`stageId` 0) until placed on the board.

| Teamwork stage | Stage id | Meaning |
| --- | --- | --- |
| **Backlog** | `0` | Default for new tasks not yet on the board |
| **Spec Draft** | `389189` | Feature notebook drafted; customer review not started |
| **Spec Approved** | `389190` | Spec approved; ready to sync notebook to git and implement |
| **Planned** | `389191` | Scheduled for an upcoming release |
| **In-progress** | `389192` | Implementation in progress |
| **Shipped** | `389193` | Released; task renamed to `vX.Y.Z - ...` |
| **Archived** | `389194` | Closed / historical |

Legacy doc names still apply: **Draft spec** = Spec Draft, **Approved for implementation** = Spec Approved, etc.

Post-approval notebook edits go in a **Change requests** section at the bottom of the feature notebook until the release ships.

## Release task naming

**Feature number** (e.g. `017`) is fixed when the feature notebook is created. **Version number** (`2.13.0`) is chosen only at deploy when you bump `FOS_PRD_VERSION`.

| Phase | Task name pattern | Example |
| --- | --- | --- |
| Intake through **Ready to ship** | `Feature NNN - Short release title` | `Feature 017 - AI usage OpenAI ingest` |
| **Shipped** | `vX.Y.Z - Short release title` | `v2.13.0 - AI usage OpenAI ingest` |

Rules:

- Do **not** bake a guessed version into the task name at intake. Patch releases (`2.12.6`) or reordering work can invalidate early guesses.
- Optional: note a **working estimate** in the task description or manifest `workingVersionEstimate` field (not in the task title).
- At **ship**, rename the Teamwork task so the `vX.Y.Z` prefix matches `FOS_PRD_VERSION` exactly, then mark **Shipped**.
- Update `docs/teamwork-manifest.json`: set `shippedVersion`, rename the manifest task key to match the final task name.

**Bootstrap exception:** The two in-flight tasks below were created with version prefixes before this rule. Rename them at ship (or proactively to `Feature NNN - ...` if you prefer).

## Release lifecycle

### 1. Intake

**From Inbox (required when promoting an inbox item to a feature):**

1. Create or update a **feature notebook** from `docs/FEATURE_TEMPLATE.md`.
2. Create a **release task** in the matching functional task list: `Feature NNN - Short release title` (no version prefix).
3. **Move the release task from Backlog to Spec Draft** on the AI Dev Workflow board (do not leave it in Backlog).
4. Set task custom fields:
   - **Feature ID** (`57880`): three-digit id, e.g. `019`
   - **Release Type** (`57881`): `Enhancement` or `Bug Fix`
   - **Release Version** (`57879`): leave blank until ship
5. Link the **notebook URL** and **inbox task URL** in the release task description; append links back on the inbox task.

Use `scripts/teamwork_intake.py` (`create_release_task`) or `python3 scripts/teamwork_publish_feature_019.py` as a template. New tasks created via API must pass `workflows: { workflowId: 83492, stageId: 389189 }` on create.

**General intake (not from Inbox):** same steps 1-2 and 4-5; move to **Spec Draft** when the notebook is ready for customer review.

### 2. Review and approval

- Customer edits the notebook in Teamwork only.
- Move the release task through **In review** to **Approved for implementation**.
- **Sync notebook to git** (`docs/features/0NN-*.md`) before starting code. This is the pre-code snapshot for Cursor.

### 3. Implementation

- Cursor reads git copies; engineering detail (file paths, cache schema, FR/AC) may be added in git only in a **Technical appendix** section or separate implementation-plan file.
- Move task to **In development**.

### 4. Ship

Single atomic release ritual:

1. Complete code and `clasp push` (if applicable).
2. Bump `FOS_PRD_VERSION` and PRD changelog (see `.cursor/rules/google-apps-script-core.mdc`). This number is the **authoritative** release version.
3. **Rename** the Teamwork release task to `vX.Y.Z - Short release title` using the bumped version (full string is the **release name**).
4. Set the task custom field **Release Version** to that same release name (`vX.Y.Z - Short release title`). Field id `57879` on this project (see `docs/teamwork-manifest.json`).
5. **Export final notebook content to git** (captures customer edits).
6. Mark Teamwork task **Shipped**; confirm task name and **Release Version** match `FOS_PRD_VERSION`.
7. Update `docs/teamwork-manifest.json` (`shippedVersion`, task key, `lastSyncedAt`).
8. Update `docs/features/000-overview.md` shipped line when appropriate.

**Automate rename + Release Version:** after bumping `FOS_PRD_VERSION` in `src/Code.js`:

```bash
python3 scripts/teamwork_ship_task.py \
  --manifest-task "v2.13.0 - AI usage OpenAI ingest" \
  --version-from-codejs \
  --update-manifest
```

Or with explicit ids:

```bash
python3 scripts/teamwork_ship_task.py \
  --task-id 40139491 \
  --version 2.13.0 \
  --title "AI usage OpenAI ingest" \
  --update-manifest
```

Add `--dry-run` to preview the API payload without writing.

**Release Version (API):** the script uses V1 `PUT /tasks/{taskId}.json` with `todo-item.content` and `todo-item.customFields` (`customFieldId` **57879**).

### 5. Bug-fix releases

- Patch releases (`v2.12.5 - ...`) use the same task model.
- Link to the parent feature notebook plus a short **Release notes** subsection (problem, fix, benefit).
- Full feature notebook not required for every patch.

## Notebook naming

| Pattern | Purpose |
| --- | --- |
| `How we work - FOS Dashboard workflow` | This operating model (customer-facing summary) |
| `Feature 017 - AI platform usage sync` | Feature spec notebook |
| `Feature 014 - Scenario planning` | Feature spec notebook |
| `AI spend impact - measurement guide` | Research notebook (AI ROI measurement; links Feature 017) |
| `Feature 019 - Resource allocation cost on P&L chart` | Delivery P&L chart - planned vs actual labor (Inbox intake) |

## Git sync mapping

| Teamwork | Git path (on ship and at approval-for-implementation) |
| --- | --- |
| Feature notebook body | `docs/features/0NN-<slug>.md` |
| Release notes section | PRD section 13 changelog row + optional `docs/release-highlights-*.md` |
| Implementation phases (engineering) | `docs/features/0NN-*-implementation-plan.md` (git; optional Teamwork mirror) |

Manifest for automation: `docs/teamwork-manifest.json` (notebook ids, task ids, feature ids).

## Cursor agent rules

Agents MUST follow `.cursor/rules/teamwork-product-workflow.mdc` in addition to `google-apps-script-core.mdc`.

## In-flight releases (review 2026-06-10)

**Current product version:** `2.12.5` (`FOS_PRD_VERSION` in `src/Code.js`).

| Feature | Teamwork task (current name) | Task id | Scope | Already shipped | Code status | Version at deploy |
| --- | --- | --- | --- | --- | --- | --- |
| **017** | `v2.13.0 - AI usage OpenAI ingest` | 40139491 | OpenAI Admin API ingest into Fibery (Phase C) | Anthropic ingest **v2.10.0** (same notebook, separate release) | OpenAI client not shipped; Anthropic path live | **Next MINOR** after `2.12.5` if this ships before another MINOR: likely **`2.13.0`**. Each patch before ship increments only the MINOR slot (e.g. patches through `2.12.9` still leave next MINOR at `2.13.0`). |
| **014** | `v2.14.0 - Scenario planning foundation (R1)` | 40139492 | Phase A: Exec nav, Drive JSON storage, scenario CRUD | Nothing | Not started in `src/` | **Next MINOR** after whatever ships immediately before R1. If 017 ships as `2.13.0` and R1 is next: likely **`2.14.0`**. If R1 ships before 017, R1 takes `2.13.0` and 017 becomes `2.14.0`. |

**Planning notes:**

- Task names still use bootstrap guesses (`v2.13.0`, `v2.14.0`). Treat those as **estimates**, not commitments. **Rename at deploy** to match the actual bump.
- Do not rely on version numbers in `docs/features/014-scenario-planning-implementation-plan.md` (R1-R6 table); those rows are stale relative to current `2.12.5`.
- One **feature notebook** can span multiple releases (017: Anthropic `2.10.0`, OpenAI TBD). Each **release task** still tracks one version bump.

**At ship (both tasks):**

1. Bump PRD / `FOS_PRD_VERSION`.
2. Rename Teamwork task: `v{FOS_PRD_VERSION} - {release title}`.
3. Set custom field **Release Version** to the same release name.
4. Set status **Shipped**; update manifest `shippedVersion` and task key.

Anthropic ingest shipped as **v2.10.0** under Feature 017 notebook (historical; no separate Teamwork release task retained).
