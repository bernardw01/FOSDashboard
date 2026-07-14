# Web App static assets (`src/assets/`)

Binary and vector files here are **version-controlled sources** for the clasp project (`rootDir: src`). They are **not** served as HTTP URLs in the deployed Web App; HtmlService embeds them via server-side data URLs (see below).

| File | Used by | Regenerate embedded copy |
| --- | --- | --- |
| `finops-performance-hub-icon-source.png` | **FinOps Performance Hub** sidebar logo (`brandLogoAsset.js`) and favicon source | `python3 scripts/embed-brand-logo.py` → `src/brandLogoAsset.js`; rasterize 32px PNG for tab icon → `scripts/embed-favicon.ps1` or Pillow resize → `src/faviconAsset.js` |
| `favicon.svg` | Legacy design source (optional) | — |
| `favicon.png` | Browser tab icon (`setFaviconUrl` via Drive mirror in `faviconAsset.js`) | Resize from `finops-performance-hub-icon-source.png`, then `powershell -File scripts/embed-favicon.ps1` or update `FOS_FAVICON_PNG_BASE64_` in `faviconAsset.js` |
| `home-hero-deap.png` | Home hero (`#panel-home-root` → `.fos-home-hero`) | `powershell -File scripts/embed-home-hero.ps1` → updates `src/homeHeroImage.js` |

**Do not** hotlink external CDNs for these assets in production. Regenerate the matching `src/*Asset.js` / `homeHeroImage.js` file after any change to the source file, then `clasp push`.

**Notes**

- **Favicon:** Tab icon uses **`HtmlOutput.setFaviconUrl`** with a Drive mirror URL (`getFaviconUrlForWebApp_()`). Apps Script **ignores** `<link rel="icon">` in HTML files and **rejects** `data:` URLs for favicons.
- **Sidebar logo:** Bundled at 128px display width in `brandLogoAsset.js` to keep the HtmlService template payload reasonable.
- `home-hero-deap.png` may be JPEG bytes with a `.png` extension; the hero embed script sets MIME from file magic bytes.

Normative specs: `docs/features/001-dashboard-shell-navigation.md` (Home hero, favicon, shell branding).
