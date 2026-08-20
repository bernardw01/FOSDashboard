#!/usr/bin/env python3
"""Catch-up: publish/sync Teamwork for shipped features missing from the board.

Ships (or prepares) Teamwork for code already in product:
  - 037 Engagement Review -> v3.5.2
  - 040 Project Performance layer -> v3.6.0
  - 043 Services Summary -> v3.8.0
  - 003 Agreements ADMIN-only patch -> v3.8.1

Does NOT touch Feature 044 (Spec Draft / not shipped).
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import PROJECT_ID, api, notebook_url  # noqa: E402
from teamwork_intake import (  # noqa: E402
    RELEASE_TYPE_BUG_FIX,
    RELEASE_TYPE_ENHANCEMENT,
    STAGE_SPEC_DRAFT_ID,
    create_release_task,
    get_task_workflow_stage,
    load_manifest,
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    markdown_to_notebook_html,
    save_manifest,
    sync_notebook,
)

DELIVERY_TL = 4174283
OPERATIONS_TL = 4174282
AGREEMENT_TL = 4174281


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
    if not md_path.exists():
        raise SystemExit(f"Missing {md_path}")
    entry = manifest.get("notebooks", {}).get(key)
    if entry:
        sync_notebook(key, md_path, description=desc)
        manifest = load_manifest()
        url = str(manifest["notebooks"][key]["url"])
        print(f"Synced notebook [{key}]: {url}")
        return manifest, url

    html = markdown_to_notebook_html(md_path.read_text(encoding="utf-8"))
    nb_id = create_notebook_html_direct(title, desc, html)
    url = notebook_url(nb_id)
    manifest.setdefault("notebooks", {})[key] = {
        "id": nb_id,
        "title": title,
        "url": url,
        "featureId": feature_id,
        "publishedAt": date.today().isoformat(),
        "lastSyncedAt": date.today().isoformat(),
        "gitMirror": str(md_path.relative_to(ROOT)).replace("\\", "/"),
    }
    save_manifest(manifest)
    print(f"Created notebook [{key}]: {url}")
    return manifest, url


def ensure_task(
    manifest: dict,
    *,
    task_key: str,
    tasklist_id: int,
    tasklist_name: str,
    feature_id: str,
    release_type: str,
    release_title: str,
    description: str,
    notebook_key: str | None = None,
    plan_key: str | None = None,
) -> tuple[dict, int, str]:
    if task_key in manifest.get("tasks", {}):
        entry = manifest["tasks"][task_key]
        tid = int(entry["id"])
        url = entry.get("url") or task_url(tid)
        print(f"Task exists: {task_key} -> {url}")
        return manifest, tid, url

    tid = create_release_task(
        tasklist_id,
        task_key,
        description,
        feature_id=feature_id,
        release_type=release_type,
        workflow_stage_id=STAGE_SPEC_DRAFT_ID,
        manifest=manifest,
    )
    url = task_url(tid)
    manifest.setdefault("tasks", {})[task_key] = {
        "id": tid,
        "tasklist": tasklist_name,
        "featureId": feature_id,
        "releaseType": release_type,
        "releaseTitle": release_title,
        "provisionalTaskName": True,
        "shippedVersion": None,
        "notebookKey": notebook_key,
        "implementationPlanNotebookKey": plan_key,
        "url": url,
        "renameAtShip": f"v{{FOS_PRD_VERSION}} - {release_title}",
        "workflowStage": "Spec Draft",
        "createdAt": date.today().isoformat(),
    }
    save_manifest(manifest)
    print(f"Created release task: {url}")
    return manifest, tid, url


def update_task_description(task_id: int, description: str) -> None:
    api("PUT", f"/tasks/{task_id}.json", {"todo-item": {"description": description}})


def inject_teamwork_links(md_path: Path, block: str) -> None:
    md = md_path.read_text(encoding="utf-8")
    if "> **Teamwork notebook:**" in md or "> **Release task:**" in md and "win.godeap.io/app/tasks" in md:
        # Prefer re-write only when missing notebook link
        if "> **Teamwork notebook:**" in md:
            print(f"Links present: {md_path.name}")
            return
    lines = md.splitlines(keepends=True)
    insert_at = 0
    for i, line in enumerate(lines):
        if (
            line.startswith("> **")
            and i + 1 < len(lines)
            and not lines[i + 1].startswith("> **")
        ):
            insert_at = i + 1
            break
    if not insert_at:
        print(f"Could not insert links in {md_path.name}")
        return
    lines.insert(insert_at, block if block.endswith("\n") else block + "\n")
    md_path.write_text("".join(lines), encoding="utf-8")
    print(f"Injected Teamwork links: {md_path.name}")


def main() -> None:
    manifest = load_manifest()
    how = manifest["notebooks"]["how_we_work"]["url"]

    # ----- 037 (existing) -----
    manifest, nb037 = ensure_notebook(
        manifest,
        key="feature_037",
        title="Feature 037 - Engagement Review",
        desc="Delivery Engagement Review workspace (shipped).",
        md_path=ROOT / "docs/features/037-engagement-review.md",
        feature_id="037",
    )
    manifest, plan037 = ensure_notebook(
        manifest,
        key="feature_037_implementation_plan",
        title="Feature 037 - Implementation plan (Engagement Review)",
        desc="Engagement Review implementation plan (shipped).",
        md_path=ROOT / "docs/features/037-engagement-review-implementation-plan.md",
        feature_id="037",
    )
    t037_key = "Feature 037 - Engagement Review"
    tid037 = int(manifest["tasks"][t037_key]["id"])
    url037 = manifest["tasks"][t037_key]["url"]
    update_task_description(
        tid037,
        f"""Release type: Enhancement
Feature id: 037
Product version: v3.5.2 (ship catch-up; foundation v3.2.0)
Workflow stage: Spec Draft -> Shipped via catch-up script

**Shipped scope:** Engagement Review under Delivery; Engagement Updates as status packs; notes; AI synopsis; HTML/Print export. Patches through v3.5.2.

Feature notebook: {nb037}
Implementation plan: {plan037}
Git: docs/features/037-engagement-review.md
Workflow: {how}
""",
    )
    print(f"037 task ready: {url037} stage={get_task_workflow_stage(tid037)}")

    # ----- 040 -----
    manifest, nb040 = ensure_notebook(
        manifest,
        key="feature_040",
        title="Feature 040 - Project Performance layer",
        desc="Delivery Project Performance tab beside Accounting P&L (shipped v3.6.0+).",
        md_path=ROOT / "docs/features/040-project-performance-layer.md",
        feature_id="040",
    )
    manifest, plan040 = ensure_notebook(
        manifest,
        key="feature_040_implementation_plan",
        title="Feature 040 - Implementation plan (Project Performance)",
        desc="Project Performance implementation plan (shipped).",
        md_path=ROOT / "docs/features/040-project-performance-layer-implementation-plan.md",
        feature_id="040",
    )
    t040_key = "Feature 040 - Project Performance layer"
    desc040 = f"""Release type: Enhancement
Feature id: 040
Product version: v3.6.0 (primary ship; patches through v3.7.6)
Workflow stage: Spec Draft -> Shipped via catch-up

**Shipped scope:** Project Performance tab on Delivery (planned/projected margin, EAC, hours, timing badge). Follow-on patches through v3.7.6 (variances, tooltips, CSV, date range, orange legend).

Feature notebook: {nb040}
Implementation plan: {plan040}
Git: docs/features/040-project-performance-layer.md
PRD: FR-137, AC-99
Workflow: {how}
"""
    manifest, tid040, url040 = ensure_task(
        manifest,
        task_key=t040_key,
        tasklist_id=DELIVERY_TL,
        tasklist_name="Delivery",
        feature_id="040",
        release_type=RELEASE_TYPE_ENHANCEMENT,
        release_title="Project Performance layer",
        description=desc040,
        notebook_key="feature_040",
        plan_key="feature_040_implementation_plan",
    )
    update_task_description(tid040, desc040)
    inject_teamwork_links(
        ROOT / "docs/features/040-project-performance-layer.md",
        (
            f"> **Teamwork notebook:** [Feature 040 - Project Performance layer]({nb040})  \n"
            f"> **Implementation plan notebook:** [Feature 040 - Implementation plan (Project Performance)]({plan040})  \n"
            f"> **Release task:** [{t040_key}]({url040})\n"
        ),
    )
    inject_teamwork_links(
        ROOT / "docs/features/040-project-performance-layer-implementation-plan.md",
        (
            f"> **Teamwork notebook:** [Feature 040 - Implementation plan (Project Performance)]({plan040})  \n"
            f"> **Feature notebook:** [Feature 040 - Project Performance layer]({nb040})  \n"
            f"> **Release task:** [{t040_key}]({url040})\n"
        ),
    )
    # Re-sync after link inject
    sync_notebook(
        "feature_040",
        ROOT / "docs/features/040-project-performance-layer.md",
        description="Delivery Project Performance tab beside Accounting P&L (shipped v3.6.0+).",
    )
    sync_notebook(
        "feature_040_implementation_plan",
        ROOT / "docs/features/040-project-performance-layer-implementation-plan.md",
        description="Project Performance implementation plan (shipped).",
    )

    # ----- 043 -----
    manifest = load_manifest()
    manifest, nb043 = ensure_notebook(
        manifest,
        key="feature_043",
        title="Feature 043 - Services Summary",
        desc="Delivery Services Summary portfolio (shipped v3.8.0).",
        md_path=ROOT / "docs/features/043-services-summary.md",
        feature_id="043",
    )
    manifest, plan043 = ensure_notebook(
        manifest,
        key="feature_043_implementation_plan",
        title="Feature 043 - Implementation plan (Services Summary)",
        desc="Services Summary implementation plan (shipped).",
        md_path=ROOT / "docs/features/043-services-summary-implementation-plan.md",
        feature_id="043",
    )
    t043_key = "Feature 043 - Services Summary"
    desc043 = f"""Release type: Enhancement
Feature id: 043
Product version: v3.8.0
Workflow stage: Spec Draft -> Shipped via catch-up

**Shipped scope:** Delivery Services Summary route: customer filter, KPIs, plan vs actual table (revenue + hours), mobile cards.

Feature notebook: {nb043}
Implementation plan: {plan043}
Git: docs/features/043-services-summary.md
PRD: FR-140, AC-101
Workflow: {how}
"""
    manifest, tid043, url043 = ensure_task(
        manifest,
        task_key=t043_key,
        tasklist_id=DELIVERY_TL,
        tasklist_name="Delivery",
        feature_id="043",
        release_type=RELEASE_TYPE_ENHANCEMENT,
        release_title="Services Summary",
        description=desc043,
        notebook_key="feature_043",
        plan_key="feature_043_implementation_plan",
    )
    update_task_description(tid043, desc043)
    inject_teamwork_links(
        ROOT / "docs/features/043-services-summary.md",
        (
            f"> **Teamwork notebook:** [Feature 043 - Services Summary]({nb043})  \n"
            f"> **Implementation plan notebook:** [Feature 043 - Implementation plan (Services Summary)]({plan043})  \n"
            f"> **Release task:** [{t043_key}]({url043})\n"
        ),
    )
    inject_teamwork_links(
        ROOT / "docs/features/043-services-summary-implementation-plan.md",
        (
            f"> **Teamwork notebook:** [Feature 043 - Implementation plan (Services Summary)]({plan043})  \n"
            f"> **Feature notebook:** [Feature 043 - Services Summary]({nb043})  \n"
            f"> **Release task:** [{t043_key}]({url043})\n"
        ),
    )
    sync_notebook(
        "feature_043",
        ROOT / "docs/features/043-services-summary.md",
        description="Delivery Services Summary portfolio (shipped v3.8.0).",
    )
    sync_notebook(
        "feature_043_implementation_plan",
        ROOT / "docs/features/043-services-summary-implementation-plan.md",
        description="Services Summary implementation plan (shipped).",
    )

    # ----- 3.8.1 Agreements ADMIN-only (feature 003 patch) -----
    manifest = load_manifest()
    t381_key = "Feature 003 - Agreements route ADMIN-only"
    desc381 = f"""Release type: Bug Fix
Feature id: 003
Product version: v3.8.1
Workflow stage: Spec Draft -> Shipped via catch-up

**Shipped scope:** Operations Agreements (`agreement-dashboard`) visible and API-gated to Role ADMIN only. Revenue review / Delivery / Services Summary unchanged.

Parent feature notebook: {manifest.get('notebooks', {}).get('feature_003', {}).get('url', '(003 notebook if present)')}
Git: docs/features/003-agreement-dashboard-fibery-client-cache.md
PRD: FR-141, AC-102
Workflow: {how}
"""
    manifest, tid381, url381 = ensure_task(
        manifest,
        task_key=t381_key,
        tasklist_id=AGREEMENT_TL,
        tasklist_name="Agreement",
        feature_id="003",
        release_type=RELEASE_TYPE_BUG_FIX,
        release_title="Agreements route ADMIN-only",
        description=desc381,
        notebook_key="feature_003" if "feature_003" in manifest.get("notebooks", {}) else None,
    )
    update_task_description(tid381, desc381)

    save_manifest(manifest)
    print("\n=== Catch-up prep complete. Next: ship rituals ===")
    print(f"037: {url037} -> ship --version 3.5.2")
    print(f"040: {url040} -> ship --version 3.6.0")
    print(f"043: {url043} -> ship --version 3.8.0")
    print(f"3.8.1: {url381} -> ship --version 3.8.1")


if __name__ == "__main__":
    main()
