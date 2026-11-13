/* Bağımlılıksız SVG çizgi grafiği: gösterge + imleç çizgisi + ipucu kutusu */
const Charts = (() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  /* opts: {labels:[], series:[{name,color,values:[number|null]}], fmt, yMax?, height?} */
  function line(el, opts) {
    const { labels, series, fmt } = opts;
    const W = Math.max(320, el.clientWidth), H = opts.height || 300;
    const m = { l: 76, r: 36, t: 14, b: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = opts.yMax || niceMax(Math.max(0, ...series.flatMap(s => s.values.filter(v => v != null))));
    const n = labels.length;
    const x = i => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = v => m.t + ih - (v / max) * ih;

    let g = '';
    for (let t = 0; t <= 4; t++) {
      const v = (max / 4) * t, yy = y(v);
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="grid${t === 0 ? ' base' : ''}"/>`;
      g += `<text x="${m.l - 10}" y="${yy + 4}" text-anchor="end" class="axis">${esc(fmt(v))}</text>`;
    }
    const step = Math.ceil(n / Math.max(1, Math.floor(iw / 70)));
    labels.forEach((l, i) => {
      if (i % step === 0 || i === n - 1 && (n - 1) % step >= step / 2)
        g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(l)}</text>`;
    });
    let marks = '';
    for (const s of series) {
      let d = '', pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
        pen = true;
      });
      marks += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      s.values.forEach((v, i) => {
        if (v != null) marks += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2"/>`;
      });
    }
    const legend = series.length > 1
      ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    el.innerHTML = `${legend}<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.label || 'Çizgi grafiği')}">
      ${g}<line class="cross" y1="${m.t}" y2="${m.t + ih}" x1="0" x2="0" visibility="hidden"/>${marks}
      <rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" class="hit"/></svg>`;

    const svg = el.querySelector('svg'), cross = svg.querySelector('.cross'), tip = document.getElementById('tip');
    svg.addEventListener('mousemove', e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) * (W / r.width);
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      const rows = series.map(s => ({ s, v: s.values[i] })).filter(o => o.v != null).sort((a, b) => b.v - a.v);
      tip.innerHTML = `<b>${esc(labels[i])}</b>` + rows.map(o =>
        `<div><i style="background:${o.s.color}"></i><span>${esc(o.s.name)}</span><em>${esc(fmt(o.v))}</em></div>`).join('');
      tip.hidden = false;
      const tw = tip.offsetWidth, left = e.clientX + 16 + tw > innerWidth ? e.clientX - tw - 16 : e.clientX + 16;
      tip.style.left = left + 'px'; tip.style.top = (e.clientY + 12) + 'px';
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  }

  return { line, esc };
})();
