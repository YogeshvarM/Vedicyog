from datetime import datetime
from typing import Optional, Dict, Any, List
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from jyotishganit import calculate_birth_chart, get_birth_chart_json_string
import json

from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
from timezonefinder import TimezoneFinder
from datetime import timezone as dt_timezone
import pytz

app = FastAPI(
    title="Vedic Astrology API",
    description="Returns full Vedic charts (including all divisional charts) as JSON.",
    version="1.0.0",
    servers=[
        {"url": "https://vedic-astrology-api-production.up.railway.app", "description": "Production Server"},
        {"url": "http://localhost:8000", "description": "Local Development"}
    ]
)

# Add CORS middleware for API access from different domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BirthData(BaseModel):
    name: Optional[str] = Field(default=None, description="Name of native")
    date: str = Field(..., description="Date in various formats: YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY, etc.")
    time: str = Field(..., description="Time in 24h or 12h format: HH:MM, HH.MM, 02:35pm, etc.")
    place: str = Field(..., description="Place name (e.g., 'Karimangalam, India', 'New York, USA')")
    
    @field_validator('date')
    @classmethod
    def parse_date(cls, v: str) -> str:
        """Parse and normalize date to YYYY-MM-DD format"""
        import re
        
        # Remove ordinal suffixes (st, nd, rd, th) and extra spaces/commas
        v_cleaned = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', v)
        v_cleaned = re.sub(r'\s*,\s*', ' ', v_cleaned)  # Normalize commas
        v_cleaned = re.sub(r'\s+', ' ', v_cleaned).strip()  # Normalize spaces
        
        date_formats = [
            "%Y-%m-%d",  # ISO format: YYYY-MM-DD
            "%d-%m-%Y",  # DD-MM-YYYY
            "%d/%m/%Y",  # DD/MM/YYYY
            "%Y/%m/%d",  # YYYY/MM/DD
            "%d.%m.%Y",  # DD.MM.YYYY
            "%Y.%m.%d",  # YYYY.MM.DD
            "%d %B %Y",  # DD Month YYYY (e.g., 05 May 1999)
            "%d %b %Y",  # DD Mon YYYY (e.g., 05 May 1999)
            "%B %d %Y",  # Month DD YYYY (e.g., May 05 1999)
            "%b %d %Y",  # Mon DD YYYY (e.g., May 05 1999)
            "%d-%B-%Y",  # DD-Month-YYYY
            "%d-%b-%Y",  # DD-Mon-YYYY
        ]
        
        for fmt in date_formats:
            try:
                dt = datetime.strptime(v_cleaned, fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        
        raise ValueError(f"Invalid date format: {v}. Supported formats: YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, '5th May 1999', 'May 5, 1999'")
    
    @field_validator('time')
    @classmethod
    def parse_time(cls, v: str) -> str:
        """Parse and normalize time to HH:MM format"""
        # Normalize: replace dots with colons
        v = v.replace('.', ':')
        # Normalize: ensure space before AM/PM and make uppercase
        v_upper = v.upper()
        # Handle formats like "02:35PM" -> "02:35 PM"
        import re
        v_normalized = re.sub(r'(\d)([AP]M)', r'\1 \2', v_upper)
        
        time_formats = [
            "%H:%M",     # HH:MM (24-hour)
            "%H:%M:%S",  # HH:MM:SS (24-hour)
            "%I:%M %p",  # 12-hour format with AM/PM (with space)
        ]
        
        for fmt in time_formats:
            try:
                dt = datetime.strptime(v_normalized, fmt)
                return dt.strftime("%H:%M")
            except ValueError:
                continue
        
        raise ValueError(f"Invalid time format: {v}. Supported formats: HH:MM, HH.MM, HH:MM:SS, 02:35 PM, 02:35PM")
    
class BirthChartResponse(BaseModel):
    birth_data: Dict[str, Any]
    panchanga: Dict[str, Any]
    d1_chart: Dict[str, Any]
    charts: Optional[Dict[str, Any]] = None
    raw_chart: Optional[Dict[str, Any]] = None


# ... (keeping existing helper functions) ...

@app.post("/birth_chart", response_model=BirthChartResponse)
def birth_chart(
    data: BirthData, 
    detailed: bool = Query(
        default=True,
        description="By default returns ALL divisional charts and raw data. Set 'detailed=false' to only get D1 chart (smaller response)."
    )
):
    """
    Get birth chart data. 
    By default, returns only D1 chart and basic info (fast & small).
    Set 'detailed=true' to get ALL divisional charts and raw data (may be large).
    """
    birth_dt = datetime_from_strings(data.date, data.time)
    
    # Geocode the place and get timezone
    latitude, longitude, tz_offset = get_location_data(data.place, birth_dt)

    chart = calculate_birth_chart(
        birth_date=birth_dt,
        latitude=latitude,
        longitude=longitude,
        timezone_offset=tz_offset,
        name=data.name or "User",
    )

    panchanga_json = panchanga_to_json(chart)
    
    # Always calculate D1 for the summary
    d1_json = divisional_chart_to_json(chart.d1_chart)

    birth_data_json = {
        "name": data.name or "User",
        "datetime": birth_dt.isoformat(),
        "date": data.date,
        "time": data.time,
        "place": data.place,
        "tz_offset": tz_offset,
        "latitude": latitude,
        "longitude": longitude,
        "ascendant_sign": getattr(chart.d1_chart.houses[0].sign, "name", str(chart.d1_chart.houses[0].sign)),
        "moon_sign": getattr(chart.d1_chart.planets[1].sign, "name", str(chart.d1_chart.planets[1].sign)),
    }

    response = BirthChartResponse(
        birth_data=birth_data_json,
        panchanga=panchanga_json,
        d1_chart=d1_json,
        charts=None,
        raw_chart=None
    )

    if detailed:
        response.raw_chart = json.loads(get_birth_chart_json_string(chart))
        response.charts = all_divisional_charts_to_json(chart)

    return response

class DivisionalChartResponse(BaseModel):
    division: str
    chart_data: Dict[str, Any]

class PlanetInfo(BaseModel):
    name: str
    sign: str
    house: int
    is_retrograde: bool
    aspects: List[Dict[str, Any]]

class PlanetsResponse(BaseModel):
    planets: List[PlanetInfo]

class DashaResponse(BaseModel):
    dashas: Dict[str, Any]


class FullChartResponse(BaseModel):
    birth_data: Dict[str, Any]
    panchanga: Dict[str, Any]
    d1_chart: Dict[str, Any]
    charts: Optional[Dict[str, Any]] = None
    raw_chart: Optional[Dict[str, Any]] = None
    planets: Optional[List[Dict[str, Any]]] = None
    dashas: Optional[Dict[str, Any]] = None
    ashtakavarga: Optional[Dict[str, Any]] = None


def get_timezone_offset(latitude: float, longitude: float, dt: datetime) -> float:
    """Get timezone offset for a location at a specific datetime"""
    tf = TimezoneFinder()
    tz_name = tf.timezone_at(lat=latitude, lng=longitude)
    
    if tz_name is None:
        raise ValueError(f"Could not determine timezone for coordinates ({latitude}, {longitude})")
    
    tz = pytz.timezone(tz_name)
    # Get the offset for the specific datetime (accounts for DST)
    offset_seconds = tz.utcoffset(dt).total_seconds()
    return offset_seconds / 3600  # Convert to hours


def get_location_data(place_name: str, dt: datetime) -> tuple[float, float, float]:
    """Get latitude, longitude, and timezone offset for a place name"""
    geolocator = Nominatim(user_agent="vedic-astrology-api")
    
    try:
        location = geolocator.geocode(place_name, timeout=10)
        
        if not location:
            raise HTTPException(status_code=404, detail=f"Could not find location '{place_name}'. Please try a more specific name (e.g., 'City, State, Country').")
        
        latitude = location.latitude
        longitude = location.longitude
        
        # Get timezone offset
        tf = TimezoneFinder()
        tz_name = tf.timezone_at(lat=latitude, lng=longitude)
        
        if tz_name is None:
            raise HTTPException(status_code=500, detail=f"Could not determine timezone for '{place_name}'")
        
        tz = pytz.timezone(tz_name)
        offset_seconds = tz.utcoffset(dt).total_seconds()
        tz_offset = offset_seconds / 3600
        
        return latitude, longitude, tz_offset
        
    except GeocoderTimedOut:
        raise HTTPException(status_code=504, detail="Geocoding service timed out. Please try again.")
    except GeocoderServiceError as e:
        raise HTTPException(status_code=503, detail=f"Geocoding service error: {str(e)}")


def datetime_from_strings(date_str: str, time_str: str) -> datetime:
    """Create datetime from validated date and time strings (already normalized by Pydantic)"""
    return datetime.fromisoformat(f"{date_str}T{time_str}:00")


def divisional_chart_to_json(dchart) -> Dict[str, Any]:
    houses_json = []
    for house in dchart.houses:
        occupants_json = []
        for p in house.occupants:
            occupants_json.append(
                {
                    "planet": getattr(getattr(p, "celestial_body", None), "name", str(getattr(p, "celestial_body", ""))),
                    "sign": getattr(getattr(p, "sign", None), "name", str(getattr(p, "sign", ""))),
                }
            )

        houses_json.append(
            {
                "house_number": getattr(house, "number", None),
                "sign": getattr(getattr(house, "sign", None), "name", str(getattr(house, "sign", ""))),
                "occupants": occupants_json,
            }
        )
    return {"houses": houses_json}


def all_divisional_charts_to_json(chart) -> Dict[str, Any]:
    result = {}
    for key, dchart in chart.divisional_charts.items():
        result[key] = divisional_chart_to_json(dchart)
    return result


def panchanga_to_json(chart) -> Dict[str, Any]:
    p = chart.panchanga
    return {
        "tithi": getattr(p, "tithi", None),
        "nakshatra": getattr(p, "nakshatra", None),
        "yoga": getattr(p, "yoga", None),
        "karana": getattr(p, "karana", None),
        "vaara": getattr(p, "vaara", None),
    }


def planets_to_json(chart) -> List[Dict[str, Any]]:
    planets_data = []
    for p in chart.d1_chart.planets:
        aspects_data = []
        if hasattr(p, 'aspects'):
            for aspect in p.aspects:
                aspects_data.append({
                    "type": getattr(aspect, 'type', str(aspect)),
                    "target": str(getattr(aspect, 'target', ''))
                })
        
        planets_data.append({
            "name": getattr(getattr(p, "celestial_body", None), "name", str(getattr(p, "celestial_body", ""))),
            "sign": getattr(getattr(p, "sign", None), "name", str(getattr(p, "sign", ""))),
            "house": getattr(getattr(p, "house", None), "number", 0),
            "is_retrograde": getattr(p, "motion_type", "").lower() == "retrograde" if hasattr(p, "motion_type") else False,
            "aspects": aspects_data
        })
    return planets_data


def dashas_to_json(chart) -> Dict[str, Any]:
    if hasattr(chart, 'dashas'):
        # Assuming dashas is a complex object, we might need to serialize it carefully
        # For now, let's try to convert it to dict if possible, or string representation
        try:
            return getattr(chart.dashas, 'to_dict', lambda: {"raw": str(chart.dashas)})()
        except Exception:
            return {"info": str(chart.dashas)}
    return {}


def get_chart_object(data: BirthData):
    birth_dt = datetime_from_strings(data.date, data.time)
    latitude, longitude, tz_offset = get_location_data(data.place, birth_dt)
    
    return calculate_birth_chart(
        birth_date=birth_dt,
        latitude=latitude,
        longitude=longitude,
        timezone_offset=tz_offset,
        name=data.name or "User",
    )


@app.post("/full_chart", response_model=FullChartResponse)
def full_chart(data: BirthData):
    """Return a single JSON containing all available information: birth data, panchanga, D1, all divisional charts, raw chart, planets, dashas, and ashtakavarga if available."""
    birth_dt = datetime_from_strings(data.date, data.time)
    latitude, longitude, tz_offset = get_location_data(data.place, birth_dt)

    chart = calculate_birth_chart(
        birth_date=birth_dt,
        latitude=latitude,
        longitude=longitude,
        timezone_offset=tz_offset,
        name=data.name or "User",
    )

    panchanga_json = panchanga_to_json(chart)
    d1_json = divisional_chart_to_json(chart.d1_chart)
    charts_json = all_divisional_charts_to_json(chart)
    raw_json = None
    try:
        raw_json = json.loads(get_birth_chart_json_string(chart))
    except Exception:
        raw_json = None

    planets_json = planets_to_json(chart)
    dashas_json = dashas_to_json(chart)
    ashtakavarga_json = None
    if raw_json and isinstance(raw_json, dict):
        ashtakavarga_json = raw_json.get("ashtakavarga")

    birth_data_json = {
        "name": data.name or "User",
        "datetime": birth_dt.isoformat(),
        "date": data.date,
        "time": data.time,
        "place": data.place,
        "tz_offset": tz_offset,
        "latitude": latitude,
        "longitude": longitude,
        "ascendant_sign": getattr(chart.d1_chart.houses[0].sign, "name", str(chart.d1_chart.houses[0].sign)),
        "moon_sign": getattr(chart.d1_chart.planets[1].sign, "name", str(chart.d1_chart.planets[1].sign)),
    }

    return FullChartResponse(
        birth_data=birth_data_json,
        panchanga=panchanga_json,
        d1_chart=d1_json,
        charts=charts_json,
        raw_chart=raw_json,
        planets=planets_json,
        dashas=dashas_json,
        ashtakavarga=ashtakavarga_json,
    )


@app.get("/health")
@app.get("/api")
def health_check():
    """Health check endpoint for Railway and monitoring"""
    return {
        "status": "healthy",
        "service": "Vedicyog API",
        "version": "1.0.0",
        "endpoints": {
            "docs": "/docs",
            "birth_chart": "/birth_chart"
        }
    }





@app.post("/charts/{division}", response_model=DivisionalChartResponse)
def get_divisional_chart(division: str, data: BirthData):
    """
    Get a specific divisional chart (e.g., D1, D9, D10).
    """
    chart = get_chart_object(data)
    
    # Normalize division name (e.g., "d1" -> "D1")
    div_key = division.upper()
    if not div_key.startswith("D"):
        div_key = "D" + div_key
        
    if div_key not in chart.divisional_charts:
        # Try to find it case-insensitive
        found = False
        for key in chart.divisional_charts.keys():
            if key.upper() == div_key:
                div_key = key
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail=f"Divisional chart '{division}' not found. Available: {list(chart.divisional_charts.keys())}")

    dchart = chart.divisional_charts[div_key]
    return DivisionalChartResponse(
        division=div_key,
        chart_data=divisional_chart_to_json(dchart)
    )


@app.post("/planets", response_model=PlanetsResponse)
def get_planetary_details(data: BirthData):
    """
    Get detailed planetary information including positions, retrograde status, and aspects.
    """
    chart = get_chart_object(data)
    return PlanetsResponse(planets=planets_to_json(chart))


@app.post("/dashas", response_model=DashaResponse)
def get_dashas(data: BirthData):
    """
    Get Vimshottari Dasha details.
    """
    chart = get_chart_object(data)
    return DashaResponse(dashas=dashas_to_json(chart))


# Serve frontend static files
FRONTEND_DIR = Path(__file__).parent / "frontend"

@app.get("/")
def serve_frontend():
    """Serve the main frontend page"""
    return FileResponse(FRONTEND_DIR / "index.html")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/{filename:path}")
def serve_static(filename: str):
    """Serve static files (js, css, etc.)"""
    file_path = FRONTEND_DIR / filename
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    return FileResponse(FRONTEND_DIR / "index.html")
