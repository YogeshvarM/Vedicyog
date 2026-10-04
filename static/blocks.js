// Renderers for the agent's rich blocks (astro-chart, astro-signals, astro-timeline)
// and for a streamed assistant message (markdown + {{chips}} + blocks).
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tone = (t) => (["good", "bad", "neutral"].includes(t) ? t : "neutral");

  const GLYPH = {
    Su: "☉", Mo: "☽", Ma: "♂", Me: "☿", Ju: "♃", Ve: "♀", Sa: "♄",
    Ra: "☊", Ke: "☋", Ur: "♅", Ne: "♆", Pl: "♇", As: "↑",
  };
  const FULL = {
    sun: "Su", moon: "Mo", mars: "Ma", mercury: "Me", jupiter: "Ju", venus: "Ve", saturn: "Sa",
    rahu: "Ra", ketu: "Ke", uranus: "Ur", neptune: "Ne", pluto: "Pl",
  };
  const code = (p) => {
    const s = String(p || "").trim();
    return FULL[s.toLowerCase()] || s.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
  };
  const glyph = (c) => (GLYPH[c] ? GLYPH[c] + "︎" : "");

  // ---------- North Indian chart ----------
  // Houses are fixed: 1 is the top diamond, then counter-clockwise.
  // kind: d = diamond, t = top/bottom triangle (wide), s = side triangle (tall).
  const HOUSES = {
    1: [200, 100, "d"], 2: [100, 36, "t"], 3: [36, 100, "s"], 4: [100, 200, "d"],
    5: [36, 300, "s"], 6: [100, 364, "t"], 7: [200, 300, "d"], 8: [300, 364, "t"],
    9: [364, 300, "s"], 10: [300, 200, "d"], 11: [364, 100, "s"], 12: [300, 36, "t"],
  };

  function layoutHouse(h, n) {
    const [cx, cy, kind] = HOUSES[h];
    let cols = kind === "s" ? (n > 3 ? 2 : 1) : n > 1 ? 2 : 1;
    if (kind === "d" && n > 4) cols = 3;
    const colW = kind === "s" ? 32 : 54;
    const rows = Math.ceil(n / cols);
    const labelH = 18, rowH = kind === "d" ? 24 : 21;
    const total = labelH + rows * rowH;
    const top = cy - total / 2;
    const label = [cx, top + 12];
    const spots = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      spots.push([cx + (c - (inRow - 1) / 2) * colW, top + labelH + r * rowH + 14]);
    }
    return { label, spots };
  }

  function arrowPath(a, b, cls, dashed, from) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const s = [a[0] + ux * 16, a[1] + uy * 10];
    const e = [b[0] - ux * 20, b[1] - uy * 14];
    const bend = Math.min(60, len * 0.16);
    const ctrl = [(s[0] + e[0]) / 2 - uy * bend, (s[1] + e[1]) / 2 + ux * bend];
    const tx = e[0] - ctrl[0], ty = e[1] - ctrl[1];
    const tl = Math.hypot(tx, ty) || 1;
    const hx = tx / tl, hy = ty / tl, size = 9;
    const p1 = [e[0] - hx * size - hy * size * 0.5, e[1] - hy * size + hx * size * 0.5];
    const p2 = [e[0] - hx * size + hy * size * 0.5, e[1] - hy * size - hx * size * 0.5];
    const f = (p) => p.map((v) => v.toFixed(1)).join(",");
    return `<g class="k-link" data-from="${from}"><path class="k-arrow ${cls}" d="M${f(s)} Q${f(ctrl)} ${f(e)}"${dashed ? ' stroke-dasharray="4 3"' : ""}/>` +
      `<polygon class="k-head ${cls}" points="${f(e)} ${f(p1)} ${f(p2)}"/></g>`;
  }

  // Tappable outline of each house, in the same 400x400 frame.
  const HOUSE_SHAPE = {
    1: "200,0 300,100 200,200 100,100", 2: "0,0 200,0 100,100", 3: "0,0 100,100 0,200",
    4: "0,200 100,100 200,200 100,300", 5: "0,200 100,300 0,400", 6: "0,400 100,300 200,400",
    7: "200,400 100,300 200,200 300,300", 8: "200,400 300,300 400,400", 9: "400,400 300,300 400,200",
    10: "400,200 300,300 200,200 300,100", 11: "400,200 300,100 400,0", 12: "400,0 300,100 200,0",
  };

  function chartSvg(d) {
    const asc = Math.min(12, Math.max(1, parseInt(d.ascendant_sign, 10) || 1));
    const byHouse = {};
    for (const p of d.planets || []) {
      const h = parseInt(p.house, 10);
      if (h >= 1 && h <= 12) (byHouse[h] ||= []).push(p);
    }
    const pos = {};
    let areas = "", houses = "", highlights = "";
    for (let h = 1; h <= 12; h++) {
      const list = byHouse[h] || [];
      const { label, spots } = layoutHouse(h, list.length);
      const sign = ((asc + h - 2) % 12) + 1;
      areas += `<polygon class="k-house" data-house="${h}" points="${HOUSE_SHAPE[h]}"/>`;
      houses += `<text class="k-sign" x="${label[0]}" y="${label[1]}" text-anchor="middle">${sign}${h === 1 ? '<tspan class="k-asc"> Asc</tspan>' : ""}</text>`;
      list.forEach((p, i) => {
        const c = code(p.p);
        const [x, y] = spots[i];
        pos[c] = [x, y - 4];
        const hl = p.highlight ? " hl" : "";
        if (p.highlight) highlights += `<rect class="k-hl-box" x="${x - 21}" y="${y - 15}" width="42" height="20" rx="5"/>`;
        houses += `<g class="k-p" data-code="${esc(c)}" tabindex="0" role="button" aria-label="${esc(c)} in house ${h}">` +
          `<rect class="k-hit" x="${x - 24}" y="${y - 17}" width="48" height="26" rx="6"/>` +
          `<text class="k-planet${hl}" x="${x}" y="${y}" text-anchor="middle"><tspan class="k-glyph">${glyph(c)}</tspan> ${esc(c)}</text>`;
        if (p.retro || c === "Ra" || c === "Ke") houses += `<text class="k-rx" x="${x + 13}" y="${y + 9}">Rx</text>`;
        if (p.note) houses += `<text class="k-note" x="${x + 23}" y="${y - 8}">${esc(p.note)}</text>`;
        houses += "</g>";
      });
    }
    let arrows = "";
    for (const a of d.arrows || []) {
      const from = pos[code(a.from)];
      let to = a.to ? pos[code(a.to)] : null;
      const th = parseInt(a.to_house, 10);
      if (!to && HOUSES[th]) to = [HOUSES[th][0], HOUSES[th][1]];
      if (from && to) arrows += arrowPath(from, to, tone(a.tone), a.style === "dashed", esc(code(a.from)));
    }
    return `<svg viewBox="-12 -12 424 424" role="img" aria-label="North Indian chart, ascendant sign ${asc}">
      <rect class="k-frame" x="0" y="0" width="400" height="400"/>
      ${areas}
      <path class="k-line" d="M0 0L400 400M400 0L0 400M200 0L400 200L200 400L0 200Z"/>
      ${highlights}${houses}${arrows}
    </svg>`;
  }

  const dotSvg = (t) => `<svg class="dot ${tone(t)}" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><circle class="core" cx="8" cy="8" r="2"/></svg>`;

  function cardHead(d) {
    return `<div class="card-head">
      ${d.eyebrow ? `<div class="eyebrow">${esc(d.eyebrow)}</div>` : ""}
      <div class="card-title">${esc(d.title)}</div>
      ${d.subtitle ? `<p class="card-sub">${esc(d.subtitle)}</p>` : ""}
    </div>`;
  }

  // most-used first, so they are visible without scrolling the tab strip on a phone
  const DIVISIONS = [
    [1, "Rashi"], [9, "Navamsa"], [10, "Dasamsa"], [2, "Hora"], [3, "Drekkana"], [4, "Chaturthamsa"],
    [7, "Saptamsa"], [12, "Dwadasamsa"], [16, "Shodasamsa"], [20, "Vimsamsa"], [24, "Chaturvimsamsa"],
    [27, "Bhamsa"], [30, "Trimsamsa"], [40, "Khavedamsa"], [45, "Akshavedamsa"], [60, "Shashtiamsa"],
  ];
  const divisionOf = (d) => parseInt(d.division, 10) || parseInt((/\bD(\d{1,2})\b/.exec(d.eyebrow || "") || [])[1], 10) || 1;
  const HINT = '<p class="k-hint">Tap a planet or a house for details.</p>';


  // Divisional charts this reading actually used: those the model declared in "divisions",
  // always including the chart it drew. Without declarations, offer every division.
  function usedDivisions(d, div) {
    const declared = (d.divisions || []).map((x) => parseInt(x.division, 10)).filter((n) => n >= 1 && n <= 60);
    if (!declared.length) return DIVISIONS.map(([n]) => n);
    const set = new Set([div, ...declared]);
    return [...set].sort((a, b) => (declared.includes(a) ? declared.indexOf(a) : 99) - (declared.includes(b) ? declared.indexOf(b) : 99));
  }

  // "What this reading took from D10": purpose, the placements picked, and the conclusion.
  function usePanel(d, n) {
    const u = (d.divisions || []).find((x) => parseInt(x.division, 10) === n);
    if (!u) return "";
    const picks = (u.picks || []).map((p) => {
      const c = code(p.planet);
      return `<li class="use-pick ${tone(p.tone)}" data-code="${esc(c)}" role="button" tabindex="0">
        <span class="use-planet">${glyph(c)} ${esc(c)}</span>
        <div><div class="use-fact">${esc(p.fact)}</div>${p.meaning ? `<div class="use-meaning">${esc(p.meaning)}</div>` : ""}</div>
      </li>`;
    }).join("");
    return `<div class="use-head"><span class="use-tag">D${n} · ${esc(divName(n))}</span>${u.role ? `<span class="use-role">${esc(u.role)}</span>` : ""}</div>
      ${u.why ? `<p class="use-why">${esc(u.why)}</p>` : ""}
      ${picks ? `<div class="use-label">What was picked from this chart <span>tap one to see it on the chart</span></div><ul class="use-picks">${picks}</ul>` : ""}
      ${u.verdict ? `<p class="use-verdict"><b>Conclusion.</b> ${esc(u.verdict)}</p>` : ""}`;
  }

  function renderChart(d) {
    const div = divisionOf(d);
    const legend = (d.legend || []).map((l) => `
      <div class="legend-item" data-code="${esc(code(l.planet))}" role="button" tabindex="0">
        <div class="legend-name">${dotSvg(l.tone)}${esc(l.planet)}</div>
        <div class="legend-detail">${esc(l.detail)}</div>
      </div>`).join("");
    const aspects = (d.aspects || []).map((a) => {
      const title = esc(a.title).replace(/(→|-&gt;)/, '<span class="arr">→</span>');
      return `<div class="aspect"><div class="aspect-title">${title}</div><div class="aspect-text">${esc(a.text)}</div></div>`;
    }).join("");
    const used = usedDivisions(d, div);
    const tabs = used.map((n) => `<button type="button" class="dv-tab${n === div ? " on" : ""}" data-div="${n}" title="D${n} ${divName(n)}${n === div ? " · the chart shown first" : ""}" aria-pressed="${n === div}">D${n}<small>${esc(divName(n))}</small></button>`).join("");
    return `<section class="card chart-card" data-chart="${esc(JSON.stringify(d))}" data-div="${div}">
      ${cardHead(d)}
      <div class="dv-tabs" role="toolbar" aria-label="Divisional charts used in this reading">${tabs}</div>
      <div class="dv-use">${usePanel(d, div)}</div>
      <div class="chart-body">
        <div class="chart-canvas"><div class="k-svg">${chartSvg(d)}</div><div class="k-detail" aria-live="polite">${HINT}</div></div>
        <div class="legend">${legend}</div>
      </div>
      ${aspects ? `<div class="aspects">${aspects}</div>` : ""}
      ${d.caption ? `<div class="card-foot">${esc(d.caption)}</div>` : ""}
    </section>`;
  }

  // ---------- signal board ----------
  const ICON = {
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v1.5M12 16v1.5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15z"/><path d="M5 19l8-8"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24">${ICON[n] || ICON.spark}</svg>`;

  function renderSignals(d) {
    const tiles = (d.signals || []).slice(0, 4).map((s) => `
      <div class="signal ${tone(s.tone)}">
        <div class="signal-label"><svg viewBox="0 0 24 24">${ICON[s.icon] || ICON.spark}</svg>${esc(s.label)}</div>
        <div class="signal-headline">${esc(s.headline)}</div>
        <p class="signal-text">${esc(s.text)}</p>
      </div>`).join("");
    return `<section class="card">${cardHead(d)}<div class="signals">${tiles}</div></section>`;
  }

  // ---------- timeline ----------
  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const DAY = 86400000;

  function fmtSpan(ms) {
    const months = Math.round(ms / (DAY * 30.44));
    if (months < 1) return `${Math.max(1, Math.round(ms / DAY))} days`;
    const y = Math.floor(months / 12), m = months % 12;
    return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(" ");
  }

  function periodDetail(p) {
    const now = Date.now();
    let status;
    if (now < p.s) status = `Starts in ${fmtSpan(p.s - now)}`;
    else if (now >= p.e) status = `Ended ${fmtSpan(now - p.e)} ago`;
    else {
      const pct = ((now - p.s) / (p.e - p.s)) * 100;
      status = `${pct.toFixed(0)}% through · ${fmtSpan(p.e - now)} left
        <span class="tl-progress"><span style="width:${pct.toFixed(1)}%"></span></span>`;
    }
    return `<div class="tl-detail-head">${dotSvg(p.tone)}<b>${esc(p.label)}</b>${p.current ? '<span class="tl-current">RUNNING</span>' : ""}</div>
      <div class="tl-detail-dates">${fmtDay(p.s)} → ${fmtDay(p.e)} · ${fmtSpan(p.e - p.s)}</div>
      <div class="tl-detail-status">${status}</div>
      ${p.note ? `<p class="tl-detail-note">${esc(p.note)}</p>` : ""}`;
  }

  function renderTimeline(d) {
    const periods = (d.periods || [])
      .map((p) => ({ ...p, s: Date.parse(p.start), e: Date.parse(p.end) }))
      .filter((p) => !isNaN(p.s) && !isNaN(p.e) && p.e > p.s);
    if (!periods.length) return `<section class="card">${cardHead(d)}</section>`;
    const min = Math.min(...periods.map((p) => p.s));
    const max = Math.max(...periods.map((p) => p.e));
    const span = max - min;
    const now = Date.now();
    let sel = periods.findIndex((p) => p.current);
    if (sel < 0) sel = periods.findIndex((p) => now >= p.s && now < p.e);
    if (sel < 0) sel = 0;
    const segs = periods.map((p, i) => {
      const w = ((p.e - p.s) / span) * 100;
      return `<div class="tl-seg ${tone(p.tone)}${p.current ? " current" : ""}${i === sel ? " sel" : ""}" data-i="${i}" role="button" tabindex="0" style="width:${w.toFixed(2)}%" title="${esc(p.label)}">${w > 11 ? esc(p.label) : ""}</div>`;
    }).join("");
    const nowMark = now > min && now < max
      ? `<div class="tl-now" style="left:${(((now - min) / span) * 100).toFixed(2)}%"><span>Today</span></div>` : "";
    const list = periods.map((p, i) => `
      <li class="tl-item${i === sel ? " sel" : ""}" data-i="${i}" role="button" tabindex="0">${dotSvg(p.tone)}
        <div>
          <div class="tl-label">${esc(p.label)}<span class="tl-dates">${fmtDate(p.s)} → ${fmtDate(p.e)}</span>${p.current ? '<span class="tl-current">RUNNING</span>' : ""}</div>
          ${p.note ? `<div class="tl-note">${esc(p.note)}</div>` : ""}
        </div>
      </li>`).join("");
    const data = periods.map(({ label, s, e, tone: t, note, current }) => ({ label, s, e, tone: t, note, current }));
    return `<section class="card tl-card" data-tl="${esc(JSON.stringify({ min, max, periods: data }))}">${cardHead(d)}
      <div class="timeline">
        <div class="tl-bar">${segs}${nowMark}<div class="tl-cursor" hidden><span></span></div></div>
        <div class="tl-scale"><span>${fmtDate(min)}</span><span class="tl-hint">Tap or drag along the bar</span><span>${fmtDate(max)}</span></div>
        <div class="tl-detail" aria-live="polite">${periodDetail(periods[sel])}</div>
        <ul class="tl-list">${list}</ul>
      </div>
    </section>`;
  }

  // ---------- summary hero ----------
  function renderSummary(d) {
    const sc = d.score && Number.isFinite(+d.score.value) ? Math.min(100, Math.max(0, +d.score.value)) : null;
    const R = 34, C = 2 * Math.PI * R;
    const ring = sc === null ? "" : `<div class="sum-score" role="img" aria-label="${esc(d.score.label || "Score")} ${sc} out of 100">
      <svg viewBox="0 0 80 80"><circle class="ring-bg" cx="40" cy="40" r="${R}"/>
        <circle class="ring-fg" cx="40" cy="40" r="${R}" stroke-dasharray="${((sc / 100) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/></svg>
      <b>${sc}</b><span>${esc(d.score.label || "")}</span></div>`;
    const kws = (d.keywords || []).slice(0, 5).map((k) => `<span class="sum-kw">${esc(k)}</span>`).join("");
    return `<section class="card summary ${tone(d.tone)}">
      <div class="sum-main">
        <div class="eyebrow">${esc(d.eyebrow || "At a glance")}</div>
        <div class="sum-verdict">${esc(d.verdict)}</div>
        ${d.summary ? `<p class="sum-text">${esc(d.summary)}</p>` : ""}
        ${kws ? `<div class="sum-kws">${kws}</div>` : ""}
      </div>${ring}
    </section>`;
  }

  // ---------- highlights strip ----------
  function renderHighlights(d) {
    const items = (d.items || []).slice(0, 5).map((it) => `
      <div class="hl ${tone(it.tone)}">
        <span class="hl-icon">${icon(it.icon)}</span>
        <div class="hl-title">${esc(it.title)}</div>
        <p class="hl-text">${esc(it.text)}</p>
      </div>`).join("");
    const head = d.title ? cardHead(d) : "";
    return `<section class="card hl-card">${head}<div class="hl-grid n${Math.min(5, (d.items || []).length)}">${items}</div></section>`;
  }

  // ---------- meters ----------
  function renderMeters(d) {
    const bars = (d.bars || []).slice(0, 8).map((b) => {
      const v = Math.min(100, Math.max(0, Math.round(+b.value || 0)));
      return `<div class="meter ${tone(b.tone)}">
        <div class="meter-row"><span class="meter-label">${esc(b.label)}</span><span class="meter-val">${v}</span></div>
        <div class="meter-track"><span style="width:${v}%"></span></div>
        ${b.note ? `<div class="meter-note">${esc(b.note)}</div>` : ""}
      </div>`;
    }).join("");
    return `<section class="card">${cardHead(d)}<div class="meters">${bars}</div></section>`;
  }

  // ---------- callout ----------
  const CALLOUT_ICON = { insight: "bulb", warning: "alert", remedy: "leaf", timing: "clock", tip: "key" };
  function renderCallout(d) {
    const kind = CALLOUT_ICON[d.kind] ? d.kind : "insight";
    return `<aside class="callout ${kind}">
      <span class="callout-icon">${icon(CALLOUT_ICON[kind])}</span>
      <div><div class="callout-kind">${esc(kind)}</div>
        ${d.title ? `<div class="callout-title">${esc(d.title)}</div>` : ""}
        <p class="callout-text">${esc(d.text)}</p></div>
    </aside>`;
  }

  const RENDERERS = {
    "astro-chart": renderChart, "astro-signals": renderSignals, "astro-timeline": renderTimeline,
    "astro-summary": renderSummary, "astro-highlights": renderHighlights, "astro-meters": renderMeters, "astro-callout": renderCallout,
  };
  const PENDING_LABEL = {
    "astro-chart": "Drawing the chart",
    "astro-signals": "Weighing the signals",
    "astro-timeline": "Laying out the timeline",
    "astro-summary": "Distilling the verdict",
    "astro-highlights": "Picking the standouts",
    "astro-meters": "Measuring strengths",
    "astro-callout": "Noting a key point",
  };
  const cache = new Map();

  function renderBlock(type, body) {
    const key = type + "\0" + body;
    if (cache.has(key)) return cache.get(key);
    let html;
    try {
      html = RENDERERS[type](JSON.parse(body));
    } catch (err) {
      html = `<div class="block-error">Could not render ${esc(type)}: ${esc(err.message)}</div>`;
    }
    cache.set(key, html);
    return html;
  }

  function renderMarkdown(md) {
    const withChips = md.replace(/\{\{([^{}\n]+?)\}\}/g, (_, t) => `<span class="chip">${esc(t.trim())}</span>`);
    return DOMPurify.sanitize(marked.parse(withChips, { gfm: true, breaks: false }));
  }

  // Render a (possibly still streaming) assistant message.
  // The model sometimes breaks off inside a block and starts the answer again. An astro fence that
  // opens before the previous one closed marks that restart: keep only the new attempt.
  function dropAbandonedAttempt(text) {
    let cut = -1;
    for (const m of text.matchAll(/```astro-[a-z]+[^\n]*\n(?:(?!```)[\s\S])*(?=```astro-)/g)) cut = m.index + m[0].length;
    return cut < 0 ? text : text.slice(cut);
  }

  function renderMessage(text, streaming) {
    text = dropAbandonedAttempt(text);
    const re = /```(astro-[a-z]+)[^\n]*\n([\s\S]*?)```/g;
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += renderMarkdown(text.slice(last, m.index));
      out += RENDERERS[m[1]] ? renderBlock(m[1], m[2]) : renderMarkdown(m[0]);
      last = re.lastIndex;
    }
    let rest = text.slice(last);
    let pending = "";
    // an astro block still streaming, or a fence whose language is still arriving
    const open = rest.match(/```(?:(astro-[a-z]+)[^`]*|[a-z-]{1,14})$/);
    if (streaming && open) {
      rest = rest.slice(0, open.index);
      const label = PENDING_LABEL[open[1]] || "Composing";
      pending = `<div class="block-pending"><span class="pulse"></span>${label}…</div>`;
    }
    out += renderMarkdown(rest) + pending;
    return out;
  }

  // ---------- interaction: divisional tabs, planet/house details, timeline scrubbing ----------
  // app.js sets AstroBlocks.context to return {conversation_id, profile} for /api/chart.
  const api = { context: () => ({}), headers: () => ({}) };
  const NAME = {
    Su: "Sun", Mo: "Moon", Ma: "Mars", Me: "Mercury", Ju: "Jupiter", Ve: "Venus", Sa: "Saturn",
    Ra: "Rahu", Ke: "Ketu", Ur: "Uranus", Ne: "Neptune", Pl: "Pluto",
  };
  const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
  const SIGN_LORD = ["Ma", "Ve", "Me", "Mo", "Su", "Me", "Ve", "Ma", "Ju", "Sa", "Sa", "Ju"];
  // graha drishti, counted in houses from the planet (matches jyotish_tools)
  const DRISHTI = { Su: [7], Mo: [7], Me: [7], Ve: [7], Ma: [4, 7, 8], Ju: [5, 7, 9], Sa: [3, 7, 10] };
  const DIGNITY_TAG = { exalted: "Ex", debilitated: "Deb", "own sign": "Own" };
  const divName = (n) => (DIVISIONS.find(([k]) => k === n) || [n, ""])[1];
  const fmtDeg = (d) => `${Math.floor(d)}°${String(Math.round((d % 1) * 60)).padStart(2, "0")}′`;

  const fetched = new Map();
  function fetchChart(division) {
    const ctx = api.context() || {};
    if (!ctx.conversation_id && !ctx.profile) return Promise.reject(new Error("Enter your birth details to load divisional charts."));
    const key = JSON.stringify([ctx.conversation_id || ctx.profile, division]);
    if (!fetched.has(key)) {
      const req = fetch("/api/chart", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...api.headers() },
        body: JSON.stringify({ ...ctx, division }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
        return r.json();
      });
      req.catch(() => fetched.delete(key));
      fetched.set(key, req);
    }
    return fetched.get(key);
  }

  const toBlock = (c, picked = []) => ({
    ascendant_sign: c.ascendant.sign_num,
    planets: c.planets.map((p) => ({ p: p.code, house: p.house, retro: p.retrograde, note: DIGNITY_TAG[p.dignity], highlight: picked.includes(p.code) })),
  });

  // Per-card state lives on the element; a re-render simply starts fresh.
  function chartState(card) {
    if (!card._st) {
      const orig = JSON.parse(card.dataset.chart);
      const div = +card.dataset.div;
      card._st = { orig, div, view: div, block: orig, legend: card.querySelector(".legend").innerHTML, token: 0, sel: null };
    }
    return card._st;
  }

  function aspectedHouses(c, house) {
    return (DRISHTI[c] || []).map((n) => ((house + n - 2) % 12) + 1);
  }

  function clearSelection(card) {
    card.classList.remove("focus");
    card.querySelectorAll(".sel, .home, .asp, .on").forEach((el) => {
      if (!el.classList.contains("dv-tab")) el.classList.remove("sel", "home", "asp", "on");
    });
  }

  function selectPlanet(card, c) {
    const st = chartState(card);
    const p = (st.block.planets || []).find((x) => code(x.p) === c);
    if (!p) return;
    if (st.sel === "p:" + c) { st.sel = null; clearSelection(card); card.querySelector(".k-detail").innerHTML = HINT; return; }
    st.sel = "p:" + c;
    clearSelection(card);
    card.classList.add("focus");
    const house = parseInt(p.house, 10);
    const asp = aspectedHouses(c, house);
    card.querySelectorAll(`[data-code="${c}"]`).forEach((el) => el.classList.add("sel"));
    card.querySelectorAll(`.k-link[data-from="${c}"]`).forEach((el) => el.classList.add("on"));
    card.querySelector(`.k-house[data-house="${house}"]`)?.classList.add("home");
    asp.forEach((h) => card.querySelector(`.k-house[data-house="${h}"]`)?.classList.add("asp"));

    const asc = parseInt(st.block.ascendant_sign, 10) || 1;
    const sign = SIGNS[(asc + house - 2) % 12];
    const note = st.view === st.div
      ? (st.orig.legend || []).find((l) => code(l.planet) === c)?.detail : null;
    const draw = (full) => {
      const tags = [full?.dignity, (full ? full.retrograde : p.retro || c === "Ra" || c === "Ke") && "retrograde",
        full?.combust && "combust"].filter(Boolean);
      const rows = [
        ["Sign", full ? `${full.sign} ${fmtDeg(full.degree)}` : sign],
        ["House", `${house}${house === 1 ? " (Lagna)" : ""}`],
        full?.nakshatra && ["Nakshatra", `${full.nakshatra} · pada ${full.pada} · lord ${full.nakshatra_lord}`],
        full?.lord_of_houses?.length && ["Lord of", "house " + full.lord_of_houses.join(", ")],
        asp.length && ["Aspects", "house " + asp.join(", ")],
      ].filter(Boolean);
      card.querySelector(".k-detail").innerHTML = `
        <div class="kd-head"><span class="kd-glyph">${glyph(c)}</span>${esc(NAME[c] || c)}
          <span class="kd-div">D${st.view}</span>${tags.map((t) => `<span class="kd-tag">${esc(t)}</span>`).join("")}</div>
        <dl class="kd-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${note ? `<p class="kd-note">${esc(note)}</p>` : ""}`;
    };
    draw(null);
    const want = st.sel;
    fetchChart(st.view).then((data) => {
      if (st.sel !== want) return;
      draw(data.planets.find((x) => x.code === c) || null);
    }).catch(() => {});
  }

  function selectHouse(card, h) {
    const st = chartState(card);
    if (st.sel === "h:" + h) { st.sel = null; clearSelection(card); card.querySelector(".k-detail").innerHTML = HINT; return; }
    st.sel = "h:" + h;
    clearSelection(card);
    card.classList.add("focus");
    card.querySelector(`.k-house[data-house="${h}"]`)?.classList.add("home");
    const asc = parseInt(st.block.ascendant_sign, 10) || 1;
    const signIdx = (asc + h - 2) % 12;
    const lord = SIGN_LORD[signIdx];
    const planets = (st.block.planets || []).map((p) => ({ c: code(p.p), h: parseInt(p.house, 10) }));
    const inside = planets.filter((p) => p.h === h).map((p) => p.c);
    const aspecting = planets.filter((p) => aspectedHouses(p.c, p.h).includes(h)).map((p) => p.c);
    const lordAt = planets.find((p) => p.c === lord);
    inside.forEach((c) => card.querySelectorAll(`.k-p[data-code="${c}"]`).forEach((el) => el.classList.add("sel")));
    aspecting.forEach((c) => card.querySelectorAll(`.k-p[data-code="${c}"]`).forEach((el) => el.classList.add("asp")));
    const names = (list) => list.length ? list.map((c) => NAME[c] || c).join(", ") : "none";
    card.querySelector(".k-detail").innerHTML = `
      <div class="kd-head">House ${h}<span class="kd-div">D${st.view}</span>${h === 1 ? '<span class="kd-tag">Lagna</span>' : ""}</div>
      <dl class="kd-grid">
        <dt>Sign</dt><dd>${SIGNS[signIdx]} (${signIdx + 1})</dd>
        <dt>Lord</dt><dd>${NAME[lord]}${lordAt ? `, placed in house ${lordAt.h}` : ""}</dd>
        <dt>Planets</dt><dd>${esc(names(inside))}</dd>
        <dt>Aspected by</dt><dd>${esc(names(aspecting))}</dd>
      </dl>`;
  }

  function showDivision(card, n) {
    const st = chartState(card);
    if (st.view === n) return;
    st.view = n;
    st.sel = null;
    const token = ++st.token;
    card.querySelectorAll(".dv-tab").forEach((b) => {
      const on = +b.dataset.div === n;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
      if (on) {
        const strip = b.parentElement;
        const left = b.offsetLeft - strip.offsetLeft;
        if (left < strip.scrollLeft || left + b.offsetWidth > strip.scrollLeft + strip.clientWidth)
          strip.scrollTo({ left: left - (strip.clientWidth - b.offsetWidth) / 2, behavior: "smooth" });
      }
    });
    const svg = card.querySelector(".k-svg"), legend = card.querySelector(".legend"), detail = card.querySelector(".k-detail");
    card.classList.remove("focus");
    const use = card.querySelector(".dv-use");
    use.innerHTML = usePanel(st.orig, n);
    const picked = ((st.orig.divisions || []).find((x) => parseInt(x.division, 10) === n)?.picks || []).map((p) => code(p.planet));
    if (n === st.div) {
      st.block = st.orig;
      card.classList.remove("alt");
      svg.innerHTML = chartSvg(st.orig);
      legend.innerHTML = st.legend;
      detail.innerHTML = HINT;
      return;
    }
    card.classList.add("alt", "loading");
    detail.innerHTML = `<p class="k-hint"><span class="pulse"></span>Calculating D${n} ${divName(n)}…</p>`;
    fetchChart(n).then((c) => {
      if (st.token !== token) return;
      st.block = toBlock(c, picked);
      svg.innerHTML = chartSvg(st.block);
      legend.innerHTML = `<div class="dv-head"><div class="eyebrow">D${n} ${esc(divName(n)).toUpperCase()}</div>
          Lagna ${esc(c.ascendant.sign)} ${fmtDeg(c.ascendant.degree)}</div>` +
        c.planets.map((p) => `<button type="button" class="dv-row" data-code="${esc(p.code)}">
          <span class="dv-code">${glyph(p.code)} ${esc(p.code)}${p.retrograde ? '<sup>R</sup>' : ""}</span>
          <span>${esc(p.sign)} ${fmtDeg(p.degree)}</span><span class="dv-house">H${p.house}</span></button>`).join("");
      detail.innerHTML = HINT;
    }).catch((err) => {
      if (st.token === token) detail.innerHTML = `<p class="k-hint err">${esc(err.message)}</p>`;
    }).finally(() => { if (st.token === token) card.classList.remove("loading"); });
  }

  function timelineState(card) {
    return (card._tl ||= JSON.parse(card.dataset.tl));
  }

  function selectPeriod(card, i) {
    const tl = timelineState(card);
    if (!tl.periods[i] || card._tlSel === i) return;
    card._tlSel = i;
    card.querySelectorAll(".tl-seg, .tl-item").forEach((el) => el.classList.toggle("sel", +el.dataset.i === i));
    card.querySelector(".tl-detail").innerHTML = periodDetail(tl.periods[i]);
  }

  function scrubTo(card, bar, clientX) {
    const tl = timelineState(card);
    const r = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const t = tl.min + f * (tl.max - tl.min);
    const cur = bar.querySelector(".tl-cursor");
    cur.hidden = false;
    cur.style.left = (f * 100).toFixed(2) + "%";
    cur.querySelector("span").textContent = fmtDay(t);
    cur.classList.toggle("flip", f > 0.8);
    cur.classList.toggle("flop", f < 0.2);
    const i = tl.periods.findIndex((p) => t >= p.s && t < p.e);
    if (i >= 0) selectPeriod(card, i);
  }

  document.addEventListener("click", (e) => {
    const chart = e.target.closest(".chart-card");
    if (chart) {
      const tab = e.target.closest(".dv-tab");
      if (tab) return showDivision(chart, +tab.dataset.div);
      const planet = e.target.closest("[data-code]");
      if (planet) return selectPlanet(chart, planet.dataset.code);
      const house = e.target.closest(".k-house");
      if (house) return selectHouse(chart, +house.dataset.house);
      return;
    }
    const tl = e.target.closest(".tl-card");
    const item = e.target.closest(".tl-seg, .tl-item");
    if (tl && item) selectPeriod(tl, +item.dataset.i);
  });

  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('.chart-card [role="button"], .tl-card [role="button"]')) {
      e.preventDefault();
      e.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });

  let drag = null, hideCursor = 0;
  document.addEventListener("pointerdown", (e) => {
    const bar = e.target.closest(".tl-bar");
    if (!bar || e.button > 0) return;
    clearTimeout(hideCursor);
    drag = { bar, card: bar.closest(".tl-card"), id: e.pointerId };
    bar.setPointerCapture?.(e.pointerId);
    scrubTo(drag.card, bar, e.clientX);
  });
  document.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.id) scrubTo(drag.card, drag.bar, e.clientX);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const cur = drag.bar.querySelector(".tl-cursor");
    hideCursor = setTimeout(() => { cur.hidden = true; }, 900);
    drag = null;
  };
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  window.AstroBlocks = Object.assign(api, { renderMessage, esc });
})();
