#!/usr/bin/env python3
"""Publish Feature 034 notebook(s) + release task from docs/features/034-*.md.

Scope: Agreement Drive warm cache, Delivery Agreement reuse, Portfolio live
batch / continuation builds (responsiveness review options 1, 2, 4).
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import PROJECT_ID, api, notebook_url  # noqa: E402
from teamwork_intake import (  # noqa: E402
    RELEASE_TYPE_ENHANCEMENT,
    STAGE_SPEC_DRAFT_ID,
    create_release_task,
    get_task_workflow_stage,
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    load_manifest,
    markdown_to_notebook_html,
    save_manifest,
    sync_notebook,
)

NOTEBOOK_KEY = "feature_034"
NOTEBOOK_TITLE = "Feature 034 - Live dashboard warm cache and Portfolio batch builds"
NOTEBOOK_DESC = (
    "Same-day Drive warm cache for Agreements, Delivery list reuse of Agreement "
    "payloads, and Portfolio P&L cold Drive builds via continuation batches. "
    "Spec Draft from responsiveness review options 1, 2, 4."
)

PLAN_NOTEBOOK_KEY = "feature_034_implementation_plan"
PLAN_NOTEBOOK_TITLE = "Feature 034 - Implementation plan (warm cache + Portfolio batches)"
PLAN_NOTEBOOK_DESC = (
    "Engineering implementation plan for Feature 034: Phase A Agreement Drive "
    "cache, Phase B Delivery reuse, Phase C Portfolio continuation batch builds."
)

FEATURE_MD = ROOT / "docs/features/034-live-dashboard-warm-cache-and-portfolio-batching.md"
PLAN_MD = (
    ROOT
    / "docs/features/034-live-dashboard-warm-cache-and-portfolio-batching-implementation-plan.md"
)
MANIFEST = ROOT / "docs/teamwork-manifest.json"
TASKLIST_NAME = "Data platform"
RELEASE_TASK_NAME = (
    "Feature 034 - Live dashboard warm cache and Portfolio batch builds"
)

RELEASE_TASK_DESC = """Release type: Enhancement
Feature id: 034
Product version: TBD at ship (do not guess in task title until deploy)

**Scope:** Cut live-mode wait time for the highest-impact cold paths:

1. **Agreement same-day Drive warm cache** (`agreement-cache/YYYY-MM-DD/`) so 2nd+ Live opens of the day are Drive-fast (Refresh still rebuilds from Fibery).
2. **Delivery list reuses Agreement** (browser and/or Drive) via `buildDeliveryDashboardPayloadFromAgreement_` so opening Delivery after Agreements does not double Fibery Agreement work.
3. **Portfolio P&L cold Drive builds via continuation batches** (reuse snapshot P&L batch pattern) so the first visitor of the day does not rebuild all projects in one Apps Script execution.

**Out of scope v1:** Utilization Drive cache; parallel `google.script.run`; CacheService full-payload store; changing historical snapshot contracts except Portfolio live build mechanics.

Feature notebook: {notebook_url}
Implementation plan notebook: {plan_notebook_url}
Git feature spec: docs/features/034-live-dashboard-warm-cache-and-portfolio-batching.md
Git implementation plan: docs/features/034-live-dashboard-warm-cache-and-portfolio-batching-implementation-plan.md
Workflow: {how_we_work_url}
"""


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
    manifest: dict,
    *,
    key: str,
    title: str,
    desc: str,
    md_path: Path,
    feature_id: str,
) -> tuple[dict, str]:
    nb_entry = manifest.get("notebooks", {}).get(key)
    if nb_entry:
        sync_notebook(key, md_path, description=desc)
        manifest = load_manifest()
        return manifest, str(manifest["notebooks"][key]["url"])

    md = md_path.read_text(encoding="utf-8")
    html = markdown_to_notebook_html(md)
    nb_id = create_notebook_html_direct(title, desc, html)
    nb_url = notebook_url(nb_id)
    manifest.setdefault("notebooks", {})[key] = {
        "id": nb_id,
        "title": title,
        "url": nb_url,
        "featureId": feature_id,
        "publishedAt": date.today().isoformat(),
        "lastSyncedAt": date.today().isoformat(),
        "gitMirror": str(md_path.relative_to(ROOT)),
    }
    save_manifest(manifest)
    print(f"Created notebook [{key}]: {nb_url}")
    return manifest, nb_url


def update_release_task_description(
    task_id: int,
    *,
    notebook_url: str,
    plan_notebook_url: str,
    manifest: dict,
) -> None:
    desc = RELEASE_TASK_DESC.format(
        notebook_url=notebook_url,
        plan_notebook_url=plan_notebook_url,
        how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
    )
    api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"description": desc}})


def main() -> None:
    if not FEATURE_MD.exists():
        raise SystemExit(f"Missing {FEATURE_MD}")
    if not PLAN_MD.exists():
        raise SystemExit(f"Missing {PLAN_MD}")

    manifest = load_manifest()

    manifest, nb_url = ensure_notebook(
        manifest,
        key=NOTEBOOK_KEY,
        title=NOTEBOOK_TITLE,
        desc=NOTEBOOK_DESC,
        md_path=FEATURE_MD,
        feature_id="034",
    )

    manifest, plan_url = ensure_notebook(
        manifest,
        key=PLAN_NOTEBOOK_KEY,
        title=PLAN_NOTEBOOK_TITLE,
        desc=PLAN_NOTEBOOK_DESC,
        md_path=PLAN_MD,
        feature_id="034",
    )

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        desc = RELEASE_TASK_DESC.format(
            notebook_url=nb_url,
            plan_notebook_url=plan_url,
            how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id="034",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            workflow_stage_id=STAGE_SPEC_DRAFT_ID,
            manifest=manifest,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": "034",
            "releaseType": "Enhancement",
            "releaseTitle": "Live dashboard warm cache and Portfolio batch builds",
            "provisionalTaskName": True,
            "shippedVersion": None,
            "notebookKey": NOTEBOOK_KEY,
            "implementationPlanNotebookKey": PLAN_NOTEBOOK_KEY,
            "url": release_task_url,
            "renameAtShip": (
                "v{FOS_PRD_VERSION} - Live dashboard warm cache and Portfolio batch builds"
            ),
            "workflowStage": "Spec Draft",
        }
        print(f"Created release task: {release_task_url}")
    else:
        release_task_url = manifest["tasks"][task_key]["url"]
        task_id = int(manifest["tasks"][task_key]["id"])
        update_release_task_description(
            task_id,
            notebook_url=nb_url,
            plan_notebook_url=plan_url,
            manifest=manifest,
        )
        print(f"Release task exists: {release_task_url}")

    stage = get_task_workflow_stage(task_id)
    print(f"Release task workflow stage id: {stage} (Spec Draft = {STAGE_SPEC_DRAFT_ID})")

    # Keep feature doc headers aligned with live Teamwork URLs after first publish.
    feature_md = FEATURE_MD.read_text(encoding="utf-8")
    marker = (
        "> **Teamwork:** notebooks and release task linked in "
        "`docs/teamwork-manifest.json` after publish."
    )
    replacement = (
        f"> **Teamwork notebook:** [{NOTEBOOK_TITLE}]({nb_url})  \n"
        f"> **Implementation plan notebook:** [{PLAN_NOTEBOOK_TITLE}]({plan_url})  \n"
        f"> **Release task:** [{RELEASE_TASK_NAME}]({release_task_url})"
    )
    if marker in feature_md:
        FEATURE_MD.write_text(
            feature_md.replace(marker, replacement, 1), encoding="utf-8"
        )
        sync_notebook(NOTEBOOK_KEY, FEATURE_MD, description=NOTEBOOK_DESC)
        manifest = load_manifest()
        print("Updated feature md Teamwork links and re-synced notebook")

    save_manifest(manifest)
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
