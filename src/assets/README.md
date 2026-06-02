# Web App static assets (`src/assets/`)

Binary and vector files here are **version-controlled sources** for the clasp project (`rootDir: src`). They are **not** served as HTTP URLs in the deployed Web App; HtmlService embeds them via server-side data URLs (see below).

| File | Used by | Regenerate embedded copy |
| --- | --- | --- |
| `favicon.svg` | Design source for tab icon | — |
| `favicon.png` | Browser tab icon (`setFaviconUrl` via Drive mirror in `faviconAsset.js`) | `powershell -File scripts/embed-favicon.ps1` → updates `src/faviconAsset.js` (script rasterizes SVG→PNG if needed) |
| `home-hero-deap.png` | Home hero (`#panel-home-root` → `.fos-home-hero`) | `powershell -File scripts/embed-home-hero.ps1` → updates `src/homeHeroImage.js` |

**Do not** hotlink harpin.ai or other CDNs for these assets in production. Regenerate the matching `src/*Asset.js` / `homeHeroImage.js` file after any change to the source file, then `clasp push`.

**Notes**

- **Favicon:** Tab icon uses **`HtmlOutput.setFaviconUrl`** with a Drive mirror URL (`getFaviconUrlForWebApp_()`). Apps Script **ignores** `<link rel="icon">` in HTML files and **rejects** `data:` URLs for favicons. First page load mirrors bundled PNG to Drive (anyone-with-link). Rasterize with Node `npx @resvg/resvg-js-cli` when SVG changes.
- `home-hero-deap.png` may be JPEG bytes with a `.png` extension; the hero embed script sets MIME from file magic bytes.

Normative specs: `docs/features/001-dashboard-shell-navigation.md` (Home hero + favicon).
