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

// ── Mini Player State ──────────────────────────────────────────────────────
const MiniPlayer = (() => {
  let _el = null;           // the .miniplayer DOM element
  let _mpPlayer = null;     // YT.Player instance inside mini player
  let _videoObj = null;     // current video metadata
  let _productObj = null;   // current product metadata
  let _savedTime = 0;       // playback position to resume from
  let _isVisible = false;
  let _currentVideoId = null; // track which video is in the mini player

  // ── Drag state ────────────────────────────────────────────────────────────
  let _drag = {
    active: false,
    startX: 0, startY: 0,
    origLeft: 0, origTop: 0
  };

  function _getEl() { return document.getElementById('miniplayer'); }

  function _buildHTML(v, embedSrc) {
    return `
      <div class="mp-drag-handle" id="mp-drag-handle">
        <div class="mp-drag-pill"></div>
      </div>
      <div class="mp-video-wrap">
        <iframe
          id="mp-yt-iframe"
          src="${embedSrc}"
          title="${esc(v.title)}"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          referrerpolicy="origin">
        </iframe>
        <div class="mp-drag-shield"></div>
      </div>
      <div class="mp-info">
        <span class="mp-title">${esc(v.title)}</span>
        <div class="mp-actions">
          <button class="mp-btn mp-btn-expand" title="Back to full player" onclick="MiniPlayer.expand()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          </button>
          <button class="mp-btn mp-btn-close" title="Close mini player" onclick="MiniPlayer.close()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="mp-resize-handle mp-resize-handle--tl" data-corner="tl"><div class="mp-resize-dots"></div></div>
      <div class="mp-resize-handle mp-resize-handle--tr" data-corner="tr"><div class="mp-resize-dots"></div></div>
      <div class="mp-resize-handle mp-resize-handle--bl" data-corner="bl"><div class="mp-resize-dots"></div></div>
      <div class="mp-resize-handle mp-resize-handle--br" data-corner="br"><div class="mp-resize-dots"></div></div>`;
  }

  function _makeSrc(v, startSeconds) {
    const parsed = parseYouTube(v.youtubeId);
    const params = new URLSearchParams({
      rel: '0', modestbranding: '1', playsinline: '1',
      enablejsapi: '1', origin: location.origin,
      autoplay: '1',
      widget_referrer: location.href
    });
    // seekTo() via onReady handles resume — start= param is unreliable in production
    const path = parsed.videoId || '';
    return `https://www.youtube.com/embed/${path}?${params.toString()}`;
  }

  // Resize state
  let _resize = {
    active: false,
    corner: 'br',
    startX: 0, startY: 0,
    origW: 0,
    origLeft: 0, origTop: 0,
    origRight: 0, origBottom: 0
  };
  const MIN_W = 240, MAX_W = 560;

  // Spring physics snap animation
  function _springSnap(el, fromX, fromY, toX, toY) {
    // Cancel any running spring
    if (el._springRaf) cancelAnimationFrame(el._springRaf);

    const stiffness = 280;  // spring stiffness
    const damping   = 22;   // damping coefficient
    const mass      = 1;

    let x = fromX, y = fromY;
    let vx = 0, vy = 0;
    let lastTime = null;

    function step(ts) {
      if (!lastTime) { lastTime = ts; el._springRaf = requestAnimationFrame(step); return; }
      const dt = Math.min((ts - lastTime) / 1000, 0.032); // cap at 32ms
      lastTime = ts;

      // Spring force
      const ax = (-stiffness * (x - toX) - damping * vx) / mass;
      const ay = (-stiffness * (y - toY) - damping * vy) / mass;

      vx += ax * dt;
      vy += ay * dt;
      x  += vx * dt;
      y  += vy * dt;

      el.style.left = x + 'px';
      el.style.top  = y + 'px';

      // Check if settled (velocity and displacement both tiny)
      const settled = Math.abs(x - toX) < 0.15 && Math.abs(y - toY) < 0.15
                   && Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5;

      if (!settled && document.body.contains(el)) {
        el._springRaf = requestAnimationFrame(step);
      } else {
        el.style.left = toX + 'px';
        el.style.top  = toY + 'px';
        el._springRaf = null;
        // Subtle landing pulse
        el.style.transition = 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1)';
        el.style.transform = 'scale(1.03)';
        setTimeout(() => {
          if (el) {
            el.style.transform = 'scale(1)';
            setTimeout(() => { if (el) el.style.transition = ''; }, 200);
          }
        }, 80);
      }
    }

    el._springRaf = requestAnimationFrame(step);
  }

    function _attachDrag(el) {
    // Drag is initiated from the pill (pointer-events: auto), not the full handle container
    const handle = el.querySelector('.mp-drag-pill');
    if (!handle) return;

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      _drag.active = true;
      el.classList.add('is-dragging');
      el.classList.remove('snap-back');

      const rect = el.getBoundingClientRect();
      _drag.origLeft = rect.left;
      _drag.origTop  = rect.top;
      _drag.startX   = e.clientX;
      _drag.startY   = e.clientY;

      // Switch to absolute positioning from fixed bottom/right
      el.style.left   = rect.left + 'px';
      el.style.top    = rect.top  + 'px';
      el.style.right  = 'auto';
      el.style.bottom = 'auto';

      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!_drag.active) return;
      const dx = e.clientX - _drag.startX;
      const dy = e.clientY - _drag.startY;
      const newLeft = _drag.origLeft + dx;
      const newTop  = _drag.origTop  + dy;

      // Clamp within viewport
      const W = window.innerWidth, H = window.innerHeight;
      const elW = el.offsetWidth, elH = el.offsetHeight;
      const clampedLeft = Math.max(8, Math.min(W - elW - 8, newLeft));
      const clampedTop  = Math.max(8, Math.min(H - elH - 8, newTop));

      el.style.left = clampedLeft + 'px';
      el.style.top  = clampedTop  + 'px';
    }

    function onPointerUp() {
      if (!_drag.active) return;
      _drag.active = false;
      el.classList.remove('is-dragging');

      // Determine nearest corner
      const W = window.innerWidth, H = window.innerHeight;
      const elW = el.offsetWidth, elH = el.offsetHeight;
      const curLeft = parseFloat(el.style.left) || (W - elW - 28);
      const curTop  = parseFloat(el.style.top)  || (H - elH - 28);
      const cx = curLeft + elW / 2;
      const cy = curTop  + elH / 2;
      const MARGIN = 20;

      const targetLeft = cx < W / 2 ? MARGIN : W - elW - MARGIN;
      const targetTop  = cy < H / 2 ? MARGIN : H - elH - MARGIN;

      el.style.right  = 'auto';
      el.style.bottom = 'auto';

      // JS spring animation — much better than CSS transition
      _springSnap(el, curLeft, curTop, targetLeft, targetTop);
    }

    handle.addEventListener('mousedown',  onPointerDown);
    handle.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      onPointerDown({ clientX: t.clientX, clientY: t.clientY, button: 0, preventDefault: () => e.preventDefault() });
    }, { passive: false });

    document.addEventListener('mousemove',  onPointerMove);
    document.addEventListener('mouseup',    onPointerUp);
    document.addEventListener('touchmove',  (e) => {
      if (!_drag.active) return;
      const t = e.touches[0];
      onPointerMove({ clientX: t.clientX, clientY: t.clientY });
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', onPointerUp);

    // ── Resize handles — all 4 corners ────────────────────────────────────
    // Listeners go on .mp-resize-dots (pointer-events: auto) not the container
    el.querySelectorAll('.mp-resize-handle').forEach(rh => {
      const corner = rh.dataset.corner; // tl | tr | bl | br
      const dots = rh.querySelector('.mp-resize-dots');
      if (!dots) return;

      function onResizeDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        _resize.active = true;
        _resize.corner = corner;
        _resize.startX = e.clientX;
        _resize.startY = e.clientY;
        _resize.origW  = el.offsetWidth;
        // Normalise to left/top positioning
        const rect = el.getBoundingClientRect();
        el.style.left   = rect.left + 'px';
        el.style.top    = rect.top  + 'px';
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
        _resize.origLeft = rect.left;
        _resize.origTop  = rect.top;
        _resize.origRight  = rect.right;
        _resize.origBottom = rect.bottom;
        el.classList.add('is-dragging');
        e.preventDefault();
        e.stopPropagation();
      }

      dots.addEventListener('mousedown', onResizeDown);
      dots.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        onResizeDown({ clientX: t.clientX, clientY: t.clientY, button: 0,
          preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() });
      }, { passive: false });
    });

    function onResizeMove(e) {
      if (!_resize.active) return;
      const dx = e.clientX - _resize.startX;
      const dy = e.clientY - _resize.startY;
      const corner = _resize.corner;
      const W = window.innerWidth, H = window.innerHeight;

      let newW = _resize.origW;
      let newLeft = _resize.origLeft;
      let newTop  = _resize.origTop;

      // Horizontal resize
      if (corner === 'tr' || corner === 'br') {
        // Right edge moves right → grow; clamp so right edge stays in viewport
        newW = Math.max(MIN_W, Math.min(MAX_W, _resize.origW + dx));
        newW = Math.min(newW, W - _resize.origLeft - 8);
      } else {
        // Left edge moves left → grow; clamp so left edge stays in viewport
        newW = Math.max(MIN_W, Math.min(MAX_W, _resize.origW - dx));
        newW = Math.min(newW, _resize.origRight - 8);
        const actualDx = _resize.origW - newW;
        newLeft = Math.max(8, _resize.origLeft + actualDx);
      }

      // Vertical: top corners adjust top edge, bottom corners keep top fixed
      const aspectH = newW * (9 / 16); // video area height
      const infoH = 52; // approximate info bar height
      const totalH = aspectH + infoH + 44; // +44 for drag handle

      if (corner === 'tl' || corner === 'tr') {
        // Top edge moves up → grow; clamp so top stays in viewport
        newTop = Math.max(8, _resize.origBottom - totalH);
      } else {
        // Bottom edge: clamp so bottom stays in viewport
        newTop = Math.max(8, Math.min(H - totalH - 8, _resize.origTop));
      }

      el.style.width = newW + 'px';
      el.style.left  = newLeft + 'px';
      el.style.top   = newTop  + 'px';
    }

    function onResizeUp() {
      if (!_resize.active) return;
      _resize.active = false;
      el.classList.remove('is-dragging');
    }

    document.addEventListener('mousemove', (e) => { if (_resize.active) onResizeMove(e); });
    document.addEventListener('mouseup',   onResizeUp);
    document.addEventListener('touchmove', (e) => {
      if (!_resize.active) return;
      const t = e.touches[0];
      onResizeMove({ clientX: t.clientX, clientY: t.clientY });
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', onResizeUp);
  }

  function _initYTPlayer(startSeconds) {
    whenYTReady(() => {
      const iframe = document.getElementById('mp-yt-iframe');
      if (!iframe) return;
      if (_mpPlayer) {
        try { _mpPlayer.destroy(); } catch(e) {}
        _mpPlayer = null;
      }
      _mpPlayer = new YT.Player(iframe, {
        events: {
          onReady: (e) => {
            if (startSeconds && startSeconds > 1) {
              try { e.target.seekTo(startSeconds, true); e.target.playVideo(); } catch(err) {}
            }
          },
          onStateChange: (e) => {}
        }
      });
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function show(videoObj, productObj, startSeconds) {
    _videoObj   = videoObj;
    _productObj = productObj;
    _savedTime  = startSeconds || 0;
    _currentVideoId = videoObj.id;

    // Remove existing if any
    const existing = _getEl();
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'miniplayer';
    el.id = 'miniplayer';
    el.innerHTML = _buildHTML(videoObj, _makeSrc(videoObj, _savedTime));
    document.body.appendChild(el);
    _el = el;
    _isVisible = true;

    _attachDrag(el);
    _initYTPlayer(_savedTime);
  }

  function hide() {
    const el = _getEl();
    if (!el) return;
    // Capture current time before hiding
    if (_mpPlayer && typeof _mpPlayer.getCurrentTime === 'function') {
      try { _savedTime = _mpPlayer.getCurrentTime(); } catch(e) {}
    }
    if (_mpPlayer) { try { _mpPlayer.destroy(); } catch(e) {} _mpPlayer = null; }
    el.classList.add('is-hiding');
    setTimeout(() => { el.remove(); _el = null; }, 320);
    _isVisible = false;
    _currentVideoId = null;
  }

  function close() {
    const el = _getEl();
    if (!el) return;
    if (_mpPlayer) { try { _mpPlayer.destroy(); } catch(e) {} _mpPlayer = null; }
    el.classList.add('is-hiding');
    setTimeout(() => { el.remove(); _el = null; }, 320);
    _isVisible = false;
    _videoObj = null;
    _productObj = null;
    _savedTime = 0;
    _currentVideoId = null;
  }

  function expand() {
    if (!_videoObj || !_productObj) return;
    // Capture current time
    if (_mpPlayer && typeof _mpPlayer.getCurrentTime === 'function') {
      try { _savedTime = _mpPlayer.getCurrentTime(); } catch(e) {}
    }
    const vid = _videoObj;
    const pid = _productObj.id;
    const t   = Math.floor(_savedTime);
    // Hide mini player first
    hide();
    // Navigate back to the full video page
    // Use a flag so renderVideo knows to resume at _savedTime
    _pendingResume = { videoId: vid.id, productId: pid, time: t };
    location.hash = `#/product/${pid}/video/${vid.id}`;
  }

  function getSavedTime() { return _savedTime; }
  function isVisible()    { return _isVisible; }
  function getCurrentVideoId() { return _currentVideoId; }

  // Called by renderVideo to check if we should resume
  let _pendingResume = null;
  function consumePendingResume(videoId) {
    if (_pendingResume && _pendingResume.videoId === videoId) {
      const t = _pendingResume.time;
      _pendingResume = null;
      return t;
    }
    return null;
  }

  return { show, hide, close, expand, isVisible, getSavedTime, getCurrentVideoId, consumePendingResume };
})();

function setupAutoAdvance(videoObj, productObj, nextHash, resumeTime) {
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
        onReady: (e) => {
          // Resume from mini player position if applicable
          if (resumeTime && resumeTime > 1) {
            try { e.target.seekTo(resumeTime, true); e.target.playVideo(); } catch(err) {}
          }
        },
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

  const isVideoPage = parts[0] === "product" && parts[2] === "video";

  // If navigating AWAY from a video page and a player is active, show mini player
  if (!isVideoPage && _currentPlayer) {
    const currentHash = location.hash;
    // Find which video was playing
    const prevHash = window._lastVideoHash || '';
    const prevParts = prevHash.slice(1).split('/').filter(Boolean);
    if (prevParts[0] === 'product' && prevParts[2] === 'video') {
      const pid = prevParts[1], vid = prevParts[3];
      const p = PRODUCTS.find(x => x.id === pid);
      const v = p && p.videos.find(x => x.id === vid);
      if (p && v && MiniPlayer.getCurrentVideoId() !== vid) {
        let startTime = 0;
        if (_currentPlayer && typeof _currentPlayer.getCurrentTime === 'function') {
          try { startTime = _currentPlayer.getCurrentTime(); } catch(e) {}
        }
        MiniPlayer.show(v, p, startTime);
      }
    }
    // Destroy the full-page player
    try { _currentPlayer.destroy(); } catch(e) {}
    _currentPlayer = null;
  }

  // If navigating TO the video that's in the mini player, hide the mini player
  if (isVideoPage && MiniPlayer.isVisible() && MiniPlayer.getCurrentVideoId() === parts[3]) {
    MiniPlayer.hide();
  }

  if (isVideoPage) {
    window._lastVideoHash = location.hash;
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

function renderLiveCta(v) {
  var desktopBtn = v.desktopLiveUrl
    ? '<button class="live-cta-btn live-cta-btn--desktop" onclick="LiveUrlModal.open(\'' + v.id + '\',\'desktop\',\'' + esc(v.desktopLiveUrl) + '\')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Desktop Browser</button>'
    : '';
  var mobileBtn = v.mobileLiveUrl
    ? '<button class="live-cta-btn live-cta-btn--mobile" onclick="LiveUrlModal.open(\'' + v.id + '\',\'mobile\',\'' + esc(v.mobileLiveUrl) + '\')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> Mobile Browser</button>'
    : '';
  var androidAppBtn = v.androidAppLiveUrl
    ? '<button class="live-cta-btn live-cta-btn--android" onclick="AppLiveModal.open(\'' + v.id + '\')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> Try on Real Android Device</button>'
    : '';
  return '<div class="live-cta-panel"><div class="live-cta-glow"></div><div class="live-cta-content"><div class="live-cta-left"><span class="live-cta-badge">&#x26A1; LIVE SESSION</span><h3 class="live-cta-heading">Try this feature on a BrowserStack Real Device!</h3><p class="live-cta-sub">Launch an instant live session &mdash; no setup, no installs. Just click and test.</p></div><div class="live-cta-actions">' + desktopBtn + mobileBtn + androidAppBtn + '</div></div></div>';
}

// ── Live URL Modal (desktop / mobile browser buttons) ────────────────────────
var LiveUrlModal = (function () {
  var _videoId = null;
  var _type = null;
  var _baseUrl = '';
  var SAMPLE_URL = 'https://ecommercebs.vercel.app';

  function _ensureModal() {
    if (document.getElementById('lum-overlay')) return;
    var el = document.createElement('div');
    el.id = 'lum-overlay';
    el.className = 'lum-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'lum-title');
    el.innerHTML = [
      '<div class="lum-box">',
        '<button class="lum-close" aria-label="Close" onclick="LiveUrlModal.close()">',
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        '</button>',
        '<div class="lum-header">',
          '<div class="lum-icon" id="lum-icon">',
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
          '</div>',
          '<div>',
            '<h2 class="lum-title" id="lum-title">Launch Live Session</h2>',
            '<p class="lum-subtitle" id="lum-subtitle">Choose how you want to test</p>',
          '</div>',
        '</div>',
        '<div class="lum-options">',
          '<button class="lum-option" onclick="LiveUrlModal.launchSample()">',
            '<div class="lum-option-icon lum-option-icon--sample">',
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 8 12 12 14 14"/></svg>',
            '</div>',
            '<div class="lum-option-body">',
              '<strong>Test with sample URL</strong>',
              '<span>Launches our demo e-commerce site &mdash; ready instantly, no setup needed.</span>',
            '</div>',
            '<svg class="lum-option-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
          '</button>',
          '<div class="lum-option lum-option--input">',
            '<div class="lum-option-icon lum-option-icon--custom">',
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
            '</div>',
            '<div class="lum-option-body lum-option-body--full">',
              '<strong>Test with your URL</strong>',
              '<div class="lum-url-row">',
                '<input id="lum-url-input" type="url" placeholder="https://your-site.com" autocomplete="url" spellcheck="false" onkeydown="if(event.key===\'Enter\')LiveUrlModal.launchCustom()" />',
                '<button class="lum-launch-btn" onclick="LiveUrlModal.launchCustom()">',
                  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
                  'Launch',
                '</button>',
              '</div>',
              '<div id="lum-url-err" class="lum-url-err" style="display:none"></div>',
            '</div>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');
    el.addEventListener('click', function (e) { if (e.target === el) LiveUrlModal.close(); });
    document.body.appendChild(el);
  }

  function _buildUrl(siteUrl) {
    if (_baseUrl.includes('{{url}}')) {
      return _baseUrl.replace('{{url}}', encodeURIComponent(siteUrl));
    }
    // Replace existing url= parameter in the hash fragment (e.g. #...&url=...&...)
    if (/[#&]url=/.test(_baseUrl)) {
      return _baseUrl.replace(/((?:^|[#&])url=)[^&]*/, '$1' + encodeURIComponent(siteUrl));
    }
    // url= not present — append it inside the hash if there is one, else as a query param
    var hashIdx = _baseUrl.indexOf('#');
    if (hashIdx !== -1) {
      return _baseUrl + '&url=' + encodeURIComponent(siteUrl);
    }
    return _baseUrl + '?url=' + encodeURIComponent(siteUrl);
  }

  return {
    open: function (videoId, type, baseUrl) {
      _videoId = videoId;
      _type = type;
      _baseUrl = baseUrl;
      _ensureModal();
      var icon = document.getElementById('lum-icon');
      if (icon) {
        icon.innerHTML = type === 'mobile'
          ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>'
          : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
      }
      var subtitle = document.getElementById('lum-subtitle');
      if (subtitle) subtitle.textContent = type === 'mobile' ? 'Mobile Browser \u2014 choose a URL to test' : 'Desktop Browser \u2014 choose a URL to test';
      var inp = document.getElementById('lum-url-input');
      if (inp) inp.value = '';
      var err = document.getElementById('lum-url-err');
      if (err) { err.style.display = 'none'; err.textContent = ''; }
      var overlay = document.getElementById('lum-overlay');
      overlay.classList.add('visible');
      document.body.style.overflow = 'hidden';
    },

    close: function () {
      var overlay = document.getElementById('lum-overlay');
      if (overlay) overlay.classList.remove('visible');
      document.body.style.overflow = '';
    },

    launchSample: function () {
      var url = _buildUrl(SAMPLE_URL);
      if (typeof gtag === 'function') gtag('event', 'live_cta_click', { cta_type: _type, video_id: _videoId, url_type: 'sample' });
      window.open(url, '_blank', 'noopener');
      LiveUrlModal.close();
    },

    launchCustom: function () {
      var inp = document.getElementById('lum-url-input');
      var err = document.getElementById('lum-url-err');
      var raw = (inp ? inp.value : '').trim();
      if (!raw) {
        if (err) { err.style.display = ''; err.textContent = 'Please enter a URL.'; }
        if (inp) inp.focus();
        return;
      }
      if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
      try { new URL(raw); } catch (e) {
        if (err) { err.style.display = ''; err.textContent = "That doesn't look like a valid URL."; }
        if (inp) inp.focus();
        return;
      }
      if (err) { err.style.display = 'none'; err.textContent = ''; }
      var url = _buildUrl(raw);
      if (typeof gtag === 'function') gtag('event', 'live_cta_click', { cta_type: _type, video_id: _videoId, url_type: 'custom' });
      window.open(url, '_blank', 'noopener');
      LiveUrlModal.close();
    }
  };
}());

// ── App Live – Sample App Modal (curl flow) ───────────────────────────────
var AppLiveModal = (function () {
  var _videoId = null;
  var _realCmd = '';

  function _ensureModal() {
    if (document.getElementById('alm-overlay')) return;
    var el = document.createElement('div');
    el.id = 'alm-overlay';
    el.className = 'alm-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'alm-title');
    el.innerHTML = [
      '<div class="alm-box">',
        // Close button
        '<button class="alm-close" aria-label="Close" onclick="AppLiveModal.close()">',
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        '</button>',
        // Header
        '<div class="alm-header">',
          '<div class="alm-icon">',
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
          '</div>',
          '<div>',
            '<h2 class="alm-title" id="alm-title">Try on a Real Android Device</h2>',
            '<p class="alm-subtitle">Follow the steps below to launch an App Live session with the Demo sample app.</p>',
          '</div>',
        '</div>',
        // Warning
        '<div class="alm-warning">',
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
          '<span>A <strong>Demo sample APK</strong> will be uploaded to your BrowserStack account. You can delete it anytime from your App Live dashboard.</span>',
        '</div>',
        // Step indicators
        '<div class="alm-steps-nav">',
          '<div class="alm-step-dot active" id="alm-dot-1"><span>1</span></div>',
          '<div class="alm-step-line"></div>',
          '<div class="alm-step-dot" id="alm-dot-2"><span>2</span></div>',
          '<div class="alm-step-line"></div>',
          '<div class="alm-step-dot" id="alm-dot-3"><span>3</span></div>',
        '</div>',
        // ── Step 1: Credentials ──
        '<div id="alm-cached" class="alm-step-panel alm-cached-panel" style="display:none">',
          '<p class="alm-step-label">Ready to launch</p>',
          '<div class="alm-cached-info">',
            '<div class="alm-cached-icon">',
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
            '</div>',
            '<div class="alm-cached-text">',
              '<strong>Demo sample app is ready</strong>',
              '<span>Your app is already set up on this device &mdash; no re-upload needed.</span>',
            '</div>',
          '</div>',
          '<p class="alm-cached-note">',
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
            '<span>App ID saved on this browser. <button class="alm-reset-link" onclick="AppLiveModal.resetCached()">Use a different app</button></span>',
          '</p>',
          '<button class="alm-btn-launch" id="alm-cached-launch-btn" onclick="AppLiveModal.launchCached()">',
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
            'Launch App Live Session',
          '</button>',
        '</div>',
        '<div id="alm-step-1" class="alm-step-panel">',
          '<p class="alm-step-label">Step 1 &mdash; Enter your BrowserStack credentials</p>',
          '<div class="alm-field">',
            '<label for="alm-username">Username <a href="https://www.browserstack.com/accounts/profile/details" target="_blank" rel="noopener noreferrer" style="font-size:0.8em;font-weight:400;">(Find yours)</a></label>',
            '<input id="alm-username" type="text" placeholder="e.g. john_doe" autocomplete="username" spellcheck="false" />',
          '</div>',
          '<div class="alm-field">',
            '<label for="alm-accesskey">Access Key <a href="https://www.browserstack.com/accounts/profile/details" target="_blank" rel="noopener noreferrer" style="font-size:0.8em;font-weight:400;">(Find yours)</a></label>',
            '<div class="alm-key-wrap">',
              '<input id="alm-accesskey" type="password" placeholder="Your access key" autocomplete="current-password" spellcheck="false" />',
              '<button type="button" class="alm-eye" aria-label="Toggle visibility" onclick="AppLiveModal.toggleKey()">',
                '<svg id="alm-eye-show" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
                '<svg id="alm-eye-hide" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
              '</button>',
            '</div>',
          '</div>',
          '<div class="alm-privacy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>Credentials are only used to generate the API command in the next step and are <strong>never stored</strong>.</span></div>',
          '<div id="alm-err-1" class="alm-status alm-status--error" style="display:none"></div>',
          '<button class="alm-btn-primary" onclick="AppLiveModal.goStep2()">',
            'Generate curl Command <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
          '</button>',
        '</div>',
        // ── Step 2: Run curl ──
        '<div id="alm-step-2" class="alm-step-panel" style="display:none">',
          '<p class="alm-step-label">Step 2 &mdash; Run this command in your terminal</p>',
          '<div class="alm-curl-block">',
            '<pre id="alm-curl-pre" class="alm-curl-pre"></pre>',
            '<button type="button" class="alm-copy-btn" onclick="AppLiveModal.copyCurl()" title="Copy">',
              '<svg id="alm-copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
              '<span id="alm-copy-lbl">Copy</span>',
            '</button>',
          '</div>',
          '<p class="alm-hint">The command will return a JSON response like: <code>{"app_url":"bs://abc123..."}</code></p>',
          '<div class="alm-step2-nav">',
            '<button class="alm-btn-back" onclick="AppLiveModal.goStep1()">&#8592; Back</button>',
            '<button class="alm-btn-primary" onclick="AppLiveModal.goStep3()">',
              'I ran it &mdash; Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
            '</button>',
          '</div>',
        '</div>',
        // ── Step 3: Paste hash & launch ──
        '<div id="alm-step-3" class="alm-step-panel" style="display:none">',
          '<p class="alm-step-label">Step 3 &mdash; Paste the app hashed ID and launch</p>',
          '<p class="alm-hint">From the terminal output, copy the value after <code>bs://</code> and paste it below.</p>',
          '<div class="alm-field">',
            '<label for="alm-hashid">App Hashed ID <span class="alm-hint-inline">(the part after bs://)</span></label>',
            '<input id="alm-hashid" type="text" placeholder="e.g. 772fccdc3629a071067a50bd2f49310b34917696" spellcheck="false" />',
          '</div>',
          '<div id="alm-err-3" class="alm-status alm-status--error" style="display:none"></div>',
          '<div class="alm-step2-nav">',
            '<button class="alm-btn-back" onclick="AppLiveModal.goStep2()">&#8592; Back</button>',
            '<button class="alm-btn-launch" id="alm-launch-btn" onclick="AppLiveModal.launch()">',
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
              'Launch App Live Session',
            '</button>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');
    el.addEventListener('click', function (e) { if (e.target === el) AppLiveModal.close(); });
    document.body.appendChild(el);
  }

  function _setDots(step) {
    [1, 2, 3].forEach(function (n) {
      var d = document.getElementById('alm-dot-' + n);
      if (!d) return;
      d.classList.toggle('active', n === step);
      d.classList.toggle('done', n < step);
    });
  }

  function _showStep(n) {
    [1, 2, 3].forEach(function (i) {
      var p = document.getElementById('alm-step-' + i);
      if (p) p.style.display = i === n ? '' : 'none';
    });
    _setDots(n);
  }

  return {
    open: function (videoId) {
      _videoId = videoId;
      _ensureModal();
      // Reset
      ['alm-username', 'alm-accesskey', 'alm-hashid'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
      });
      var k = document.getElementById('alm-accesskey');
      if (k) k.type = 'password';
      var es = document.getElementById('alm-eye-show'), eh = document.getElementById('alm-eye-hide');
      if (es) es.style.display = ''; if (eh) eh.style.display = 'none';
      ['alm-err-1', 'alm-err-3'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.innerHTML = ''; }
      });
      // Check localStorage for a cached app hashed ID
      var cachedId = null;
      try { cachedId = localStorage.getItem('bs_applive_hashed_id'); } catch(e) {}
      if (cachedId) {
        // Show cached panel, hide step panels
        var cached = document.getElementById('alm-cached');
        if (cached) cached.style.display = '';
        [1,2,3].forEach(function(n) {
          var p = document.getElementById('alm-step-' + n);
          if (p) p.style.display = 'none';
        });
        // Hide step dots when using cached
        var nav = document.querySelector('.alm-steps-nav');
        if (nav) nav.style.display = 'none';
      } else {
        var cached = document.getElementById('alm-cached');
        if (cached) cached.style.display = 'none';
        var nav = document.querySelector('.alm-steps-nav');
        if (nav) nav.style.display = '';
        _showStep(1);
      }
      var overlay = document.getElementById('alm-overlay');
      overlay.classList.add('visible');
      document.body.style.overflow = 'hidden';
      setTimeout(function () {
        var u = document.getElementById('alm-username');
        if (!cachedId && u) u.focus();
      }, 80);
    },

    close: function () {
      var overlay = document.getElementById('alm-overlay');
      if (overlay) overlay.classList.remove('visible');
      document.body.style.overflow = '';
    },

    launchCached: function () {
      var cachedId = null;
      try { cachedId = localStorage.getItem('bs_applive_hashed_id'); } catch(e) {}
      if (!cachedId) { AppLiveModal.resetCached(); return; }
      var btn = document.getElementById('alm-cached-launch-btn');
      if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Opening session\u2026'; }
      var sessionUrl = 'https://app-live.browserstack.com/dashboard#os=android&os_version=15.0&device=Google+Pixel+9'
        + '&app_hashed_id=' + encodeURIComponent(cachedId)
        + '&scale_to_fit=true&speed=1&start=true';
      if (typeof gtag === 'function') {
        gtag('event', 'applive_sample_launch', { video_id: _videoId, cached: true });
      }
      setTimeout(function () {
        window.open(sessionUrl, '_blank', 'noopener');
        AppLiveModal.close();
        if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Launch App Live Session'; }
      }, 400);
    },

    resetCached: function () {
      try { localStorage.removeItem('bs_applive_hashed_id'); } catch(e) {}
      var cached = document.getElementById('alm-cached');
      if (cached) cached.style.display = 'none';
      var nav = document.querySelector('.alm-steps-nav');
      if (nav) nav.style.display = '';
      _showStep(1);
      setTimeout(function () {
        var u = document.getElementById('alm-username');
        if (u) u.focus();
      }, 80);
    },

    toggleKey: function () {
      var inp = document.getElementById('alm-accesskey');
      var es = document.getElementById('alm-eye-show'), eh = document.getElementById('alm-eye-hide');
      if (!inp) return;
      var isPwd = inp.type === 'password';
      inp.type = isPwd ? 'text' : 'password';
      if (es) es.style.display = isPwd ? 'none' : '';
      if (eh) eh.style.display = isPwd ? '' : 'none';
    },

    goStep1: function () { _showStep(1); },

    goStep2: function () {
      var username = (document.getElementById('alm-username').value || '').trim();
      var accesskey = (document.getElementById('alm-accesskey').value || '').trim();
      var err = document.getElementById('alm-err-1');
      if (!username || !accesskey) {
        if (err) {
          err.style.display = '';
          err.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Please enter both your username and access key.';
        }
        return;
      }
      if (err) err.style.display = 'none';
      var uploadUrl = 'https://github.com/BrowserStackCE/browserstack-demo-hub/releases/download/2.9.12/NexusDemo-v2.9.12.apk';
      // Store real command for copying; display masked version on screen
      _realCmd = 'curl -u "' + username + ':' + accesskey + '" \\\n  -X POST "https://api-cloud.browserstack.com/app-live/upload" \\\n  -F \x27data={"url": "' + uploadUrl + '"}\x27';
      var maskedCmd = 'curl -u "' + username.replace(/./g, '\u25CF') + ':' + accesskey.replace(/./g, '\u25CF') + '" \\\n  -X POST "https://api-cloud.browserstack.com/app-live/upload" \\\n  -F \x27data={"url": "' + uploadUrl + '"}\x27';
      var pre = document.getElementById('alm-curl-pre');
      if (pre) pre.textContent = maskedCmd;
      var lbl = document.getElementById('alm-copy-lbl');
      if (lbl) lbl.textContent = 'Copy';
      _showStep(2);
    },

    goStep3: function () {
      _showStep(3);
      setTimeout(function () {
        var h = document.getElementById('alm-hashid');
        if (h) h.focus();
      }, 80);
    },

    copyCurl: function () {
      var lbl = document.getElementById('alm-copy-lbl');
      var text = _realCmd;
      if (!text) return;
      var done = function () {
        if (lbl) {
          lbl.textContent = 'Copied!';
          setTimeout(function () { lbl.textContent = 'Copy'; }, 2000);
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          var ta = document.createElement('textarea');
          ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) {}
          document.body.removeChild(ta);
        });
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    },

    launch: function () {
      var raw = (document.getElementById('alm-hashid').value || '').trim();
      var err = document.getElementById('alm-err-3');
      function showErr(msg) {
        if (err) { err.style.display = ''; err.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ' + msg; }
      }
      if (!raw) { showErr('Please paste the app hashed ID first.'); return; }
      // Accept full bs:// URL or bare hash
      var hashedId = raw.replace(/^bs:\/\//, '').trim();
      if (!/^[a-f0-9]{10,}$/i.test(hashedId)) {
        showErr('That doesn\'t look like a valid app hashed ID. Copy the value after <code>bs://</code> from the terminal output.');
        return;
      }
      if (err) err.style.display = 'none';
      var btn = document.getElementById('alm-launch-btn');
      if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Opening session…'; }
      var sessionUrl = 'https://app-live.browserstack.com/dashboard#os=android&os_version=15.0&device=Google+Pixel+9'
        + '&app_hashed_id=' + encodeURIComponent(hashedId)
        + '&scale_to_fit=true&speed=1&start=true';
      if (typeof gtag === 'function') {
        gtag('event', 'applive_sample_launch', { video_id: _videoId });
      }
      setTimeout(function () {
        try { localStorage.setItem('bs_applive_hashed_id', hashedId); } catch(e) {}
        window.open(sessionUrl, '_blank', 'noopener');
        AppLiveModal.close();
        if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Launch App Live Session'; }
      }, 600);
    }
  };
}());

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
    
  // Capture resume time from mini player before rendering
  const _resumeTime = MiniPlayer.consumePendingResume(v.id) || 0;
  const _iframeSrc = embedUrl(v, { jsapi: true, widgetReferrer: location.href });

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
          <iframe id="yt-player" src="${_iframeSrc}" title="${esc(v.title)}" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="origin"></iframe>
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
        ${(v.desktopLiveUrl || v.mobileLiveUrl || v.androidAppLiveUrl) ? renderLiveCta(v) : ''}
      </div>
      <div class="side">
        <div class="glass panel pl-panel">
          <h4>▶ Playlist &middot; ${p.videos.length} videos</h4>
          <ul class="playlist">${playlist}</ul>
        </div>
        <div class="glass panel docs-panel" id="docs-panel">
          <div class="docs-nudge" id="docs-nudge">
            🚀 Ready to dive in? The docs will get you there fast!
            <button class="docs-nudge-close" onclick="document.getElementById('docs-nudge').classList.remove('visible')">✕</button>
          </div>
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
  setupAutoAdvance(v, p, next ? `#/product/${p.id}/video/${next.id}` : null, _resumeTime);

  // Show keyboard shortcut hint once per session
  setTimeout(showKbHint, 1200);

  // Show mini player discovery hint on the player
  setTimeout(() => {
    const playerWrap = document.querySelector('.player-wrap');
    if (!playerWrap) return;
    let hint = playerWrap.querySelector('.mp-discovery-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'mp-discovery-hint';
      hint.innerHTML = '<span class="mp-hint-icon">✦</span> Leave this page — video continues in a mini player';
      playerWrap.appendChild(hint);
    }
    hint.classList.add('visible');
    setTimeout(() => hint.classList.remove('visible'), 5000);
  }, 3500);
  
  const active = document.querySelector(".pl-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });

  // Show docs nudge tooltip after 0.8s, auto-dismiss after 6s
  const nudge = document.getElementById("docs-nudge");
  if (nudge) {
    const nudgeTimer = setTimeout(() => {
      nudge.classList.add("visible");
      setTimeout(() => nudge.classList.remove("visible"), 6000);
    }, 800);
    // Clean up if user navigates away
    const cleanup = () => { clearTimeout(nudgeTimer); nudge.classList.remove("visible"); };
    window.addEventListener("hashchange", cleanup, { once: true });
  }
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
  // Flash the copy button
  const btn = document.querySelector(".copy-link-btn");
  if (btn) {
    btn.classList.remove("copied");
    void btn.offsetWidth; // force reflow to restart animation
    btn.classList.add("copied");
    setTimeout(() => btn.classList.remove("copied"), 500);
  }
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

// ── Keyboard shortcut hint toast ──────────────────────────────────────────
function showKbHint() {
  let hint = document.getElementById('kb-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'kb-hint';
    hint.className = 'kb-hint';
    hint.innerHTML = '<kbd>Space</kbd> Play/Pause &nbsp;·&nbsp; <kbd>F</kbd> Fullscreen';
    document.body.appendChild(hint);
  }
  hint.classList.add('visible');
  setTimeout(() => hint.classList.remove('visible'), 4000);
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────
// Space → play/pause active player
// M     → toggle mini player (show/hide)
// F     → fullscreen on video page
let _spaceDebounce = 0;
document.addEventListener('keydown', (e) => {
  // Ignore when typing in an input/textarea
  const tag = document.activeElement && document.activeElement.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();

    // Debounce: ignore if fired within 400ms of last space press
    const now = Date.now();
    if (now - _spaceDebounce < 400) return;
    _spaceDebounce = now;

    // If the YT iframe has focus, blur it so it does NOT also handle this
    // space press — otherwise both our handler and the iframe toggle the state
    const ytIframe = document.getElementById('yt-player');
    if (ytIframe && document.activeElement === ytIframe) {
      ytIframe.blur();
    }

    // Try full-page player first, then mini player
    if (_currentPlayer && typeof _currentPlayer.getPlayerState === 'function') {
      try {
        const state = _currentPlayer.getPlayerState();
        // Only act on stable states: PLAYING(1), PAUSED(2), CUED(5)
        // Ignore UNSTARTED(-1), ENDED(0), BUFFERING(3) — player not ready yet
        if (state === YT.PlayerState.PLAYING) {
          _currentPlayer.pauseVideo();
        } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.CUED) {
          _currentPlayer.playVideo();
        } else if (state === 3) {
          // Buffering — defer until ready, then play
          const waitAndPlay = setInterval(() => {
            try {
              const s = _currentPlayer.getPlayerState();
              if (s === YT.PlayerState.PAUSED || s === YT.PlayerState.CUED) {
                _currentPlayer.playVideo();
                clearInterval(waitAndPlay);
              } else if (s === YT.PlayerState.PLAYING || s === YT.PlayerState.ENDED) {
                clearInterval(waitAndPlay);
              }
            } catch(e) { clearInterval(waitAndPlay); }
          }, 100);
          setTimeout(() => clearInterval(waitAndPlay), 3000);
        }
      } catch(err) {}
    } else if (MiniPlayer.isVisible()) {
      // Mini player — send postMessage to iframe
      const mpIframe = document.getElementById('mp-yt-iframe');
      if (mpIframe) {
        try {
          const mpPlayer = document.getElementById('mp-yt-iframe').__ytPlayer;
          if (mpPlayer && typeof mpPlayer.getPlayerState === 'function') {
            const s = mpPlayer.getPlayerState();
            if (s === YT.PlayerState.PLAYING) mpPlayer.pauseVideo();
            else if (s === YT.PlayerState.PAUSED || s === YT.PlayerState.CUED) mpPlayer.playVideo();
          }
        } catch(err) {}
      }
    }
  }

if (e.key === 'f' || e.key === 'F') {
    // Fullscreen the main player iframe on video pages
    const iframe = document.getElementById('yt-player');
    if (iframe) {
      try {
        if (iframe.requestFullscreen) iframe.requestFullscreen();
        else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
        else if (iframe.mozRequestFullScreen) iframe.mozRequestFullScreen();
      } catch(err) {}
    }
  }
});

window.addEventListener("hashchange", render);
render();