/**
 * ReviewLens Content Script
 * Orchestrates review scraping + dashboard injection
 * Runs in the context of the product page
 */

// ─── Site Adapters ────────────────────────────────────────────────────────────

const SITE_ADAPTERS = {
  amazon: {
    test: () => /amazon\.(in|com)/.test(location.hostname),
    productTitle: () =>
      document.querySelector('#productTitle')?.textContent?.trim() ||
      document.querySelector('.product-title-word-break')?.textContent?.trim(),
    reviewContainer: () =>
      document.querySelector('#cm-cr-dp-review-list') ||
      document.querySelector('[data-hook="review"]')?.parentElement,
    reviewItems: () => [
      ...document.querySelectorAll('[data-hook="review"]'),
    ],
    parseReview: (el) => ({
      id: el.getAttribute('id') || crypto.randomUUID(),
      text:
        el.querySelector('[data-hook="review-body"] span')?.textContent?.trim() || '',
      rating: parseFloat(
        el
          .querySelector('[data-hook="review-star-rating"] span')
          ?.textContent?.match(/[\d.]+/)?.[0] || '0'
      ),
      date:
        el.querySelector('[data-hook="review-date"]')?.textContent?.trim() || '',
      username:
        el.querySelector('.a-profile-name')?.textContent?.trim() || 'Anonymous',
      helpful:
        parseInt(
          el
            .querySelector('[data-hook="helpful-vote-statement"]')
            ?.textContent?.match(/\d+/)?.[0] || '0'
        ),
    }),
    insertionPoint: () =>
      document.querySelector('#reviewsMedley') ||
      document.querySelector('#customer-reviews_feature_div') ||
      document.querySelector('#reviews-medley-footer'),
  },

  flipkart: {
    test: () => /flipkart\.com/.test(location.hostname),
    productTitle: () =>
      document.querySelector('.B_NuCI')?.textContent?.trim() ||
      document.querySelector('h1 span')?.textContent?.trim(),
    reviewContainer: () => document.querySelector('._1YokD2._3Mn1Gg'),
    reviewItems: () => [...document.querySelectorAll('._1AtVbE col-12-12 ._27M-vq, ._16PBlm')],
    parseReview: (el) => ({
      id: crypto.randomUUID(),
      text:
        el.querySelector('._6K-7Co, .t-ZTKy')?.textContent?.trim() || '',
      rating: parseFloat(
        el.querySelector('._3LWZlK')?.textContent?.trim() || '0'
      ),
      date: el.querySelector('._2sc7ZR span')?.textContent?.trim() || '',
      username:
        el.querySelector('._2sc7ZR ._1wjpf4')?.textContent?.trim() || 'Anonymous',
      helpful: 0,
    }),
    insertionPoint: () =>
      document.querySelector('._1YokD2._3Mn1Gg') ||
      document.querySelector('[class*="riRPCb"]'),
  },
};

// ─── Scraping Engine ──────────────────────────────────────────────────────────

function detectAdapter() {
  return Object.values(SITE_ADAPTERS).find((a) => a.test()) || null;
}

function scrapeReviews(adapter) {
  const items = adapter.reviewItems();
  return items
    .map(adapter.parseReview)
    .filter((r) => r.text.length > 10); // skip empty/stub reviews
}

// ─── MutationObserver for SPA / Lazy-Loaded Content ──────────────────────────

function waitForReviews(adapter, timeout = 12000) {
  return new Promise((resolve, reject) => {
    // First try: already in DOM
    const initial = scrapeReviews(adapter);
    if (initial.length > 0) return resolve(initial);

    const deadline = Date.now() + timeout;
    const observer = new MutationObserver(() => {
      const reviews = scrapeReviews(adapter);
      if (reviews.length > 0) {
        observer.disconnect();
        resolve(reviews);
      } else if (Date.now() > deadline) {
        observer.disconnect();
        reject(new Error('Review scraping timed out'));
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Reject after timeout regardless
    setTimeout(() => {
      observer.disconnect();
      reject(new Error('No reviews found within timeout'));
    }, timeout);
  });
}

// ─── Dashboard Injection ──────────────────────────────────────────────────────

const DASHBOARD_ID = 'reviewlens-root';

function injectDashboard(adapter) {
  if (document.getElementById(DASHBOARD_ID)) return; // already injected

  const insertionPoint = adapter.insertionPoint();
  if (!insertionPoint) return;

  // Wrapper
  const wrapper = document.createElement('div');
  wrapper.id = DASHBOARD_ID;
  wrapper.setAttribute('data-reviewlens', 'true');

  // Shadow DOM to isolate styles completely
  const shadow = wrapper.attachShadow({ mode: 'open' });

  // Mount point inside shadow
  const mountPoint = document.createElement('div');
  mountPoint.id = 'reviewlens-mount';
  shadow.appendChild(mountPoint);

  // Insert before the reviews section
  insertionPoint.parentNode.insertBefore(wrapper, insertionPoint);

  return { shadow, mountPoint };
}

// ─── Communication with Background / React App ────────────────────────────────

async function sendToBackground(reviews, productTitle) {
  return chrome.runtime.sendMessage({
    type: 'ANALYZE_REVIEWS',
    payload: { reviews, productTitle },
  });
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap() {
  const adapter = detectAdapter();
  if (!adapter) return;

  // Wait for page to settle (Amazon SPA can re-render)
  await new Promise((r) => setTimeout(r, 1500));

  const productTitle = adapter.productTitle() || document.title;

  // Inject toggle button immediately (don't wait for reviews)
  injectToggleButton(adapter, productTitle);
}

function injectToggleButton(adapter, productTitle) {
  const existingBtn = document.getElementById('reviewlens-trigger');
  if (existingBtn) return;

  const btn = document.createElement('button');
  btn.id = 'reviewlens-trigger';
  btn.innerHTML = `
    <span class="rl-icon">◈</span>
    <span class="rl-label">View AI Insights</span>
  `;
  btn.style.cssText = `
    position: fixed;
    bottom: 32px;
    right: 32px;
    z-index: 2147483646;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #0f0f0f;
    color: #f0f0f0;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 50px;
    padding: 12px 20px;
    font-family: 'SF Pro Display', -apple-system, sans-serif;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    transition: all 0.2s ease;
    letter-spacing: 0.01em;
  `;

  let dashboardOpen = false;
  let dashboardData = null;
  let dashboardLoaded = false;

  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#1a1a1a';
    btn.style.transform = 'translateY(-2px)';
    btn.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = dashboardOpen ? '#1a1a1a' : '#0f0f0f';
    btn.style.transform = 'translateY(0)';
    btn.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4)';
  });

  btn.addEventListener('click', async () => {
    if (dashboardOpen) {
      closeDashboard();
      dashboardOpen = false;
      btn.querySelector('.rl-label').textContent = 'View AI Insights';
      return;
    }

    dashboardOpen = true;
    btn.querySelector('.rl-label').textContent = 'Analyzing...';
    btn.disabled = true;

    try {
      if (!dashboardData) {
        const reviews = await waitForReviews(adapter);
        dashboardData = await sendToBackground(reviews, productTitle);
      }
      openDashboard(dashboardData, productTitle);
      btn.querySelector('.rl-label').textContent = 'Close Insights';
    } catch (err) {
      console.error('[ReviewLens]', err);
      btn.querySelector('.rl-label').textContent = 'Try Again';
      dashboardOpen = false;
    } finally {
      btn.disabled = false;
    }
  });

  document.body.appendChild(btn);
}

function openDashboard(data, productTitle) {
  closeDashboard(); // clear any existing
  const panel = document.createElement('div');
  panel.id = 'reviewlens-panel';

  // Send data to the React app via postMessage into the iframe
  const iframeSrc = chrome.runtime.getURL('index.html');

  panel.style.cssText = `
    position: fixed;
    top: 0; right: 0;
    width: min(560px, 100vw);
    height: 100vh;
    z-index: 2147483645;
    background: transparent;
    border: none;
    box-shadow: -8px 0 48px rgba(0,0,0,0.35);
  `;

  const iframe = document.createElement('iframe');
  iframe.src = iframeSrc;
  iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:0;';

  iframe.addEventListener('load', () => {
    iframe.contentWindow.postMessage(
      { type: 'REVIEWLENS_DATA', payload: { data, productTitle } },
      '*'
    );
  });

  panel.appendChild(iframe);
  document.body.appendChild(panel);

  // Slide in
  panel.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], {
    duration: 320,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    fill: 'forwards',
  });
}

function closeDashboard() {
  const panel = document.getElementById('reviewlens-panel');
  if (panel) {
    panel.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], {
      duration: 260,
      easing: 'cubic-bezier(0.7, 0, 1, 1)',
      fill: 'forwards',
    }).onfinish = () => panel.remove();
  }
}

bootstrap();
