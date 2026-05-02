# ReviewLens — AI Sentiment Dashboard Extension

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     BROWSER (Product Page)                   │
│                                                             │
│  ┌───────────────┐    ┌──────────────────────────────────┐  │
│  │  Content      │    │  Background Service Worker       │  │
│  │  Script       │───▶│  (chrome.runtime.sendMessage)    │  │
│  │  - Scrapes    │    │  - Proxies fetch to backend      │  │
│  │    reviews    │◀───│  - Avoids CORS                   │  │
│  │  - Injects    │    └──────────────┬───────────────────┘  │
│  │    iframe     │                   │                       │
│  └───────────────┘                   │                       │
│         │                            │ HTTP POST /analyze    │
│         │ postMessage(data)          ▼                       │
│  ┌──────▼──────────────────┐  ┌─────────────────────────┐  │
│  │  React Dashboard        │  │  FastAPI Backend         │  │
│  │  (runs in iframe)       │  │                         │  │
│  │  - Recharts             │  │  DistilRoBERTa           │  │
│  │  - Sentiment donut      │  │  Sentiment Classification│  │
│  │  - Aspect bar chart     │  │  Aspect Extraction       │  │
│  │  - Trend area chart     │  │  Keyword Extraction      │  │
│  │  - Review list          │  │  (KeyBERT / YAKE)        │  │
│  └─────────────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Folder Structure

```
reviewlens/
├── extension/
│   ├── public/
│   │   ├── manifest.json      # MV3 manifest
│   │   ├── content.css        # Minimal injected styles
│   │   └── icons/             # Extension icons (add your own)
│   ├── src/
│   │   ├── components/
│   │   │   └── Dashboard.jsx  # Full React dashboard
│   │   ├── content.js         # Scraping + injection logic
│   │   ├── background.js      # Service worker / proxy
│   │   └── main.jsx           # React entry point
│   ├── index.html             # Dashboard shell
│   ├── vite.config.js
│   └── package.json
│
└── backend/
    ├── app/
    │   ├── main.py            # FastAPI app
    │   ├── routers/
    │   │   └── analysis.py    # /analyze endpoint
    │   ├── services/
    │   │   └── nlp_service.py # Sentiment + aspect pipeline
    │   └── models/
    │       └── schemas.py     # Pydantic request/response
    ├── requirements.txt
    └── README.md
```

## Setup

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

On first request, HuggingFace will download:
- `cardiffnlp/twitter-roberta-base-sentiment-latest` (~500MB)

### Extension

```bash
cd extension
npm install
npm run build          # outputs to dist/
```

Load in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/dist/`

## API Contract

**POST /analyze**

Request:
```json
{
  "product_title": "Samsung Galaxy S24 Ultra",
  "reviews": [
    {
      "id": "abc123",
      "text": "Battery life is great but camera disappoints",
      "rating": 3.0,
      "date": "January 15, 2024",
      "username": "Rahul K.",
      "helpful": 12
    }
  ]
}
```

Response:
```json
{
  "product_title": "Samsung Galaxy S24 Ultra",
  "total_reviews": 1,
  "sentiment_distribution": { "positive": 0, "neutral": 1, "negative": 0 },
  "aspect_sentiment": [
    { "aspect": "battery", "positive": 1, "neutral": 0, "negative": 0, "score": 1.0 },
    { "aspect": "camera", "positive": 0, "neutral": 0, "negative": 1, "score": -1.0 }
  ],
  "trends": [{ "period": "Jan 2024", "positive": 0, "neutral": 1, "negative": 0, "avg_rating": 3.0 }],
  "insights": [...],
  "top_keywords": ["battery", "camera", ...],
  "reviews": [{ ...original, "sentiment": "neutral", "sentiment_score": 0.71, "aspects": {...} }]
}
```