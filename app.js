// Demo Hub — hash-based router & views
const app = document.getElementById("app");

// Define our default fallback for direct sales shares
const DEFAULT_GID = 'independent_visit';

// Extract q_group_id from URL query string OR hash query string, fallback to session/default
// Handles both ?q_group_id=X (before hash) and #/path?q_group_id=X (after hash)
const _hashSearch = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '';
let _groupId = new URLSearchParams(window.location.search).get('q_group_id')
  || new URLSearchParams(_hashSearch).get('q_group_id');

if (_groupId && _groupId.trim() !== '') {
  _groupId = _groupId.trim();
} else {
  try { 
    const stored = sessionStorage.getItem('q_group_id');
    _groupId = (stored && stored.trim() !== '') ? stored.trim() : DEFAULT_GID; 
  } catch(e) { 
    _groupId = DEFAULT_GID; 
  }
}

// Persist across page navigations in this session
try { sessionStorage.setItem('q_group_id', _groupId); } catch(e) {}

const _effectiveGroupId = _groupId;

let _groupIdSent = false;
function _sendGroupId() {
  if (!_effectiveGroupId || typeof gtag !== 'function') return;
  // gtag('set') attaches q_group_id to every subsequent event automatically
  gtag('set', { 'q_group_id': _effectiveGroupId });
  // Fire the dedicated event only once per session
  if (!_groupIdSent) {
    _groupIdSent = true;
    gtag('event', 'group_identified', { 'q_group_id': _effectiveGroupId });
  }
}

// Run immediately if gtag is ready, otherwise wait for it
if (typeof gtag === 'function') {
  _sendGroupId();
} else {
  window.addEventListener('load', _sendGroupId);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Accepts a bare ID, a full watch URL, a youtu.be link, or a playlist URL.
// Returns { videoId, playlistId } — either may be null.
function parseYouTube(input) {
  if (!input) return { videoId: null, playlistId: null };
  const raw = String(input).trim();
  if (/^[\w-]{11}$/.test(raw)) return { videoId: raw, playlistId: null };
  let videoId = null,
    playlistId = null;
  try {
    const u = new URL(raw);
    videoId = u.searchParams.get("v");
    playlistId = u.searchParams.get("list");
    if (!videoId && u.hostname.includes("youtu.be")) {
      videoId = u.pathname.slice(1).split("/")[0] || null;
    }
    if (!videoId && u.pathname.includes("/embed/")) {
      videoId = u.pathname.split("/embed/")[1].split("/")[0] || null;
    }
  } catch (e) {
    // Not a URL — fall through with nulls
  }
  return { videoId: videoId || null, playlistId: playlistId || null };
}

function embedUrl(video, opts = {}) {
  const parsed = parseYouTube(video.youtubeId);
  const playlistId = video.playlistId || parsed.playlistId;
  const base = { rel: "0", modestbranding: "1", playsinline: "1" };
  if (opts.jsapi) {
    base.enablejsapi = "1";
    base.origin = location.origin;
  }
  base.autoplay = "0";
  base.widget_referrer = opts.widgetReferrer || location.href;
  const params = new URLSearchParams(base);
  let path;
  if (parsed.videoId) {
    path = parsed.videoId;
  } else if (playlistId && !parsed.videoId) {
    return `https://www.youtube.com/embed/videoseries?${params.toString()}&list=${encodeURIComponent(playlistId)}`;
  } else {
    path = "";
  }
  return `https://www.youtube.com/embed/${path}?${params.toString()}`;
}

let _ytReady = false;
let _ytReadyCbs = [];
function onYouTubeIframeAPIReady() {
  _ytReady = true;
  _ytReadyCbs.forEach(fn => fn());
  _ytReadyCbs = [];
}
function whenYTReady(fn) {
  if (_ytReady) { fn(); return; }
  _ytReadyCbs.push(fn);
  if (!document.querySelector('script[src*="iframe_api"]')) {
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  }
}

let _currentPlayer = null;

function setupAutoAdvance(videoObj, productObj, nextHash) {
  if (_currentPlayer) {
    try { _currentPlayer.destroy(); } catch(e) {}
    _currentPlayer = null;
  }

  whenYTReady(() => {
    const iframe = document.getElementById("yt-player");
    if (!iframe) return; 
    
    let videoStarted = false;

    _currentPlayer = new YT.Player(iframe, {
      events: {
        onReady: (_e) => {},
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING && !videoStarted) {
            videoStarted = true;
            if (typeof gtag === 'function') {
              gtag('event', 'video_start', {
                video_title: videoObj.title,
                video_id: videoObj.id,
                product_name: productObj.name,
                q_group_id: _effectiveGroupId
              });
            }
          }
          if (e.data === YT.PlayerState.ENDED && nextHash) {
            location.hash = nextHash;
          }
        }
      }
    });
  });
}

function thumbUrl(video) {
  const { videoId } = parseYouTube(video.youtubeId);
  return videoId
    ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    : "https://img.youtube.com/vi/videoseries/hqdefault.jpg";
}

function render() {
  // Strip any query params appended after the hash (e.g. #/product/x?utm_source=y)
  const rawHash = location.hash.slice(1);
  const hash = rawHash.includes('?') ? rawHash.slice(0, rawHash.indexOf('?')) : rawHash;
  const parts = hash.split("/").filter(Boolean);
  const isHome = parts.length === 0 || parts[0] !== "product";
  document.querySelector(".navbar").classList.toggle("is-home", isHome);
  // Clear search input on navigation
  const searchEl = document.getElementById("globalSearch");
  if (searchEl) searchEl.value = "";
  if (parts[0] === "product" && parts[2] === "video") {
    renderVideo(parts[1], parts[3]);
  } else if (parts[0] === "product") {
    renderDashboard(parts[1]);
  } else {
    renderHome();
  }
  window.scrollTo(0, 0);
}

// ── Search & Filter ────────────────────────────────────────────────────────

// Build a flat list of all videos across all products for global search
function allVideos() {
  const results = [];
  PRODUCTS.forEach((p) => {
    (p.videos || []).forEach((v) => {
      results.push({ product: p, video: v });
    });
  });
  return results;
}

/**
 * Tokenise a string into lowercase words, stripping punctuation.
 * e.g. "App Live — iOS/Android" → ["app", "live", "ios", "android"]
 */
function tokenise(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Synonym / concept map.
 * Each key is a query term a user might type; the value is an array of
 * additional tokens injected into the search so they score against the
 * video corpus even when the exact word isn't in the title.
 *
 * Rules:
 *  - Keys are lowercase, no punctuation (same form tokenise() produces).
 *  - Values are real words that appear in titles / descriptions / doc labels.
 *  - Keep entries specific enough not to cause false positives.
 */
const SYNONYMS = {
  // Bug / issue tracking integrations
  "jira":        ["bug", "reporting", "log", "issue"],
  "azure":       ["bug", "reporting", "devops"],
  "trello":      ["bug", "reporting"],
  "github":      ["bug", "reporting"],
  "slack":       ["bug", "reporting", "notification"],
  "bug":         ["reporting", "log"],
  "issue":       ["reporting", "bug", "log"],
  "ticket":      ["reporting", "bug"],
  "defect":      ["reporting", "bug"],

  // Payments
  "payment":     ["pay", "apple", "google", "checkout"],
  "pay":         ["apple", "google", "payment"],
  "applepay":    ["apple", "pay", "ios"],
  "googlepay":   ["google", "pay", "android"],
  "checkout":    ["payment", "pay"],

  // Auth / security
  "biometric":   ["face", "touch", "authentication", "fingerprint"],
  "faceid":      ["biometric", "authentication", "face"],
  "touchid":     ["biometric", "authentication", "touch"],
  "fingerprint": ["biometric", "authentication"],
  "otp":         ["sim", "sms", "message", "verification"],
  "sms":         ["sim", "otp", "message"],
  "2fa":         ["otp", "sim", "authentication"],
  "mfa":         ["otp", "authentication"],

  // Network / performance
  "throttle":    ["throttling", "network", "speed", "3g"],
  "throttling":  ["network", "speed", "simulation"],
  "slow":        ["throttling", "network", "3g"],
  "offline":     ["throttling", "network"],
  "proxy":       ["proxies", "internal", "network"],
  "vpn":         ["local", "internal", "network"],
  "latency":     ["throttling", "network"],
  "bandwidth":   ["throttling", "network"],

  // Location / geo
  "geo":         ["geolocation", "location", "gps", "ip"],
  "gps":         ["geolocation", "location"],
  "location":    ["geolocation", "gps", "timezone", "ip"],
  "timezone":    ["time", "zone", "location", "region"],
  "region":      ["timezone", "location", "geolocation"],
  "country":     ["geolocation", "location", "ip"],

  // Accessibility
  "a11y":        ["accessibility", "screen", "reader", "wcag"],
  "wcag":        ["accessibility"],
  "screenreader":["accessibility", "screen", "reader"],
  "aria":        ["accessibility"],

  // Media / injection
  "camera":      ["image", "injection", "qr", "barcode"],
  "photo":       ["image", "injection"],
  "scan":        ["qr", "barcode", "scanning", "image"],
  "qr":          ["barcode", "scanning", "image", "injection"],
  "barcode":     ["qr", "scanning", "image", "injection"],
  "audio":       ["injection", "voice", "microphone", "sound"],
  "voice":       ["audio", "injection", "microphone"],
  "microphone":  ["audio", "injection"],

  // File operations
  "upload":      ["file", "injection", "media"],
  "download":    ["file", "media"],
  "file":        ["upload", "download", "injection"],

  // Testing concepts
  "responsive":  ["resolution", "resolutions", "screen"],
  "resolution":  ["responsive", "screen"],
  "cross":       ["browser", "device", "multi"],
  "parallel":    ["multi", "device", "simultaneous"],
  "local":       ["internal", "network", "staging", "localhost"],
  "staging":     ["local", "internal", "network"],
  "internal":    ["local", "network", "staging"],
  "debug":       ["network", "monitoring", "devtools", "console"],
  "devtools":    ["debug", "network", "monitoring"],
  "console":     ["debug", "devtools", "network"],
  "performance": ["cpu", "memory", "battery", "profiling"],
  "cpu":         ["performance", "profiling"],
  "memory":      ["performance", "profiling"],
  "battery":     ["performance", "profiling"],

  // Integrations / CI
  "ci":          ["integration", "gradle", "studio", "pipeline"],
  "cd":          ["integration", "pipeline"],
  "gradle":      ["android", "integration", "build"],
  "xcode":       ["ios", "integration"],
  "studio":      ["android", "integration"],

  // Misc
  "bookmark":    ["url", "save", "quick"],
  "record":      ["session", "video", "recording"],
  "recording":   ["record", "session"],
  "screenshot":  ["capture", "bug", "reporting"],
  "whitelisting":["ip", "whitelist", "security"],
  "whitelist":   ["ip", "whitelisting", "security"],
  "locale":      ["language", "localization", "region"],
  "language":    ["locale", "localization"],
  "localization":["locale", "language", "region"],
  "i18n":        ["localization", "locale", "language"],
  "l10n":        ["localization", "locale", "language"],
};

/**
 * Expand a list of query tokens with synonyms.
 * Returns a new array with originals + any synonym expansions, deduplicated.
 * Synonym expansions are weighted lower (they don't replace the original token
 * in scoring — they are added as extra tokens that can boost the score but
 * whose absence does NOT disqualify a result).
 */
function expandTokens(tokens) {
  const expanded = new Set(tokens);
  tokens.forEach(t => {
    (SYNONYMS[t] || []).forEach(s => expanded.add(s));
  });
  return [...expanded];
}

/**
 * Build the full-text corpus for a video, including doc labels and link labels.
 */
function videoCorpus(v, p) {
  const docText  = (v.docs  || []).map(d => typeof d === "string" ? d : d.label || "").join(" ");
  const linkText = (v.links || []).map(l => typeof l === "string" ? l : l.label || "").join(" ");
  return [v.title, v.description || "", p.name, p.tagline || "", docText, linkText].join(" ");
}

/**
 * Score a single video entry against an array of query tokens.
 * Returns a numeric score (higher = better match); 0 means no match.
 *
 * Scoring weights (per original query token):
 *   10 – exact word match in title
 *    6 – prefix match in title
 *    4 – exact word match in description / product name / doc labels
 *    2 – prefix match in description / product name / doc labels
 *    1 – substring fallback anywhere in corpus
 *
 * Synonym-expanded tokens contribute half the above weights and are
 * treated as OPTIONAL (their absence does not disqualify the result).
 *
 * AND semantics: every ORIGINAL query token must contribute ≥ 1 point.
 */
function scoreVideo(entry, queryTokens) {
  const { product: p, video: v } = entry;
  const corpus       = videoCorpus(v, p).toLowerCase();
  const titleTokens  = tokenise(v.title);
  const bodyTokens   = tokenise(corpus);
  const expandedTokens = expandTokens(queryTokens);
  const synonymOnly    = expandedTokens.filter(t => !queryTokens.includes(t));

  let totalScore = 0;

  // Score original (required) tokens — AND logic
  for (const qt of queryTokens) {
    let tokenScore = 0;

    if (titleTokens.includes(qt)) {
      tokenScore += 10;
    } else if (titleTokens.some(t => t.startsWith(qt))) {
      tokenScore += 6;
    }

    if (bodyTokens.includes(qt)) {
      tokenScore += 4;
    } else if (bodyTokens.some(t => t.startsWith(qt))) {
      tokenScore += 2;
    }

    if (tokenScore === 0 && corpus.includes(qt)) {
      tokenScore += 1;
    }

    // Original token matched nothing → exclude this result
    if (tokenScore === 0) return 0;

    totalScore += tokenScore;
  }

  // Score synonym-expanded tokens — OPTIONAL boost only
  for (const st of synonymOnly) {
    if (titleTokens.includes(st)) {
      totalScore += 5;
    } else if (titleTokens.some(t => t.startsWith(st))) {
      totalScore += 3;
    } else if (bodyTokens.includes(st)) {
      totalScore += 2;
    } else if (bodyTokens.some(t => t.startsWith(st))) {
      totalScore += 1;
    } else if (corpus.includes(st)) {
      totalScore += 0.5;
    }
  }

  return totalScore;
}

function renderSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) return;

  const queryTokens = tokenise(q);
  if (!queryTokens.length) return;

  const scored = allVideos()
    .map(entry => ({ entry, score: scoreVideo(entry, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  const matches = scored.map(({ entry }) => entry);
  const cards = matches.length
    ? matches.map(({ product: p, video: v }) => `
      <div class="glass card vthumb" onclick="location.hash='#/product/${p.id}/video/${v.id}'">
        <div class="thumbwrap">
          <img class="thumbimg" src="${thumbUrl(v)}" alt="${esc(v.title)}" onerror="this.classList.add('noimg')" />
          <div class="play"><span>&#9654;</span></div>
          ${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}
        </div>
        <div class="meta">
          <span class="search-product-tag">${esc(p.name)}</span>
          <h3>${esc(v.title)}</h3>
          <p>${esc(v.description).slice(0, 90)}${v.description.length > 90 ? "…" : ""}</p>
        </div>
      </div>`).join("")
    : buildNoResults(query);

  app.innerHTML = `
    <div class="search-header fade">
      <h2 class="section-label">Search results for "<strong>${esc(query)}</strong>" &mdash; ${matches.length} found</h2>
    </div>
    <div class="grid fade">${cards}</div>`;
}

/**
 * Seeded shuffle — deterministic for a given seed so the same seed always
 * produces the same order, but different seeds give different orders.
 * Uses a simple mulberry32 PRNG.
 */
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    const j = (s >>> 0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build the "no results" panel with related-term suggestions and time-dynamic popular videos.
 * Popular videos rotate every 6 hours — different each session window, deterministic within it.
 */
function buildNoResults(query) {
  const qt = tokenise(query);

  // ── Related-term suggestions ──────────────────────────────────────────────
  const suggestions = new Set();
  qt.forEach(t => (SYNONYMS[t] || []).forEach(s => suggestions.add(s)));
  Object.keys(SYNONYMS).forEach(key => {
    if (qt.some(t => key.startsWith(t) || t.startsWith(key))) suggestions.add(key);
  });
  qt.forEach(t => suggestions.delete(t));

  const suggestionHtml = suggestions.size
    ? `<div class="no-results-suggestions">
        <p class="no-results-label">💡 Try searching for:</p>
        <div class="no-results-chips">
          ${[...suggestions].slice(0, 8).map(s =>
            `<button class="suggestion-chip" onclick="document.getElementById('globalSearch').value='${esc(s)}';document.getElementById('globalSearch').dispatchEvent(new Event('input'))">${esc(s)}</button>`
          ).join("")}
        </div>
      </div>`
    : "";

  // ── Time-dynamic popular videos ───────────────────────────────────────────
  // Seed changes every 6 hours → 4 different rotations per day
  const seed = Math.floor(Date.now() / (1000 * 60 * 60 * 6));
  const all = allVideos();
  // Ensure one video per product for variety, then fill from the rest
  const byProduct = {};
  all.forEach(e => { if (!byProduct[e.product.id]) byProduct[e.product.id] = e; });
  const candidates = seededShuffle(Object.values(byProduct), seed);
  const popular = candidates.slice(0, 4);

  const popularHtml = `
    <div class="no-results-popular">
      <p class="no-results-label">🔥 Popular right now:</p>
      <div class="no-results-popular-grid">
        ${popular.map(({ product: p, video: v }) => `
          <div class="no-results-popular-item" onclick="location.hash='#/product/${p.id}/video/${v.id}'">
            <div class="nrp-thumb-wrap">
              <img src="${thumbUrl(v)}" alt="${esc(v.title)}" onerror="this.style.display='none'" />
              <div class="nrp-play">▶</div>
            </div>
            <div class="nrp-meta">
              <span class="nrp-product">${esc(p.name)}</span>
              <span class="nrp-title">${esc(v.title)}</span>
              ${v.duration ? `<span class="nrp-dur">${esc(v.duration)}</span>` : ""}
            </div>
          </div>`).join("")}
      </div>
    </div>`;

  return `<div class="search-empty">
    <div class="no-results-icon">🔍</div>
    <h3 class="no-results-heading">No results for "<strong>${esc(query)}</strong>"</h3>
    <p class="no-results-sub">Double-check your spelling, or try one of the suggestions below.</p>
    ${suggestionHtml}
    ${popularHtml}
  </div>`;
}

// Wire up global search input
document.addEventListener("DOMContentLoaded", () => {
  const searchEl = document.getElementById("globalSearch");
  if (!searchEl) return;

  // ── Debounced input handler ────────────────────────────────────────────────
  let debounceTimer;
  searchEl.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = searchEl.value.trim();
    debounceTimer = setTimeout(() => {
      if (q.length >= 2) {
        renderSearchResults(q);
      } else if (q.length === 0) {
        render(); // restore current view
      }
    }, 220);
  });

  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { searchEl.value = ""; render(); }
  });

  // ── "/" shortcut — focus search from anywhere ──────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchEl &&
        !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      searchEl.focus();
      searchEl.select();
    }
  });
});

function renderHome() {
  document.title = 'BrowserStack Demo Hub';
  if (typeof gtag === 'function') {
    gtag('event', 'page_view', {
      page_title: document.title,
      page_path: location.pathname + location.search + '/#/',
      page_location: location.href,
      // ADD THESE TWO LINES:
      product_name: 'Demo Hub Home',
      product_id: 'home'
    });
  }
  const cards = PRODUCTS.map(
    (p) => `
    <div class="glass card" onclick="location.hash='#/product/${p.id}'">
      <div class="icon">${p.iconSvg ? `<img src="${p.iconSvg}" alt="${esc(p.name)}" style="width:32px;height:32px;object-fit:contain;" />` : p.icon}</div>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.tagline)}</p>
      ${p.videos && p.videos.length > 0 ? `<div class="count">${p.videos.length} video${p.videos.length === 1 ? "" : "s"} &rarr;</div>` : ""}
    </div>`
  ).join("");
  
  app.innerHTML = `
    <div class="home-hero-wrap fade">
      <div class="hero-orb orb-1"></div>
      <div class="hero-orb orb-2"></div>
      <div class="hero-orb orb-3"></div>
      <div class="hero-glass">
        <div class="hero-logo-row">
          <img src="icons/browserstack-icon.svg" alt="BrowserStack" class="hero-logo" />
          <span class="hero-brand">BrowserStack</span>
        </div>
        <h1 class="hero-title">Welcome to the <span class="hero-grad">Demo Hub</span></h1>
        <p class="hero-sub">Explore, Learn, Launch</p>
        <p class="hero-desc">Explore interactive demos of BrowserStack's powerful testing features, all in one place. Whether you're new or looking to deepen your product knowledge, this hub helps you quickly understand, experience, and onboard with BrowserStack.</p>
        <div class="hero-chips">
          <span class="chip">🚀 Onboarding</span>
          <span class="chip">🎬 Video Walkthroughs</span>
          <span class="chip">📚 Documentation</span>
        </div>
      </div>
    </div>
    <h2 class="section-label fade">Choose a product</h2>
    <div class="grid fade">${cards}</div>
    <footer class="site-footer fade">
      <div class="footer-inner">
        <div class="footer-brand">
          <img src="icons/browserstack-icon.svg" alt="BrowserStack" width="28" height="28" />
          <span>BrowserStack Demo Hub</span>
        </div>
        <p class="footer-desc">Your one-stop destination for BrowserStack product walkthroughs, onboarding videos, and documentation.</p>
        <div class="footer-links">
          <a href="https://www.browserstack.com/docs" target="_blank"  rel="noopener">Documentation</a>
          <a href="https://www.browserstack.com/contact" target="_blank"  rel="noopener">Support</a>
          <a href="https://www.browserstack.com/blog" target="_blank"  rel="noopener">Blog</a>
          <a href="https://www.browserstack.com/pricing" target="_blank"  rel="noopener">Pricing</a>
        </div>
        <p class="footer-copy">&copy; ${new Date().getFullYear()} BrowserStack. All rights reserved.</p>
      </div>
    </footer>`;
}

function renderDashboard(pid) {
  const p = PRODUCTS.find((x) => x.id === pid);
  if (!p) return renderHome();
  document.title = p.name + ' – BrowserStack Demo Hub';
  if (typeof gtag === 'function') {
    gtag('event', 'page_view', {
      page_title: document.title,
      page_path: location.pathname + location.search + '/#/product/' + pid,
      page_location: location.href,
      // ADD THESE TWO LINES:
      product_name: p.name,
      product_id: p.id
    });
  }
  const cards = p.videos.map(
    (v) => `
    <div class="glass card vthumb" data-vid="${v.id}" onclick="location.hash='#/product/${p.id}/video/${v.id}'">
      <div class="thumbwrap">
        <img class="thumbimg" src="${thumbUrl(v)}" alt="${esc(v.title)}" onerror="this.classList.add('noimg')" />
        <div class="play"><span>&#9654;</span></div>
        ${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}
      </div>
      <div class="meta">
        <h3>${esc(v.title)}</h3>
        <p>${esc(v.description).slice(0, 90)}${v.description.length > 90 ? "…" : ""}</p>
      </div>
    </div>`
  ).join("");
  app.innerHTML = `
    <div class="crumbs fade">
      <button class="back-btn" onclick="location.hash='#/'">&#8592; Back</button>
      <a onclick="location.hash='#/'">BrowserStack Demo Hub</a><span>›</span><span>${esc(p.name)}</span>
    </div>
    <header class="hero fade" style="text-align:left;margin-bottom:24px;">
      <h1 style="font-size:2.4rem;display:flex;align-items:center;gap:12px;">
        ${p.iconSvg ? `<img src="${p.iconSvg}" alt="" style="width:36px;height:36px;object-fit:contain;flex-shrink:0;" />` : `<span>${p.icon}</span>`}
        ${esc(p.name)}
      </h1>
      <h5>${esc(p.tagline)}</h5>
    </header>
    <div class="dash-search-row fade">
      <div class="dash-search-wrap">
        <span class="dash-search-icon">🔍</span>
        <input type="search" id="dashSearch" class="dash-search" placeholder="Filter videos…" autocomplete="off" />
      </div>
    </div>
    <div class="grid fade" id="dashGrid">${cards}</div>`;

  // Wire up dashboard search filter (tokenised + synonym scoring, same engine as global search)
  const dashSearch = document.getElementById("dashSearch");
  if (dashSearch) {
    dashSearch.addEventListener("input", () => {
      const q = dashSearch.value.trim();
      const queryTokens = tokenise(q);
      document.querySelectorAll("#dashGrid .card").forEach((card) => {
        if (!q || queryTokens.length === 0) {
          card.style.display = "";
          return;
        }
        // Resolve the video object from the card's data-vid attribute
        const vid = card.getAttribute("data-vid") ||
          card.getAttribute("onclick")?.match(/video\/([^']+)/)?.[1];
        const videoObj = vid ? p.videos.find(x => x.id === vid) : null;
        if (videoObj) {
          const score = scoreVideo({ product: p, video: videoObj }, queryTokens);
          card.style.display = score > 0 ? "" : "none";
        } else {
          // Fallback: plain text match on rendered content
          const text = (card.querySelector("h3")?.textContent || "") + " " +
                       (card.querySelector("p")?.textContent || "");
          const corpus = text.toLowerCase();
          const expanded = expandTokens(queryTokens);
          const allMatch = queryTokens.every(t => corpus.includes(t));
          const anyExpanded = expanded.some(t => corpus.includes(t));
          card.style.display = (allMatch || anyExpanded) ? "" : "none";
        }
      });
    });
  }
}

function renderVideo(pid, vid) {
  const p = PRODUCTS.find((x) => x.id === pid);
  const idx = p ? p.videos.findIndex((x) => x.id === vid) : -1;
  const v = idx >= 0 ? p.videos[idx] : null;
  if (!v) return renderHome();
  document.title = v.title + ' – BrowserStack Demo Hub';
  
  if (typeof gtag === 'function') {
    gtag('event', 'page_view', {
      page_title: document.title,
      page_path: location.pathname + location.search + '/#/product/' + pid + '/video/' + vid,
      page_location: location.href,
      // ADD THESE TWO LINES:
      product_name: p.name,
      product_id: p.id
    });
    gtag('event', 'video_view', {
      video_title: v.title,
      video_id: v.id,
      video_duration: v.duration || '',
      product_name: p.name,
      product_id: p.id,
      video_index: idx + 1,
      total_videos: p.videos.length
    });
  }
  
  function renderLink(item, emoji, eventName) {
    const url = typeof item === "string" ? item : item.url;
    const label = typeof item === "string"
      ? decodeURIComponent(url.split("/").filter(Boolean).pop().replace(/-/g, " "))
      : item.label;
    
    const gidParam = `,q_group_id:'${_effectiveGroupId.replace(/'/g,"\\'")}'`;
    const gaAttr = `onclick="if(typeof gtag==='function')gtag('event','${eventName}',{link_label:'${label.replace(/'/g,"\\'")}',link_url:'${url.replace(/'/g,"\\'")}',video_title:'${v.title.replace(/'/g,"\\'")}',product_name:'${p.name.replace(/'/g,"\\'")}'${gidParam}})"`;
    
    return `<li><a href="${esc(url)}" target="_blank" rel="noopener" ${gaAttr}>${emoji} ${esc(label)}</a></li>`;
  }
  
  const docs = v.docs.map((d) => renderLink(d, "📄", "doc_click")).join("");
  const links = v.links.map((l) => renderLink(l, "🔗", "link_click")).join("");
  
  const playlistGidParam = `,q_group_id:'${_effectiveGroupId.replace(/'/g,"\\'")}'`;
  const playlist = p.videos
    .map(
      (item, i) => `
      <li class="pl-item ${item.id === v.id ? "active" : ""}" data-vid="${item.id}" onclick="if(typeof gtag==='function'&&'${item.id}'!=='${v.id}')gtag('event','playlist_click',{video_title:'${item.title.replace(/'/g,"\\'")}',video_id:'${item.id}',product_name:'${p.name.replace(/'/g,"\\'")}',from_video:'${v.title.replace(/'/g,"\\'")}'${playlistGidParam}}); location.hash='#/product/${p.id}/video/${item.id}'">
        <span class="pl-index">${i + 1}</span>
        <img class="pl-thumb" src="${thumbUrl(item)}" alt="" onerror="this.classList.add('noimg')" />
        <span class="pl-meta">
          <span class="pl-title">${esc(item.title)}</span>
          <span class="pl-sub">
            ${item.duration ? `<span class="pl-dur">${esc(item.duration)}</span>` : ""}
            ${item.id === v.id ? '<span class="pl-now">Now playing</span>' : ""}
          </span>
        </span>
      </li>`
    )
    .join("");
    
  app.innerHTML = `
    <div class="crumbs fade">
      <button class="back-btn" onclick="location.hash='#/product/${p.id}'">&#8592; Back</button>
      <a onclick="location.hash='#/'">BrowserStack Demo Hub</a><span>›</span>
      <a onclick="location.hash='#/product/${p.id}'">${esc(p.name)}</a><span>›</span>
      <span>${esc(v.title)}</span>
    </div>
    <div class="detail fade">
      <div class="main-col">
        <div class="glass player-wrap">
          <iframe id="yt-player" src="${embedUrl(v, { jsapi: true, widgetReferrer: location.href })}" title="${esc(v.title)}" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="origin"></iframe>
        </div>
        <div class="glass panel desc-panel">
          <div class="desc-title-row">
            <h2>${esc(v.title)}</h2>
            <button class="copy-link-btn" title="Copy link to this video" onclick="copyVideoLink()">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <span>Copy link</span>
            </button>
          </div>
          <p>${esc(v.description)}</p>
        </div>
      </div>
      <div class="side">
        <div class="glass panel pl-panel">
          <h4>▶ Playlist &middot; ${p.videos.length} videos</h4>
          <ul class="playlist">${playlist}</ul>
        </div>
        <div class="glass panel">
          <h4>Documentation</h4>
          <ul class="linklist">${docs || "<li><p>None yet.</p></li>"}</ul>
        </div>
        <div class="glass panel">
          <h4>Relevant Links</h4>
          <ul class="linklist">${links || "<li><p>None yet.</p></li>"}</ul>
        </div>
      </div>
    </div>`;
    
  const next = p.videos[idx + 1];
  setupAutoAdvance(v, p, next ? `#/product/${p.id}/video/${next.id}` : null);
  
  const active = document.querySelector(".pl-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

// ── Copy video link + toast ────────────────────────────────────────────────
function copyVideoLink() {
  const url = location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(showCopyToast).catch(() => fallbackCopy(url));
  } else {
    fallbackCopy(url);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); showCopyToast(); } catch(e) {}
  document.body.removeChild(ta);
}
function showCopyToast() {
  let toast = document.getElementById("copy-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "copy-toast";
    toast.className = "copy-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = "✓ Link copied to clipboard";
  toast.classList.add("copy-toast--show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("copy-toast--show"), 2400);
}

// Dark mode toggle — persists in localStorage
function initDarkMode() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
  updateToggleIcon();
}
function updateToggleIcon() {
  const btn = document.getElementById("darkToggle");
  if (!btn) return;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  btn.querySelector(".toggle-icon").textContent = isDark ? "☀️" : "🌙";
  btn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
}
if (document.getElementById("darkToggle")) {
  document.getElementById("darkToggle").addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    }
    updateToggleIcon();
  });
}
initDarkMode();

window.addEventListener("hashchange", render);
render();