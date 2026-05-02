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


## Scaling to New Sites

Add a new adapter to `SITE_ADAPTERS` in `content.js`:

```js
myntra: {
  test: () => /myntra\.com/.test(location.hostname),
  productTitle: () => document.querySelector('.pdp-title')?.textContent?.trim(),
  reviewItems: () => [...document.querySelectorAll('.detailed-review')],
  parseReview: (el) => ({
    id: crypto.randomUUID(),
    text: el.querySelector('.user-review')?.textContent?.trim() || '',
    rating: parseFloat(el.querySelector('.rating')?.textContent || '0'),
    date: el.querySelector('.review-date')?.textContent?.trim() || '',
    username: el.querySelector('.author')?.textContent?.trim() || 'Anonymous',
    helpful: 0,
  }),
  insertionPoint: () => document.querySelector('.ratings-container'),
}
```

No other changes needed.

## Handling Amazon SPA Behavior

Amazon uses a hybrid SPA — product pages are server-rendered but reviews
load lazily via XHR as you scroll. The content script handles this with:

1. **`waitForReviews()`**: MutationObserver watches for DOM changes with a
   12-second timeout. Reviews appear as the user scrolls or after JS settles.

2. **1.5s initial delay**: Amazon re-renders above-the-fold content after
   load. Waiting avoids scraping stale/empty DOM.

3. **Fallback selector chain**: Multiple CSS selectors tried in order. Amazon
   has changed their DOM structure many times; having a chain makes it more
   resilient to redesigns.

4. **Data caching**: Once scraped and analyzed, results are stored in memory.
   Toggling the dashboard open/close doesn't re-fetch.

## Production Considerations

| Concern | Solution |
|---|---|
| Model cold start | Run uvicorn with `--workers 1`, use gunicorn + model preload |
| Rate limiting | Add slowapi or Redis-based rate limiter per extension ID |
| CORS in prod | Restrict to `chrome-extension://<extension-id>` origin |
| Model hosting | Deploy on RunPod / Modal / HuggingFace Inference Endpoints |
| Review cap | Currently 500 per request; batch larger sets if needed |
| Amazon bot detection | Extension runs in-browser with real cookies — not detected |