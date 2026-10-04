"""The astrologer agent: a function-calling loop on the OpenAI Responses API over the
PyJHora tools, streaming events (text, thinking, tool, tool_done, usage) for app.py.

Conversation memory is kept by OpenAI: each turn continues from the previous
response id stored on the conversation.
"""

import json
import os
import time

from fastapi.concurrency import run_in_threadpool
from openai import AsyncOpenAI

from jyotish_tools import TOOLS, run_tool
from telemetry import RunRecorder


# $ per 1M tokens: input, cached input, cache write, output (standard tier).
# Override with OPENAI_PRICE="in,cached,write,out" for other models.
PRICES = {
    "gpt-6-luna": (0.10, 0.01, 0.125, 0.50),
}

FUNCTIONS = [{"type": "function", "name": name, "description": desc, "parameters": schema}
             for name, desc, schema, *_ in TOOLS]

# Reasoning effort levels gpt-6-luna accepts ("minimal" is rejected)
EFFORTS = ("none", "low", "medium", "high", "xhigh")
DEFAULT_EFFORT = "medium"

_client: AsyncOpenAI | None = None


def model_name() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-6-luna")


def configured() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def price(model: str) -> tuple | None:
    if env := os.getenv("OPENAI_PRICE"):
        return tuple(float(x) for x in env.split(","))
    return PRICES.get(model)


async def run_openai(profile: dict, message: str, system_prompt: str, previous_id: str | None,
                     rec: RunRecorder, max_turns: int, state: dict, effort: str = DEFAULT_EFFORT):
    """Run one consultation turn. Yields SSE event dicts. Only a finished answer moves
    state["response_id"] on: a turn that fails mid tool call would leave OpenAI waiting
    for tool output, so the next turn continues from the last good answer instead."""
    global _client
    _client = _client or AsyncOpenAI()
    model = model_name()
    input_items: list = [{"role": "user", "content": message}]
    # summaries of the model's reasoning stream to the UI's "Thinking" panel
    reasoning = {"effort": effort} if effort == "none" else {"effort": effort, "summary": "auto"}

    for _ in range(max_turns):
        t0 = time.monotonic()
        stream = await _client.responses.create(
            model=model, instructions=system_prompt, input=input_items, tools=FUNCTIONS,
            previous_response_id=previous_id, reasoning=reasoning, stream=True)
        response = None
        async for ev in stream:
            if ev.type == "response.output_text.delta":
                yield {"type": "text", "delta": ev.delta}
            elif ev.type == "response.reasoning_summary_text.delta":
                yield {"type": "thinking", "delta": ev.delta}
            elif ev.type == "response.reasoning_summary_part.done":
                yield {"type": "thinking", "delta": "\n\n"}
            elif ev.type in ("response.completed", "response.incomplete", "response.failed"):
                response = ev.response
            elif ev.type == "error":
                raise RuntimeError(getattr(ev, "message", "OpenAI stream error"))
        if response is None:
            raise RuntimeError("OpenAI stream ended without a response")
        if response.error:
            raise RuntimeError(response.error.message)

        previous_id = response.id
        calls = [o for o in response.output if o.type == "function_call"]
        stop = "tool_use" if calls else (response.incomplete_details.reason
                                         if response.incomplete_details else "end_turn")
        yield rec.on_openai_call(model, response.usage, stop, round((time.monotonic() - t0) * 1000))
        if not calls:
            state["response_id"] = response.id
            return

        input_items = []
        for call in calls:
            try:
                args = json.loads(call.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            rec.on_tool_use(call.call_id, call.name, args)
            yield {"type": "tool", "id": call.call_id, "name": call.name.replace("_", " "), "input": args}
            text, is_error = await run_in_threadpool(run_tool, profile, call.name, args)
            t = rec.on_tool_result(call.call_id, text, is_error)
            yield {"type": "tool_done", "id": call.call_id, "ms": t["duration_ms"],
                   "chars": t["result_chars"], "is_error": t["is_error"]}
            input_items.append({"type": "function_call_output", "call_id": call.call_id, "output": text})

    raise RuntimeError(f"Stopped after {max_turns} model calls without a final answer")
