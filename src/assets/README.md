# Web App static assets (`src/assets/`)

Binary files here are **version-controlled sources** for the clasp project (`rootDir: src`). They are **not** served as HTTP URLs in the deployed Web App; HtmlService embeds them via server-side data URLs (see below).

| File | Used by | Regenerate embedded copy |
| --- | --- | --- |
| `home-hero-deap.png` | Home hero (`#panel-home-root` → `.fos-home-hero`) | `powershell -File scripts/embed-home-hero.ps1` → updates `src/homeHeroImage.js` |

**Do not** point the hero at external stock URLs or edit `homeHeroImage.js` by hand. `doGet` embeds the data URL into the hero `<img src>` via HtmlService template (`homeHeroImageUrl`). Regenerate after asset changes with the embed script above.

**Note:** The committed file may be JPEG content with a `.png` extension; the embed script sets `data:image/jpeg` or `data:image/png` from file magic bytes.

Normative spec: `docs/features/001-dashboard-shell-navigation.md` (Home hero).
