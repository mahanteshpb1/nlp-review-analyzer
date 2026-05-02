/**
 * ReviewLens Background Service Worker
 * Proxies requests to the NLP backend (avoids CORS from content script)
 */

const BACKEND_URL = 'http://localhost:8000'; // swap to prod URL

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_REVIEWS') {
    handleAnalysis(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }
});

async function handleAnalysis({ reviews, productTitle }) {
  const response = await fetch(`${BACKEND_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviews, product_title: productTitle }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Backend error ${response.status}: ${err}`);
  }

  return response.json();
}
