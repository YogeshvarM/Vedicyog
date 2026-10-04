"""User accounts, sessions and the per-user question quota.

- Users sign up with a username and password (PBKDF2-hashed) stored in users.json.
- The admin account comes from ADMIN_USERNAME / ADMIN_PASSWORD (never from code)
  and has no question limit.
- Sessions are HMAC-signed cookies keyed by SECRET_KEY, so they survive restarts.
- Everyone else may ask MAX_QUESTIONS questions in total (default 5).
"""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Cookie, HTTPException

COOKIE = "vy_session"
SESSION_DAYS = 30
PBKDF2_ROUNDS = 200_000
USERNAME_RE = re.compile(r"[a-z0-9_.-]{3,32}")

_lock = threading.Lock()


def _secret() -> bytes:
    key = os.getenv("SECRET_KEY")
    if not key:  # local dev: sessions just won't survive a restart
        key = os.environ["SECRET_KEY"] = secrets.token_urlsafe(32)
    return key.encode()


def max_questions() -> int:
    return int(os.getenv("MAX_QUESTIONS", "5"))


def admin_name() -> str:
    return os.getenv("ADMIN_USERNAME", "admin").strip().lower()


def _users_file() -> Path:
    return Path(os.getenv("DATA_DIR", Path(__file__).parent / "data")) / "users.json"


def _load() -> dict:
    f = _users_file()
    return json.loads(f.read_text()) if f.exists() else {}


def _save(users: dict) -> None:
    f = _users_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(users, indent=2))
    tmp.replace(f)


def _hash(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS).hex()


# ---------- accounts ----------

def create_user(username: str, password: str) -> str:
    username = username.strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(400, "Username must be 3-32 characters: letters, numbers, _ . -")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if username == admin_name():
        raise HTTPException(400, "That username is taken")
    with _lock:
        users = _load()
        if username in users:
            raise HTTPException(400, "That username is taken")
        salt = secrets.token_bytes(16)
        users[username] = {"salt": salt.hex(), "hash": _hash(password, salt), "questions": 0,
                           "created": datetime.now(timezone.utc).isoformat()}
        _save(users)
    return username


def check_login(username: str, password: str) -> str:
    username = username.strip().lower()
    admin_pw = os.getenv("ADMIN_PASSWORD")
    if username == admin_name():
        if admin_pw and hmac.compare_digest(password.encode(), admin_pw.encode()):
            return username
    else:
        user = _load().get(username)
        if user and hmac.compare_digest(_hash(password, bytes.fromhex(user["salt"])), user["hash"]):
            return username
    time.sleep(0.5)  # slow down password guessing
    raise HTTPException(401, "Wrong username or password")


def is_admin(username: str) -> bool:
    return username == admin_name() and bool(os.getenv("ADMIN_PASSWORD"))


def account(username: str) -> dict:
    if is_admin(username):
        return {"username": username, "admin": True, "used": None, "limit": None, "remaining": None}
    used = _load().get(username, {}).get("questions", 0)
    limit = max_questions()
    return {"username": username, "admin": False, "used": used, "limit": limit, "remaining": max(0, limit - used)}


# ---------- question quota ----------

def take_question(username: str) -> None:
    """Reserve one question, or raise 403 when the quota is used up."""
    if is_admin(username):
        return
    with _lock:
        users = _load()
        user = users.get(username)
        if not user:
            raise HTTPException(401, "Please log in again")
        if user["questions"] >= max_questions():
            raise HTTPException(403, f"You have used all {max_questions()} questions on this account.")
        user["questions"] += 1
        _save(users)


def refund_question(username: str) -> None:
    """Give a question back when the model failed to answer it."""
    if is_admin(username):
        return
    with _lock:
        users = _load()
        if username in users and users[username]["questions"] > 0:
            users[username]["questions"] -= 1
            _save(users)


# ---------- sessions ----------

def make_session(username: str) -> str:
    payload = base64.urlsafe_b64encode(f"{username}|{int(time.time()) + SESSION_DAYS * 86400}".encode()).decode()
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def read_session(token: str | None) -> str | None:
    if not token or "." not in token:
        return None
    payload, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()):
        return None
    try:
        username, expires = base64.urlsafe_b64decode(payload).decode().rsplit("|", 1)
    except Exception:
        return None
    if int(expires) < time.time():
        return None
    if username != admin_name() and username not in _load():
        return None  # account no longer exists
    if username == admin_name() and not is_admin(username):
        return None  # admin disabled (no ADMIN_PASSWORD)
    return username


def current_user(vy_session: str | None = Cookie(None)) -> str:
    """FastAPI dependency: the logged-in username, or 401."""
    username = read_session(vy_session)
    if not username:
        raise HTTPException(401, "Please log in")
    return username
