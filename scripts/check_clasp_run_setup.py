#!/usr/bin/env python3
"""Check prerequisites for `clasp run` / scripts/run_diagnostics.py (feature 057).

Usage:
    python scripts/check_clasp_run_setup.py

Exit codes:
    0  local config looks OK (still run `clasp run getDashboardNavigation` to confirm)
    1  one or more local prerequisites missing
    2  could not read repo config
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLASP_JSON = os.path.join(REPO_ROOT, '.clasp.json')
APPSCRIPT_JSON = os.path.join(REPO_ROOT, 'src', 'appsscript.json')

SETUP_STEPS = """
One-time clasp run setup (script owner only):

1. Apps Script editor: clasp open
   Project Settings -> copy the linked GCP **Project ID** (not project number).
   Add it to .clasp.json:
     { "scriptId": "...", "rootDir": "src", "projectId": "YOUR_GCP_PROJECT_ID" }

2. User setting: https://script.google.com/home/usersettings
   Turn ON "Google Apps Script API".

3. GCP console for that project:
   APIs & Services -> Library -> enable "Google Apps Script API".

4. Apps Script editor: Deploy -> New deployment -> type **API executable**
   Access: Only myself (matches executionApi.access MYSELF in appsscript.json).

5. OAuth desktop client (same GCP project):
   clasp open-credentials-setup
   Create credentials -> OAuth client ID -> Desktop app -> download JSON.

6. Login clasp with project scopes:
   clasp logout
   clasp login --creds client_secret.json --use-project-scopes --include-clasp-scopes

7. Push and smoke-test:
   clasp push --force
   clasp run getDashboardNavigation
   python scripts/run_diagnostics.py

Guide: https://github.com/google/clasp/blob/master/docs/run.md
"""


def main() -> int:
    problems = []

    if not os.path.exists(CLASP_JSON):
        problems.append('.clasp.json missing at repo root')
    else:
        with open(CLASP_JSON, encoding='utf-8') as handle:
            clasp = json.load(handle)
        if not clasp.get('scriptId'):
            problems.append('.clasp.json missing scriptId')
        if not clasp.get('projectId'):
            problems.append(
                '.clasp.json missing projectId (required for clasp run; see setup below)'
            )

    if not os.path.exists(APPSCRIPT_JSON):
        problems.append('src/appsscript.json missing')
    else:
        with open(APPSCRIPT_JSON, encoding='utf-8') as handle:
            manifest = json.load(handle)
        api = manifest.get('executionApi') or {}
        if api.get('access') != 'MYSELF':
            problems.append(
                'src/appsscript.json executionApi.access should stay MYSELF for this repo'
            )

    try:
        subprocess.run(
            ['clasp', '--version'],
            capture_output=True,
            text=True,
            timeout=30,
            shell=(os.name == 'nt'),
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        problems.append('clasp CLI not found on PATH')

    if problems:
        print('clasp run prerequisites: NOT READY', file=sys.stderr)
        for item in problems:
            print('  - ' + item, file=sys.stderr)
        print(SETUP_STEPS, file=sys.stderr)
        return 1

    print('clasp run prerequisites: local config OK')
    print('Next: clasp run getDashboardNavigation')
    print('Then: python scripts/run_diagnostics.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
