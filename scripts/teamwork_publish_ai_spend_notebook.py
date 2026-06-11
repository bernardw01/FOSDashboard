#!/usr/bin/env python3
"""Publish AI spend impact measurement guide to Teamwork notebooks."""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import (  # noqa: E402
    PROJECT_ID,
    BASE,
    api,
    create_notebook,
    md_to_html,
    notebook_url,
)

NOTEBOOK_KEY = "ai_spend_impact"
NOTEBOOK_TITLE = "AI spend impact - measurement guide"
NOTEBOOK_DESC = (
    "Research and recommendations for measuring whether AI spend delivers business value. "
    "Related to Feature 017 (AI usage sync)."
)
SOURCE_MD = ROOT / "docs" / "ai-spend-impact-measurement.md"
HTML_OUT = ROOT / "scripts" / "teamwork_notebook_ai_spend_impact.html"
MANIFEST = ROOT / "docs" / "teamwork-manifest.json"
GITHUB_BASE = "https://github.com/bernardw01/FOSDashboard/blob/main/docs"


def absolutize_markdown_links(text: str, manifest: dict) -> str:
    """Rewrite relative doc links to GitHub or Teamwork URLs."""
    feature_017_url = manifest.get("notebooks", {}).get("feature_017", {}).get("url", "")

    def repl(match: re.Match[str]) -> str:
        label, path = match.group(1), match.group(2)
        if path.startswith("http"):
            return match.group(0)
        if path == "features/017-ai-platform-usage-fibery-sync.md" and feature_017_url:
            return f"[{label}]({feature_017_url})"
        if path.endswith(".ipynb"):
            return f"[{label}]({GITHUB_BASE}/ai-spend-impact-measurement.md)"
        if path.startswith("features/"):
            return f"[{label}]({GITHUB_BASE}/{path})"
        if path.startswith("docs/"):
            return f"[{label}](https://github.com/bernardw01/FOSDashboard/blob/main/{path})"
        return match.group(0)

    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", repl, text)


def teamwork_md(manifest: dict) -> str:
    """Adapt git markdown for Teamwork with absolute reference links."""
    text = absolutize_markdown_links(SOURCE_MD.read_text(encoding="utf-8"), manifest)

    feature_017_url = manifest.get("notebooks", {}).get("feature_017", {}).get("url", "")

    # Enrich inline Sources lines that omit links present in References section
    text = text.replace(
        "Sources: [Larridin - Strategic AI Productivity Measurement Framework (PDF)]",
        "Sources: [Larridin - AI ROI measurement framework](https://larridin.com/blog/ai-roi-measurement), "
        "[Larridin - Strategic AI Productivity Measurement Framework (PDF)]",
    )
    text = text.replace(
        "Sources: [TBM Council - CFO framework for technology value]",
        "Sources: [TBM Council - CFO framework for technology value]"
        "(https://www.tbmcouncil.org/the-cfos-framework-for-technology-value/), "
        "[Iternal - AI cost allocation](https://iternal.ai/ai-cost-allocation)",
    )
    text = text.replace(
        "Sources: [Grant Thornton - 2026 AI Impact Survey (services)](https://www.grantthornton.com/insights/survey-reports/services/2026/services-insights-2026-ai-impact-survey), [Crossing - AI ROI for professional services firms](https://crossing.one/archive/ai-roi-professional-services-firms-2026)",
        "Sources: [Grant Thornton - 2026 AI Impact Survey (services)](https://www.grantthornton.com/insights/survey-reports/services/2026/services-insights-2026-ai-impact-survey), "
        "[Crossing - AI ROI for professional services firms](https://crossing.one/archive/ai-roi-professional-services-firms-2026), "
        "[Value Add VC - Enterprise AI ROI frameworks (2026)](https://valueaddvc.com/blog/how-enterprises-are-calculating-ai-roi-in-2026-the-frameworks-cfos-are-actually-using)",
    )

    header = f"""# {NOTEBOOK_TITLE}

> **Purpose:** Research summary for leadership reviewing whether AI investment is delivering positive business impact.
> **Audience:** Finance, delivery leadership, and operators building AI cost visibility.
> **Date:** 2026-06-09
> **Related:** [Feature 017 - AI platform usage sync]({feature_017_url or GITHUB_BASE + '/features/017-ai-platform-usage-fibery-sync.md'})
> **Git archive:** [{GITHUB_BASE}/ai-spend-impact-measurement.md]({GITHUB_BASE}/ai-spend-impact-measurement.md)

---

"""

    # Drop duplicate title block from source (first 8 lines)
    body = re.sub(
        r"^# Measuring AI Spend Impact:.*?\n\n---\n\n",
        "",
        text,
        count=1,
        flags=re.DOTALL,
    )
    return header + body


def verify_reference_links(md: str) -> list[str]:
    """Return markdown link targets for a quick audit."""
    return re.findall(r"\[([^\]]+)\]\(([^)]+)\)", md)


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}

    md = teamwork_md(manifest)
    links = verify_reference_links(md)
    external = [url for _, url in links if url.startswith("http")]
    print(f"Prepared markdown with {len(links)} links ({len(external)} external URLs)")

    html = md_to_html(md)
    HTML_OUT.write_text(html + "\n", encoding="utf-8")
    print(f"Wrote {HTML_OUT}")

    if NOTEBOOK_KEY in manifest.get("notebooks", {}):
        nb = manifest["notebooks"][NOTEBOOK_KEY]
        print(f"Notebook already exists: {nb['url']}")
        print("To update content in Teamwork, use the Teamwork UI or add PUT support to this script.")
        return

    nb_id = create_notebook(NOTEBOOK_TITLE, NOTEBOOK_DESC, md)
    url = notebook_url(nb_id)
    manifest.setdefault("notebooks", {})[NOTEBOOK_KEY] = {
        "id": nb_id,
        "title": NOTEBOOK_TITLE,
        "url": url,
        "relatedFeatureId": "017",
        "publishedAt": date.today().isoformat(),
        "gitMirror": "docs/ai-spend-impact-measurement.md",
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Created Teamwork notebook: {url}")
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
