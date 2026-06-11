#!/usr/bin/env python3
"""Bootstrap FOS Dashboard Teamwork project: task lists, notebooks, release tasks."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from html import escape
from pathlib import Path

HOST = "win.godeap.io"
PROJECT_ID = 1615262
BASE = f"https://{HOST}"
ROOT = Path(__file__).resolve().parents[1]


def load_token() -> str:
    token = os.environ.get("TEAMWORK_BEARER_TOKEN", "").strip()
    if token:
        return token
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("TEAMWORK_BEARER_TOKEN="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("TEAMWORK_BEARER_TOKEN not set")


def api(method: str, path: str, body: dict | None = None) -> dict:
    """Teamwork API via curl (avoids Python SSL issues on some macOS installs)."""
    token = load_token()
    url = f"{BASE}{path}"
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "-X", method, "-H", f"Authorization: Bearer {token}"]
    if body is not None:
        cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(body)])
    cmd.append(url)
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise SystemExit(f"curl failed {method} {path}: {proc.stderr}")
    lines = proc.stdout.rsplit("\n", 1)
    if len(lines) != 2:
        raise SystemExit(f"unexpected curl output for {path}")
    raw, status = lines[0], lines[1]
    if not status.startswith("2"):
        raise SystemExit(f"HTTP {status} {method} {path}: {raw}")
    return json.loads(raw) if raw else {}


def md_to_html(md: str) -> str:
    """Minimal markdown to XHTML for Teamwork notebooks."""
    lines = md.splitlines()
    out: list[str] = []
    in_ul = False
    in_ol = False
    in_pre = False
    in_table = False

    def close_lists():
        nonlocal in_ul, in_ol
        if in_ul:
            out.append("</ul>")
            in_ul = False
        if in_ol:
            out.append("</ol>")
            in_ol = False

    def close_table():
        nonlocal in_table
        if in_table:
            out.append("</table>")
            in_table = False

    for line in lines:
        if line.strip().startswith("```"):
            close_lists()
            close_table()
            if in_pre:
                out.append("</pre>")
                in_pre = False
            else:
                out.append("<pre>")
                in_pre = True
            continue
        if in_pre:
            out.append(escape(line))
            continue

        if not line.strip():
            close_lists()
            close_table()
            continue

        if line.startswith("# "):
            close_lists()
            close_table()
            out.append(f"<h2>{escape(line[2:].strip())}</h2>")
            continue
        if line.startswith("## "):
            close_lists()
            close_table()
            out.append(f"<h3>{escape(line[3:].strip())}</h3>")
            continue
        if line.startswith("### "):
            close_lists()
            close_table()
            out.append(f"<h4>{escape(line[4:].strip())}</h4>")
            continue

        m = re.match(r"^[-*] (.+)$", line)
        if m:
            if not in_ul:
                close_lists()
                close_table()
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{inline_md(m.group(1))}</li>")
            continue

        m = re.match(r"^\d+\.\s+(.+)$", line)
        if m:
            if not in_ol:
                close_lists()
                close_table()
                out.append("<ol>")
                in_ol = True
            out.append(f"<li>{inline_md(m.group(1))}</li>")
            continue

        if line.startswith("|") and "|" in line[1:]:
            close_lists()
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(set(c) <= set("- ") for c in cells):
                continue
            if not in_table:
                out.append("<table>")
                in_table = True
            out.append(
                "<tr>" + "".join(f"<td>{inline_md(c)}</td>" for c in cells) + "</tr>"
            )
            continue

        close_lists()
        close_table()
        out.append(f"<p>{inline_md(line)}</p>")

    close_lists()
    close_table()
    if in_pre:
        out.append("</pre>")

    return "\n".join(out)


def inline_md(text: str) -> str:
    text = escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    return text


def notebook_url(notebook_id: int) -> str:
    return f"{BASE}/app/projects/{PROJECT_ID}/notebooks/{notebook_id}"


def create_tasklist(name: str, description: str) -> int:
    res = api(
        "POST",
        f"/projects/{PROJECT_ID}/tasklists.json",
        {"todo-list": {"name": name, "description": description}},
    )
    return int(res["TASKLISTID"])


def create_notebook(name: str, description: str, md_content: str) -> int:
    res = api(
        "POST",
        f"/projects/{PROJECT_ID}/notebooks.json",
        {
            "notebook": {
                "name": name,
                "description": description,
                "content": md_to_html(md_content),
                "content-type": "HTML",
            }
        },
    )
    return int(res.get("notebookId") or res.get("id"))


def create_task(
    tasklist_id: int,
    name: str,
    description: str,
    *,
    workflow_id: int | None = None,
    workflow_stage_id: int | None = None,
) -> int:
    body: dict = {"task": {"name": name, "description": description}}
    if workflow_id is not None and workflow_stage_id is not None:
        body["workflows"] = {"workflowId": workflow_id, "stageId": workflow_stage_id}
    res = api("POST", f"/projects/api/v3/tasklists/{tasklist_id}/tasks.json", body)
    return int(res["task"]["id"])


TASK_LISTS = [
    ("Platform and shell", "Home, navigation, auth, data source selector, shared shell"),
    ("Agreement", "Agreement dashboard and revenue review"),
    ("Operations", "Utilization, labor hours, alerts"),
    ("Delivery", "Projects and P&L, delivery signals, status updates"),
    ("Finance", "Expenses dashboard"),
    ("Sales", "Pipeline dashboard"),
    ("Admin and settings", "Settings UI, app versions, usage analytics"),
    ("Data platform", "Fibery integrations, AI usage sync, snapshot jobs"),
    ("Scenario planning", "Exec FP&A scenario planning route"),
]

HOW_WE_WORK = """# How we work - FOS Dashboard workflow

## Goal
Use Teamwork as the single place customers see release status and feature documentation. Git receives a copy of notebook content whenever we approve work for implementation and again when we ship.

## One task = one release
Each release task is named with the feature id until ship, for example `Feature 017 - AI usage OpenAI ingest`. Add the version prefix only at deploy: `v2.13.0 - AI usage OpenAI ingest`.

## Inbox intake
When promoting an Inbox item to a feature:

1. Create the feature notebook and release task `Feature NNN - title`.
2. Move the release task to **Spec Draft** on the AI Dev Workflow board (not Backlog).
3. Set custom fields **Feature ID** and **Release Type** (`Enhancement` or `Bug Fix`).
4. Link notebook and inbox task URLs in both directions.

## Feature notebooks
Feature specs follow the repository template `docs/FEATURE_TEMPLATE.md`:

- Goal
- User stories
- Acceptance criteria
- UI notes
- Data model
- Operations
- Edge cases
- Verification steps
- Implementation checklist

## Status workflow
Move the release task through the project workflow stages:

1. Draft spec
2. In review
3. Approved for implementation (sync notebook to git; then code)
4. In development
5. Ready to ship
6. Shipped (version in task name matches product version)

## Change requests
After approval, customer edits go in a **Change requests** section at the bottom of the feature notebook until the release ships.

## Ship ritual
When coding is complete:

1. Deploy and bump the product version in the PRD
2. Rename the release task to vX.Y.Z - title and set custom field Release Version to the same release name
3. Sync the final notebook content back to the git repository
4. Mark the Teamwork task as Shipped

## Functional task lists
Releases are filed under the task list for the primary area they affect (Delivery, Data platform, Scenario planning, etc.).
"""

FEATURE_017 = """# Feature 017 - AI platform usage sync

> Feature id: **017** | Task list: **Data platform** | Anthropic ingest shipped **v2.10.0**

## Goal
Give finance and delivery leadership a single inventory of AI platform usage and cost, tied to people in our time-tracking roster, by syncing vendor usage data into Fibery daily.

## User stories
- As **finance**, I want daily AI usage and cost by person so I can see spend trends without logging into each vendor console.
- As **delivery leadership**, I want usage matched to Clockify users so we can later allocate cost to teams and work types.
- As an **admin**, I want a reliable scheduled sync with run logs so failures are visible and recoverable.

## Acceptance criteria
- [ ] OpenAI organization usage and cost is ingested on the same schedule as Anthropic (daily job plus on-demand).
- [ ] Rows upsert into Fibery `AI Usage Data/Usage` with a stable source record id (no duplicates on re-run).
- [ ] People are matched to `Agreement Management/Clockify Users` by email where possible; unmatched rows are flagged.
- [ ] Sync runs are logged (spreadsheet tab and/or Fibery Sync Runs).
- [ ] Script properties for OpenAI admin API are documented in admin settings catalog.
- [ ] No secrets are exposed to browser clients.

## UI notes
- v2.13.0 scope is **backend ingest only** (no FOS Dashboard panel for AI costs yet).
- Operator UI for manual sync remains a follow-on release.

## Data model
- Fibery app: **AI Usage Data**
- Primary entity: **Usage** (daily usage and cost facts)
- Supporting: **Actor Mapping**, **Sync Runs**
- Cross-app link: **Clockify Users** (read for matching)

## Operations
- Daily time-driven trigger plus on-demand date range sync
- Idempotent upsert by source record id
- Re-pull window for daily job (default 3 days)

## Edge cases
- Shared API keys map to Actor Mapping or an explicit shared-key status
- OpenAI admin key missing: job skips OpenAI with a clear run log message
- Vendor API rate limits: continuation/resume pattern consistent with snapshot job

## Verification steps
1. Set `OPENAI_ADMIN_API_KEY` in Script Properties.
2. Run on-demand sync for a 7-day window.
3. Confirm new rows in Fibery `AI Usage Data/Usage` with source platform OpenAI.
4. Confirm run log row shows success and row counts.

## Implementation checklist
- [ ] OpenAI client module and normalize path
- [ ] Wire into `aiUsageSyncJob.js` orchestration
- [ ] Admin settings registry entries
- [ ] Editor diagnostic for OpenAI sample pull
- [ ] PRD version bump on ship

## Change requests
(Add customer edits here after spec approval.)
"""

FEATURE_014_R1 = """# Feature 014 - Scenario planning (release R1 foundation)

> Feature id: **014** | Task list: **Scenario planning** | Target release: **v2.14.0**

## Goal
Give executive users a new **Scenario planning** area in the FOS Dashboard to create, duplicate, and archive scenarios stored as JSON in Google Drive, without write-back to Fibery or spreadsheets.

## User stories
- As an **executive**, I want a dedicated Scenario planning navigation entry so forecasting work lives inside the same dashboard as actuals.
- As an **executive**, I want to create and duplicate scenarios so I can branch plans without spreadsheet version chaos.
- As **security/ops**, I want only Exec role users to access this route.

## Acceptance criteria (R1 only)
- [ ] New top-level nav route `scenario-planning` visible only when `Role = EXEC`.
- [ ] Panel `#panel-scenario-planning` renders in the dashboard shell (shell UI acceptable in R1).
- [ ] Drive folder configured via `SCENARIO_PLANNING_DRIVE_FOLDER_ID` with `index.json` manifest.
- [ ] Users can create, duplicate, and archive scenarios; `scenarioKind` is `baseline`, `working`, or `archived`.
- [ ] Unauthorized users do not see the nav item; API returns FORBIDDEN.
- [ ] Activity events for create/duplicate/archive are logged.

## UI notes
- R1 is foundation only: list of scenarios and CRUD; no driver engine or compare dashboards yet.
- Reuse dark dashboard chrome consistent with other panels.

## Data model
- Drive JSON: `index.json`, `scenarios/<id>/manifest.json`
- No Fibery write-back in any phase

## Operations
- Read-only actuals seeding is **out of scope for R1** (Phase B / R2).

## Edge cases
- Missing Drive folder id: clear admin-facing error
- Concurrent edits: LockService on manifest updates

## Verification steps
1. Sign in as Exec test user: nav item appears.
2. Sign in as non-Exec: nav item hidden; API forbidden.
3. Create scenario: folder and manifest updated in Drive.
4. Duplicate and archive flows update index.

## Implementation checklist
- [ ] Auth gate `canAccessScenarioPlanning_()`
- [ ] `scenarioPlanningStore.js` Drive I/O
- [ ] Navigation model update in `Code.js`
- [ ] Shell panel stub in `DashboardShell.html`
- [ ] Admin settings for Drive folder id
- [ ] PRD FR/AC reserved on ship

## Change requests
(Add customer edits here after spec approval.)
"""

RELEASE_TASKS = [
    {
        "tasklist": "Data platform",
        "name": "Feature 017 - AI usage OpenAI ingest",
        "description": (
            "Release type: enhancement\n"
            "Feature id: 017\n"
            "Notebook: Feature 017 - AI platform usage sync\n\n"
            "Scope: OpenAI Admin API ingest into Fibery AI Usage Data/Usage; "
            "daily and on-demand sync; match Clockify users. "
            "Anthropic ingest already shipped v2.10.0.\n\n"
            "Linked notebooks will be appended after creation."
        ),
        "notebook_key": "feature_017",
    },
    {
        "tasklist": "Scenario planning",
        "name": "Feature 014 - Scenario planning foundation (R1)",
        "description": (
            "Release type: enhancement\n"
            "Feature id: 014\n"
            "Notebook: Feature 014 - Scenario planning (release R1 foundation)\n\n"
            "Scope: Exec-only nav route, Drive JSON storage, scenario list create/duplicate/archive. "
            "No driver engine or compare UI in this release.\n\n"
            "Linked notebooks will be appended after creation."
        ),
        "notebook_key": "feature_014",
    },
]


def main() -> None:
    manifest_path = ROOT / "docs" / "teamwork-manifest.json"
    manifest: dict = {
        "projectId": PROJECT_ID,
        "host": HOST,
        "tasklists": {},
        "notebooks": {},
        "tasks": {},
    }
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    # Task lists
    for name, desc in TASK_LISTS:
        if name not in manifest.get("tasklists", {}):
            tl_id = create_tasklist(name, desc)
            manifest.setdefault("tasklists", {})[name] = {"id": tl_id, "description": desc}
            print(f"Created task list: {name} ({tl_id})")
        else:
            print(f"Task list exists: {name}")

    # Notebooks
    notebooks_to_create = [
        (
            "how_we_work",
            "How we work - FOS Dashboard workflow",
            "Operating model for releases and feature notebooks",
            HOW_WE_WORK,
        ),
        (
            "feature_017",
            "Feature 017 - AI platform usage sync",
            "Feature spec - AI usage sync to Fibery (017)",
            FEATURE_017,
        ),
        (
            "feature_014",
            "Feature 014 - Scenario planning (R1 foundation)",
            "Feature spec - Scenario planning phase A / R1 (014)",
            FEATURE_014_R1,
        ),
    ]
    # Research notebooks are published via scripts/teamwork_publish_ai_spend_notebook.py
    # (key: ai_spend_impact). Do not duplicate here unless seeding a new environment.
    for key, title, desc, body in notebooks_to_create:
        if key not in manifest.get("notebooks", {}):
            nb_id = create_notebook(title, desc, body)
            manifest.setdefault("notebooks", {})[key] = {
                "id": nb_id,
                "title": title,
                "url": notebook_url(nb_id),
            }
            print(f"Created notebook: {title} ({nb_id})")
        else:
            print(f"Notebook exists: {title}")

    # Release tasks
    for spec in RELEASE_TASKS:
        key = spec["name"]
        if key in manifest.get("tasks", {}):
            print(f"Task exists: {key}")
            continue
        tl_name = spec["tasklist"]
        tl_id = manifest["tasklists"][tl_name]["id"]
        nb = manifest["notebooks"].get(spec["notebook_key"], {})
        desc = spec["description"]
        if nb.get("url"):
            desc += f"\n\nNotebook: {nb['url']}"
        how = manifest["notebooks"].get("how_we_work", {})
        if how.get("url"):
            desc += f"\nWorkflow: {how['url']}"
        task_id = create_task(tl_id, spec["name"], desc)
        manifest.setdefault("tasks", {})[key] = {
            "id": task_id,
            "tasklist": tl_name,
            "featureId": spec["description"].split("Feature id: ")[1].split("\n")[0]
            if "Feature id: " in spec["description"]
            else None,
            "targetVersion": spec["name"].split(" - ")[0],
            "shippedVersion": None,
            "notebookKey": spec["notebook_key"],
        }
        print(f"Created task: {spec['name']} ({task_id})")

    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {manifest_path}")


if __name__ == "__main__":
    main()
