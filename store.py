"""Where accounts and conversations are kept.

With DATABASE_URL set (any Postgres, e.g. a free Neon database), each document
(users, conversations) is one JSON row in a `vedicyog_kv` table, so it survives
redeploys and restarts. Without it, documents are JSON files in DATA_DIR, which is
fine locally but wiped on every deploy on Render's free plan.

Documents are cached in memory and written through on every save, which assumes a
single server process (Render's default WEB_CONCURRENCY=1).
"""

import copy
import json
import os
import threading
from pathlib import Path

_lock = threading.RLock()
_cache: dict[str, object] = {}
_conn = None


def _database_url() -> str | None:
    return os.getenv("DATABASE_URL") or None


def _data_dir() -> Path:
    return Path(os.getenv("DATA_DIR", Path(__file__).parent / "data"))


def _db():
    """A live connection, reconnecting if the database dropped it (Neon idles out)."""
    global _conn
    import psycopg  # only needed with DATABASE_URL

    if _conn is None or _conn.closed:
        _conn = psycopg.connect(_database_url(), autocommit=True, connect_timeout=15)
        _conn.execute("CREATE TABLE IF NOT EXISTS vedicyog_kv "
                      "(key text PRIMARY KEY, value jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())")
    return _conn


def _db_call(fn):
    try:
        return fn(_db())
    except Exception:
        global _conn
        _conn = None  # stale connection: retry once on a fresh one
        return fn(_db())


def _read(key: str):
    if _database_url():
        row = _db_call(lambda c: c.execute("SELECT value FROM vedicyog_kv WHERE key = %s", (key,)).fetchone())
        return row[0] if row else None
    f = _data_dir() / f"{key}.json"
    return json.loads(f.read_text()) if f.exists() else None


def _write(key: str, value) -> None:
    if _database_url():
        text = json.dumps(value, ensure_ascii=False)
        _db_call(lambda c: c.execute(
            "INSERT INTO vedicyog_kv (key, value, updated) VALUES (%s, %s::jsonb, now()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated = now()", (key, text)))
        return
    d = _data_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{key}.json.tmp"
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False))
    tmp.replace(d / f"{key}.json")


def get(key: str, default):
    """A private copy of the document (callers may change it and then put it back)."""
    with _lock:
        if key not in _cache:
            value = _read(key)
            _cache[key] = default if value is None else value
        return copy.deepcopy(_cache[key])


def put(key: str, value) -> None:
    with _lock:
        _write(key, value)
        _cache[key] = copy.deepcopy(value)


def backend() -> str:
    return "postgres" if _database_url() else "files"
