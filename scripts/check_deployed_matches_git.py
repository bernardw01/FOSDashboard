#!/usr/bin/env python3
"""Verify the deployed Apps Script project matches `src/` in git.

Feature 047 workstream A2. On 2026-08-24 the nightly hydrate was found writing
`resource-assignments` at cache_schema_version 2 while git had said 3 since
2026-08-15. The deployed project, not the database, was the stale thing: four
"Ship PRD" commits (3.7.4, 3.7.5, 3.7.6, 3.8.2) had been committed but never
pushed. Every panel kept working because the running script was internally
consistent, so nothing surfaced it for nine days.

No runtime check can catch this. The script only knows its own constants and
cannot see git. This comparison has to happen outside Apps Script, which is
what this does: pull the deployed files into a temp directory and diff them
against `src/`.

The working tree is not the same thing as a commit. Comparing only against
`src/` on disk passes while the deployed code exists in no commit, which is the
mirror of the original defect: commit-without-push becomes push-without-commit,
and the deployed artifact is again unreproducible from history. Found in exactly
that state on 2026-08-24 right after shipping 3.9.4. So this also reports when
tracked files under `src/` are dirty relative to HEAD.

Usage:
    python3 scripts/check_deployed_matches_git.py
    python3 scripts/check_deployed_matches_git.py --quiet
    python3 scripts/check_deployed_matches_git.py --allow-dirty

Exit codes:
    0  deployed matches src/, and src/ is committed
    1  deployed differs from src/ (push needed), or src/ is dirty (commit needed)
    2  could not run the check (clasp missing, not logged in, etc.)
"""

import argparse
import filecmp
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO_ROOT, 'src')
CLASP_JSON = os.path.join(REPO_ROOT, '.clasp.json')

# clasp pull rewrites this from the remote manifest; it is not a source file.
IGNORED = {'appsscript.json'}


def fail(message):
    print('ERROR: ' + message, file=sys.stderr)
    sys.exit(2)


def read_script_id():
    if not os.path.exists(CLASP_JSON):
        fail('.clasp.json not found at ' + CLASP_JSON)
    with open(CLASP_JSON, encoding='utf-8') as handle:
        return json.load(handle).get('scriptId')


def pull_deployed(script_id, dest):
    """Pull the deployed project into `dest`. Returns nothing, exits on failure."""
    with open(os.path.join(dest, '.clasp.json'), 'w', encoding='utf-8') as handle:
        json.dump({'scriptId': script_id, 'rootDir': '.'}, handle)
    try:
        result = subprocess.run(
            ['clasp', 'pull'],
            cwd=dest,
            capture_output=True,
            text=True,
            timeout=180,
            shell=(os.name == 'nt'),
        )
    except FileNotFoundError:
        fail('clasp is not installed or not on PATH.')
    except subprocess.TimeoutExpired:
        fail('clasp pull timed out after 180s.')
    if result.returncode != 0:
        fail('clasp pull failed:\n' + (result.stderr or result.stdout or '').strip())


def compare(deployed_dir):
    """Return (only_local, only_deployed, differing) file name lists."""
    local = {
        name
        for name in os.listdir(SRC_DIR)
        if os.path.isfile(os.path.join(SRC_DIR, name)) and name not in IGNORED
    }
    deployed = {
        name
        for name in os.listdir(deployed_dir)
        if os.path.isfile(os.path.join(deployed_dir, name))
        and not name.startswith('.')
        and name not in IGNORED
    }
    differing = sorted(
        name
        for name in (local & deployed)
        if not filecmp.cmp(
            os.path.join(SRC_DIR, name), os.path.join(deployed_dir, name), shallow=False
        )
    )
    return sorted(local - deployed), sorted(deployed - local), differing


def dirty_src_files():
    """Tracked files under src/ that differ from HEAD, plus untracked ones."""
    try:
        result = subprocess.run(
            ['git', 'status', '--porcelain', '--', 'src'],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        # Not fatal: the deployed-vs-src check is still worth running without git.
        return None
    if result.returncode != 0:
        return None
    names = []
    for line in result.stdout.splitlines():
        if len(line) > 3:
            names.append(line[3:].strip().strip('"'))
    return sorted(names)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--quiet', action='store_true', help='Print nothing when deployed matches src/.'
    )
    parser.add_argument(
        '--allow-dirty',
        action='store_true',
        help='Skip the check that src/ is committed. For mid-work pushes only.',
    )
    args = parser.parse_args()

    script_id = read_script_id()
    if not script_id:
        fail('.clasp.json has no scriptId.')

    temp_dir = tempfile.mkdtemp(prefix='fos-deployed-')
    try:
        pull_deployed(script_id, temp_dir)
        only_local, only_deployed, differing = compare(temp_dir)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    if not (only_local or only_deployed or differing):
        dirty = None if args.allow_dirty else dirty_src_files()
        if dirty:
            print(
                'Deployed Apps Script matches src/, but src/ is NOT committed.\n'
                'The deployed code exists in no commit, so it cannot be reproduced\n'
                'from history. Commit before calling this shipped.\n'
            )
            print('  uncommitted under src/ (%d):' % len(dirty))
            for name in dirty:
                print('    - ' + name)
            return 1
        if not args.quiet:
            suffix = '' if dirty is not None else ' (git state not checked)'
            print('OK: deployed Apps Script matches src/, and src/ is committed' + suffix + '.')
        return 0

    print('Deployed Apps Script does NOT match src/. Run `clasp push`.\n')
    for label, names in (
        ('in src/ but not deployed', only_local),
        ('deployed but not in src/', only_deployed),
        ('content differs', differing),
    ):
        if names:
            print('  %s (%d):' % (label, len(names)))
            for name in names:
                print('    - ' + name)
    return 1


if __name__ == '__main__':
    sys.exit(main())
