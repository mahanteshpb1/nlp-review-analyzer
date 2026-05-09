// content.js — Main orchestrator
// Injected into Amazon product pages

(async () => {
  // Guard: only run on product pages
  const product = window.ReviewScraper.detectProduct();
  if (!product) return;

  console.log('[ReviewIntel] Product detected:', product);

  // ── Inject trigger button ─────────────────────────────────────────────────

  injectTriggerButton(product);

})();

// ── Trigger button ────────────────────────────────────────────────────────────

function injectTriggerButton(product) {
  // Avoid duplicate injection
  if (document.getElementById('review-intel-btn')) return;

  const btn = document.createElement('div');
  btn.id = 'review-intel-btn';
  btn.innerHTML = `
    <div id="ri-fab">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
      <span>Analyze Reviews</span>
    </div>
  `;

  btn.addEventListener('click', () => launchDashboard(product));

  // Insert near the ratings section
  const target =
    document.getElementById('averageCustomerReviews') ||
    document.getElementById('reviews-medley') ||
    document.querySelector('#reviewsMedley') ||
    document.body;

  target.parentNode?.insertBefore(btn, target) || document.body.appendChild(btn);
}

// ── Dashboard overlay ─────────────────────────────────────────────────────────

function launchDashboard(product) {
  // Remove existing overlay
  document.getElementById('review-intel-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'review-intel-overlay';
  overlay.innerHTML = buildOverlayHTML(product);
  document.body.appendChild(overlay);

  // Close button
  overlay.querySelector('#ri-close').addEventListener('click', () => overlay.remove());

  // Start analysis pipeline
  runPipeline(product, overlay);
}

// ── Pipeline: scrape → backend → render ──────────────────────────────────────

async function runPipeline(product, overlay) {
  const BACKEND = 'http://localhost:8000';

  setStatus(overlay, 'scraping', `Scraping reviews for ${product.name}…`);

  let scraped;
  try {
    scraped = await window.ReviewScraper.scrapeReviews({
      maxPages: 10,
      maxReviews: 150,
      sortBy: 'recent',
      onProgress: (page, count) => {
        setStatus(overlay, 'scraping', `Scraped ${count} reviews (page ${page})…`);
      }
    });
  } catch (err) {
    setStatus(overlay, 'error', `Scraping failed: ${err.message}`);
    return;
  }

  if (!scraped.reviews.length) {
    setStatus(overlay, 'error', 'No reviews found. Make sure you are on an Amazon product page.');
    return;
  }

  setStatus(overlay, 'analyzing', `Analyzing ${scraped.reviews.length} reviews with NLP…`);

  let analytics;
  try {
    const resp = await fetch(`${BACKEND}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: scraped.product,
        reviews: scraped.reviews,
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Backend error ${resp.status}`);
    }

    analytics = await resp.json();
  } catch (err) {
    setStatus(overlay, 'error', `Backend error: ${err.message}. Is FastAPI running on :8000?`);
    return;
  }

  renderDashboard(overlay, analytics, scraped);
}

// ── Status helper ─────────────────────────────────────────────────────────────

function setStatus(overlay, type, message) {
  const statusEl = overlay.querySelector('#ri-status');
  if (!statusEl) return;
  statusEl.className = `ri-status ri-status--${type}`;
  statusEl.textContent = message;
}

// ── Overlay HTML skeleton ─────────────────────────────────────────────────────

function buildOverlayHTML(product) {
  return `
    <div id="ri-panel">
      <div id="ri-header">
        <div>
          <div id="ri-title">Review Intelligence</div>
          <div id="ri-subtitle">${escHtml(product.name.slice(0, 60))}${product.name.length > 60 ? '…' : ''}</div>
        </div>
        <button id="ri-close">✕</button>
      </div>
      <div id="ri-status" class="ri-status ri-status--scraping">Initializing…</div>
      <div id="ri-dashboard" style="display:none"></div>
    </div>
  `;
}

// ── Dashboard renderer ────────────────────────────────────────────────────────

function renderDashboard(overlay, analytics, scraped) {
  const status = overlay.querySelector('#ri-status');
  status.style.display = 'none';

  const dash = overlay.querySelector('#ri-dashboard');
  dash.style.display = 'block';

  const d = analytics;
  const total = d.total_reviews;
  const posPct = Math.round(d.sentiment_distribution.positive / total * 100);
  const negPct = Math.round(d.sentiment_distribution.negative / total * 100);
  const neuPct = 100 - posPct - negPct;

  dash.innerHTML = `
    <!-- Metrics row -->
    <div class="ri-metrics">
      <div class="ri-metric">
        <div class="ri-metric-label">Reviews</div>
        <div class="ri-metric-val">${total}</div>
      </div>
      <div class="ri-metric">
        <div class="ri-metric-label">Positive</div>
        <div class="ri-metric-val ri-green">${posPct}%</div>
      </div>
      <div class="ri-metric">
        <div class="ri-metric-label">Negative</div>
        <div class="ri-metric-val ri-red">${negPct}%</div>
      </div>
      <div class="ri-metric">
        <div class="ri-metric-label">Top praised</div>
        <div class="ri-metric-val ri-small">${d.top_positive_feature || '—'}</div>
      </div>
      <div class="ri-metric">
        <div class="ri-metric-label">Top complaint</div>
        <div class="ri-metric-val ri-small">${d.top_negative_feature || '—'}</div>
      </div>
    </div>

    <!-- Summary -->
    <div class="ri-section">
      <div class="ri-section-title">AI Summary</div>
      <div class="ri-summary">${escHtml(d.summary)}</div>
    </div>

    <!-- Sentiment bar -->
    <div class="ri-section">
      <div class="ri-section-title">Sentiment Distribution</div>
      <div class="ri-sent-bar">
        <div class="ri-sent-pos" style="width:${posPct}%" title="Positive ${posPct}%"></div>
        <div class="ri-sent-neu" style="width:${neuPct}%" title="Neutral ${neuPct}%"></div>
        <div class="ri-sent-neg" style="width:${negPct}%" title="Negative ${negPct}%"></div>
      </div>
      <div class="ri-sent-legend">
        <span class="ri-dot ri-dot-green"></span>Positive ${posPct}%
        <span class="ri-dot ri-dot-gray" style="margin-left:12px"></span>Neutral ${neuPct}%
        <span class="ri-dot ri-dot-red" style="margin-left:12px"></span>Negative ${negPct}%
      </div>
    </div>

    <!-- Aspect breakdown -->
    <div class="ri-section">
      <div class="ri-section-title">Feature Sentiment</div>
      ${renderAspectBars(d.aspect_sentiments)}
    </div>

    <!-- Common complaints -->
    <div class="ri-section">
      <div class="ri-section-title">Common Complaints</div>
      <div class="ri-complaints">
        ${(d.common_complaints || []).map(c => `<span class="ri-tag ri-tag-neg">${escHtml(c)}</span>`).join('')}
      </div>
    </div>

    <!-- Verdict -->
    <div class="ri-verdict">
      <strong>Verdict:</strong> ${escHtml(d.verdict)}
    </div>

    <!-- Review explorer -->
    <div class="ri-section">
      <div class="ri-section-title">Reviews <span id="ri-rev-count">(${scraped.reviews.length})</span></div>
      <div class="ri-filter-row">
        <button class="ri-chip ri-chip-active" onclick="riFilter(this,'all')">All</button>
        <button class="ri-chip" onclick="riFilter(this,'positive')">Positive</button>
        <button class="ri-chip" onclick="riFilter(this,'negative')">Negative</button>
        <button class="ri-chip" onclick="riFilter(this,'neutral')">Neutral</button>
      </div>
      <div id="ri-review-list">
        ${renderReviewCards(d.reviews || scraped.reviews)}
      </div>
    </div>
  `;

  // Filter handler — attach to window for onclick
  window.riFilter = (btn, sentiment) => {
    overlay.querySelectorAll('.ri-chip').forEach(b => b.classList.remove('ri-chip-active'));
    btn.classList.add('ri-chip-active');
    const toShow = sentiment === 'all'
      ? (d.reviews || scraped.reviews)
      : (d.reviews || scraped.reviews).filter(r => r.sentiment === sentiment);
    overlay.querySelector('#ri-review-list').innerHTML = renderReviewCards(toShow);
    overlay.querySelector('#ri-rev-count').textContent = `(${toShow.length})`;
  };
}

function renderAspectBars(aspects) {
  if (!aspects || !Object.keys(aspects).length) return '<div class="ri-empty">No aspects extracted.</div>';
  return Object.entries(aspects).map(([feature, scores]) => {
    const pos = Math.round(scores.positive || 0);
    const neg = Math.round(scores.negative || 0);
    return `
      <div class="ri-aspect-row">
        <div class="ri-aspect-name">${escHtml(feature)}</div>
        <div class="ri-bar-track">
          <div class="ri-bar-pos" style="width:${pos}%"></div>
          <div class="ri-bar-neg" style="width:${neg}%"></div>
        </div>
        <div class="ri-bar-pct">${pos}%</div>
      </div>`;
  }).join('');
}

function renderReviewCards(reviews) {
  if (!reviews?.length) return '<div class="ri-empty">No reviews.</div>';
  return reviews.slice(0, 30).map(r => `
    <div class="ri-rcard">
      <div class="ri-rcard-top">
        <span class="ri-badge ri-badge-${(r.sentiment||'neutral').slice(0,3)}">${r.sentiment || 'neutral'}</span>
        <span class="ri-rcard-meta">${escHtml(r.author || '')} · ${escHtml(r.date || '')}</span>
      </div>
      ${r.title ? `<div class="ri-rcard-title">${escHtml(r.title)}</div>` : ''}
      <div class="ri-rcard-body">${escHtml((r.body || '').slice(0, 200))}${(r.body||'').length > 200 ? '…' : ''}</div>
      ${r.aspects?.length ? `<div class="ri-tags">${r.aspects.map(a => `<span class="ri-tag">${escHtml(a)}</span>`).join('')}</div>` : ''}
    </div>`).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
