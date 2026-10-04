"""User accounts, sessions and the question quota.

- Users sign up with a username and password (PBKDF2-hashed) stored in users.json.
- The admin account comes from ADMIN_USERNAME / ADMIN_PASSWORD (never from code)
  and has no question limit.
- Sessions are HMAC-signed cookies keyed by SECRET_KEY, so they survive restarts.

The quota (MAX_QUESTIONS, default 5) is counted three ways, and a question is only
allowed while all three are under the limit, so a second account does not get a
fresh set of questions:
- per account;
- per device: a long-lived cookie set on every browser (accounts made in the same
  browser share it);
- per birth chart: same birth date, place within ~10 km and time within 30 minutes,
  whatever name is typed. Faking the birth details to dodge this gives a reading of
  the wrong chart.
New accounts are also limited per IP address per day (MAX_SIGNUPS_PER_IP, default 3).
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
DEVICE_COOKIE = "vy_device"
SESSION_DAYS = 30
PBKDF2_ROUNDS = 200_000
USERNAME_RE = re.compile(r"[a-z0-9_.-]{3,32}")
DEVICE_RE = re.compile(r"[a-f0-9]{32}")
CHART_MINUTES = 30   # birth times this close count as the same chart
CHART_DEGREES = 0.1  # ~10 km

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


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- storage ----------

def _users_file() -> Path:
    return Path(os.getenv("DATA_DIR", Path(__file__).parent / "data")) / "users.json"


def _load() -> dict:
    f = _users_file()
    data = json.loads(f.read_text()) if f.exists() else {}
    if data and "users" not in data:  # first version stored only the users
        data = {"users": data}
    for key, empty in (("users", {}), ("devices", {}), ("charts", []), ("signups", [])):
        data.setdefault(key, empty)
    for u in data["users"].values():
        u.setdefault("devices", [])
    return data


def _save(data: dict) -> None:
    f = _users_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(f)


def _hash(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS).hex()


def new_device_id() -> str:
    return secrets.token_hex(16)


def valid_device(device: str | None) -> str | None:
    return device if device and DEVICE_RE.fullmatch(device) else None


def _link_device(data: dict, username: str, device: str | None) -> None:
    if device and username in data["users"]:
        devices = data["users"][username]["devices"]
        if device not in devices:
            devices.append(device)
        data["devices"].setdefault(device, {"questions": 0})


# ---------- birth charts ----------

def _minutes(t: str) -> int:
    hh, mm, *_ = (int(x) for x in t.split(":"))
    return hh * 60 + mm


def _find_chart(data: dict, profile: dict) -> dict | None:
    m = _minutes(profile["time"])
    for c in data["charts"]:
        if (c["date"] == profile["date"] and abs(c["minutes"] - m) <= CHART_MINUTES
                and abs(c["lat"] - profile["latitude"]) <= CHART_DEGREES
                and abs(c["lon"] - profile["longitude"]) <= CHART_DEGREES):
            return c
    return None


# ---------- accounts ----------

def create_user(username: str, password: str, device: str | None, ip: str | None) -> str:
    username = username.strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(400, "Username must be 3-32 characters: letters, numbers, _ . -")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if username == admin_name():
        raise HTTPException(400, "That username is taken")
    with _lock:
        data = _load()
        if username in data["users"]:
            raise HTTPException(400, "That username is taken")
        if device and data["devices"].get(device, {}).get("questions", 0) >= max_questions():
            raise HTTPException(403, "This device has already used its free questions. "
                                     "Log in to your existing account instead.")
        day_ago = time.time() - 86400
        data["signups"] = [s for s in data["signups"] if s["at"] > day_ago]
        if ip and sum(s["ip"] == ip for s in data["signups"]) >= int(os.getenv("MAX_SIGNUPS_PER_IP", "3")):
            raise HTTPException(429, "Too many new accounts from this network today. Try again tomorrow.")
        salt = secrets.token_bytes(16)
        data["users"][username] = {"salt": salt.hex(), "hash": _hash(password, salt), "questions": 0,
                                   "created": now_iso(), "ip": ip, "devices": []}
        _link_device(data, username, device)
        if ip:
            data["signups"].append({"ip": ip, "at": time.time()})
        _save(data)
    return username


def check_login(username: str, password: str, device: str | None) -> str:
    username = username.strip().lower()
    admin_pw = os.getenv("ADMIN_PASSWORD")
    if username == admin_name():
        if admin_pw and hmac.compare_digest(password.encode(), admin_pw.encode()):
            return username
    else:
        with _lock:
            data = _load()
            user = data["users"].get(username)
            if user and hmac.compare_digest(_hash(password, bytes.fromhex(user["salt"])), user["hash"]):
                _link_device(data, username, device)
                _save(data)
                return username
    time.sleep(0.5)  # slow down password guessing
    raise HTTPException(401, "Wrong username or password")


def is_admin(username: str) -> bool:
    return username == admin_name() and bool(os.getenv("ADMIN_PASSWORD"))


def account(username: str, device: str | None = None) -> dict:
    if is_admin(username):
        return {"username": username, "admin": True, "used": None, "limit": None, "remaining": None}
    data = _load()
    limit = max_questions()
    used = data["users"].get(username, {}).get("questions", 0)
    device_used = data["devices"].get(device, {}).get("questions", 0) if device else 0
    return {"username": username, "admin": False, "used": used, "limit": limit,
            "remaining": max(0, limit - max(used, device_used)),
            "shared": device_used > used}  # another account on this device used some


# ---------- question quota ----------

def take_question(username: str, device: str | None, profile: dict) -> dict | None:
    """Reserve one question against the account, the device and the birth chart, or
    raise 403. Returns a ticket for refund_question."""
    if is_admin(username):
        return None
    limit = max_questions()
    with _lock:
        data = _load()
        user = data["users"].get(username)
        if not user:
            raise HTTPException(401, "Please log in again")
        if user["questions"] >= limit:
            raise HTTPException(403, f"You have used all {limit} questions on this account.")
        if device and data["devices"].get(device, {}).get("questions", 0) >= limit:
            raise HTTPException(403, f"This device has already used its {limit} free questions on another account.")
        chart = _find_chart(data, profile)
        if chart and chart["questions"] >= limit:
            others = [a for a in chart["accounts"] if a != username]
            if username not in chart["accounts"]:  # record the attempt so the admin sees the link
                chart["accounts"].append(username)
                _save(data)
            raise HTTPException(403, f"These birth details have already used their {limit} free questions"
                                     f"{' on another account' if others else ''}.")
        if not chart:
            chart = {"id": secrets.token_hex(6), "date": profile["date"], "minutes": _minutes(profile["time"]),
                     "lat": profile["latitude"], "lon": profile["longitude"], "place": profile.get("place"),
                     "questions": 0, "accounts": []}
            data["charts"].append(chart)
        if username not in chart["accounts"]:
            chart["accounts"].append(username)
        user["questions"] += 1
        chart["questions"] += 1
        _link_device(data, username, device)
        if device:
            data["devices"][device]["questions"] += 1
        _save(data)
        return {"username": username, "device": device, "chart": chart["id"]}


def refund_question(ticket: dict | None) -> None:
    """Give a question back when the model failed to answer it."""
    if not ticket:
        return
    with _lock:
        data = _load()
        counters = [data["users"].get(ticket["username"]), data["devices"].get(ticket["device"] or ""),
                    next((c for c in data["charts"] if c["id"] == ticket["chart"]), None)]
        for c in counters:
            if c and c["questions"] > 0:
                c["questions"] -= 1
        _save(data)


# ---------- admin ----------

def list_users() -> list[dict]:
    """Every account with the accounts it is linked to through a device or birth chart."""
    data = _load()
    users = data["users"]
    rows = []
    for name, u in users.items():
        via_device = {o for o, ou in users.items() if o != name and set(ou["devices"]) & set(u["devices"])}
        charts = [c for c in data["charts"] if name in c["accounts"]]
        via_chart = {o for c in charts for o in c["accounts"] if o != name}
        rows.append({"username": name, "created": u["created"], "ip": u.get("ip"), "questions": u["questions"],
                     "devices": len(u["devices"]), "charts": len(charts),
                     "same_device": sorted(via_device), "same_birth_chart": sorted(via_chart)})
    rows.sort(key=lambda r: r["created"], reverse=True)
    rows.sort(key=lambda r: not (r["same_device"] or r["same_birth_chart"]))  # linked accounts first
    return rows


def reset_user(username: str) -> None:
    """Give an account a fresh quota: its own count, its devices and its birth charts."""
    with _lock:
        data = _load()
        user = data["users"].get(username)
        if not user:
            raise HTTPException(404, "No such user")
        user["questions"] = 0
        for d in user["devices"]:
            if d in data["devices"]:
                data["devices"][d]["questions"] = 0
        for c in data["charts"]:
            if username in c["accounts"]:
                c["questions"] = 0
        _save(data)


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
    if username == admin_name():
        return username if is_admin(username) else None  # admin disabled without ADMIN_PASSWORD
    return username if username in _load()["users"] else None


def current_user(vy_session: str | None = Cookie(None)) -> str:
    """FastAPI dependency: the logged-in username, or 401."""
    username = read_session(vy_session)
    if not username:
        raise HTTPException(401, "Please log in")
    return username


def require_admin(vy_session: str | None = Cookie(None)) -> str:
    username = current_user(vy_session)
    if not is_admin(username):
        raise HTTPException(403, "Admin only")
    return username
