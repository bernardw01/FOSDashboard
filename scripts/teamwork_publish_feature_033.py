#!/usr/bin/env python3
"""Publish Feature 033 notebook(s) + release task from docs/features/033-*.md.

Inbox source: https://godeap.teamwork.com/app/tasks/40228889
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
    link_inbox_task,
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    load_manifest,
    markdown_to_notebook_html,
    save_manifest,
    sync_notebook,
)

NOTEBOOK_KEY = "feature_033"
NOTEBOOK_TITLE = "Feature 033 - User profile and alert email notifications"
NOTEBOOK_DESC = (
    "User Profile panel + opt-in HTML email digests for all existing platform alerts "
    "(fine-grained). Frequencies: Hourly / Daily / Weekly (no Immediate). Notification "
    "Log + upper-right bell tray with dismiss. Weekly = Tuesday AM. Spec draft."
)

PLAN_NOTEBOOK_KEY = "feature_033_implementation_plan"
PLAN_NOTEBOOK_TITLE = "Feature 033 - Implementation plan (profile + alert emails)"
PLAN_NOTEBOOK_DESC = (
    "Engineering implementation plan for Feature 033: phases A (profile shell), "
    "B (Daily digest + Notification Log tray), C (Hourly + Weekly Tuesday)."
)

FEATURE_MD = ROOT / "docs/features/033-user-profile-alert-email-notifications.md"
PLAN_MD = (
    ROOT / "docs/features/033-user-profile-alert-email-notifications-implementation-plan.md"
)
MANIFEST = ROOT / "docs/teamwork-manifest.json"
TASKLIST_NAME = "Platform and shell"
RELEASE_TASK_NAME = "Feature 033 - User profile and alert email notifications"
INBOX_TASK_ID = 40228889
INBOX_TASK_URL = "https://godeap.teamwork.com/app/tasks/40228889"

RELEASE_TASK_DESC = """Release type: Enhancement
Feature id: 033
Product version: TBD at ship (do not guess in task title until deploy)

**Customer inbox:** {inbox_url}

**Scope:** Personal **Profile** (sidebar above Settings) to **opt in** to **fine-grained** subscriptions for **all current** Agreement + Utilization alerts. Preferences on the auth **Users** tab **Profile** column (JSON). Frequencies: **Hourly / Daily / Weekly** only (**no Immediate**). Emails are **HTML digests** with **deep links**. **Weekly = Tuesday mornings**. Master email **off by default**. Jobs evaluate **live Fibery** only and respect **dashboard access** gates. **Notification Log** + upper-right **bell tray** with per-item **Clear**. Schema bumps require **migrate-all** of saved Profile JSON cells. Lazy profile load after shell paint. No extra profile fields in v1.

**Out of scope v1:** SMS/push; Immediate polling; new custom alert rules; extra profile fields; ADMIN Script Properties Settings replacement.

Feature notebook: {notebook_url}
Implementation plan notebook: {plan_notebook_url}
Git feature spec: docs/features/033-user-profile-alert-email-notifications.md
Git implementation plan: docs/features/033-user-profile-alert-email-notifications-implementation-plan.md
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
        inbox_url=INBOX_TASK_URL,
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
        feature_id="033",
    )

    manifest, plan_url = ensure_notebook(
        manifest,
        key=PLAN_NOTEBOOK_KEY,
        title=PLAN_NOTEBOOK_TITLE,
        desc=PLAN_NOTEBOOK_DESC,
        md_path=PLAN_MD,
        feature_id="033",
    )

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        desc = RELEASE_TASK_DESC.format(
            inbox_url=INBOX_TASK_URL,
            notebook_url=nb_url,
            plan_notebook_url=plan_url,
            how_we_work_url=manifest["notebooks"]["how_we_work"]["url"],
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id="033",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            workflow_stage_id=STAGE_SPEC_DRAFT_ID,
            manifest=manifest,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": "033",
            "releaseType": "Enhancement",
            "releaseTitle": "User profile and alert email notifications",
            "provisionalTaskName": True,
            "shippedVersion": None,
            "notebookKey": NOTEBOOK_KEY,
            "implementationPlanNotebookKey": PLAN_NOTEBOOK_KEY,
            "inboxTaskId": INBOX_TASK_ID,
            "inboxTaskUrl": INBOX_TASK_URL,
            "url": release_task_url,
            "renameAtShip": "v{FOS_PRD_VERSION} - User profile and alert email notifications",
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

    link_inbox_task(INBOX_TASK_ID, nb_url, release_task_url)

    stage = get_task_workflow_stage(task_id)
    print(f"Release task workflow stage id: {stage} (Spec Draft = {STAGE_SPEC_DRAFT_ID})")
    print(f"Linked inbox task {INBOX_TASK_ID}")

    save_manifest(manifest)
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
