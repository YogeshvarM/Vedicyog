"""Free, local Vedic astrology tools for the agent.

Calculations come from PyJHora (open-source port of Jagannatha Hora, Swiss
Ephemeris, Lahiri ayanamsa) and run in-process as tools the model can call, so
there is no astrology API key and no per-call cost. Birthplaces are geocoded once with
OpenStreetMap Nominatim + timezonefinder.
"""

import json
import logging
import re
import time
from datetime import date, datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

from geopy.geocoders import Nominatim
from timezonefinder import TimezoneFinder

from jhora import const, utils
from jhora.horoscope.chart import ashtakavarga, charts, dosha, house, strength, yoga
from jhora.horoscope.dhasa.graha import vimsottari
from jhora.panchanga import drik

utils.set_language("en")
log = logging.getLogger("vedicyog.tools")

SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
         "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]
PLANETS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]
CODES = ["Su", "Mo", "Ma", "Me", "Ju", "Ve", "Sa", "Ra", "Ke"]
SIGN_LORDS = [2, 5, 3, 1, 0, 3, 5, 2, 4, 6, 6, 4]  # planet index ruling each sign
NAKSHATRAS = ["Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra", "Punarvasu",
              "Pushya", "Ashlesha", "Magha", "Purva Phalguni", "Uttara Phalguni", "Hasta",
              "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha", "Mula", "Purva Ashadha",
              "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada",
              "Uttara Bhadrapada", "Revati"]
NAK_LORDS = [8, 5, 0, 1, 2, 7, 4, 6, 3]  # Vimshottari order, repeats every 9
TITHIS = ["Pratipada", "Dwitiya", "Tritiya", "Chaturthi", "Panchami", "Shashthi", "Saptami",
          "Ashtami", "Navami", "Dashami", "Ekadashi", "Dwadashi", "Trayodashi", "Chaturdashi"]
DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
DIGNITY = {5: "own sign", 4: "exalted", 3: "friendly sign", 2: "neutral sign", 1: "enemy sign", 0: "debilitated"}
KARAKAS = ["Atma Karaka (AK)", "Amatya Karaka (AmK)", "Bhratri Karaka (BK)", "Matri Karaka (MK)",
           "Pitri Karaka (PiK)", "Putra Karaka (PuK)", "Gnati Karaka (GK)", "Dara Karaka (DK)"]
# Special graha drishti in houses counted from the planet (7th is universal)
SPECIAL_ASPECTS = {2: [4, 7, 8], 4: [5, 7, 9], 6: [3, 7, 10]}
COMBUST_ORB = {1: 12, 2: 17, 3: 14, 4: 11, 5: 10, 6: 15}


# ---------- birthplace ----------

@lru_cache(maxsize=256)
def _geocode(place: str):
    loc = Nominatim(user_agent="vedicyog-local").geocode(place, timeout=15)
    if not loc:
        raise ValueError(f"Could not find the birthplace '{place}'. Try 'City, State, Country'.")
    tz = TimezoneFinder().timezone_at(lat=loc.latitude, lng=loc.longitude) or "UTC"
    return loc.address, round(loc.latitude, 4), round(loc.longitude, 4), tz


def resolve_birthplace(profile: dict) -> dict:
    """Add latitude, longitude, timezone and the UTC offset in force at birth (DST-aware)."""
    address, lat, lon, tz = _geocode(profile["place"].strip())
    birth = datetime.fromisoformat(f"{profile['date']}T{profile['time']}")
    offset = birth.replace(tzinfo=ZoneInfo(tz)).utcoffset().total_seconds() / 3600
    return {**profile, "resolved_place": address, "latitude": lat, "longitude": lon,
            "timezone": tz, "utc_offset": offset}


# ---------- helpers ----------

def _native(profile: dict):
    y, m, d = map(int, profile["date"].split("-"))
    hh, mm, *ss = map(int, profile["time"].split(":"))
    place = drik.Place(profile["place"], profile["latitude"], profile["longitude"], profile["utc_offset"])
    jd = utils.julian_day_number(drik.Date(y, m, d), (hh, mm, ss[0] if ss else 0))
    return jd, place


def _jd_on(day: str | None, place) -> float:
    dt = date.fromisoformat(day) if day else date.today()
    return utils.julian_day_number(drik.Date(dt.year, dt.month, dt.day), (12, 0, 0))


def _nakshatra(longitude: float) -> dict:
    span = 360 / 27
    idx = int(longitude // span) % 27
    return {"nakshatra": NAKSHATRAS[idx], "pada": int((longitude % span) // (span / 4)) + 1,
            "nakshatra_lord": PLANETS[NAK_LORDS[idx % 9]]}


def _fmt_date(t) -> str:
    y, m, d = t[:3]
    return f"{y:04d}-{m:02d}-{d:02d}"


def _positions(jd, place, division=1):
    pp = charts.divisional_chart(jd, place, divisional_chart_factor=division)
    asc = pp[0][1]
    planets = {p: tuple(pos) for p, pos in pp[1:] if isinstance(p, int) and p < 9}
    return (asc[0], asc[1]), planets


# ---------- tool implementations (pure functions, easy to test) ----------

def chart_data(profile: dict, division: int = 1) -> dict:
    jd, place = _native(profile)
    asc, planets = _positions(jd, place, division)
    asc_sign = asc[0]
    retro = set(drik.planets_in_retrograde(jd, place))
    _, d1 = _positions(jd, place, 1)
    sun_lon = d1[0][0] * 30 + d1[0][1]

    house_of = lambda sign: (sign - asc_sign) % 12 + 1
    lords = {h: PLANETS[SIGN_LORDS[(asc_sign + h - 1) % 12]] for h in range(1, 13)}
    out = []
    for p, (sign, deg) in planets.items():
        h = house_of(sign)
        lon = sign * 30 + deg
        row = {
            "planet": PLANETS[p], "code": CODES[p], "sign": SIGNS[sign], "sign_num": sign + 1,
            "degree": round(deg, 2), "house": h,
            "retrograde": p in retro or p in (7, 8),
            "lord_of_houses": [hh for hh, name in lords.items() if name == PLANETS[p]],
            "aspects_houses": [(h + n - 2) % 12 + 1 for n in SPECIAL_ASPECTS.get(p, [7])] if p < 7 else [],
        }
        if p < len(const.house_strengths_of_planets):
            row["dignity"] = DIGNITY.get(const.house_strengths_of_planets[p][sign], "")
        if division == 1:
            row.update(_nakshatra(lon))
            if p in COMBUST_ORB:
                dist = abs((lon - sun_lon + 180) % 360 - 180)
                row["combust"] = dist < COMBUST_ORB[p] - (2 if p in (3, 5) and p in retro else 0)
        out.append(row)
    houses = {h: [r["code"] for r in out if r["house"] == h] for h in range(1, 13)}
    asc_info = {"sign": SIGNS[asc_sign], "sign_num": asc_sign + 1, "degree": round(asc[1], 2)}
    if division == 1:
        asc_info.update(_nakshatra(asc_sign * 30 + asc[1]))
    return {"chart": f"D{division}", "ascendant": asc_info, "planets": out,
            "house_lords": lords, "houses": houses,
            "birthplace": profile.get("resolved_place"), "ayanamsa": "Lahiri"}


def karakas_data(profile: dict) -> dict:
    jd, place = _native(profile)
    pp = charts.divisional_chart(jd, place, divisional_chart_factor=1)
    order = house.chara_karakas(pp)
    return {"scheme": "Jaimini 8 chara karakas (Rahu included)",
            "karakas": [{"karaka": KARAKAS[i], "planet": PLANETS[p]} for i, p in enumerate(order)]}


def strength_data(profile: dict) -> dict:
    jd, place = _native(profile)
    sb = strength.shad_bala(jd, place)
    labels = ["sthana_bala", "dig_bala", "kaala_bala", "cheshta_bala", "naisargika_bala", "drik_bala"]
    rows = []
    for i in range(7):
        rows.append({"planet": PLANETS[i],
                     **{lab: round(sb[j][i], 2) for j, lab in enumerate(labels)},
                     "total_rupas": round(sb[7][i], 2), "strength_ratio": round(sb[8][i], 2),
                     "strong": sb[8][i] >= 1})
    rows.sort(key=lambda r: -r["strength_ratio"])
    return {"shadbala": rows, "note": "strength_ratio = total / required minimum; >= 1 means strong"}


def ashtakavarga_data(profile: dict) -> dict:
    jd, place = _native(profile)
    pp = charts.divisional_chart(jd, place, divisional_chart_factor=1)
    asc_sign = pp[0][1][0]
    h2p = utils.get_house_planet_list_from_planet_positions(pp)
    binna, sarva, _ = ashtakavarga.get_ashtaka_varga(h2p)
    by_house = lambda row: {h: row[(asc_sign + h - 1) % 12] for h in range(1, 13)}
    return {
        "sarvashtakavarga_by_house": by_house(sarva),
        "total": sum(sarva),
        "bhinnashtakavarga_by_house": {PLANETS[i]: by_house(binna[i]) for i in range(7)},
        "note": "Houses counted from the ascendant. 28+ bindus in a house is above average.",
    }


def dasha_data(profile: dict, on_date: str | None = None) -> dict:
    jd, place = _native(profile)
    _, rows = vimsottari.get_vimsottari_dhasa_bhukthi(jd, place)
    periods = [((m, b), _fmt_date(start)) for (m, b), start, _dur in rows]
    mahas = []
    for i, ((m, b), start) in enumerate(periods):
        if not mahas or mahas[-1]["lord"] != PLANETS[m]:
            mahas.append({"lord": PLANETS[m], "start": start, "antardashas": []})
        end = periods[i + 1][1] if i + 1 < len(periods) else None
        mahas[-1]["antardashas"].append({"lord": PLANETS[b], "start": start, "end": end})
    for i, md in enumerate(mahas):
        md["end"] = mahas[i + 1]["start"] if i + 1 < len(mahas) else md["antardashas"][-1]["end"]

    today = on_date or date.today().isoformat()
    running = vimsottari.get_running_dhasa_for_given_date(_jd_on(today, place), jd, place, dhasa_level_index=3)
    current = [{"level": lvl, "lord": PLANETS[r[0][-1]], "start": _fmt_date(r[1]), "end": _fmt_date(r[2])}
               for lvl, r in zip(["mahadasha", "antardasha", "pratyantardasha"], running)]
    # full antardasha detail only for the running and next mahadasha keeps the payload small
    cur_idx = next((i for i, m in enumerate(mahas) if m["start"] <= today < (m["end"] or "9999")), 0)
    for i, m in enumerate(mahas):
        if i not in (cur_idx, cur_idx + 1):
            m.pop("antardashas")
    return {"system": "Vimshottari", "as_of": today, "running": current, "mahadashas": mahas}


def transit_data(profile: dict, on_date: str | None = None, months_ahead: int = 0) -> dict:
    jd, place = _native(profile)
    (asc_sign, _), natal = _positions(jd, place, 1)
    moon_sign = natal[1][0]

    def snapshot(day: str):
        tjd = _jd_on(day, place)
        _, now = _positions(tjd, place, 1)
        retro = set(drik.planets_in_retrograde(tjd, place))
        return [{"planet": PLANETS[p], "sign": SIGNS[s], "degree": round(d, 2),
                 "house_from_lagna": (s - asc_sign) % 12 + 1, "house_from_moon": (s - moon_sign) % 12 + 1,
                 "retrograde": p in retro or p in (7, 8)} for p, (s, d) in now.items()]

    day = on_date or date.today().isoformat()
    current = snapshot(day)
    sat_from_moon = next(r["house_from_moon"] for r in current if r["planet"] == "Saturn")
    sade = {12: "rising phase (12th from Moon)", 1: "peak phase (over natal Moon)",
            2: "setting phase (2nd from Moon)"}.get(sat_from_moon)
    result = {
        "date": day, "natal_lagna": SIGNS[asc_sign], "natal_moon_sign": SIGNS[moon_sign],
        "positions": current,
        "sade_sati": sade or "not running",
        "kantaka_or_ashtama_shani": sat_from_moon in (4, 8),
    }
    if months_ahead:
        start = date.fromisoformat(day)
        slow = []
        for k in range(1, min(months_ahead, 36) + 1):
            d = (start.replace(day=1) + timedelta(days=32 * k)).replace(day=1).isoformat()
            slow.append({"month": d[:7], **{r["planet"]: f"{r['sign']} (H{r['house_from_lagna']}, M{r['house_from_moon']})"
                                             for r in snapshot(d) if r["planet"] in ("Jupiter", "Saturn", "Rahu", "Ketu")}})
        result["slow_planets_monthly"] = slow
        result["legend"] = "H = house from natal lagna, M = house from natal Moon"
    return result


def yogas_doshas_data(profile: dict) -> dict:
    jd, place = _native(profile)
    yogas, *_ = yoga.get_yoga_details(jd, place, divisional_chart_factor=1, language="en")
    found = [{"name": v[1], "condition": v[2], "result": v[3][:220]} for v in yogas.values()]
    doshas = {}
    for name, html in dosha.get_dosha_details(jd, place, language="en").items():
        text = re.sub(r"<[^>]+>", " ", html).replace("\\n", " ")
        text = re.sub(r"\s+", " ", text).strip()
        doshas[name] = {"present": not text.lower().startswith("there is no"), "summary": text[:400]}
    return {"yogas": found, "doshas": doshas}


def panchang_data(profile: dict, on_date: str | None = None) -> dict:
    _, place = _native(profile)
    day = on_date or date.today().isoformat()
    jd = _jd_on(day, place)
    t = drik.tithi(jd, place)[0]
    n = drik.nakshatra(jd, place)[0]
    paksha = "Shukla" if t <= 15 else "Krishna"
    tithi_name = "Purnima" if t == 15 else "Amavasya" if t == 30 else TITHIS[(t - 1) % 15]
    return {"date": day, "place": profile.get("resolved_place"),
            "vaara": DAYS[drik.vaara(jd, place) % 7],
            "tithi": f"{paksha} {tithi_name}", "nakshatra": NAKSHATRAS[(n - 1) % 27],
            "yoga": utils.YOGAM_LIST[drik.yogam(jd, place)[0] - 1],
            "karana": utils.KARANA_LIST[drik.karana(jd, place)[0] - 1],
            "sunrise": drik.sunrise(jd, place)[1], "sunset": drik.sunset(jd, place)[1]}


# ---------- tool catalogue (exposed to the model as function tools) ----------

def _schema(**props) -> dict:
    return {"type": "object", "properties": props, "required": []}


_DATE = {"type": "string", "description": "YYYY-MM-DD; omit for today"}

# name, description, JSON schema, implementation, args -> extra positional arguments
TOOLS = [
    ("birth_chart", "The native's Vedic chart: ascendant, each graha's sign, degree, house, nakshatra & pada, "
     "dignity, retrograde/combust, house lordships and graha drishti. division=1 is the D1 Rashi chart; "
     "9 = Navamsa (marriage, dharma), 10 = Dasamsa (career), 2 Hora (wealth), 7 Saptamsa (children), "
     "12 Dwadasamsa (parents), 24, 30, 60 etc.",
     _schema(division={"type": "integer", "description": "Divisional chart factor, 1-60 (default 1)"}),
     chart_data, lambda a: (int(a.get("division") or 1),)),
    ("chara_karakas", "Jaimini chara karakas: Atma, Amatya (career), Dara (spouse) etc.",
     _schema(), karakas_data, lambda a: ()),
    ("shadbala", "Six-fold planetary strength (Shadbala) with strength ratio for Sun..Saturn, strongest first.",
     _schema(), strength_data, lambda a: ()),
    ("ashtakavarga", "Sarvashtakavarga bindus per house and Bhinnashtakavarga per planet.",
     _schema(), ashtakavarga_data, lambda a: ()),
    ("vimshottari_dasha", "Vimshottari dasha: running maha/antar/pratyantar dasha on a date, every mahadasha "
     "with dates, and antardashas of the running and next mahadasha. Use for all timing and predictions.",
     _schema(on_date={"type": "string", "description": "YYYY-MM-DD to evaluate; omit for today"}),
     dasha_data, lambda a: (a.get("on_date") or None,)),
    ("transits", "Gochar: sidereal planet positions on a date with house from natal lagna and natal Moon, "
     "Sade Sati status, and optionally Jupiter/Saturn/Rahu/Ketu month by month for up to 36 months ahead.",
     _schema(on_date=_DATE, months_ahead={"type": "integer", "description": "0-36 months of slow-planet transits to list (default 0)"}),
     transit_data, lambda a: (a.get("on_date") or None, int(a.get("months_ahead") or 0))),
    ("yogas_and_doshas", "Classical yogas present in D1 (Raja, Dhana, Pancha Mahapurusha, Nabhasa...) and "
     "doshas (Manglik, Kala Sarpa, Pitru, Guru Chandala, Ganda Moola...).",
     _schema(), yogas_doshas_data, lambda a: ()),
    ("panchang", "Panchang at the birthplace for a date: tithi, vaara, nakshatra, yoga, karana, sunrise, sunset.",
     _schema(on_date=_DATE), panchang_data, lambda a: (a.get("on_date") or None,)),
]


def run_tool(profile: dict, name: str, args: dict) -> tuple[str, bool]:
    """Run one tool for the native; returns (JSON text or error message, is_error)."""
    spec = next((t for t in TOOLS if t[0] == name), None)
    if not spec:
        return f"Unknown tool {name}", True
    _, _, _, fn, extra = spec
    t0 = time.perf_counter()
    try:
        a = extra(args or {})
        text = json.dumps(fn(profile, *a), ensure_ascii=False)
        log.info("  [pyjhora] %s%s computed in %.0f ms", fn.__name__, a or "", (time.perf_counter() - t0) * 1000)
        return text, False
    except Exception as exc:
        log.exception("  [pyjhora] %s failed", fn.__name__)
        return f"Calculation failed: {exc}", True
