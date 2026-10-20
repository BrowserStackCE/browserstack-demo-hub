// Demo Hub — Achievements (badges & milestones), persisted in localStorage.
//  • "Explorer" badge  → first time a user starts ANY video of a product
//  • "Master"  badge   → once a user has finished ALL videos of a product
const Achievements = (() => {
  const KEY = "bs_demohub_achievements_v1";
  let _state = null;
  let _queue = [];
  let _busy = false;
  let _introTracked = false;

  // GA helper: every achievement event carries q_group_id plus overall progress
  function _track(name, params) {
    if (typeof gtag !== "function") return;
    let sm = {};
    try {
      const s = summary();
      sm = { badges_earned: s.earned, badges_possible: s.possible, products_mastered: s.master };
    } catch (e) {}
    gtag("event", name, Object.assign({
      q_group_id: typeof _effectiveGroupId !== "undefined" ? _effectiveGroupId : ""
    }, sm, params || {}));
  }

  function _load() {
    if (_state) return _state;
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      _state = {
        started: raw.started || {},     // { videoId: ts }
        completed: raw.completed || {}, // { videoId: ts }
        badges: raw.badges || {}        // { "explorer:pid" | "master:pid": ts }
      };
    } catch (e) {
      _state = { started: {}, completed: {}, badges: {} };
    }
    return _state;
  }
  function _save() {
    try { localStorage.setItem(KEY, JSON.stringify(_state)); } catch (e) {}
  }

  function _product(pid) { return PRODUCTS.find((p) => p.id === pid); }
  function _vids(p) { return (p && p.videos) || []; }

  function isStarted(vid) { return !!_load().started[vid]; }
  function isCompleted(vid) { return !!_load().completed[vid]; }
  function hasBadge(type, pid) { return !!_load().badges[type + ":" + pid]; }

  function productProgress(pid) {
    const p = _product(pid);
    const vids = _vids(p);
    const done = vids.filter((v) => isCompleted(v.id)).length;
    const started = vids.filter((v) => isStarted(v.id)).length;
    return {
      total: vids.length, done, started,
      pct: vids.length ? Math.round((done / vids.length) * 100) : 0
    };
  }

  function summary() {
    const prods = PRODUCTS.filter((p) => _vids(p).length > 0);
    let explorer = 0, master = 0;
    prods.forEach((p) => {
      if (hasBadge("explorer", p.id)) explorer++;
      if (hasBadge("master", p.id)) master++;
    });
    return {
      products: prods.length, explorer, master,
      earned: explorer + master, possible: prods.length * 2
    };
  }

  function _award(type, pid) {
    const s = _load();
    const k = type + ":" + pid;
    if (s.badges[k]) return;
    s.badges[k] = Date.now();
    _save();
    // Report at the moment of earning, not when the (queued) toast is displayed
    const prod = _product(pid);
    const pr = productProgress(pid);
    _track("badge_unlocked", {
      badge_type: type, badge_id: type + ":" + pid, product_id: pid,
      product_name: prod ? prod.name : pid,
      badge_name: prod ? badgeName(type, prod) : type + ":" + pid,
      videos_completed: pr.done, videos_total: pr.total
    });
    _enqueue({ type, pid });
    _refreshNavCount();
  }

  function recordStart(pid, vid) {
    const s = _load();
    if (!s.started[vid]) { s.started[vid] = Date.now(); _save(); }
    _award("explorer", pid);
  }

  function recordComplete(pid, vid) {
    const s = _load();
    if (!s.started[vid]) s.started[vid] = Date.now();
    if (!s.completed[vid]) { s.completed[vid] = Date.now(); _save(); }
    _award("explorer", pid);
    const p = _product(pid);
    const vids = _vids(p);
    if (vids.length && vids.every((v) => s.completed[v.id])) _award("master", pid);
    _refreshPageWidgets();
  }

  // ── Product-wise badge names ─────────────────────────────────────────────
  // explorer = first video started, master = every video finished.
  // `blurb` is the line shown in the unlock toast. Unlisted products fall back to a generic name.
  const BADGE_NAMES = {
    "live": {
      explorer: { name: "Browser Voyager", blurb: "You've set sail across real browsers and devices." },
      master:   { name: "Cross-Browser Captain", blurb: "Every browser bows to you. No bug escapes your live sessions." }
    },
    "app-live": {
      explorer: { name: "Pocket Pioneer", blurb: "You've picked up your first real device." },
      master:   { name: "Device Whisperer", blurb: "Real phones, real taps, zero surprises. App Live mastered." }
    },
    "automate": {
      explorer: { name: "Script Starter", blurb: "Your first automated run is on its way." },
      master:   { name: "Automation Architect", blurb: "You're running tests at scale while everyone else is clicking." }
    },
    "app-automate": {
      explorer: { name: "Mobile Maverick", blurb: "You've launched your first automated mobile test." },
      master:   { name: "App Automation Ace", blurb: "Hundreds of devices, one pipeline. App Automate is yours." }
    },
    "test-management": {
      explorer: { name: "Case Collector", blurb: "Your test cases are getting organised." },
      master:   { name: "Quality Commander", blurb: "Plans, cases and runs in perfect order. You lead from the front." }
    },
    "accessibility": {
      explorer: { name: "Inclusion Initiate", blurb: "You've started building for everyone." },
      master:   { name: "Accessibility Champion", blurb: "WCAG-ready and proud. The web is better because of you." }
    },
    "app-accessibility": {
      explorer: { name: "Access Ally", blurb: "You've started testing native apps for everyone." },
      master:   { name: "Inclusive App Hero", blurb: "Every screen, every user. Native accessibility mastered." }
    },
    "Low-Code-Automation": {
      explorer: { name: "No-Code Newbie", blurb: "You've built your first test without writing a line." },
      master:   { name: "Low-Code Legend", blurb: "Tests at the speed of thought. No code, all power." }
    },
    "test-reporting-and-analytics": {
      explorer: { name: "Insight Seeker", blurb: "You've opened the dashboard and the data is talking." },
      master:   { name: "Analytics Afficionado", blurb: "You turn raw runs into clear decisions." }
    },
    "percy": {
      explorer: { name: "Pixel Spotter", blurb: "You've caught your first visual change." },
      master:   { name: "Visual Virtuoso", blurb: "Not a single pixel out of place. Percy is in your hands." }
    },
    "app-percy": {
      explorer: { name: "Screen Scout", blurb: "You've started watching your app's look and feel." },
      master:   { name: "Pixel-Perfect Pro", blurb: "Every screen on every device, flawless. App Percy mastered." }
    },
    "test-companion": {
      explorer: { name: "AI Apprentice", blurb: "You've met your new testing sidekick." },
      master:   { name: "Companion Commander", blurb: "You and your AI companion are an unstoppable pair." }
    },
    "load-testing": {
      explorer: { name: "Traffic Tamer", blurb: "You've sent your first wave of virtual users." },
      master:   { name: "Load Legend", blurb: "Peak traffic? You've already survived it." }
    },
    "requestly": {
      explorer: { name: "Request Ranger", blurb: "You've intercepted your first request." },
      master:   { name: "API Alchemist", blurb: "Mock, modify, debug. Every request now bends to your will." }
    }
  };

  // Display name / toast line for a badge, with a generic fallback for unlisted products
  function badgeName(type, p) {
    const e = BADGE_NAMES[p.id] && BADGE_NAMES[p.id][type];
    return e ? e.name : p.name + " " + (type === "master" ? "Master" : "Explorer");
  }
  function badgeBlurb(type, p) {
    const e = BADGE_NAMES[p.id] && BADGE_NAMES[p.id][type];
    if (e) return e.blurb;
    return type === "master"
      ? "You completed every " + p.name + " video. Incredible!"
      : "You've started your " + p.name + " journey.";
  }

  // ── Badge visuals ────────────────────────────────────────────────────────
  function _icon(p) {
    return p && p.iconSvg
      ? `<img src="${p.iconSvg}" alt="" />`
      : `<span>${(p && p.icon) || "★"}</span>`;
  }

  function badgeHTML(type, p, earned, size) {
    const label = badgeName(type, p);
    return `
      <div class="ach-badge ach-${type} ${earned ? "is-earned" : "is-locked"} ${size || ""}" title="${esc(label)}${earned ? "" : " (locked)"}">
        <div class="ach-medal">
          <div class="ach-medal-ring"></div>
          <div class="ach-medal-face">${_icon(p)}</div>
          ${type === "master" ? '<div class="ach-crown">👑</div>' : ""}
          ${earned ? "" : '<div class="ach-lock">🔒</div>'}
          <div class="ach-shine"></div>
        </div>
      </div>`;
  }

  // Compact progress strip for the product page
  function productBanner(pid) {
    const p = _product(pid);
    if (!p || !_vids(p).length) return "";
    const pr = productProgress(pid);
    const ex = hasBadge("explorer", pid), ma = hasBadge("master", pid);
    const msg = ma
      ? "Mastered! You've watched every video. 🎉"
      : pr.done > 0
        ? `${pr.total - pr.done} more video${pr.total - pr.done === 1 ? "" : "s"} to earn the Master badge`
        : ex ? "Keep going — finish every video to earn the Master badge"
             : "Start any video to earn the Explorer badge";
    return `
      <div class="ach-banner glass fade" id="achBanner">
        <div class="ach-banner-badges">
          <span class="ach-pick" role="button" tabindex="0" aria-label="${esc(badgeName("explorer", p))}" onclick="BadgeDetail.open('${p.id}','explorer','product_banner')">${badgeHTML("explorer", p, ex, "sm")}</span>
          <span class="ach-pick" role="button" tabindex="0" aria-label="${esc(badgeName("master", p))}" onclick="BadgeDetail.open('${p.id}','master','product_banner')">${badgeHTML("master", p, ma, "sm")}</span>
        </div>
        <div class="ach-banner-main">
          <div class="ach-banner-top">
            <b>Your ${esc(p.name)} journey</b>
            <span>${pr.done}/${pr.total} completed</span>
          </div>
          <div class="ach-bar"><div class="ach-bar-fill ${ma ? "is-full" : ""}" style="width:${pr.pct}%"></div></div>
          <div class="ach-banner-msg">${msg}</div>
        </div>
      </div>`;
  }

  // Tiny progress ring for home cards
  function cardRing(pid) {
    const p = _product(pid);
    if (!p || !_vids(p).length) return "";
    const pr = productProgress(pid);
    const ex = hasBadge("explorer", pid), ma = hasBadge("master", pid);
    if (!ex && !ma && pr.done === 0) return "";
    const r = 15, c = 2 * Math.PI * r, off = c * (1 - pr.pct / 100);
    return `
      <div class="ach-ring ${ma ? "is-master" : ""}" title="${pr.done}/${pr.total} completed">
        <svg viewBox="0 0 40 40" width="40" height="40">
          <circle cx="20" cy="20" r="${r}" class="ach-ring-bg"></circle>
          <circle cx="20" cy="20" r="${r}" class="ach-ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 20 20)"></circle>
        </svg>
        <span>${ma ? "👑" : pr.pct + "%"}</span>
      </div>`;
  }

  // "Watched" check on video thumbnails
  function thumbMark(vid) {
    if (isCompleted(vid)) return '<span class="ach-done-mark" title="Completed">✓ Watched</span>';
    return "";
  }

  // ── Toast queue ──────────────────────────────────────────────────────────
  function _enqueue(item) { _queue.push(item); if (!_busy) _next(); }
  function _next() {
    const item = _queue.shift();
    if (!item) { _busy = false; return; }
    _busy = true;
    _showUnlock(item);
  }

  function _showUnlock({ type, pid }) {
    const p = _product(pid);
    if (!p) return _next();
    const isMaster = type === "master";
    const old = document.getElementById("achToast");
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = "achToast";
    el.className = "ach-toast " + (isMaster ? "is-master" : "is-explorer");
    el.setAttribute("role", "status");
    el.innerHTML = `
      <div class="ach-toast-glow"></div>
      ${badgeHTML(type, p, true)}
      <div class="ach-toast-text">
        <div class="ach-toast-kicker">${isMaster ? "🏆 Milestone unlocked" : "✨ Badge unlocked"}</div>
        <div class="ach-toast-title">${esc(badgeName(type, p))}</div>
        <div class="ach-toast-sub">${esc(badgeBlurb(type, p))}</div>
      </div>
      <button class="ach-toast-view" type="button">View</button>
      <button class="ach-toast-x" type="button" aria-label="Dismiss">&times;</button>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-in"));
    if (isMaster) _confetti();

    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      el.classList.remove("is-in");
      el.classList.add("is-out");
      setTimeout(() => { el.remove(); _next(); }, 450);
    };
    el.querySelector(".ach-toast-x").onclick = close;
    el.querySelector(".ach-toast-view").onclick = () => {
      close();
      if (typeof BadgeDetail !== "undefined") BadgeDetail.open(pid, type, "toast");
      else openCase("toast");
    };
    setTimeout(close, isMaster ? 7000 : 4800);
  }

  // ── Confetti ─────────────────────────────────────────────────────────────
  function _confetti() {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cv = document.createElement("canvas");
    cv.className = "ach-confetti";
    cv.width = innerWidth; cv.height = innerHeight;
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d");
    const colors = ["#2c74f6", "#6f7bff", "#ffd54a", "#ff6b9d", "#35d49a", "#ff9f43"];
    const bits = Array.from({ length: 150 }, () => ({
      x: cv.width / 2 + (Math.random() - 0.5) * 240,
      y: cv.height * 0.35,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 14 - 4,
      s: Math.random() * 8 + 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0]
    }));
    let frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      bits.forEach((b) => {
        b.vy += 0.38; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.globalAlpha = Math.max(0, 1 - frames / 170);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        ctx.restore();
      });
      if (++frames < 170) requestAnimationFrame(tick); else cv.remove();
    })();
  }

  // ── Trophy case modal ────────────────────────────────────────────────────
  function openCase(source) {
    closeCase();
    // Inline handlers may pass an Event, so only accept strings
    const src = typeof source === "string" ? source : "navbar";
    if (src === "intro_banner") _track("achievements_intro_cta", {});
    markIntroSeen();
    _track("achievements_opened", { source: src });
    const sm = summary();
    const pct = sm.possible ? Math.round((sm.earned / sm.possible) * 100) : 0;
    const level =
      sm.master >= sm.products && sm.products > 0 ? "BrowserStack Legend" :
      sm.master >= 3 ? "Power User" :
      sm.earned >= 3 ? "Rising Star" :
      sm.earned >= 1 ? "Explorer" : "Newcomer";
    const rows = PRODUCTS.filter((p) => _vids(p).length).map((p) => {
      const pr = productProgress(p.id);
      const ex = hasBadge("explorer", p.id), ma = hasBadge("master", p.id);
      return `
        <div class="ach-row ${ma ? "is-master" : ex ? "is-explorer" : ""}" onclick="Achievements.closeCase(); location.hash='#/product/${p.id}'">
          <div class="ach-row-badges">
            <span class="ach-pick" role="button" tabindex="0" aria-label="${esc(badgeName("explorer", p))}" onclick="event.stopPropagation(); Achievements.closeCase(); BadgeDetail.open('${p.id}','explorer','trophy_case')">${badgeHTML("explorer", p, ex, "sm")}</span>
            <span class="ach-pick" role="button" tabindex="0" aria-label="${esc(badgeName("master", p))}" onclick="event.stopPropagation(); Achievements.closeCase(); BadgeDetail.open('${p.id}','master','trophy_case')">${badgeHTML("master", p, ma, "sm")}</span>
          </div>
          <div class="ach-row-info">
            <b>${esc(p.name)}</b>
            <div class="ach-bar"><div class="ach-bar-fill ${ma ? "is-full" : ""}" style="width:${pr.pct}%"></div></div>
            <small>${pr.done}/${pr.total} videos completed${ma ? " · " + esc(badgeName("master", p)) + " 👑" : ex ? " · " + esc(badgeName("explorer", p)) + " ✨" : ""}</small>
          </div>
        </div>`;
    }).join("");

    const ov = document.createElement("div");
    ov.className = "ach-overlay";
    ov.id = "achOverlay";
    ov.innerHTML = `
      <div class="ach-modal" role="dialog" aria-modal="true" aria-label="Your achievements">
        <button class="ach-modal-x" type="button" aria-label="Close">&times;</button>
        <div class="ach-hero">
          <div class="ach-hero-trophy">🏆</div>
          <div>
            <div class="ach-hero-kicker">Your trophy case</div>
            <div class="ach-hero-level">${level}</div>
            <div class="ach-hero-sub">${sm.earned} of ${sm.possible} badges earned · ${sm.master}/${sm.products} products mastered</div>
          </div>
        </div>
        <div class="ach-bar ach-bar-lg"><div class="ach-bar-fill" style="width:${pct}%"></div></div>
        <div class="ach-legend">
          <span><i class="dot dot-ex"></i>Explorer — start any video</span>
          <span><i class="dot dot-ma"></i>Master — finish every video</span>
        </div>
        <div class="ach-list">${rows}</div>
        <button class="ach-reset" type="button">Reset progress</button>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("is-in"));
    ov.addEventListener("click", (e) => { if (e.target === ov) closeCase(); });
    ov.querySelector(".ach-modal-x").onclick = closeCase;
    ov.querySelector(".ach-reset").onclick = () => {
      if (confirm("Reset all your badges and watch progress on this browser?")) {
        _track("achievements_reset", {});
        _state = { started: {}, completed: {}, badges: {} };
        _save(); closeCase(); _refreshNavCount(); _refreshPageWidgets();
      }
    };
    document.addEventListener("keydown", _esc);
    window.addEventListener("hashchange", closeCase);
  }
  function _esc(e) { if (e.key === "Escape") closeCase(); }
  function closeCase() {
    document.removeEventListener("keydown", _esc);
    window.removeEventListener("hashchange", closeCase);
    const ov = document.getElementById("achOverlay");
    if (!ov) return;
    ov.classList.remove("is-in");
    setTimeout(() => ov.remove(), 250);
  }

  // ── Feature announcement (shown on the first INTRO_MAX_VIEWS visits) ─────
  // A "view" = one page load on which the home banner was rendered.
  const VIEWS_KEY = "bs_demohub_ach_intro_views_v1";
  const INTRO_MAX_VIEWS = 5;
  let _introDismissed = false; // dismissed/opened on THIS page load only

  function _introViews() {
    try { return parseInt(localStorage.getItem(VIEWS_KEY), 10) || 0; } catch (e) { return INTRO_MAX_VIEWS; }
  }
  // Still within the 3-view budget (or the current page load is one of them)
  function _introSeen() {
    return _introDismissed || _introViews() >= INTRO_MAX_VIEWS + (_introTracked ? 1 : 0);
  }
  function markIntroSeen(how) {
    if (how === "dismiss") _track("achievements_intro_dismissed", { intro_view: _introViews() });
    _introDismissed = true;
    const nb = document.getElementById("achNavBtn");
    if (nb) nb.classList.remove("is-new");
    const tip = document.getElementById("achNavTip");
    if (tip) tip.remove();
    const b = document.getElementById("achIntro");
    if (b) {
      b.classList.add("is-out");
      setTimeout(() => b.remove(), 400);
    }
  }
  // Home-page banner markup. Counts one view per page load; empty after 3 views.
  function introBanner() {
    if (_introDismissed) return "";
    if (!_introTracked) {
      if (_introViews() >= INTRO_MAX_VIEWS) return "";
      _introTracked = true;
      const n = _introViews() + 1;
      try { localStorage.setItem(VIEWS_KEY, String(n)); } catch (e) {}
      _track("achievements_intro_shown", { intro_view: n });
    }
    const total = PRODUCTS.filter((p) => _vids(p).length).length;
    return `
      <div class="ach-intro fade" id="achIntro" role="status">
        <div class="ach-intro-medals" aria-hidden="true">
          <span class="m m1">✨</span><span class="m m2">🏆</span><span class="m m3">👑</span>
        </div>
        <div class="ach-intro-text">
          <span class="ach-intro-tag">NEW</span>
          <b>Earn badges as you learn.</b>
          Start a product's videos to become an <b>Explorer</b>, finish them all to become a <b>Master</b>.
          ${total} products, ${total * 2} badges to collect.
        </div>
        <button class="ach-intro-cta" type="button" onclick="Achievements.openCase('intro_banner')">See my badges</button>
        <button class="ach-intro-x" type="button" aria-label="Dismiss" onclick="Achievements.markIntroSeen('dismiss')">&times;</button>
      </div>`;
  }

  // ── Nav button ───────────────────────────────────────────────────────────
  function _refreshNavCount() {
    const el = document.getElementById("achNavCount");
    if (!el) return;
    const n = summary().earned;
    el.textContent = n;
    el.style.display = n ? "" : "none";
  }
  function initNav() {
    const right = document.querySelector(".nav-right");
    if (!right || document.getElementById("achNavBtn")) return;
    const btn = document.createElement("button");
    btn.id = "achNavBtn";
    btn.className = "ach-nav-btn";
    btn.type = "button";
    btn.title = "Your achievements";
    btn.setAttribute("aria-label", "Your achievements");
    btn.innerHTML = '<span>🏆</span><b id="achNavCount" class="ach-nav-count" style="display:none">0</b>';
    btn.onclick = () => openCase("navbar");
    right.insertBefore(btn, right.firstChild);
    _refreshNavCount();
    if (!_introSeen()) {
      btn.classList.add("is-new");
      const tip = document.createElement("div");
      tip.id = "achNavTip";
      tip.className = "ach-nav-tip";
      tip.textContent = "New: collect badges!";
      btn.appendChild(tip);
    }
  }

  // Live-update page widgets (e.g. product banner) without a full re-render
  function _refreshPageWidgets() {
    const b = document.getElementById("achBanner");
    if (b) {
      const pid = (location.hash.match(/#\/product\/([^/?]+)/) || [])[1];
      if (pid) {
        const tmp = document.createElement("div");
        tmp.innerHTML = productBanner(pid).replace(" fade", "");
        if (tmp.firstElementChild) b.replaceWith(tmp.firstElementChild);
      }
    }
    document.querySelectorAll("[data-vid]").forEach((card) => {
      if (isCompleted(card.getAttribute("data-vid")) && !card.querySelector(".ach-done-mark")) {
        const w = card.querySelector(".thumbwrap");
        if (w) w.insertAdjacentHTML("beforeend", thumbMark(card.getAttribute("data-vid")));
      }
    });
  }

  return {
    recordStart, recordComplete, isCompleted, isStarted, hasBadge,
    productProgress, summary, badgeHTML, productBanner, cardRing, thumbMark,
    openCase, closeCase, initNav, introBanner, markIntroSeen,
    // used by achievement-detail.js (full-screen badge view)
    badgeName, badgeBlurb, track: _track,
    earnedAt: (type, pid) => _load().badges[type + ":" + pid] || null
  };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", Achievements.initNav);
} else {
  Achievements.initNav();
}
