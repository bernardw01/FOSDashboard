# Harpin FOS Dashboard

**FOS** (Finance & Operations Snapshot) is a **Google Apps Script** web application that gives authorized Workspace users a single place to open **harpin AI Ops Dashboards**: a shell with navigation, spreadsheet-backed access control, and a first **Finance / Agreement Management** view aligned with the product baseline in [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md).

The app **reads and presents** data from configured sources (today: stub agreement payload; planned: Fibery, Sheets metric layers, and other connectors). It does **not** replace upstream systems of record (for example the Clockify → Fibery pipeline described in [`docs/PRD.md`](docs/PRD.md)).

---

## Current functionality

| Area | Behavior |
| --- | --- |
| **Web App entry** | `doGet` serves either **`DashboardShell.html`** (authorized) or **`NotAuthorized.html`** (not listed, misconfiguration, or missing email under the deployment identity). |
| **Authorization** | Active user’s email is matched against a **Google Sheet** tab (default name **`Users`**) in a spreadsheet whose ID is stored in **Script Properties**. **Role** and **Team** come from that row and appear in the sidebar user chip. |
| **Server API** | `getDashboardNavigation()` and `getAgreementDashboardData()` use **`requireAuthForApi_()`** so `google.script.run` cannot bypass the sheet gate. |
| **Shell UI** | Bootstrap **dark** layout: left nav (icons + labels), **Home** welcome copy, **Settings** (gear) at bottom of sidebar with a “coming soon” placeholder. |
| **Finance** | Opens the **Agreement Management Dashboard** panel: harpin branding tokens (see agreement PRD §9.5–9.7), header, six KPI cards (stub values until Fibery is wired), **Refresh**, **last refreshed**, and **`sessionStorage`** cache key `fos_agreement_dashboard_v1` (no secrets in cache). |
| **Other routes** | **Operations** and **Delivery** still open the shared **coming soon** modal. |
| **Version** | Sidebar footer and not-authorized page show **PRD version** from `FOS_PRD_VERSION` in [`src/Code.js`](src/Code.js) (must match the version line in `docs/FOS-Dashboard-PRD.md`). |

---

## Repository layout

| Path | Purpose |
| --- | --- |
| [`src/`](src/) | **Only** what **clasp** pushes to Apps Script (`.gs`, `.html`, `appsscript.json`). |
| [`docs/`](docs/) | PRDs and feature specs; **not** uploaded to the script project (see [`.claspignore`](.claspignore)). |
| [`.clasp.json`](.clasp.json) | Links this repo to a Google Apps Script project (`scriptId`) and sets **`rootDir`: `src`**. |

---

## Prerequisites

- **Google account** with access to the target Apps Script project and (for deploy) the auth spreadsheet.
- **[clasp](https://github.com/google/clasp)** (CLI for Apps Script). Install globally, for example: `npm install -g @google/clasp`.
- **Node.js** (for `npm` / `npx` if you prefer not to install clasp globally).

---

## Instantiate the project (local + Apps Script)

### 1. Clone and log in

```bash
git clone <your-git-remote-url> FOSDashboard
cd FOSDashboard
clasp login
```

### 2. Connect to an Apps Script project

**Option A — You already have this repo and a shared script:** ensure [`.clasp.json`](.clasp.json) contains the correct **`scriptId`** and that your Google user has **Editor** (or Owner) on that Apps Script project.

**Option B — New Apps Script project:** in [script.google.com](https://script.google.com), create a project → **Project settings** → copy **Script ID**. Set it in `.clasp.json`:

```json
{
  "scriptId": "YOUR_SCRIPT_ID_HERE",
  "rootDir": "src"
}
```

Then pull any remote files (optional, if the project is not empty):

```bash
clasp pull
```

Overwrite or merge with the contents of [`src/`](src/) from this repository as needed.

### 3. Push code from `src/`

```bash
clasp push
```

Only files under **`src/`** are pushed; `README.md`, `docs/`, `.git/`, etc. are excluded by [`.claspignore`](.claspignore).

### 4. Configure Script Properties

In the Apps Script editor: **Project settings** → **Script properties** (or **File → Project properties** in the older UI). Add at least:

| Property | Required | Description |
| --- | --- | --- |
| `AUTH_SPREADSHEET_ID` | **Yes** | Google Spreadsheet ID containing the authorized users tab. |
| `AUTH_USERS_SHEET_NAME` | No | Tab name (default **`Users`**). |
| `AUTH_COL_EMAIL` | No | Email column header (default **`Email`**). |
| `AUTH_COL_ROLE` | No | Role column header (default **`Role`**). |
| `AUTH_COL_TEAM` | No | Team column header (default **`Team`**). |

The **Users** sheet must have a **header row** with those columns; each authorized user is one row with a Workspace **email** that matches `Session.getActiveUser().getEmail()` when the Web App runs as **User accessing the web app**.

Fibery and other API tokens belong in Script Properties as well when those connectors are implemented; **never** commit them to git.

### 5. Deploy as a Web App

1. In Apps Script: **Deploy → New deployment** → type **Web app**.
2. **Execute as:** *User accessing the web app* (so authorization sees the viewer’s email).
3. **Who has access:** choose the audience your org requires (often *Anyone within \<domain\>* or a specific group).
4. Copy the **Web App URL** and open it while signed into an authorized Workspace account.

---

## Maintain the project in Apps Script

### Day-to-day workflow

1. Edit files under **`src/`** in your IDE (or pull doc-only changes from `docs/` for reference).
2. Run **`clasp push`** to upload `.gs` / `.html` / `appsscript.json` changes.
3. Re-test the **Web App** URL (or create a **Test deployment** first).
4. Keep **`FOS_PRD_VERSION`** in [`src/Code.js`](src/Code.js) and the **`PRD version`** line in each `src/*` file header in sync with [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md) whenever that document’s version changes (see [`.cursor/rules/google-apps-script-core.mdc`](.cursor/rules/google-apps-script-core.mdc) if you use Cursor rules).

### If someone edited code in the browser

```bash
clasp pull
```

Review diffs carefully: **`clasp pull`** overwrites local `src/` files with the server’s copy for matching filenames.

### Documentation and PRDs

Requirements and feature breakdowns live under **`docs/`**. They are **not** deployed with clasp; treat them as the source of truth for behavior and update them when you change product scope (for example [`docs/features/003-agreement-dashboard-fibery-client-cache.md`](docs/features/003-agreement-dashboard-fibery-client-cache.md) for the Finance route).

### Useful clasp commands

| Command | Use |
| --- | --- |
| `clasp open` | Open the script project in the browser. |
| `clasp deployments` | List deployments and versions. |
| `clasp version "message"` | Save a named version snapshot before deploying. |
| `clasp logs` | Stream Stackdriver-style logs (when logging is used). |

---

## Related documents

- [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md) — main product PRD for this Web App.
- [`docs/agreement-dashboard-prd-v2.md`](docs/agreement-dashboard-prd-v2.md) — agreement dashboard visuals, Fibery model, and thresholds (Finance view pulls from this where applicable).
- [`docs/PRD.md`](docs/PRD.md) — separate Clockify ↔ Fibery sync PRD (related data pipelines).
