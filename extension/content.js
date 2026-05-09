// content.js — Direct in-page injector for Amazon product pages

(async () => {
  await waitForScraper();

  const product = await waitForProduct();
  if (!product) return;

  injectTriggerButton(product);
})();

const BACKEND_URL = 'http://localhost:8000';
const MAX_REVIEWS = 300;
let activeSessionId = 0;

async function waitForScraper(timeoutMs = 8000) {
  if (window.ReviewScraper) return;

  const startedAt = Date.now();
  while (!window.ReviewScraper && Date.now() - startedAt < timeoutMs) {
    await sleep(100);
  }
}

async function waitForProduct(timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const product = getProductFromPage();
    if (product) return product;
    await sleep(250);
  }
  return getProductFromPage();
}

function getProductFromPage() {
  const detectProduct = window.ReviewScraper?.detectProduct?.bind(window.ReviewScraper);
  const product = detectProduct?.();
  if (product) return product;

  const asin = getAsinFromUrl();
  if (!asin) return null;

  const titleEl = document.getElementById('productTitle') || document.querySelector('h1 span') || document.querySelector('h1');
  const name = titleEl?.textContent?.trim() || 'Unknown Product';
  const domainMatch = location.hostname.match(/amazon\.(in|com|co\.uk)/i);
  const domain = domainMatch ? `amazon.${domainMatch[1].toLowerCase()}` : location.hostname;

  return {
    asin,
    domain,
    name,
    url: location.href,
  };
}

function getAsinFromUrl() {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/product-reviews\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = location.href.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }

  return null;
}

function injectTriggerButton(product) {
  if (document.getElementById('review-intel-btn')) return;

  const btn = document.createElement('div');
  btn.id = 'review-intel-btn';
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.setAttribute('aria-label', 'Analyze Amazon reviews');
  btn.innerHTML = `
    <div id="ri-fab">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"></path>
      </svg>
      <span>Analyze Reviews</span>
    </div>
  `;

  const launch = () => openReviewIntel(product);
  btn.addEventListener('click', launch);
  btn.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      launch();
    }
  });

  const target =
    document.getElementById('averageCustomerReviews') ||
    document.getElementById('reviews-medley') ||
    document.querySelector('#reviewsMedley') ||
    document.body;

  target.parentNode?.insertBefore(btn, target) || document.body.appendChild(btn);
}

function openReviewIntel(product) {
  document.getElementById('review-intel-overlay')?.remove();

  const overlay = document.createElement('aside');
  overlay.id = 'review-intel-overlay';
  overlay.setAttribute('aria-label', 'Review Intel analysis panel');
  overlay.innerHTML = buildOverlayHTML(product);
  document.body.appendChild(overlay);

  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  const close = () => closeOverlay(overlay);
  overlay.querySelector('#ri-close')?.addEventListener('click', close);

  function onKeyDown(event) {
    if (event.key === 'Escape') close();
  }

  overlay.__riKeyDown = onKeyDown;
  window.addEventListener('keydown', onKeyDown);

  runPipeline(product, overlay).finally(() => {
    window.removeEventListener('keydown', onKeyDown);
  });
}

function closeOverlay(overlay) {
  activeSessionId++;
  if (overlay?.__riKeyDown) {
    window.removeEventListener('keydown', overlay.__riKeyDown);
  }
  overlay?.remove();
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
}

function buildOverlayHTML(product) {
  return `
    <div id="ri-panel">
      <div id="ri-header">
        <div>
          <div id="ri-title">Review Intelligence</div>
          <div id="ri-subtitle">${escHtml(truncate(product.name, 76))}</div>
        </div>
        <button id="ri-close" type="button" aria-label="Close analysis panel">✕</button>
      </div>
      <div id="ri-status" class="ri-status ri-status--scraping">Preparing analysis…</div>
      <div id="ri-dashboard" style="display:none"></div>
    </div>
  `;
}

async function runPipeline(product, overlay) {
  const sessionId = ++activeSessionId;
  const setStatusSafe = (type, message) => {
    if (sessionId !== activeSessionId) return false;
    setStatus(overlay, type, message);
    return true;
  };

  if (!setStatusSafe('scraping', `Holistically scraping reviews for ${product.name}…`)) return;

  let scraped;
  try {
    scraped = await window.ReviewScraper.scrapeHolistic((done, total, count) => {
      setStatusSafe('scraping', `Scraped ${count} unique reviews across ${done}/${total} passes…`);
    });
  } catch (error) {
    setStatusSafe('error', `Scraping failed: ${error.message}`);
    return;
  }

  const uniqueReviews = dedupeReviews(scraped.reviews || []).slice(0, MAX_REVIEWS);
  if (!uniqueReviews.length) {
    setStatusSafe('error', 'No reviews found. Open an Amazon product page with visible review data.');
    return;
  }

  if (!setStatusSafe('analyzing', `Analyzing ${uniqueReviews.length} holistic reviews with NLP…`)) return;

  let analytics;
  try {
    const response = await fetch(`${BACKEND_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product,
        reviews: uniqueReviews,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.detail || `Backend error ${response.status}`);
    }

    analytics = await response.json();
  } catch (error) {
    setStatusSafe('error', `Backend error: ${error.message}. Is FastAPI running on :8000?`);
    return;
  }

  if (sessionId !== activeSessionId) return;

  renderDashboard(overlay, analytics, { product, reviews: uniqueReviews, aspects: scraped.aspects || [] });
  chrome.runtime?.sendMessage?.({ type: 'ANALYSIS_COMPLETE', asin: product.asin });
}

function setStatus(overlay, type, message) {
  const statusEl = overlay.querySelector('#ri-status');
  if (!statusEl) return;
  statusEl.className = `ri-status ri-status--${type}`;
  statusEl.textContent = message;
}

function renderDashboard(overlay, analytics, scraped) {
  const status = overlay.querySelector('#ri-status');
  if (status) status.style.display = 'none';

  const dash = overlay.querySelector('#ri-dashboard');
  if (!dash) return;
  dash.style.display = 'block';

  const total = Math.max(analytics.total_reviews || 0, 1);
  const sentimentDistribution = analytics.sentiment_distribution || { positive: 0, neutral: 0, negative: 0 };
  const posPct = Math.round(sentimentDistribution.positive / total * 100);
  const negPct = Math.round(sentimentDistribution.negative / total * 100);
  const neuPct = Math.max(0, 100 - posPct - negPct);
  const reviewStats = computeReviewStats(scraped.reviews || []);

  dash.innerHTML = `
    <div class="ri-chart-grid">
      <section class="ri-chart-card">
        <div class="ri-section-title">Sentiment Donut</div>
        ${renderDonutChart({ positive: sentimentDistribution.positive || 0, neutral: sentimentDistribution.neutral || 0, negative: sentimentDistribution.negative || 0 })}
      </section>
      <section class="ri-chart-card">
        <div class="ri-section-title">Star Distribution</div>
        ${renderStarBars(reviewStats.stars)}
      </section>
    </div>

    <div class="ri-metrics">
      <div class="ri-metric">
        <div class="ri-metric-label">Reviews</div>
        <div class="ri-metric-val">${analytics.total_reviews || scraped.reviews.length}</div>
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
        <div class="ri-metric-val ri-small">${escHtml(analytics.top_positive_feature || '—')}</div>
      </div>
      <div class="ri-metric">
        <div class="ri-metric-label">Top complaint</div>
        <div class="ri-metric-val ri-small">${escHtml(analytics.top_negative_feature || '—')}</div>
      </div>
    </div>

    <div class="ri-section">
      <div class="ri-section-title">Holistic coverage</div>
      <div class="ri-hint-grid">
        <div class="ri-hint-pill">Reviews used: ${scraped.reviews.length}</div>
        <div class="ri-hint-pill">Aspect tags: ${scraped.aspects?.length || 0}</div>
        <div class="ri-hint-pill">Positive / neutral / negative: ${sentimentDistribution.positive || 0} / ${sentimentDistribution.neutral || 0} / ${sentimentDistribution.negative || 0}</div>
      </div>
    </div>

    <div class="ri-section">
      <div class="ri-section-title">AI Summary</div>
      <div class="ri-summary">${escHtml(analytics.summary || 'No summary available.')}</div>
    </div>

    <div class="ri-section">
      <div class="ri-section-title">Sentiment Distribution</div>
      <div class="ri-sent-bar">
        <div class="ri-sent-pos" style="width:${posPct}%" title="Positive ${posPct}%"></div>
        <div class="ri-sent-neu" style="width:${neuPct}%" title="Neutral ${neuPct}%"></div>
        <div class="ri-sent-neg" style="width:${negPct}%" title="Negative ${negPct}%"></div>
      </div>
      <div class="ri-sent-legend">
        <span><span class="ri-dot ri-dot-green"></span>Positive ${posPct}%</span>
        <span><span class="ri-dot ri-dot-gray"></span>Neutral ${neuPct}%</span>
        <span><span class="ri-dot ri-dot-red"></span>Negative ${negPct}%</span>
      </div>
    </div>

    <div class="ri-section">
      <div class="ri-section-title">Feature Sentiment</div>
      ${renderAspectBars(analytics.aspect_sentiments || {})}
    </div>

    <div class="ri-section">
      <div class="ri-section-title">Detected aspect tags</div>
      <div class="ri-tags">
        ${(scraped.aspects || []).length
          ? scraped.aspects.map(aspect => `<span class="ri-tag">${escHtml(aspect)}</span>`).join('')
          : '<div class="ri-empty">No aspect tags detected on the page.</div>'}
      </div>
    </div>

    <div class="ri-section">
      <div class="ri-section-title">Common Complaints</div>
      <div class="ri-complaints">
        ${(analytics.common_complaints || []).length
          ? analytics.common_complaints.map(item => `<span class="ri-tag ri-tag-neg">${escHtml(item)}</span>`).join('')
          : '<div class="ri-empty">No common complaints detected.</div>'}
      </div>
    </div>

    <div class="ri-verdict">
      <strong>Verdict:</strong> ${escHtml(analytics.verdict || 'No verdict available.')}
    </div>

    <div class="ri-section">
      <div class="ri-section-title">Keywords</div>
      <div class="ri-tags">
        ${(analytics.keywords || []).length
          ? analytics.keywords.map(keyword => `<span class="ri-tag">${escHtml(keyword)}</span>`).join('')
          : '<div class="ri-empty">No keywords extracted.</div>'}
      </div>
    </div>

    <div class="ri-section">
      <div class="ri-section-title">Reviews <span id="ri-rev-count">(${scraped.reviews.length})</span></div>
      <div class="ri-filter-row">
        <button class="ri-chip ri-chip-active" type="button" data-filter="all">All</button>
        <button class="ri-chip" type="button" data-filter="positive">Positive</button>
        <button class="ri-chip" type="button" data-filter="negative">Negative</button>
        <button class="ri-chip" type="button" data-filter="neutral">Neutral</button>
      </div>
      <div id="ri-review-list">
        ${renderReviewCards(analytics.reviews || scraped.reviews)}
      </div>
    </div>
  `;

  const filters = overlay.querySelectorAll('[data-filter]');
  const allReviews = analytics.reviews || scraped.reviews;

  filters.forEach(button => {
    button.addEventListener('click', () => {
      const sentiment = button.getAttribute('data-filter') || 'all';
      filters.forEach(other => other.classList.remove('ri-chip-active'));
      button.classList.add('ri-chip-active');

      const filtered = sentiment === 'all'
        ? allReviews
        : allReviews.filter(review => (review.sentiment || 'neutral') === sentiment);

      const list = overlay.querySelector('#ri-review-list');
      const count = overlay.querySelector('#ri-rev-count');
      if (list) list.innerHTML = renderReviewCards(filtered);
      if (count) count.textContent = `(${filtered.length})`;
    });
  });

  overlay.querySelector('#ri-close')?.focus?.();
}

function renderDonutChart(counts) {
  const total = Math.max(1, (counts.positive || 0) + (counts.neutral || 0) + (counts.negative || 0));
  const posPct = Math.round((counts.positive || 0) / total * 100);
  const neuPct = Math.round((counts.neutral || 0) / total * 100);
  const negPct = Math.max(0, 100 - posPct - neuPct);

  return `
    <div class="ri-donut-wrap">
      <div class="ri-donut" style="--ri-donut-positive:${posPct}%;--ri-donut-neutral:${neuPct}%;--ri-donut-negative:${negPct}%" aria-hidden="true">
        <div class="ri-donut-center">
          <div class="ri-donut-label">${posPct}%</div>
          <div class="ri-donut-sub">positive</div>
        </div>
      </div>
      <div class="ri-donut-legend">
        <div><span class="ri-dot ri-dot-green"></span>Positive ${counts.positive || 0}</div>
        <div><span class="ri-dot ri-dot-gray"></span>Neutral ${counts.neutral || 0}</div>
        <div><span class="ri-dot ri-dot-red"></span>Negative ${counts.negative || 0}</div>
      </div>
    </div>
  `;
}

function renderStarBars(stars) {
  const rows = [5, 4, 3, 2, 1].map(star => {
    const value = stars[star] || 0;
    const max = Math.max(...Object.values(stars), 1);
    const width = Math.max(4, Math.round((value / max) * 100));
    return `
      <div class="ri-star-row">
        <span class="ri-star-label">${star}★</span>
        <div class="ri-star-track"><span class="ri-star-fill" style="width:${width}%"></span></div>
        <span class="ri-star-value">${value}</span>
      </div>
    `;
  }).join('');

  return `<div class="ri-star-bars">${rows}</div>`;
}

function computeReviewStats(reviews) {
  const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of reviews) {
    const rating = Math.round(Number(review.rating) || 0);
    if (rating >= 1 && rating <= 5) stars[rating] += 1;
  }
  return { stars };
}

function renderAspectBars(aspects) {
  const entries = Object.entries(aspects || {});
  if (!entries.length) return '<div class="ri-empty">No aspects extracted.</div>';

  return entries.map(([feature, scores]) => {
    const positive = clampPercent(scores?.positive || 0);
    const negative = clampPercent(scores?.negative || 0);
    return `
      <div class="ri-aspect-row">
        <div class="ri-aspect-name" title="${escHtml(feature)}">${escHtml(feature)}</div>
        <div class="ri-bar-track">
          <div class="ri-bar-pos" style="width:${positive}%"></div>
          <div class="ri-bar-neg" style="width:${negative}%"></div>
        </div>
        <div class="ri-bar-pct">${positive}%</div>
      </div>
    `;
  }).join('');
}

function renderReviewCards(reviews) {
  if (!reviews?.length) return '<div class="ri-empty">No reviews.</div>';

  return reviews.slice(0, 30).map(review => {
    const sentiment = (review.sentiment || 'neutral').slice(0, 3);
    const body = review.body || '';
    const title = review.title || '';
    const aspects = Array.isArray(review.aspects) ? review.aspects : [];

    return `
      <article class="ri-rcard">
        <div class="ri-rcard-top">
          <span class="ri-badge ri-badge-${sentiment}">${escHtml(review.sentiment || 'neutral')}</span>
          <span class="ri-rcard-meta">${escHtml(review.author || 'Anonymous')} · ${escHtml(review.date || '')}${review.verified ? ' · verified' : ''}</span>
        </div>
        ${title ? `<div class="ri-rcard-title">${escHtml(title)}</div>` : ''}
        <div class="ri-rcard-body">${escHtml(truncate(body, 220))}${body.length > 220 ? '…' : ''}</div>
        ${aspects.length ? `<div class="ri-tags">${aspects.map(aspect => `<span class="ri-tag">${escHtml(aspect)}</span>`).join('')}</div>` : ''}
      </article>
    `;
  }).join('');
}

function dedupeReviews(reviews) {
  const seen = new Set();
  const unique = [];

  for (const review of reviews) {
    const signature = [
      review.id || '',
      review.title || '',
      review.body || '',
      review.author || '',
      review.date || '',
    ].join('|');

    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(review);
  }

  return unique;
}

function clampPercent(value) {
  const num = Number(value) || 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function truncate(text, limit) {
  const value = String(text || '');
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}` : value;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}