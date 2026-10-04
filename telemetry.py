"""Run logging and token accounting for VedicYog.

Every consultation turn produces:
- readable lines in the terminal and in data/logs/vedicyog.log
- one JSON record in data/logs/runs.jsonl (model, every API call's tokens,
  every tool call with arguments and timing, totals and cost)
- a summary sent to the browser and stored with the assistant message
"""

import json
import logging
import os
import time
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent / "data")) / "logs"
RUNS_FILE = LOG_DIR / "runs.jsonl"

log = logging.getLogger("vedicyog")


def setup_logging() -> None:
    if log.handlers:
        return
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-5s %(name)s | %(message)s", "%Y-%m-%d %H:%M:%S")
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    file = RotatingFileHandler(LOG_DIR / "vedicyog.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    file.setFormatter(fmt)
    log.addHandler(console)
    log.addHandler(file)
    log.setLevel(logging.INFO)
    log.propagate = False


def _short(value, limit=160) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit] + "…"


def _tokens(n: int) -> str:
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


class RunRecorder:
    """Collects what one agent run did: API calls, tokens, tools, cost."""

    def __init__(self, conv_id: str, message: str, model: str, resume: str | None, system_prompt_chars: int):
        self.conv_id = conv_id
        self.t0 = time.monotonic()
        self.record = {
            "conversation_id": conv_id,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "requested_model": model,
            "resumed_session": resume,
            "system_prompt_chars": system_prompt_chars,
            "message": message,
            "api_calls": [],
            "tools": [],
        }
        self._pending_tools: dict[str, dict] = {}
        self._call: dict | None = None
        self._p = f"[{conv_id}]"
        log.info("%s ▶ new turn | model=%s | %s | system prompt %s chars | user: %s",
                 self._p, model, f"resuming session {resume[:8]}" if resume else "new session",
                 system_prompt_chars, _short(message, 120))

    def live_totals(self) -> dict:
        calls = self.record["api_calls"]
        return {
            "api_calls": len(calls),
            "input_tokens": sum(c["input_tokens"] for c in calls),
            "cache_read_tokens": sum(c["cache_read_tokens"] for c in calls),
            "cache_write_tokens": sum(c["cache_write_tokens"] for c in calls),
            "output_tokens": sum(c["output_tokens"] for c in calls),
            "reasoning_tokens": sum(c.get("reasoning_tokens") or 0 for c in calls),
        }

    # ----- OpenAI Responses API calls -----
    def on_openai_call(self, model: str, usage, stop_reason: str, duration_ms: int) -> dict:
        d = getattr(usage, "input_tokens_details", None)
        cached = getattr(d, "cached_tokens", 0) or 0
        written = getattr(d, "cache_write_tokens", 0) or 0
        c = {"n": len(self.record["api_calls"]) + 1, "model": model,
             "input_tokens": max(0, usage.input_tokens - cached - written),
             "cache_read_tokens": cached, "cache_write_tokens": written,
             "output_tokens": usage.output_tokens, "stop_reason": stop_reason, "duration_ms": duration_ms,
             "reasoning_tokens": getattr(getattr(usage, "output_tokens_details", None), "reasoning_tokens", 0) or 0}
        self.record["api_calls"].append(c)
        log.info("%s   api call #%d | %s | input %s + cache read %s + cache write %s | output %s | %s | %.1fs",
                 self._p, c["n"], model, _tokens(c["input_tokens"]), _tokens(cached), _tokens(written),
                 _tokens(c["output_tokens"]), stop_reason, duration_ms / 1000)
        return {"type": "usage", **self.live_totals()}

    def on_openai_result(self, model: str, response_id: str | None, price: tuple | None) -> None:
        """Fill the same fields on_result does, pricing tokens with (input, cached, cache write, output) $/1M."""
        r, t = self.record, self.live_totals()
        cost = None
        if price:
            cost = (t["input_tokens"] * price[0] + t["cache_read_tokens"] * price[1]
                    + t["cache_write_tokens"] * price[2] + t["output_tokens"] * price[3]) / 1e6
        r["session_id"] = response_id
        r["num_turns"] = t["api_calls"]
        r["duration_ms"] = round((time.monotonic() - self.t0) * 1000)
        r["duration_api_ms"] = sum(c.get("duration_ms") or 0 for c in r["api_calls"])
        r["cost_usd"] = cost
        r["model_usage"] = {model: {"inputTokens": t["input_tokens"], "outputTokens": t["output_tokens"],
                                    "cacheReadInputTokens": t["cache_read_tokens"],
                                    "cacheCreationInputTokens": t["cache_write_tokens"], "costUSD": cost or 0}}

    # ----- tools -----
    def on_tool_use(self, tool_id: str, name: str, args: dict) -> dict:
        entry = {"id": tool_id, "name": name.split("__")[-1], "server": name.split("__")[1] if "__" in name else "",
                 "input": args, "t0": time.monotonic()}
        self._pending_tools[tool_id] = entry
        self.record["tools"].append(entry)
        log.info("%s   tool call  → %s %s", self._p, entry["name"], _short(args))
        return entry

    def on_tool_result(self, tool_id: str, content, is_error: bool | None) -> dict | None:
        entry = self._pending_tools.pop(tool_id, None)
        if not entry:
            return None
        text = content if isinstance(content, str) else json.dumps(content or "", ensure_ascii=False)
        entry["duration_ms"] = round((time.monotonic() - entry.pop("t0")) * 1000)
        entry["result_chars"] = len(text)
        entry["is_error"] = bool(is_error)
        log.info("%s   tool result ← %s | %s chars | %d ms%s", self._p, entry["name"], f"{len(text):,}",
                 entry["duration_ms"], " | ERROR " + _short(text, 200) if is_error else "")
        return entry

    # ----- end of run -----
    def finish(self, answer: str, error: str | None = None) -> dict:
        r = self.record
        for t in r["tools"]:
            t.pop("t0", None)
        for c in r["api_calls"]:
            c.pop("t0", None)
        r["answer_chars"] = len(answer)
        r["error"] = error
        r.setdefault("duration_ms", round((time.monotonic() - self.t0) * 1000))
        r["totals"] = self.live_totals()
        summary = self.summary()

        totals = summary["totals"]
        log.info("%s ✔ done | %d api calls, %d tools | input %s, cache read %s, cache write %s, output %s | $%.4f | %.1fs%s",
                 self._p, totals["api_calls"], len(r["tools"]), _tokens(totals["input_tokens"]),
                 _tokens(totals["cache_read_tokens"]), _tokens(totals["cache_write_tokens"]),
                 _tokens(totals["output_tokens"]), summary["cost_usd"] or 0, (r["duration_ms"] or 0) / 1000,
                 f" | ERROR {error}" if error else "")
        for model, mu in summary["models"].items():
            log.info("%s   model %s | input %s, cache read %s, cache write %s, output %s | $%.4f", self._p, model,
                     _tokens(mu["input_tokens"]), _tokens(mu["cache_read_tokens"]), _tokens(mu["cache_write_tokens"]),
                     _tokens(mu["output_tokens"]), mu["cost_usd"])

        with RUNS_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
        return summary

    def summary(self) -> dict:
        """Compact run details for the browser and the conversation store."""
        r = self.record
        models = {
            m: {"input_tokens": u.get("inputTokens", 0), "output_tokens": u.get("outputTokens", 0),
                "cache_read_tokens": u.get("cacheReadInputTokens", 0),
                "cache_write_tokens": u.get("cacheCreationInputTokens", 0), "cost_usd": u.get("costUSD", 0)}
            for m, u in (r.get("model_usage") or {}).items()
        }
        if not models:  # run failed before it was priced: fall back to the per-call counts
            for c in r["api_calls"]:
                m = models.setdefault(c["model"] or "unknown", {"input_tokens": 0, "output_tokens": 0,
                                                                "cache_read_tokens": 0, "cache_write_tokens": 0,
                                                                "cost_usd": None})
                for k in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"):
                    m[k] += c[k]
        return {
            "requested_model": r["requested_model"],
            "reasoning_effort": r.get("reasoning_effort"),
            "models": models,
            "totals": r.get("totals") or self.live_totals(),
            "cost_usd": r.get("cost_usd"),
            "num_turns": r.get("num_turns"),
            "duration_ms": r.get("duration_ms"),
            "duration_api_ms": r.get("duration_api_ms"),
            "api_calls": [{k: c.get(k) for k in ("n", "model", "input_tokens", "cache_read_tokens",
                                                 "cache_write_tokens", "output_tokens", "reasoning_tokens", "stop_reason",
                                                 "duration_ms")}
                          for c in r["api_calls"]],
            "tools": [{k: t.get(k) for k in ("name", "input", "duration_ms", "result_chars", "is_error")}
                      for t in r["tools"]],
            "error": r.get("error"),
        }


def usage_report() -> dict:
    """Totals across every logged run, overall and per model."""
    runs, per_model = 0, {}
    total = {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": 0.0}
    if RUNS_FILE.exists():
        for line in RUNS_FILE.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            runs += 1
            total["cost_usd"] += r.get("cost_usd") or 0
            for m, u in (r.get("model_usage") or {}).items():
                pm = per_model.setdefault(m, {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0,
                                              "cache_write_tokens": 0, "cost_usd": 0.0})
                for key, src in (("input_tokens", "inputTokens"), ("output_tokens", "outputTokens"),
                                 ("cache_read_tokens", "cacheReadInputTokens"),
                                 ("cache_write_tokens", "cacheCreationInputTokens")):
                    pm[key] += u.get(src, 0)
                    total[key] += u.get(src, 0)
                pm["cost_usd"] += u.get("costUSD", 0)
    return {"runs": runs, "total": total, "models": per_model}
