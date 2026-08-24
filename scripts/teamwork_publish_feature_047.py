#!/usr/bin/env python3
"""Publish Feature 047 notebooks and re-scope the Feature 044 release task.

Feature 047 (Dashboard performance and responsiveness) supersedes Feature 044
(Live visualization serve performance), which was a Spec Draft that was never
implemented. Per the review decision, task 40839335 is re-scoped to 047 rather
than opening a second release task, so the performance program has one task.

Actions:
  1. Create (or re-sync) the 047 feature and implementation plan notebooks.
  2. Rename task 40839335, rewrite its description, set Feature ID to 047,
     and move it to Spec Approved.
  3. Prepend a superseded banner to the two 044 notebooks.
  4. Re-key the manifest task entry and record the supersede relationship.

Idempotent: safe to re-run.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import PROJECT_ID, api, notebook_url  # noqa: E402
from teamwork_intake import (  # noqa: E402
    STAGE_SPEC_APPROVED_ID,
    get_task_workflow_stage,
    load_manifest,
    move_task_to_workflow_stage,
    set_task_custom_fields,
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    markdown_to_notebook_html,
    save_manifest,
    sync_notebook,
)

FEATURE_ID = "047"
RELEASE_TITLE = "Dashboard performance and responsiveness"
RELEASE_TASK_NAME = f"Feature {FEATURE_ID} - {RELEASE_TITLE}"
OLD_TASK_NAME = "Feature 044 - Live visualization serve performance"
TASKLIST_NAME = "Data platform"

NOTEBOOK_KEY = "feature_047"
NOTEBOOK_TITLE = f"Feature {FEATURE_ID} - {RELEASE_TITLE}"
NOTEBOOK_DESC = (
    "Measured performance program. The Datastore is 101 MB with a 100% cache "
    "hit ratio and aggregates the 90-day utilization window in 17.8 ms, while "
    "Apps Script pages 9,360 rows over ~7.6 MB in 10 serial round trips. Four "
    "workstreams: stop over-fetching and schema drift, aggregate in Postgres "
    "(absorbs 044), fix hydrate, client responsiveness."
)

PLAN_NOTEBOOK_KEY = "feature_047_implementation_plan"
PLAN_NOTEBOOK_TITLE = f"Feature {FEATURE_ID} - Implementation plan (Performance)"
PLAN_NOTEBOOK_DESC = (
    "Engineering plan for Feature 047 workstreams A-D, with a parity harness "
    "gate, per-workstream kill switches, and measured success metrics."
)

FEATURE_MD = ROOT / "docs/features/047-dashboard-performance-and-responsiveness.md"
PLAN_MD = (
    ROOT
    / "docs/features/047-dashboard-performance-and-responsiveness-implementation-plan.md"
)

OLD_NOTEBOOK_KEYS = ("feature_044", "feature_044_implementation_plan")

RELEASE_TASK_DESC = """Release type: Enhancement
Feature id: 047
Product version: TBD at ship (do not guess in task title until deploy)
Workflow stage: Spec Approved

**Supersedes Feature 044** (Live visualization serve performance, Spec Draft,
never implemented). This task was re-scoped from 044 so the performance program
has a single release task. Feature 044 phases A-D are absorbed as Workstream B.

**Measured baseline (2026-08-24, live Datastore):**

- Database is 101 MB with a 100% buffer cache hit ratio; CPU is healthy.
- Postgres aggregates the 90-day utilization window in 17.8 ms warm.
- Apps Script instead pages 9,360 rows over ~7.6 MB in 10 serial round trips.
- 91% of those bytes are `fibery_payload_json`, used only for three values.
- Stored `cache_schema_version` for utilization (5 vs 6) and resource
  assignments (2 vs 3) is stale, so both panels always take the slow rebuild.
- Nightly hydrate takes 60-70 minutes and 2 of the last 10 runs failed.

**Workstreams (each independently shippable, each behind a kill switch):**

A. Stop over-fetching and stop schema drift (1-2 days, largest quick win).
B. Aggregate in Postgres: RPCs, slim charts, range cache (absorbs 044).
C. Fix hydrate: incremental watermarks, batching, failure alerting.
D. Client responsiveness: shell weight, image hosting, chunked rendering.

Feature notebook: {notebook_url}
Implementation plan notebook: {plan_notebook_url}
Superseded notebook (044): {old_notebook_url}
Git feature spec: docs/features/047-dashboard-performance-and-responsiveness.md
Git implementation plan: docs/features/047-dashboard-performance-and-responsiveness-implementation-plan.md
Workflow: {how_we_work_url}
"""

SUPERSEDED_BANNER = (
    '<div style="border-left:4px solid #ff7641;padding:8px 12px;margin:0 0 16px 0;'
    'background:#fff6f0;">'
    "<strong>Superseded by Feature 047 - Dashboard performance and "
    "responsiveness.</strong><br/>"
    "This spec was never implemented. Its diagnosis is correct and is absorbed "
    "as Workstream B of Feature 047, which adds the causes that measurement "
    "surfaced later: the <code>fibery_payload_json</code> over-fetch, panel "
    "schema-version drift, hydrate duration and reliability, and client shell "
    "weight. Release task 40839335 was re-scoped to Feature 047. "
    'See <a href="{url}">{title}</a>.'
    "</div>"
)


def create_notebook_html_direct(title: str, desc: str, html: str) -> int:
    res = api(
        "POST",
        f"/projects/{PROJECT_ID}/notebooks.json",
        {
            "notebook": {
                "name": title,
                "description": desc,
                "content": html,
                "content-type": "HTML",
            }
        },
    )
    return int(res.get("notebookId") or res.get("id"))


def ensure_notebook(
    manifest: dict, *, key: str, title: str, desc: str, md_path: Path
) -> tuple[dict, str]:
    if manifest.get("notebooks", {}).get(key):
        sync_notebook(key, md_path, description=desc)
        manifest = load_manifest()
        print(f"Re-synced notebook [{key}]: {manifest['notebooks'][key]['url']}")
        return manifest, str(manifest["notebooks"][key]["url"])

    html = markdown_to_notebook_html(md_path.read_text(encoding="utf-8"))
    nb_id = create_notebook_html_direct(title, desc, html)
    nb_url = notebook_url(nb_id)
    manifest.setdefault("notebooks", {})[key] = {
        "id": nb_id,
        "title": title,
        "url": nb_url,
        "featureId": FEATURE_ID,
        "publishedAt": date.today().isoformat(),
        "lastSyncedAt": date.today().isoformat(),
        "gitMirror": str(md_path.relative_to(ROOT)).replace("\\", "/"),
    }
    save_manifest(manifest)
    print(f"Created notebook [{key}]: {nb_url}")
    return manifest, nb_url


def mark_044_notebooks_superseded(manifest: dict, new_nb_url: str) -> dict:
    """Prepend a superseded banner to each 044 notebook, once."""
    banner = SUPERSEDED_BANNER.format(url=new_nb_url, title=NOTEBOOK_TITLE)
    marker = "Superseded by Feature 047"
    for key in OLD_NOTEBOOK_KEYS:
        entry = manifest.get("notebooks", {}).get(key)
        if not entry:
            print(f"No manifest entry for [{key}], skipping supersede banner")
            continue
        nb_id = int(entry["id"])
        raw = api("GET", f"/notebooks/{nb_id}.json")
        nb = raw.get("notebook", raw)
        content = nb.get("contents") or nb.get("content") or ""
        if marker in content:
            print(f"Notebook [{key}] already marked superseded")
        else:
            api(
                "PUT",
                f"/notebooks/{nb_id}.json",
                {"notebook": {"content": banner + content, "content-type": "HTML"}},
            )
            print(f"Marked notebook [{key}] superseded")
        entry["supersededBy"] = NOTEBOOK_KEY
        entry["supersededAt"] = date.today().isoformat()
    save_manifest(manifest)
    return manifest


def rescope_task(
    manifest: dict, *, nb_url: str, plan_url: str, old_nb_url: str
) -> tuple[dict, int, str]:
    tasks = manifest.setdefault("tasks", {})
    entry = tasks.get(RELEASE_TASK_NAME) or tasks.get(OLD_TASK_NAME)
    if not entry:
        raise SystemExit(
            f"Neither {RELEASE_TASK_NAME!r} nor {OLD_TASK_NAME!r} is in the manifest; "
            "cannot re-scope. Check docs/teamwork-manifest.json."
        )
    task_id = int(entry["id"])

    desc = RELEASE_TASK_DESC.format(
        notebook_url=nb_url,
        plan_notebook_url=plan_url,
        old_notebook_url=old_nb_url,
        how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
    )
    api(
        "PUT",
        f"/tasks/{task_id}.json",
        {"todo-item": {"content": RELEASE_TASK_NAME, "description": desc}},
    )
    print(f"Renamed task {task_id} to {RELEASE_TASK_NAME!r}")

    set_task_custom_fields(
        task_id,
        feature_id=FEATURE_ID,
        release_type="Enhancement",
        manifest=manifest,
    )
    print(f"Set Feature ID to {FEATURE_ID}")

    if get_task_workflow_stage(task_id) != STAGE_SPEC_APPROVED_ID:
        move_task_to_workflow_stage(task_id, STAGE_SPEC_APPROVED_ID)
    print(f"Workflow stage: {get_task_workflow_stage(task_id)} (Spec Approved)")

    tasks.pop(OLD_TASK_NAME, None)
    tasks[RELEASE_TASK_NAME] = {
        "id": task_id,
        "tasklist": TASKLIST_NAME,
        "featureId": FEATURE_ID,
        "releaseType": "Enhancement",
        "releaseTitle": RELEASE_TITLE,
        "provisionalTaskName": True,
        "shippedVersion": None,
        "notebookKey": NOTEBOOK_KEY,
        "implementationPlanNotebookKey": PLAN_NOTEBOOK_KEY,
        "url": task_url(task_id),
        "renameAtShip": f"v{{FOS_PRD_VERSION}} - {RELEASE_TITLE}",
        "workflowStage": "Spec Approved",
        "createdAt": entry.get("createdAt", date.today().isoformat()),
        "rescopedFrom": {
            "featureId": "044",
            "taskName": OLD_TASK_NAME,
            "rescopedAt": date.today().isoformat(),
            "reason": (
                "Feature 047 supersedes 044; 044 phases A-D become Workstream B."
            ),
        },
    }
    save_manifest(manifest)
    return manifest, task_id, task_url(task_id)


def main() -> None:
    for path in (FEATURE_MD, PLAN_MD):
        if not path.exists():
            raise SystemExit(f"Missing {path}")

    manifest = load_manifest()
    manifest, nb_url = ensure_notebook(
        manifest,
        key=NOTEBOOK_KEY,
        title=NOTEBOOK_TITLE,
        desc=NOTEBOOK_DESC,
        md_path=FEATURE_MD,
    )
    manifest, plan_url = ensure_notebook(
        manifest,
        key=PLAN_NOTEBOOK_KEY,
        title=PLAN_NOTEBOOK_TITLE,
        desc=PLAN_NOTEBOOK_DESC,
        md_path=PLAN_MD,
    )

    old_nb_url = (
        manifest.get("notebooks", {}).get("feature_044", {}).get("url", "(none)")
    )
    manifest = mark_044_notebooks_superseded(manifest, nb_url)
    manifest, task_id, release_task_url = rescope_task(
        manifest, nb_url=nb_url, plan_url=plan_url, old_nb_url=old_nb_url
    )

    print("\nFeature notebook:   " + nb_url)
    print("Plan notebook:      " + plan_url)
    print("Release task:       " + release_task_url)


if __name__ == "__main__":
    main()
