"""VedicYog: Vedic astrology consultation app.

FastAPI backend that runs an OpenAI model (Responses API, see openai_agent.py) with
local, free Vedic astrology tools (PyJHora, see jyotish_tools.py) and streams the
answer to the browser as server-sent events.
"""

import json
import os
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import auth
import openai_agent
from auth import current_user
from jyotish_tools import chart_data, resolve_birthplace
from prompts import build_system_prompt
from telemetry import RunRecorder, log, setup_logging, usage_report

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

MAX_TURNS = int(os.getenv("ASTRO_MAX_TURNS", "30"))
# Fallback USD->INR rate when the live rate cannot be fetched
USD_INR = float(os.getenv("USD_INR", "96"))

DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
STORE = DATA_DIR / "conversations.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)

setup_logging()
app = FastAPI(title="VedicYog")


# ---------- conversation store ----------

def load_store() -> dict:
    if STORE.exists():
        return json.loads(STORE.read_text())
    return {}


def save_store(store: dict) -> None:
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, indent=2, ensure_ascii=False))
    tmp.replace(STORE)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Conversations belong to the account that created them.
def owned(conv_id: str, username: str) -> dict:
    conv = load_store().get(conv_id)
    if not conv or conv.get("owner") != username:
        raise HTTPException(404, "Conversation not found")
    return conv


class Credentials(BaseModel):
    username: str
    password: str


class Profile(BaseModel):
    name: str
    date: str  # YYYY-MM-DD
    time: str  # HH:MM or HH:MM:SS
    place: str
    lang: str = "en"


class ChartRequest(BaseModel):
    division: int = 1
    conversation_id: str | None = None
    profile: Profile | None = None


class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None
    profile: Profile | None = None
    effort: str | None = None  # reasoning effort: none, low, medium, high, xhigh


# ---------- agent ----------

def sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


async def run_consultation(conv_id: str, message: str, effort: str | None, username: str):
    store = load_store()
    conv = store[conv_id]
    conv["messages"].append({"role": "user", "text": message, "at": now_iso()})
    save_store(store)

    model = openai_agent.model_name()
    effort = effort or openai_agent.DEFAULT_EFFORT
    system_prompt = build_system_prompt(conv["profile"], date.today().isoformat())
    resume = conv.get("session_id")
    rec = RunRecorder(conv_id, message, model, resume, len(system_prompt))
    rec.record["reasoning_effort"] = effort
    yield sse({"type": "start", "conversation_id": conv_id, "title": conv["title"], "model": model, "effort": effort})

    # Text from the final model call is the answer; text written before a tool call
    # is just the model thinking aloud, so the client clears it on "tool".
    answer, thinking, error = "", "", None
    state = {"response_id": resume}
    try:
        async for ev in openai_agent.run_openai(conv["profile"], message, system_prompt, resume,
                                                rec, MAX_TURNS, state, effort):
            if ev["type"] == "text":
                answer += ev["delta"]
            elif ev["type"] == "thinking":
                thinking += ev["delta"]
            elif ev["type"] == "tool":
                answer = ""
            yield sse(ev)
    except Exception as exc:  # surface API failures to the UI
        error = str(exc)
        log.exception("[%s] agent run failed", conv_id)
        yield sse({"type": "error", "message": error})
    finally:
        conv["session_id"] = state["response_id"]
        rec.on_openai_result(model, state["response_id"], openai_agent.price(model))

    if not answer.strip():
        auth.refund_question(username)  # no answer: the question does not count
    run = rec.finish(answer, error)
    yield sse({"type": "done", "run": run, "account": auth.account(username)})

    store = load_store()
    store[conv_id]["session_id"] = conv.get("session_id")
    if answer.strip():
        msg = {"role": "assistant", "text": answer, "at": now_iso(), "run": run}
        if thinking.strip():
            msg["thinking"] = thinking.strip()
        store[conv_id]["messages"].append(msg)
    store[conv_id]["updated"] = now_iso()
    save_store(store)


# ---------- accounts ----------

def _set_session(request: Request, response: Response, username: str) -> None:
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(auth.COOKIE, auth.make_session(username), max_age=auth.SESSION_DAYS * 86400,
                        httponly=True, samesite="lax", secure=https)


@app.post("/api/signup")
def signup(creds: Credentials, request: Request, response: Response):
    username = auth.create_user(creds.username, creds.password)
    _set_session(request, response, username)
    return auth.account(username)


@app.post("/api/login")
def login(creds: Credentials, request: Request, response: Response):
    username = auth.check_login(creds.username, creds.password)
    _set_session(request, response, username)
    return auth.account(username)


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(username: str = Depends(current_user)):
    return auth.account(username)


# ---------- routes ----------

@app.get("/api/health")
def health():
    return {"engine": "PyJHora (local)", "model": openai_agent.model_name(),
            "available": openai_agent.configured(),
            "efforts": openai_agent.EFFORTS, "default_effort": openai_agent.DEFAULT_EFFORT}


@app.get("/api/usage")
def usage(username: str = Depends(current_user)):
    if not auth.is_admin(username):
        raise HTTPException(403, "Admin only")
    return usage_report()


_fx = {"rate": None, "at": 0.0, "source": None}


@app.get("/api/fx")
def fx():
    """USD->INR rate for showing costs in rupees; refreshed every 12 hours, env fallback offline."""
    if _fx["rate"] is None or time.time() - _fx["at"] > 12 * 3600:
        try:
            r = requests.get("https://open.er-api.com/v6/latest/USD", timeout=5)
            _fx.update(rate=float(r.json()["rates"]["INR"]), at=time.time(), source="open.er-api.com")
        except Exception as exc:
            log.warning("USD->INR lookup failed, using USD_INR=%s: %s", USD_INR, exc)
            if _fx["rate"] is None:
                _fx.update(rate=USD_INR, at=time.time() - 11 * 3600, source="USD_INR setting")
    return {"usd_inr": _fx["rate"], "source": _fx["source"]}


@app.post("/api/chart")
async def chart(req: ChartRequest, username: str = Depends(current_user)):
    """Any divisional chart for the native, for the chart card's D1/D9/D10... tabs."""
    if not 1 <= req.division <= 60:
        raise HTTPException(400, "division must be 1-60")
    if req.conversation_id:
        profile = owned(req.conversation_id, username)["profile"]
    elif req.profile:
        try:
            profile = await run_in_threadpool(resolve_birthplace, req.profile.model_dump())
        except Exception as exc:
            raise HTTPException(400, f"Birthplace lookup failed: {exc}")
    else:
        raise HTTPException(400, "Birth details are required")
    try:
        return await run_in_threadpool(chart_data, profile, req.division)
    except Exception as exc:
        log.exception("chart D%s failed", req.division)
        raise HTTPException(500, f"Calculation failed: {exc}")


@app.post("/api/chat")
async def chat(req: ChatRequest, username: str = Depends(current_user)):
    if req.effort and req.effort not in openai_agent.EFFORTS:
        raise HTTPException(400, f"effort must be one of {', '.join(openai_agent.EFFORTS)}")
    if not openai_agent.configured():
        raise HTTPException(503, "The server has no OPENAI_API_KEY configured")
    if req.conversation_id:
        conv_id = owned(req.conversation_id, username)["id"]
        auth.take_question(username)
    else:
        if not req.profile:
            raise HTTPException(400, "Birth details are required to start a consultation")
        conv_id = uuid.uuid4().hex[:12]
        try:
            p = await run_in_threadpool(resolve_birthplace, req.profile.model_dump())
        except Exception as exc:
            raise HTTPException(400, f"Birthplace lookup failed: {exc}")
        auth.take_question(username)
        store = load_store()
        store[conv_id] = {
            "id": conv_id,
            "title": f"{p['name']} · {req.message[:48]}",
            "owner": username,
            "profile": p,
            "session_id": None,
            "messages": [],
            "created": now_iso(),
            "updated": now_iso(),
        }
        save_store(store)
    return StreamingResponse(
        run_consultation(conv_id, req.message, req.effort, username),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/conversations")
def list_conversations(username: str = Depends(current_user)):
    convs = sorted((c for c in load_store().values() if c.get("owner") == username),
                   key=lambda c: c["updated"], reverse=True)
    return [{k: c[k] for k in ("id", "title", "profile", "updated")} for c in convs]


@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: str, username: str = Depends(current_user)):
    conv = owned(conv_id, username)
    return {k: v for k, v in conv.items() if k != "owner"}


@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str, username: str = Depends(current_user)):
    owned(conv_id, username)
    store = load_store()
    store.pop(conv_id, None)
    save_store(store)
    return {"ok": True}


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")
