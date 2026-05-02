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