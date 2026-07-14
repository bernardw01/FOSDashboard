#!/usr/bin/env python3
"""Regenerates src/brandLogoAsset.js from src/assets/finops-performance-hub-icon-source.png.

Sidebar logo is rasterized to 128px wide for a reasonable HtmlService template payload.
Regenerate after replacing the source PNG, then clasp push.
"""

from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/assets/finops-performance-hub-icon-source.png"
OUT = ROOT / "src/brandLogoAsset.js"
DISPLAY_WIDTH = 128


def main() -> int:
    try:
        from PIL import Image
    except ImportError:
        print("Install Pillow: pip install pillow", file=sys.stderr)
        return 1

    if not SOURCE.is_file():
        print(f"Missing {SOURCE}", file=sys.stderr)
        return 1

    img = Image.open(SOURCE).convert("RGBA")
    w, h = img.size
    display_h = max(1, round(h * (DISPLAY_WIDTH / w)))
    img = img.resize((DISPLAY_WIDTH, display_h), Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    png_bytes = buf.getvalue()
    b64 = base64.b64encode(png_bytes).decode("ascii")
    data_url = f"data:image/png;base64,{b64}"

    js = """/**
 * PRD version 2.23.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * FinOps Performance Hub sidebar logo as a data URL (HtmlService template).
 * Source: src/assets/finops-performance-hub-icon-source.png (""" + str(DISPLAY_WIDTH) + """px display width)
 * Regenerate: python3 scripts/embed-brand-logo.py
 */

/** @const {string} */
var BRAND_LOGO_DATA_URL_ = '""" + data_url + """';

/**
 * @return {string}
 */
function getBrandLogoDataUrl_() {
  return BRAND_LOGO_DATA_URL_;
}
"""

    OUT.write_text(js, encoding="utf-8")
    print(f"Wrote {OUT} ({len(b64)} base64 chars, {DISPLAY_WIDTH}x{display_h} from {SOURCE.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
