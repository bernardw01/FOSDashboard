# Cursor Rules for Google Apps Script Apps

These rules guide AI-assisted development for Google Workspace apps built with Google Apps Script, Cursor, `clasp`, and TypeScript.

## Project Philosophy

Build Apps Script projects like real applications, not loose collections of `.gs` snippets.

The preferred workflow is:

```text
Prompt → Generate one module → Review → Build → clasp push → Test in Google Workspace → Fix errors → Commit
```

Avoid large, one-shot prompts that attempt to generate the entire app at once. Prefer small, testable slices.

## Preferred Stack

Use this stack unless the project explicitly requires otherwise:

```text
Google Apps Script
Cursor IDE
clasp
TypeScript
Git / GitHub
Google Sheets as lightweight storage when appropriate
HTML Service for UI
PropertiesService for configuration
Apps Script Triggers for automation
```

## Project Structure

Use a local project opened in Cursor.

Recommended structure:

```text
project-root/
  src/
    main.ts
    sheets.ts
    ui.ts
    services/
    utils/
  html/
    index.html
    sidebar.html
  appsscript.json
  package.json
  tsconfig.json
  .clasp.json
  .claspignore
  README.md
```

Keep business logic separate from UI and platform-specific entry points.

## File Responsibilities

### `main.ts`

Use for Apps Script entry points only, such as:

```ts
function doGet() {}
function onOpen() {}
function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit) {}
```

Do not place complex business logic here.

### `sheets.ts`

Use for Google Sheets read/write helpers.

Examples:

```ts
function getSheetByName(name: string): GoogleAppsScript.Spreadsheet.Sheet {}
function readRows(sheetName: string): unknown[] {}
function appendRow(sheetName: string, row: unknown[]): void {}
```

### `ui.ts`

Use for menu, sidebar, dialog, and HTML rendering helpers.

### `services/`

Use for domain-specific business logic.

Examples:

```text
leadService.ts
clientOnboardingService.ts
billingService.ts
notificationService.ts
```

### `utils/`

Use for reusable helpers such as validation, formatting, logging, date handling, and config access.

## TypeScript Rules

Use TypeScript for non-trivial Apps Script projects.

Install Apps Script types:

```bash
npm install --save-dev @types/google-apps-script typescript
```

Recommended `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES5",
    "module": "none",
    "outDir": "dist",
    "rootDir": "src",
    "types": ["google-apps-script"],
    "strict": true,
    "noImplicitAny": true
  }
}
```

Prefer explicit types for function inputs and outputs.

Avoid `any` unless interacting with loosely typed Apps Script events or API responses. When using `any`, add a short comment explaining why.

## Apps Script Runtime Rules

Apps Script has platform limitations. Code must account for them.

Follow these rules:

- Do not assume Node.js APIs are available.
- Do not use filesystem access.
- Do not use unsupported browser APIs in server-side `.ts` / `.gs` files.
- Avoid unnecessary external dependencies.
- Keep execution time limits in mind.
- Batch reads and writes to Google Sheets whenever possible.
- Minimize calls inside loops.

Bad:

```ts
rows.forEach((row, i) => {
  sheet.getRange(i + 1, 1).setValue(row.name);
});
```

Better:

```ts
sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
```

## `clasp` Workflow

Use `clasp` as the bridge between Cursor and Google Apps Script.

Common commands:

```bash
clasp login
clasp create --type standalone --title "My Apps Script App"
clasp pull
clasp push
clasp open
clasp version "Description of version"
clasp deploy
```

Use `clasp push` after compiling TypeScript.

Recommended scripts in `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "push": "npm run build && clasp push",
    "deploy": "npm run build && clasp push && clasp version \"Release\" && clasp deploy"
  }
}
```

## `.claspignore`

Do not push local development files to Apps Script.

Recommended `.claspignore`:

```text
node_modules
src
.git
.gitignore
README.md
package.json
package-lock.json
tsconfig.json
.cursor
.cursorignore
```

Adjust this if HTML files or compiled output live outside `dist`.

## Configuration Rules

Do not hardcode secrets, API keys, environment-specific IDs, or tokens.

Use `PropertiesService`:

```ts
function getConfigValue(key: string): string {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(`Missing required script property: ${key}`);
  }
  return value;
}
```

Use constants only for safe, non-secret values.

## Logging and Error Handling

Use Apps Script-compatible logging.

Acceptable:

```ts
Logger.log("Message");
console.log("Message");
console.error("Error message");
```

For user-facing apps, catch errors and return safe messages to the UI.

Example:

```ts
function safeGetLeads() {
  try {
    return { success: true, data: getLeads() };
  } catch (error) {
    console.error(error);
    return { success: false, error: "Unable to load leads." };
  }
}
```

Do not expose stack traces, secrets, raw API responses, or sensitive data to the frontend.

## HTML Service Rules

Use HTML Service for sidebars, dialogs, and web apps.

Server-side Apps Script functions can be called from client-side HTML using `google.script.run`.

Example:

```html
<script>
  google.script.run
    .withSuccessHandler(function(result) {
      console.log(result);
    })
    .withFailureHandler(function(error) {
      console.error(error);
    })
    .safeGetLeads();
</script>
```

Keep UI code simple unless a richer frontend is truly needed.

Avoid overbuilding Apps Script UIs into full SPA frameworks unless the project justifies it.

## Google Sheets Data Rules

When using Sheets as a lightweight database:

- Treat the first row as headers.
- Normalize rows into objects before business logic touches them.
- Validate required fields.
- Avoid relying on column order deep inside business logic.
- Centralize sheet names and column mappings.

Example:

```ts
const SHEETS = {
  leads: "Leads",
  clients: "Clients",
  logs: "Logs"
} as const;
```

Prefer this shape:

```ts
type Lead = {
  name: string;
  email: string;
  phone?: string;
  status: string;
};
```

## AI Prompting Rules in Cursor

Use Cursor to generate small, reviewable units.

Good prompts:

```text
Create a Google Apps Script function that reads rows from a sheet named "Leads", maps the header row to objects, validates required email and name fields, and returns typed Lead objects.
```

```text
Refactor this function to batch Google Sheets reads and writes. Avoid calling getRange inside loops.
```

```text
Create an HTML sidebar that calls safeGetLeads using google.script.run and renders loading, success, and error states.
```

```text
Add defensive error handling and Apps Script-compatible logging to this module.
```

Bad prompts:

```text
Build my whole Google Workspace app.
```

```text
Make this enterprise-grade.
```

```text
Add everything we might need later.
```

## Coding Style

Prefer clear, boring code.

Rules:

- Use descriptive function names.
- Keep functions small.
- Separate validation, data access, business logic, and UI.
- Prefer pure functions where possible.
- Avoid clever abstractions.
- Add comments only where they clarify intent or Apps Script-specific behavior.
- Prefer early returns over deeply nested conditionals.

## Security Rules

Apps Script apps often touch business data. Be careful by default.

Follow these rules:

- Do not log sensitive personal data.
- Do not expose secrets to HTML templates.
- Do not store API keys in source code.
- Validate user inputs from sidebars, dialogs, web apps, and forms.
- Confirm permissions before sending emails, creating calendar events, or modifying data.
- Use least-privilege OAuth scopes where practical.

## Deployment Rules

Choose the deployment model early.

### Web App

Use when the app should be accessed by URL.

Requires:

```ts
function doGet() {
  return HtmlService.createHtmlOutputFromFile("index");
}
```

### Sheets / Docs / Slides Sidebar

Use when the app enhances a specific Workspace file.

Usually requires:

```ts
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Custom App")
    .addItem("Open Sidebar", "showSidebar")
    .addToUi();
}
```

### Automation Script

Use triggers for scheduled or event-driven automation.

Examples:

- Time-based trigger
- Form submit trigger
- Sheet edit trigger
- Calendar event trigger

## Testing Rules

Apps Script testing is awkward, so design for testability.

Rules:

- Keep pure logic separate from Apps Script services.
- Test data transformation functions locally where possible.
- Use small manual test functions for Apps Script integrations.
- Prefix manual test functions with `test_`.

Example:

```ts
function test_getLeads() {
  const leads = getLeads();
  Logger.log(JSON.stringify(leads, null, 2));
}
```

Do not leave destructive test functions available without safeguards.

## Performance Rules

Apps Script quotas and execution limits matter.

Always prefer:

- Batch reads
- Batch writes
- Caching repeated lookups
- PropertiesService for config
- CacheService for short-lived cached data
- LockService for concurrency-sensitive writes

Use `LockService` when multiple users or triggers may write to the same sheet.

Example:

```ts
const lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
  // critical write operation
} finally {
  lock.releaseLock();
}
```

## Common App Patterns

### Internal CRM / Lead Tracker

Use:

```text
Sheets for data
Sidebar for UI
Triggers for reminders
GmailApp or MailApp for notifications
PropertiesService for config
```

### Client Onboarding App

Use:

```text
Google Form or sidebar input
Sheets for intake records
Drive folders for client assets
Gmail templates for automated emails
Calendar events for kickoff scheduling
```

### Reporting Dashboard

Use:

```text
Sheets as source data
Apps Script for refresh logic
HTML Service for dashboard UI
Time-based triggers for scheduled updates
```

### API Bridge

Use:

```text
UrlFetchApp for external APIs
PropertiesService for credentials
Triggers for sync jobs
Sheets for audit logs
```

## Review Checklist Before Push

Before running `clasp push`, verify:

```text
[ ] TypeScript compiles
[ ] No secrets are hardcoded
[ ] Sheet reads/writes are batched
[ ] User-facing errors are safe
[ ] Logs do not expose sensitive data
[ ] Entry points are in main.ts
[ ] Business logic is separated into services
[ ] appsscript.json scopes are appropriate
[ ] README explains setup and deployment
```

## Review Checklist Before Deployment

Before production deployment, verify:

```text
[ ] Script properties are configured
[ ] OAuth scopes are reviewed
[ ] Deployment access is correct
[ ] Test data is removed or isolated
[ ] Manual test functions are safe
[ ] Trigger behavior is understood
[ ] Rollback version exists
[ ] Key user flows have been manually tested
```

## Default Instruction for Cursor AI

When generating or modifying code in this project, follow these rules:

```text
You are helping build a Google Apps Script application using Cursor, clasp, and TypeScript.

Generate small, testable changes.
Prefer Apps Script-compatible APIs.
Do not assume Node.js runtime features.
Keep business logic separate from Apps Script entry points.
Batch Google Sheets reads and writes.
Use PropertiesService for configuration and secrets.
Use HTML Service and google.script.run for UI interactions.
Return safe error messages to the frontend.
Avoid hardcoded secrets, unnecessary dependencies, and overengineered abstractions.
Explain any Apps Script platform constraints that affect the implementation.
```

