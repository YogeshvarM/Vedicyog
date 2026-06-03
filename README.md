# Vedicyog

Vedic Astrology Chart Generator with South Indian style divisional charts.

## Features

- South Indian style Rasi (D1) and all divisional charts (D2-D60)
- Planet dignity indicators (Exalted, Debilitated, Own Sign, etc.)
- Vimshottari Dasha with Mahadasha/Antardasha/Pratyantardasha
- Panchanga details (Tithi, Nakshatra, Yoga, Karana, Vaara)
- PDF download
- Mobile-friendly responsive design

## Local Development

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run server
uvicorn main:app --reload --port 8000
```

Visit http://localhost:8000

## Deployment

Deploy to Railway:
1. Push to GitHub
2. Connect repo to Railway
3. Railway auto-deploys

## API Endpoints

- `POST /full_chart` - Get complete chart data
- `POST /birth_chart` - Get birth chart
- `POST /charts/{division}` - Get specific divisional chart
- `POST /planets` - Get planetary details
- `POST /dashas` - Get dasha details
- `GET /health` - Health check

## License

Copyright 2024 Vedicyog. All rights reserved.
