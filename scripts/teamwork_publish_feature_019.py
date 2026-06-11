#!/usr/bin/env python3
"""Publish or sync Feature 019 notebook to Teamwork from docs/features/019-*.md."""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import PROJECT_ID, api, notebook_url  # noqa: E402
from teamwork_intake import (  # noqa: E402
    RELEASE_TYPE_ENHANCEMENT,
    create_release_task,
    link_inbox_task,
    set_task_custom_fields,
    task_url,
)
from teamwork_sync_notebook import (  # noqa: E402
    markdown_to_notebook_html,
    sync_notebook,
)

NOTEBOOK_KEY = "feature_019"
NOTEBOOK_TITLE = "Feature 019 - Resource allocation cost on P&L chart"
NOTEBOOK_DESC = (
    "Delivery P&L chart: planned labor cost from Fibery Resource Allocations vs actuals. "
    "Shipped v2.12.7. Intake from Inbox task 40146804."
)
FEATURE_MD = ROOT / "docs/features/019-resource-allocation-pnl-chart.md"
MANIFEST = ROOT / "docs" / "teamwork-manifest.json"
INBOX_TASK_ID = 40146804
TASKLIST_NAME = "Delivery"
RELEASE_TASK_NAME = "v2.12.7 - Resource allocation cost on P&L chart"
MOCKUP_RAW_URL = (
    "https://raw.githubusercontent.com/bernardw01/FOSDashboard/main/"
    "docs/implementation-notes/019-resource-allocation-pnl-mockup.png"
)

CHART_MOCKUP_SVG = """
<h4>Visualization mockup (chart layout)</h4>
<p>Target Chart view on the Delivery P&L card. <strong>Allocated cost (plan)</strong> is a dashed line;
actual labor remains stacked bars; revenue stays the solid teal line.</p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 340" width="100%" style="max-width:920px;background:#1a1f2e;border-radius:12px;border:1px solid #2d3748">
  <text x="24" y="32" fill="#e2e8f0" font-size="16" font-weight="600">Profit &amp; Loss chart (mockup)</text>
  <text x="24" y="52" fill="#a0aec0" font-size="11">RCI Phase 2 - sample months</text>
  <rect x="70" y="250" width="36" height="50" fill="rgba(67,214,186,0.75)" rx="2"/>
  <rect x="70" y="230" width="36" height="20" fill="rgba(160,174,192,0.75)" rx="2"/>
  <rect x="130" y="220" width="36" height="80" fill="rgba(67,214,186,0.75)" rx="2"/>
  <rect x="130" y="200" width="36" height="20" fill="rgba(160,174,192,0.75)" rx="2"/>
  <rect x="190" y="210" width="36" height="90" fill="rgba(67,214,186,0.75)" rx="2"/>
  <rect x="190" y="195" width="36" height="15" fill="rgba(160,174,192,0.75)" rx="2"/>
  <rect x="250" y="190" width="36" height="110" fill="rgba(67,214,186,0.55)" rx="2"/>
  <rect x="310" y="180" width="36" height="120" fill="rgba(67,214,186,0.55)" rx="2"/>
  <polyline points="88,200 148,185 208,170 268,155 328,140" fill="none" stroke="#43D6BA" stroke-width="3"/>
  <polyline points="88,175 148,168 208,162 268,158 328,155" fill="none" stroke="#9B8CFF" stroke-width="2.5" stroke-dasharray="8,6"/>
  <text x="350" y="132" fill="#43D6BA" font-size="11">Revenue</text>
  <text x="350" y="152" fill="#9B8CFF" font-size="11">Allocated cost (plan)</text>
  <text x="70" y="318" fill="#a0aec0" font-size="10">May</text>
  <text x="130" y="318" fill="#a0aec0" font-size="10">Jun</text>
  <text x="190" y="318" fill="#a0aec0" font-size="10">Jul</text>
  <text x="250" y="318" fill="#a0aec0" font-size="10">Aug</text>
  <text x="310" y="318" fill="#a0aec0" font-size="10">Sep</text>
  <text x="24" y="300" fill="#718096" font-size="10">Stacked bars = actual labor (by role) + expenses</text>
</svg>
<p><em>Reference image (when synced to git):</em>
<a href="{mockup_url}">019-resource-allocation-pnl-mockup.png</a></p>
"""


def build_notebook_html() -> str:
    md = FEATURE_MD.read_text(encoding="utf-8")
    mockup = CHART_MOCKUP_SVG.format(mockup_url=MOCKUP_RAW_URL)
    return markdown_to_notebook_html(md, inject_html=mockup, inject_before="Implementation checklist")


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


def main() -> None:
    if not FEATURE_MD.exists():
        raise SystemExit(f"Missing {FEATURE_MD}")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}

    if NOTEBOOK_KEY in manifest.get("notebooks", {}):
        sync_notebook(
            NOTEBOOK_KEY,
            FEATURE_MD,
            description=NOTEBOOK_DESC,
            inject_html=CHART_MOCKUP_SVG.format(mockup_url=MOCKUP_RAW_URL),
            inject_before="Implementation checklist",
        )
        return

    html = build_notebook_html()
    nb_id = create_notebook_html_direct(NOTEBOOK_TITLE, NOTEBOOK_DESC, html)
    nb_url = notebook_url(nb_id)
    manifest.setdefault("notebooks", {})[NOTEBOOK_KEY] = {
        "id": nb_id,
        "title": NOTEBOOK_TITLE,
        "url": nb_url,
        "featureId": "019",
        "intakeTaskId": INBOX_TASK_ID,
        "publishedAt": date.today().isoformat(),
    }
    print(f"Created notebook: {nb_url}")

    task_key = RELEASE_TASK_NAME
    if task_key not in manifest.get("tasks", {}):
        tl_id = manifest["tasklists"][TASKLIST_NAME]["id"]
        desc = (
            "Release type: enhancement\n"
            "Feature id: 019\n"
            "Intake: Inbox task 40146804 - Resource allocation hours view\n\n"
            "Scope: Add allocated cost (plan) trend line to Delivery P&L chart from "
            "Fibery Resource Allocations; empty-state note when none.\n\n"
            f"Notebook: {nb_url}\n"
            f"Workflow: {manifest['notebooks']['how_we_work']['url']}"
        )
        task_id = create_release_task(
            tl_id,
            RELEASE_TASK_NAME,
            desc,
            feature_id="019",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            manifest=manifest,
        )
        release_task_url = task_url(task_id)
        manifest.setdefault("tasks", {})[task_key] = {
            "id": task_id,
            "tasklist": TASKLIST_NAME,
            "featureId": "019",
            "releaseType": "Enhancement",
            "releaseTitle": "Resource allocation cost on P&L chart",
            "provisionalTaskName": False,
            "shippedVersion": "v2.12.7",
            "notebookKey": NOTEBOOK_KEY,
            "intakeTaskId": INBOX_TASK_ID,
            "url": release_task_url,
            "renameAtShip": "v{FOS_PRD_VERSION} - Resource allocation cost on P&L chart",
            "shippedAt": "2026-06-11",
        }
        print(f"Created release task: {release_task_url}")
        link_inbox_task(INBOX_TASK_ID, nb_url, release_task_url)
        print(f"Linked inbox task {INBOX_TASK_ID}")
    else:
        release_task_url = manifest["tasks"][task_key]["url"]
        task_id = int(manifest["tasks"][task_key]["id"])
        set_task_custom_fields(
            task_id,
            feature_id="019",
            release_type=RELEASE_TYPE_ENHANCEMENT,
            manifest=manifest,
        )
        link_inbox_task(INBOX_TASK_ID, nb_url, release_task_url)

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
