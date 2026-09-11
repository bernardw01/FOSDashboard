#!/usr/bin/env python3
"""Run the standing FOS diagnostic suite via clasp (Apps Script Execution API).

Feature 057. Dev-time only: invokes `runFullDiagnosticsSuite` on the
deployed Apps Script project via clasp run. Does not touch the Web App UI.

Usage:
    python scripts/run_diagnostics.py
    python scripts/run_diagnostics.py --heavy
    python scripts/run_diagnostics.py --json
    python scripts/run_diagnostics.py --check-setup
    python scripts/run_diagnostics.py --help

Run after `clasp push` as a post-deploy smoke gate. Requires one-time clasp run
setup (see `python scripts/check_clasp_run_setup.py`).

Exit codes:
    0  every executed step passed (and no registry error)
    1  clasp run succeeded but one or more steps failed (or suite incomplete)
    2  could not invoke clasp run (tooling/auth/deploy), not a product regression
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLASP_JSON = os.path.join(REPO_ROOT, '.clasp.json')
SUITE_FUNCTION = 'runFullDiagnosticsSuite'
QUERY_HINT = (
    "select run_id, kind, label, passed, captured_at "
    "from fos_perf_runs where kind = 'diag-suite' "
    "order by captured_at desc limit 5;"
)


def print_clasp_setup_help() -> None:
    print(
        '\nclasp run is not configured on this machine yet.\n'
        'Run:  python scripts/check_clasp_run_setup.py\n'
        'That prints the one-time setup checklist (GCP projectId, API executable\n'
        'deployment, OAuth desktop client, clasp login --creds ...).\n'
        '\nUntil clasp run works, run the suite from the Apps Script editor:\n'
        '  runDiagnosticSuiteManual_()\n'
        '(Or runFullDiagnosticsSuite with includeHeavy=false if your editor supports arguments.)\n'
        'Results still persist to fos_perf_runs (kind = diag-suite).\n',
        file=sys.stderr,
    )


def local_clasp_prereq_issues() -> list[str]:
    issues = []
    if not os.path.exists(CLASP_JSON):
        issues.append('.clasp.json missing')
        return issues
    try:
        with open(CLASP_JSON, encoding='utf-8') as handle:
            clasp = json.load(handle)
    except (OSError, json.JSONDecodeError):
        issues.append('.clasp.json unreadable')
        return issues
    if not clasp.get('projectId'):
        issues.append('.clasp.json missing projectId')
    return issues


def fail_clasp(message: str, detail: str | None = None) -> int:
    print('CLASP RUN FAILED (not a suite regression): ' + message, file=sys.stderr)
    if detail:
        print(detail.strip(), file=sys.stderr)
    for item in local_clasp_prereq_issues():
        print('  config: ' + item, file=sys.stderr)
    print_clasp_setup_help()
    return 2


def clasp_output_indicates_failure(stdout: str, stderr: str) -> str | None:
    combined = ((stdout or '') + '\n' + (stderr or '')).strip()
    needles = (
        'Unable to run script function',
        'Script function not found',
        'Execution API access denied',
        'Insufficient Permission',
        'invalid_grant',
        'invalid_rapt',
        'User has not enabled the Apps Script API',
    )
    lower = combined.lower()
    for needle in needles:
        if needle.lower() in lower:
            return combined
    return None


def run_clasp_suite(include_heavy: bool) -> tuple[int, str, str]:
    params = json.dumps([include_heavy])
    cmd = ['clasp', 'run', SUITE_FUNCTION, '--params', params]
    try:
        result = subprocess.run(
            cmd,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=600,
            shell=(os.name == 'nt'),
        )
    except FileNotFoundError:
        return fail_clasp('clasp is not installed or not on PATH.'), '', ''
    except subprocess.TimeoutExpired:
        return fail_clasp('clasp run timed out after 600s.'), '', ''
    stdout = result.stdout or ''
    stderr = result.stderr or ''
    clasp_err = clasp_output_indicates_failure(stdout, stderr)
    if clasp_err:
        return (
            fail_clasp(
                'Apps Script Execution API rejected the run (not a suite regression).',
                clasp_err,
            ),
            stdout,
            stderr,
        )
    combined = stdout + '\n' + stderr
    if result.returncode != 0:
        return (
            fail_clasp(
                'clasp exited with code %d.' % result.returncode,
                combined.strip(),
            ),
            stdout,
            stderr,
        )
    return 0, stdout, stderr


def _try_parse_json(text: str):
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def parse_clasp_suite_result(stdout: str, stderr: str):
    """Return parsed suite summary dict or None."""
    chunks = []
    for block in (stdout, stderr):
        if block:
            chunks.append(block.strip())

    for blob in chunks:
        direct = _try_parse_json(blob)
        if isinstance(direct, dict) and ('steps' in direct or 'pass' in direct):
            return direct
        if isinstance(direct, str):
            nested = _try_parse_json(direct)
            if isinstance(nested, dict):
                return nested

    combined = '\n'.join(chunks)
    for line in reversed(combined.splitlines()):
        line = line.strip()
        if not line.startswith('{'):
            continue
        parsed = _try_parse_json(line)
        if isinstance(parsed, dict) and ('steps' in parsed or 'pass' in parsed):
            return parsed

    match = re.search(r'(\{[\s\S]*"steps"[\s\S]*\})\s*$', combined)
    if match:
        parsed = _try_parse_json(match.group(1))
        if isinstance(parsed, dict):
            return parsed

    match = re.search(
        r'===== FULL DIAGNOSTICS SUITE =====\s*\n(\{[\s\S]*\})',
        combined,
    )
    if match:
        parsed = _try_parse_json(match.group(1))
        if isinstance(parsed, dict):
            return parsed

    return None


def step_error_message(step: dict) -> str:
    if step.get('error'):
        return str(step['error'])
    result = step.get('result') or {}
    if isinstance(result, dict):
        for key in ('message', 'registryError', 'persistWarning'):
            if result.get(key):
                return str(result[key])
    return ''


def print_human_summary(summary: dict, include_heavy: bool) -> int:
    if summary.get('registryError'):
        print('REGISTRY ERROR: ' + str(summary.get('message', 'unknown')))
        return 1

    overall_pass = summary.get('pass') is True
    complete = summary.get('complete') is True
    steps = summary.get('steps') or []
    skipped = summary.get('skipped') or []

    mode = 'heavy' if include_heavy else 'non-heavy'
    print('FOS diagnostic suite (%s)' % mode)
    print('  overall: %s' % ('PASS' if overall_pass and complete else 'FAIL'))
    if summary.get('runId'):
        print('  runId:   %s' % summary['runId'])
    if summary.get('prdVersion'):
        print('  PRD:     %s' % summary['prdVersion'])
    if not complete:
        print('  note:    incomplete (%d step(s) skipped)' % len(skipped))
    print('')
    print('%-36s  %-6s  %6s  %s' % ('id', 'result', 'ms', 'label'))
    print('-' * 96)

    exit_code = 0
    for step in steps:
        passed = step.get('pass') is True
        if not passed:
            exit_code = 1
        status = 'PASS' if passed else 'FAIL'
        err = step_error_message(step)
        line = '%-36s  %-6s  %6s  %s' % (
            step.get('id', '?'),
            status,
            step.get('ms', 0),
            step.get('label', ''),
        )
        print(line)
        if err and not passed:
            print('    -> %s' % err)

    for skip in skipped:
        print('%-36s  SKIP          %s' % (skip.get('id', '?'), skip.get('reason', '')))

    if exit_code == 0 and not complete:
        exit_code = 1

    print('')
    print('History query:')
    print('  ' + (summary.get('queryHint') or QUERY_HINT))
    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Run FOS standing diagnostic suite via clasp run (feature 057).',
    )
    parser.add_argument(
        '--heavy',
        action='store_true',
        help='Include heavy steps (e.g. hydrate-dataset-timings).',
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help='Print raw suite JSON instead of the human-readable summary.',
    )
    parser.add_argument(
        '--check-setup',
        action='store_true',
        help='Run local clasp run prerequisite checks and exit.',
    )
    args = parser.parse_args()

    if args.check_setup:
        check_script = os.path.join(REPO_ROOT, 'scripts', 'check_clasp_run_setup.py')
        return subprocess.call([sys.executable, check_script], cwd=REPO_ROOT)

    prereq = local_clasp_prereq_issues()
    if prereq:
        return fail_clasp(
            'Local clasp run prerequisites missing.',
            '; '.join(prereq),
        )

    clasp_code, stdout, stderr = run_clasp_suite(args.heavy)
    if clasp_code != 0:
        return clasp_code

    summary = parse_clasp_suite_result(stdout, stderr)
    if summary is None:
        return fail_clasp(
            'Could not parse suite JSON from clasp output.',
            (stdout + '\n' + stderr).strip() or '(empty output)',
        )

    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
        if summary.get('registryError') or summary.get('pass') is not True:
            return 1
        if summary.get('complete') is not True:
            return 1
        return 0

    return print_human_summary(summary, args.heavy)


if __name__ == '__main__':
    sys.exit(main())
