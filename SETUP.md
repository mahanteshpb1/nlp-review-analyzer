# Review Intel — Setup Guide

## Backend

```bash
cd backend

# Create virtualenv
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install deps
pip install -r requirements.txt

# Download spaCy model
python -m spacy download en_core_web_sm

# Run (models download on first start — ~500MB)
python main.py
```

Backend runs at http://localhost:8000
Health check: http://localhost:8000/health

---

## Chrome Extension

1. Open Chrome → chrome://extensions
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension/` folder

Navigate to any Amazon product page (e.g. amazon.in/dp/B09BFV96TS)
Click the "Analyze Reviews" button (bottom right)

---

## Architecture

```
extension/
  manifest.json   — MV3 manifest
  scraper.js      — Client-side review scraper (runs in Amazon page context)
  content.js      — Orchestrator: scrape → POST /analyze → render overlay
  overlay.css     — Panel styles injected into Amazon
  background.js   — Service worker

backend/
  main.py         — FastAPI app, /analyze endpoint
  nlp/
    pipeline.py   — RoBERTa sentiment + spaCy aspects + KeyBERT keywords
  requirements.txt
```

---

## Data Flow

1. User lands on amazon.in/dp/{ASIN}
2. content.js detects product page, injects "Analyze Reviews" FAB
3. User clicks FAB → overlay opens
4. scraper.js fetches /product-reviews/{ASIN} pages using browser session
5. DOM parsed, reviews extracted (title, body, rating, author, date, verified)
6. Structured JSON POSTed to FastAPI localhost:8000/analyze
7. pipeline.py runs:
   - RoBERTa classifies sentiment per review
   - Aspect seeds matched → feature-level sentiment aggregated
   - KeyBERT extracts top keywords
   - Summary + verdict generated
8. Analytics JSON returned to content.js
9. Overlay renders: metrics, summary, aspect bars, sentiment bar, review explorer

---

## Next Steps (Phase 2)

- React dashboard (replaces raw DOM overlay)
- Recharts visualizations (donut, stacked bar, timeline)
- BART/T5 abstractive summarization
- Trend analysis (group reviews by date)
- Feature-targeted scraping (keyword filter per aspect)
- Caching layer (Redis or localStorage)
