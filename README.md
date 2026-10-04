# VedicYog

A Vedic astrology consultation web app. A FastAPI backend runs an OpenAI model
(default `gpt-6-luna`, Responses API) with **local, free astrology tools** built on
[PyJHora](https://pypi.org/project/PyJHora/), the open-source Python port of
Jagannatha Hora (Swiss Ephemeris, Lahiri ayanamsa). There are no astrology API
keys or per-call fees. The model calculates the kundli, divisional charts, dashas,
transits, shadbala, ashtakavarga, yogas and doshas, then streams a consultation.

The browser renders it as rich, touch-friendly cards:

- **North Indian chart** with aspect arrows. Tabs switch between D1-D60, and tapping
  a planet or house shows its sign, degree, nakshatra, lordship and aspects.
- **Signal board** of the four decisive factors.
- **Dasha timeline**: tap a period, or drag along the bar to scrub through dates.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # then set OPENAI_API_KEY
.venv/bin/uvicorn app:app --port 8765
```

Open http://localhost:8765, click the gear icon and enter the birth details.
http://localhost:8765/?demo shows a sample consultation without calling the model.

## Deploy on Render

1. In Render, **New → Blueprint** and pick this repository. `render.yaml` sets up a
   Python 3.13 web service (`uvicorn app:app --host 0.0.0.0 --port $PORT`).
2. Set **`OPENAI_API_KEY`** in the service's Environment tab. Never commit it.
3. Deploy. The health check is `/api/health`.

Things to know about a public deployment:

- **Cost**: every visitor's question is billed to your OpenAI key. Set a monthly
  budget limit in the OpenAI dashboard. Free-tier OpenAI accounts hit rate limits fast.
- **Storage**: conversations and logs are JSON files under `data/`. On Render's free
  plan the disk is wiped on every deploy and restart. For history that survives, add a
  persistent disk (paid plans) and set `DATA_DIR` to its mount path, e.g. `/var/data`.
- **Privacy**: each browser gets a random id, and the server only lists and opens
  that browser's consultations. It is not a login: clearing browser storage loses
  access to past consultations.
- The free plan sleeps after 15 minutes idle; the first request then takes ~1 minute.

## Thinking depth

The **Think** row above the message box sets the reasoning effort per message:
Off, Low, Medium (default), High or Max (`none`, `low`, `medium`, `high`, `xhigh`).
Reasoning summaries stream into a collapsible **Thinking** panel above the answer and
are saved with it; run details show the effort and reasoning tokens.

## How it fits together

| File | Role |
|---|---|
| `jyotish_tools.py` | The free astrology tools (PyJHora) and their function-tool definitions |
| `openai_agent.py` | Function-calling loop on the OpenAI Responses API; streams text, thinking and tool events |
| `app.py` | FastAPI: geocodes the birthplace once (OpenStreetMap), streams SSE, stores conversations per browser |
| `prompts.py` | The astrologer system prompt: which tools to call per topic, and the JSON contract for rich blocks |
| `telemetry.py` | Run logging, token accounting and cost |
| `static/blocks.js` | Renders and wires up the `astro-chart`, `astro-signals` and `astro-timeline` blocks |
| `static/app.js` | Chat UI, streaming, history, birth details, thinking depth |

Tools: `birth_chart` (D1-D60), `chara_karakas`, `shadbala`, `ashtakavarga`,
`vimshottari_dasha`, `transits` (with Sade Sati and a monthly slow-planet table),
`yogas_and_doshas`, `panchang`.

## Logs, tokens and cost

| Where | What |
|---|---|
| Server log and `data/logs/vedicyog.log` | One line per step: the turn starting, each tool call with its arguments and PyJHora compute time, each model call's tokens, and a final total with cost |
| `data/logs/runs.jsonl` | One JSON record per question with everything above |
| The page | Live token counter while answering; the **Run details** bar under each answer expands to tokens, every model call and every tool call |

Costs are shown in USD and INR. `GET /api/fx` fetches the USD→INR rate from
open.er-api.com (refreshed every 12 hours); offline, it falls back to `USD_INR`.
Prices for `gpt-6-luna` are built in ($0.10 / 1M input, $0.50 / 1M output); for
another model set `OPENAI_MODEL` and `OPENAI_PRICE`.
