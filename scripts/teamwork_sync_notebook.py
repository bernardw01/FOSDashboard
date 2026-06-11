#!/usr/bin/env python3
"""Push git feature spec markdown to an existing Teamwork notebook (PUT content)."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from teamwork_bootstrap import api, md_to_html, notebook_url  # noqa: E402

MANIFEST = ROOT / "docs" / "teamwork-manifest.json"


def absolutize_feature_links(md: str) -> str:
    def repl(match: re.Match[str]) -> str:
        label, path = match.group(1), match.group(2)
        if path.startswith("http"):
            return match.group(0)
        name = path.split("/")[-1]
        if name.endswith(".md"):
            return (
                f"[{label}](https://github.com/bernardw01/FOSDashboard/blob/main/"
                f"docs/features/{name})"
            )
        if path.startswith("../features/"):
            return (
                f"[{label}](https://github.com/bernardw01/FOSDashboard/blob/main/"
                f"docs/features/{name})"
            )
        return match.group(0)

    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", repl, md)


def inject_before_heading(html: str, heading: str, fragment: str) -> str:
    token = f"<h3>{heading}</h3>"
    if token in html:
        return html.replace(token, fragment + "\n" + token, 1)
    return html + "\n" + fragment


def markdown_to_notebook_html(
    md: str,
    *,
    inject_html: str = "",
    inject_before: str | None = None,
) -> str:
    html = md_to_html(absolutize_feature_links(md))
    if inject_html:
        if inject_before:
            html = inject_before_heading(html, inject_before, inject_html)
        else:
            html += "\n" + inject_html
    return html


def update_notebook(
    notebook_id: int,
    *,
    content: str,
    description: str | None = None,
) -> None:
    body: dict = {"notebook": {"content": content}}
    if description is not None:
        body["notebook"]["description"] = description
    api("PUT", f"/notebooks/{notebook_id}.json", body)


def load_manifest() -> dict:
    if not MANIFEST.exists():
        raise SystemExit(f"Missing {MANIFEST}")
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def save_manifest(manifest: dict) -> None:
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def sync_notebook(
    notebook_key: str,
    md_path: Path,
    *,
    description: str | None = None,
    inject_html: str = "",
    inject_before: str | None = None,
    dry_run: bool = False,
) -> int:
    if not md_path.exists():
        raise SystemExit(f"Missing markdown: {md_path}")

    manifest = load_manifest()
    nb_entry = manifest.get("notebooks", {}).get(notebook_key)
    if not nb_entry:
        raise SystemExit(f"Notebook key not in manifest: {notebook_key!r}")

    nb_id = int(nb_entry["id"])
    md = md_path.read_text(encoding="utf-8")
    html = markdown_to_notebook_html(
        md, inject_html=inject_html, inject_before=inject_before
    )

    if dry_run:
        print(f"DRY RUN - would PUT /notebooks/{nb_id}.json ({len(html)} chars)")
        return nb_id

    update_notebook(nb_id, content=html, description=description)
    nb_entry["lastSyncedAt"] = date.today().isoformat()
    save_manifest(manifest)

    url = nb_entry.get("url") or notebook_url(nb_id)
    print(f"Synced notebook {notebook_key} ({nb_id}): {url}")
    return nb_id


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync docs/features/*.md HTML into a Teamwork notebook."
    )
    parser.add_argument(
        "--notebook-key",
        required=True,
        help="Manifest notebooks{} key (e.g. feature_019).",
    )
    parser.add_argument(
        "--md",
        type=Path,
        help="Feature markdown path (default: inferred from notebook key).",
    )
    parser.add_argument(
        "--description",
        help="Optional notebook description override.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build HTML only; do not call Teamwork API.",
    )
    return parser.parse_args()


def default_md_for_key(notebook_key: str) -> Path:
    feature_id = notebook_key.replace("feature_", "")
    matches = sorted(ROOT.glob(f"docs/features/{feature_id}-*.md"))
    if not matches:
        raise SystemExit(f"No docs/features/{feature_id}-*.md found for {notebook_key}")
    return matches[0]


def main() -> None:
    args = parse_args()
    md_path = args.md or default_md_for_key(args.notebook_key)
    sync_notebook(
        args.notebook_key,
        md_path.resolve(),
        description=args.description,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
