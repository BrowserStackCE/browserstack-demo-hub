// Demo Hub — full-screen badge detail view (Apple Fitness style).
// Depends on Achievements (achievements.js) and PRODUCTS (data.js).
const BadgeDetail = (() => {
  const TYPES = ["explorer", "master"];
  let _pid = null;
  let _idx = 0;
  let _touchX = null;

  function _product(pid) { return PRODUCTS.find((p) => p.id === pid); }
  function _fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); }
    catch (e) { return ""; }
  }
  function _icon(p) {
    return p && p.iconSvg ? `<img src="${p.iconSvg}" alt="" />` : `<span>${(p && p.icon) || "★"}</span>`;
  }

  // One slide = one badge (Explorer or Master) of the current product
  function _slide(type, p) {
    const earned = Achievements.hasBadge(type, p.id);
    const pr = Achievements.productProgress(p.id);
    const isMaster = type === "master";
    const name = Achievements.badgeName(type, p);
    const when = earned ? Achievements.earnedAt(type, p.id) : null;
    const how = isMaster
      ? `Finish all ${pr.total} ${esc(p.name)} video${pr.total === 1 ? "" : "s"}`
      : `Start any ${esc(p.name)} video`;
    const pct = isMaster ? pr.pct : (earned ? 100 : 0);
    const progressText = isMaster
      ? `${pr.done} of ${pr.total} videos completed`
      : (earned ? "Started" : "Not started yet");
    return `
      <section class="bd-slide ${isMaster ? "is-master" : "is-explorer"} ${earned ? "is-earned" : "is-locked"}" data-type="${type}" aria-label="${esc(name)}">
        <div class="bd-stage">
          <div class="bd-glow"></div>
          <div class="bd-sparkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="bd-medal-wrap">
            <div class="bd-medal">
              <div class="bd-medal-edge"></div>
              <div class="bd-medal-ring"></div>
              <div class="bd-medal-face">${_icon(p)}</div>
              <div class="bd-medal-shine"></div>
              ${isMaster ? '<div class="bd-crown">👑</div>' : ""}
            </div>
            ${earned ? "" : '<div class="bd-lock">🔒</div>'}
          </div>
        </div>
        <div class="bd-info">
          <div class="bd-kicker">${isMaster ? "Milestone" : "Badge"} · ${esc(p.name)}</div>
          <h2 class="bd-name">${esc(name)}</h2>
          <p class="bd-blurb">${esc(Achievements.badgeBlurb(type, p))}</p>
          ${earned
            ? `<div class="bd-earned">✓ Earned${when ? " on " + esc(_fmtDate(when)) : ""}</div>`
            : `<div class="bd-howto"><b>How to earn it</b><span>${how}</span></div>`}
          <div class="bd-progress">
            <div class="bd-bar"><div class="bd-bar-fill ${earned && isMaster ? "is-full" : ""}" style="width:${pct}%"></div></div>
            <small>${progressText}</small>
          </div>
        </div>
      </section>`;
  }

  function _render() {
    const p = _product(_pid);
    const ov = document.getElementById("bdOverlay");
    if (!p || !ov) return;
    const type = TYPES[_idx];
    ov.querySelector(".bd-content").innerHTML = _slide(type, p);
    ov.querySelectorAll(".bd-dot").forEach((d, i) => d.classList.toggle("is-on", i === _idx));
    ov.classList.toggle("is-master-view", type === "master");
    const earned = Achievements.hasBadge(type, p.id);
    ov.querySelector(".bd-share-row").style.display = earned ? "" : "none";
    _bindTilt(ov.querySelector(".bd-medal-wrap"), earned);
  }

  // Pointer tilt for earned medals (skipped for reduced motion)
  function _bindTilt(el, earned) {
    if (!el || !earned) return;
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const medal = el.querySelector(".bd-medal");
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      medal.style.transform = `rotateY(${x * 28}deg) rotateX(${-y * 28}deg)`;
    });
    el.addEventListener("pointerleave", () => { medal.style.transform = ""; });
  }

  function go(delta) {
    const n = _idx + delta;
    if (n < 0 || n >= TYPES.length) return;
    _idx = n;
    _render();
    Achievements.track("badge_detail_viewed", {
      product_id: _pid, badge_type: TYPES[_idx], badge_id: TYPES[_idx] + ":" + _pid, source: "flip"
    });
  }

  function _onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
  }

  // ---- Shareable badge card (canvas -> PNG / PDF) ----
  function _loadImg(src) {
    return new Promise((res) => {
      if (!src) return res(null);
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  }
  function _wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    words.forEach((w) => {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }

  async function _renderCard(type, p) {
    const W = 1080, H = 1350;
    const master = type === "master";
    const A = master ? "#ffd54a" : "#6f7bff";
    const B = master ? "#ff8f00" : "#2c74f6";
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

    // background
    const bg = ctx.createRadialGradient(W / 2, 300, 40, W / 2, 300, 1100);
    if (master) { bg.addColorStop(0, "#4a2c06"); bg.addColorStop(0.6, "#14090a"); bg.addColorStop(1, "#060304"); }
    else { bg.addColorStop(0, "#1b2352"); bg.addColorStop(0.6, "#0b0e1d"); bg.addColorStop(1, "#05060d"); }
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // glow
    const cx = W / 2, cy = 520, R = 270;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 520);
    glow.addColorStop(0, master ? "rgba(255,170,0,.55)" : "rgba(44,116,246,.5)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // sparkles
    [[170, 300, 7], [900, 260, 6], [130, 640, 5], [960, 700, 8], [260, 150, 5], [820, 130, 6]].forEach(([x, y, r]) => {
      ctx.save(); ctx.shadowColor = B; ctx.shadowBlur = 24; ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    });

    // medal edge + shadow
    ctx.save();
    ctx.shadowColor = master ? "rgba(255,170,0,.7)" : "rgba(44,116,246,.7)"; ctx.shadowBlur = 90; ctx.shadowOffsetY = 20;
    const edge = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    edge.addColorStop(0, "rgba(255,255,255,.7)"); edge.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = edge; ctx.beginPath(); ctx.arc(cx, cy, R + 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // medal ring (conic when available)
    if (ctx.createConicGradient) {
      const g = ctx.createConicGradient(0.35, cx, cy);
      [A, B, A, B, A].forEach((col, i) => g.addColorStop(i / 4, col));
      ctx.fillStyle = g;
    } else {
      const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      g.addColorStop(0, A); g.addColorStop(1, B); ctx.fillStyle = g;
    }
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = "rgba(255,255,255,.4)";
    ctx.beginPath(); ctx.arc(cx, cy, R - 3, 0, Math.PI * 2); ctx.stroke();

    // face
    const FR = R * 0.7;
    const face = ctx.createRadialGradient(cx - FR * 0.3, cy - FR * 0.4, 10, cx, cy, FR);
    face.addColorStop(0, "#ffffff"); face.addColorStop(0.7, "#dfe6ff"); face.addColorStop(1, "#cfd8ff");
    ctx.fillStyle = face; ctx.beginPath(); ctx.arc(cx, cy, FR, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.stroke();

    // product icon
    const img = await _loadImg(p.iconSvg);
    if (img) {
      const s = FR * 1.15;
      ctx.drawImage(img, cx - s / 2, cy - s / 2, s, s);
    } else {
      ctx.fillStyle = "#1a2a6c"; ctx.font = `700 ${FR}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.icon || "★", cx, cy);
    }

    // crown for master
    if (master) {
      ctx.font = `150px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.save(); ctx.translate(cx, cy - R + 10); ctx.rotate(-0.12); ctx.fillText("👑", 0, 0); ctx.restore();
    }

    // text
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = `700 30px ${FONT}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "5px";
    ctx.fillText(((master ? "Milestone" : "Badge") + " · " + p.name).toUpperCase(), cx, 925);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    const name = Achievements.badgeName(type, p);
    ctx.font = `800 84px ${FONT}`;
    let y = 1020;
    const nameLines = _wrap(ctx, name, W - 160);
    const ng = ctx.createLinearGradient(0, y - 80, 0, y + 20);
    ng.addColorStop(0.3, "#ffffff"); ng.addColorStop(1, A);
    ctx.fillStyle = ng;
    nameLines.forEach((l) => { ctx.fillText(l, cx, y); y += 92; });

    ctx.fillStyle = "rgba(255,255,255,.82)"; ctx.font = `400 36px ${FONT}`;
    y -= 10;
    _wrap(ctx, Achievements.badgeBlurb(type, p), W - 260).slice(0, 2).forEach((l) => { ctx.fillText(l, cx, y); y += 50; });

    // earned pill
    const when = Achievements.earnedAt(type, p.id);
    const pill = "✓ Earned" + (when ? " on " + _fmtDate(when) : "");
    ctx.font = `700 30px ${FONT}`;
    const pw = ctx.measureText(pill).width + 64, ph = 62, py = Math.min(y + 10, H - 150);
    const pg = ctx.createLinearGradient(cx - pw / 2, 0, cx + pw / 2, 0);
    pg.addColorStop(0, "#5df0a8"); pg.addColorStop(1, "#1fbf7a");
    ctx.fillStyle = pg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - pw / 2, py, pw, ph, 31); else ctx.rect(cx - pw / 2, py, pw, ph);
    ctx.fill();
    ctx.fillStyle = "#0b2e1c"; ctx.textBaseline = "middle"; ctx.fillText(pill, cx, py + ph / 2 + 1);

    // footer
    ctx.textBaseline = "alphabetic"; ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.font = `600 26px ${FONT}`;
    ctx.fillText("BrowserStack Demo Hub", cx, H - 46);
    return c;
  }

  // Minimal single-page PDF embedding a JPEG (no library needed)
  function _pdfFromCanvas(canvas) {
    const jpeg = atob(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
    const w = canvas.width, h = canvas.height;
    const pw = 540, ph = Math.round(540 * h / w); // points
    const parts = [];
    const offs = [];
    let len = 0;
    const push = (s) => { parts.push(s); len += s.length; };
    const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
    push("%PDF-1.4\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    offs[4] = len;
    push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push("\nendstream\nendobj\n");
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const xref = len;
    let x = "xref\n0 6\n0000000000 65535 f \n";
    for (let i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, "0") + " 00000 n \n";
    push(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const all = parts.join("");
    const bytes = new Uint8Array(all.length);
    for (let i = 0; i < all.length; i++) bytes[i] = all.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: "application/pdf" });
  }

  function _save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function _flash(btn, text) {
    if (!btn) return;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = btn.dataset.label; btn.disabled = false; }, 1800);
  }

  async function _download(format, btn) {
    const p = _product(_pid);
    if (!p) return;
    const type = TYPES[_idx];
    if (!Achievements.hasBadge(type, p.id)) return;
    btn.disabled = true;
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.textContent = "Creating…";
    try {
      const canvas = await _renderCard(type, p);
      const base = ("bs-demohub-" + type + "-" + p.id).replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
      if (format === "pdf") {
        _save(_pdfFromCanvas(canvas), base + ".pdf");
      } else {
        const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
        _save(blob, base + ".png");
      }
      Achievements.track("badge_shared", { product_id: _pid, badge_type: type, badge_id: type + ":" + _pid, share_method: "download_" + format });
      _flash(btn, "Saved ✓");
    } catch (e) {
      _flash(btn, "Failed");
    }
  }

  function _copyText() {
    const p = _product(_pid);
    if (!p) return;
    const type = TYPES[_idx];
    const text = `I just earned the "${Achievements.badgeName(type, p)}" badge on the BrowserStack Demo Hub! ${location.origin}${location.pathname}`;
    Achievements.track("badge_shared", { product_id: _pid, badge_type: type, badge_id: type + ":" + _pid, share_method: "copy_text" });
    const b = document.querySelector("#bdOverlay .bd-copy");
    if (b) b.dataset.label = b.dataset.label || b.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => _flash(b, "Copied!")).catch(() => {});
  }

  // open(productId, 'explorer' | 'master', source)
  function open(pid, type, source) {
    const p = _product(pid);
    if (!p) return;
    close(true);
    _pid = pid;
    _idx = Math.max(0, TYPES.indexOf(type));
    const src = typeof source === "string" ? source : "unknown";
    const ov = document.createElement("div");
    ov.id = "bdOverlay";
    ov.className = "bd-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", p.name + " badges");
    ov.innerHTML = `
      <button class="bd-close" type="button" aria-label="Close">&times;</button>
      <button class="bd-nav bd-prev" type="button" aria-label="Previous badge">&#8249;</button>
      <button class="bd-nav bd-next" type="button" aria-label="Next badge">&#8250;</button>
      <div class="bd-content"></div>
      <div class="bd-footer">
        <div class="bd-dots"><span class="bd-dot"></span><span class="bd-dot"></span></div>
        <div class="bd-share-row">
          <button class="bd-share bd-png" type="button">Save image</button>
          <button class="bd-share bd-pdf" type="button">Save PDF</button>
          <button class="bd-share bd-copy" type="button">Copy text</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.body.style.overflow = "hidden";
    ov.querySelector(".bd-close").onclick = () => close();
    ov.querySelector(".bd-prev").onclick = () => go(-1);
    ov.querySelector(".bd-next").onclick = () => go(1);
    ov.querySelector(".bd-png").onclick = (e) => _download("png", e.currentTarget);
    ov.querySelector(".bd-pdf").onclick = (e) => _download("pdf", e.currentTarget);
    ov.querySelector(".bd-copy").onclick = _copyText;
    ov.querySelectorAll(".bd-dot").forEach((d, i) => { d.onclick = () => { _idx = i; _render(); }; });
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.addEventListener("touchstart", (e) => { _touchX = e.touches[0].clientX; }, { passive: true });
    ov.addEventListener("touchend", (e) => {
      if (_touchX == null) return;
      const dx = e.changedTouches[0].clientX - _touchX;
      _touchX = null;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    }, { passive: true });
    document.addEventListener("keydown", _onKey);
    window.addEventListener("hashchange", _onHash);
    _render();
    requestAnimationFrame(() => ov.classList.add("is-in"));
    Achievements.track("badge_detail_viewed", {
      product_id: pid, badge_type: TYPES[_idx], badge_id: TYPES[_idx] + ":" + pid, source: src
    });
  }

  function _onHash() { close(); }

  function close(immediate) {
    document.removeEventListener("keydown", _onKey);
    window.removeEventListener("hashchange", _onHash);
    const ov = document.getElementById("bdOverlay");
    document.body.style.overflow = "";
    if (!ov) return;
    if (immediate === true) { ov.remove(); return; }
    ov.classList.remove("is-in");
    setTimeout(() => ov.remove(), 300);
  }

  return { open, close };
})();
