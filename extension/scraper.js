// scraper.js — Client-side Amazon review scraper
// Runs in content script context, uses existing session/cookies

const ReviewScraper = (() => {

  // ── ASIN + product detection ──────────────────────────────────────────────

  function detectProduct() {
    const url = window.location.href;

    // Extract ASIN from URL patterns:
    // /dp/B09BFV96TS  or  /product-reviews/B09BFV96TS
    const asinMatch = url.match(/\/(?:dp|product-reviews)\/([A-Z0-9]{10})/);
    if (!asinMatch) return null;

    const asin = asinMatch[1];

    // Extract domain for multi-marketplace support
    const domainMatch = url.match(/amazon\.(in|com|co\.uk)/);
    const domain = domainMatch ? `amazon.${domainMatch[1]}` : 'amazon.in';

    // Product name from page title or h1
    const nameEl =
      document.getElementById('productTitle') ||
      document.querySelector('h1.a-size-large') ||
      document.querySelector('h1');

    const name = nameEl ? nameEl.textContent.trim() : 'Unknown Product';

    return { asin, domain, name, url };
  }

  // ── URL builder ───────────────────────────────────────────────────────────

  function buildReviewURL(domain, asin, opts = {}) {
    const base = `https://www.${domain}/product-reviews/${asin}`;
    const params = new URLSearchParams({
      pageNumber: opts.page || 1,
      ...(opts.filterByStar && { filterByStar: opts.filterByStar }),
      ...(opts.filterByKeyword && { filterByKeyword: opts.filterByKeyword }),
      ...(opts.sortBy && { sortBy: opts.sortBy }),
      reviewerType: opts.reviewerType || 'all_reviews',
      mediaType: 'all_contents',
      formatType: 'all_formats',
    });
    return `${base}?${params.toString()}`;
  }

  // ── Single page fetcher + parser ──────────────────────────────────────────

  async function fetchReviewPage(url) {
    const resp = await fetch(url, {
      credentials: 'include',   // send existing Amazon session cookies
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} for ${url}`);

    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return parseReviewsFromDoc(doc);
  }

  // ── DOM parser ────────────────────────────────────────────────────────────

  function parseReviewsFromDoc(doc) {
    const reviews = [];

    // Primary selector — Amazon's standard review container
    const reviewEls = doc.querySelectorAll('[data-hook="review"]');

    reviewEls.forEach(el => {
      try {
        // Rating — aria-label="X.0 out of 5 stars"
        const ratingEl = el.querySelector('[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"]');
        const ratingText = ratingEl?.querySelector('.a-icon-alt')?.textContent || '';
        const rating = parseFloat(ratingText) || null;

        // Title
        const titleEl = el.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)');
        const title = titleEl?.textContent?.trim() || '';

        // Body
        const bodyEl = el.querySelector('[data-hook="review-body"] span');
        const body = bodyEl?.textContent?.trim() || '';

        // Skip if no body
        if (!body) return;

        // Author
        const authorEl = el.querySelector('.a-profile-name');
        const author = authorEl?.textContent?.trim() || 'Anonymous';

        // Date — "Reviewed in India on 5 April 2024"
        const dateEl = el.querySelector('[data-hook="review-date"]');
        const dateRaw = dateEl?.textContent?.trim() || '';
        const dateMatch = dateRaw.match(/on (.+)$/);
        const date = dateMatch ? dateMatch[1] : dateRaw;

        // Verified purchase
        const verifiedEl = el.querySelector('[data-hook="avp-badge"]');
        const verified = !!verifiedEl;

        // Helpful votes — "X people found this helpful"
        const helpfulEl = el.querySelector('[data-hook="helpful-vote-statement"]');
        const helpfulText = helpfulEl?.textContent?.trim() || '';
        const helpfulMatch = helpfulText.match(/(\d+)/);
        const helpful = helpfulMatch ? parseInt(helpfulMatch[1]) : 0;

        // Review ID
        const id = el.getAttribute('id') || `rev_${Math.random().toString(36).slice(2)}`;

        reviews.push({ id, title, body, rating, author, date, verified, helpful });

      } catch (err) {
        console.warn('[ReviewIntel] Failed to parse review element:', err);
      }
    });

    // Check if there's a next page
    const nextPageEl = doc.querySelector('.a-pagination .a-last:not(.a-disabled)');
    const hasNextPage = !!nextPageEl;

    return { reviews, hasNextPage };
  }

  // ── Multi-page scraper ────────────────────────────────────────────────────

  async function scrapeReviews(opts = {}) {
    const product = detectProduct();
    if (!product) throw new Error('Not an Amazon product page or ASIN not found');

    const {
      maxPages = 10,           // max pages to scrape (~10 reviews/page → ~100 reviews)
      maxReviews = 150,
      filterByStar = null,     // 'one_star' | 'two_star' | ... | 'five_star'
      filterByKeyword = null,  // 'battery' | 'camera' | etc.
      sortBy = 'recent',       // 'recent' | 'helpful'
      onProgress = null,       // callback(page, total)
    } = opts;

    const allReviews = [];
    let page = 1;

    while (page <= maxPages && allReviews.length < maxReviews) {
      const url = buildReviewURL(product.domain, product.asin, {
        page,
        filterByStar,
        filterByKeyword,
        sortBy,
      });

      console.log(`[ReviewIntel] Scraping page ${page}: ${url}`);

      try {
        const { reviews, hasNextPage } = await fetchReviewPage(url);

        allReviews.push(...reviews);

        if (onProgress) onProgress(page, allReviews.length);

        if (!hasNextPage || reviews.length === 0) break;

        page++;

        // Polite delay — avoid hammering Amazon
        await sleep(800 + Math.random() * 600);

      } catch (err) {
        console.error(`[ReviewIntel] Page ${page} failed:`, err);
        break;
      }
    }

    return {
      product,
      reviews: allReviews.slice(0, maxReviews),
      totalScraped: allReviews.length,
      pagesScraped: page,
    };
  }

  // ── Feature-targeted scraper ──────────────────────────────────────────────
  // Runs multiple keyword scrapes in parallel (camera, battery, display, etc.)

  async function scrapeByFeatures(features = ['battery', 'camera', 'display', 'heating', 'performance']) {
    const product = detectProduct();
    if (!product) throw new Error('Not an Amazon product page');

    const results = {};

    for (const feature of features) {
      console.log(`[ReviewIntel] Scraping feature: ${feature}`);
      const { reviews } = await scrapeReviews({
        filterByKeyword: feature,
        maxPages: 3,
        maxReviews: 30,
        sortBy: 'recent',
      });
      results[feature] = reviews;
      await sleep(1000);
    }

    return results;
  }

  // ── Utils ─────────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    detectProduct,
    scrapeReviews,
    scrapeByFeatures,
    buildReviewURL,
  };

})();

// Expose globally for content.js
window.ReviewScraper = ReviewScraper;
