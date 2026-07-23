#!/usr/bin/env python3
"""Build / apply the FinOps Performance Hub Supabase (Postgres) schema.

Reads numbered SQL files from supabase/migrations/ in lexical order and either:

  - writes a combined SQL file (default),
  - prints the combined SQL to stdout (--print),
  - applies via psql when DATABASE_URL / --database-url is set (--apply).

Examples (from repo root):

  python scripts/supabase_build_schema.py
  python scripts/supabase_build_schema.py --print
  python scripts/supabase_build_schema.py --apply --database-url \"$DATABASE_URL\"
  python scripts/supabase_build_schema.py --list

Environment:

  DATABASE_URL   Postgres connection string (optional; used with --apply)
  SUPABASE_DB_URL  Alias for DATABASE_URL

See docs/supabase-data-model.md and README.md (Supabase database section).
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"
DEFAULT_OUT = ROOT / "supabase" / "build" / "schema_all.sql"


def load_env_file() -> None:
    """Load simple KEY=VALUE pairs from repo .env into os.environ (no overwrite)."""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, val = raw.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def list_migrations() -> list[Path]:
    if not MIGRATIONS_DIR.is_dir():
        raise SystemExit(f"Missing migrations directory: {MIGRATIONS_DIR}")
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise SystemExit(f"No *.sql files in {MIGRATIONS_DIR}")
    return files


def combine_sql(files: list[Path]) -> str:
    parts: list[str] = [
        "-- FinOps Performance Hub - combined Supabase schema",
        f"-- Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
        f"-- Source: {MIGRATIONS_DIR.as_posix()}",
        "-- Idempotent: migrations use IF NOT EXISTS where possible.",
        "",
    ]
    for path in files:
        parts.append(f"-- ========== BEGIN {path.name} ==========")
        body = path.read_text(encoding="utf-8").strip()
        parts.append(body)
        parts.append(f"-- ========== END {path.name} ==========")
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def resolve_database_url(explicit: str | None) -> str:
    url = (explicit or "").strip()
    if not url:
        url = (
            os.environ.get("DATABASE_URL", "").strip()
            or os.environ.get("SUPABASE_DB_URL", "").strip()
        )
    if not url:
        raise SystemExit(
            "DATABASE_URL (or SUPABASE_DB_URL / --database-url) is required for --apply.\n"
            "In Supabase Dashboard: Project Settings → Database → Connection string (URI).\n"
            "Prefer the direct connection (port 5432) or Session pooler for DDL."
        )
    return url


def apply_with_psql(sql_path: Path, database_url: str) -> None:
    try:
        proc = subprocess.run(
            [
                "psql",
                database_url,
                "-v",
                "ON_ERROR_STOP=1",
                "-f",
                str(sql_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise SystemExit(
            "psql was not found on PATH.\n"
            "Install PostgreSQL client tools, or paste the combined SQL into the\n"
            "Supabase SQL Editor (Dashboard → SQL → New query).\n"
            f"Combined file: {sql_path}"
        ) from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise SystemExit(f"psql failed (exit {proc.returncode}):\n{err}")
    if proc.stdout.strip():
        print(proc.stdout.rstrip())
    print(f"Applied schema via psql: {sql_path}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Build or apply FinOps Performance Hub Supabase schema migrations."
    )
    p.add_argument(
        "--list",
        action="store_true",
        help="List migration files in apply order and exit.",
    )
    p.add_argument(
        "--print",
        action="store_true",
        help="Print combined SQL to stdout instead of writing the build file.",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Combined SQL output path (default: {DEFAULT_OUT.relative_to(ROOT)}).",
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Apply combined SQL with psql using DATABASE_URL / --database-url.",
    )
    p.add_argument(
        "--database-url",
        default=None,
        help="Postgres URI (overrides DATABASE_URL / SUPABASE_DB_URL).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="With --apply, build SQL and print the psql command without executing.",
    )
    return p.parse_args()


def main() -> int:
    load_env_file()
    args = parse_args()
    files = list_migrations()

    if args.list:
        print(f"Migrations in {MIGRATIONS_DIR.relative_to(ROOT)} ({len(files)}):")
        for path in files:
            print(f"  {path.name}")
        return 0

    sql = combine_sql(files)

    if args.print:
        sys.stdout.write(sql)
        return 0

    out_path: Path = args.out
    if not out_path.is_absolute():
        out_path = ROOT / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(sql, encoding="utf-8")
    print(f"Wrote combined schema ({len(files)} migrations): {out_path}")

    if args.apply or args.dry_run:
        database_url = resolve_database_url(args.database_url)
        cmd_preview = f'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "{out_path}"'
        if args.dry_run:
            print("Dry run - would execute:")
            print(f"  {cmd_preview}")
            return 0
        apply_with_psql(out_path, database_url)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
