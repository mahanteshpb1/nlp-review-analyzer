# ReviewIntel

An Amazon product-review intelligence extension that scrapes reviews from Amazon, analyzes them with a FastAPI-backed NLP pipeline, and renders an inline sentiment dashboard directly on the product page.

## Features

- Scrapes Amazon review data from product pages
- Sends review payloads to a local FastAPI backend
- Classifies review sentiment as positive, neutral, or negative
- Extracts aspect-level sentiment for key product features
- Extracts top keywords from the review corpus
- Generates a summary and recommendation verdict
- Injects a lightweight inline dashboard into Amazon product pages

## Project structure

```text
.
|-- backend/
|   |-- main.py
|   `-- nlp/
|       `-- pipeline.py
`-- extension/
    |-- background.js
    |-- content.js
    |-- manifest.json
    |-- overlay.css
    |-- package.json
    |-- scraper.js
    `-- icons/
```

## How it works

1. The Chrome extension loads on Amazon product pages matched by `manifest.json`.
2. `scraper.js` collects review data and page metadata.
3. `content.js` injects a button and renders the analysis panel.
4. `background.js` forwards the payload to a local FastAPI backend.
5. `backend/main.py` validates the request and runs `ReviewPipeline` from `backend/nlp/pipeline.py`.
6. The backend returns sentiment, aspect sentiment, keywords, summary, verdict, and annotated reviews.
7. `content.js` renders the results in the page overlay.

## Current implementation notes

This repository currently contains a plain JavaScript Chrome extension, not a React/Vite-based dashboard.

The README is aligned to the current implementation:

- `extension/` contains the browser extension assets
- `backend/main.py` is the FastAPI entry point
- `backend/nlp/pipeline.py` contains the NLP logic
- There is no build step in `extension/package.json`
- The extension is currently targeted at Amazon product pages

## Getting started

### 1. Start the backend

From the repository root:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn torch transformers keybert spacy
python main.py
```

The backend listens on `http://localhost:8000`.

> The first request may download model weights from Hugging Face, which can take time.

### 2. Load the extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select the `extension` folder

## API

### POST /analyze

Sends Amazon product data and review objects to the backend.

#### Example request

```json
{
  "product": {
    "asin": "B0ABC12345",
    "name": "Example Product",
    "domain": "amazon.in",
    "url": "https://www.amazon.in/dp/B0ABC12345"
  },
  "reviews": [
    {
      "id": "abc123",
      "title": "Great battery life",
      "body": "Battery life is excellent, but the camera could be better.",
      "rating": 3.0,
      "author": "Rahul K.",
      "date": "January 15, 2024",
      "verified": true,
      "helpful": 12
    }
  ]
}
```

#### Example response

```json
{
  "product": {
    "asin": "B0ABC12345",
    "name": "Example Product",
    "domain": "amazon.in",
    "url": "https://www.amazon.in/dp/B0ABC12345"
  },
  "total_reviews": 1,
  "sentiment_distribution": {
    "positive": 0,
    "neutral": 1,
    "negative": 0
  },
  "aspect_sentiments": {
    "battery": {
      "positive": 100.0,
      "negative": 0.0,
      "neutral": 0.0,
      "total": 1
    },
    "camera": {
      "positive": 0.0,
      "negative": 100.0,
      "neutral": 0.0,
      "total": 1
    }
  },
  "top_positive_feature": "battery",
  "top_negative_feature": "camera",
  "common_complaints": ["camera"],
  "keywords": ["battery", "camera"],
  "summary": "50% of 1 reviews are positive. Users consistently praise battery. The most common complaint is camera.",
  "verdict": "Generally recommended with caveats. Best feature: battery. Main weakness: camera.",
  "reviews": [
    {
      "id": "abc123",
      "title": "Great battery life",
      "body": "Battery life is excellent, but the camera could be better.",
      "rating": 3.0,
      "author": "Rahul K.",
      "date": "January 15, 2024",
      "verified": true,
      "helpful": 12,
      "sentiment": "neutral",
      "confidence": 0.73,
      "aspects": ["battery", "camera"]
    }
  ]
}
```

### GET /health

Returns backend status and model metadata.

## Usage

1. Visit an Amazon product page.
2. A floating Analyze Reviews button appears.
3. Click it to scrape reviews and open the inline dashboard.
4. Review the sentiment summary, aspect sentiment, top keywords, and extracted complaints.

## Current limitations

- The extension is currently scoped to Amazon product pages.
- The current backend is a local prototype and uses `allow_origins=["*"]`.
- No automated tests are included in the repository.
- The current aspect extraction is based on seed terms in `pipeline.py`, not a full semantic extractor.

## Production considerations

- Restrict CORS to the Chrome extension origin in production.
- Add rate limiting if the backend is exposed publicly.
- Consider hosting the backend with model weights preloaded.
- Keep the review batch size bounded to avoid large payloads.

## Contributing

Pull requests are welcome. Please keep the README aligned with the actual implementation and note any changes to the extension behavior or backend contract.