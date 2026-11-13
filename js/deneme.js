/* Grafik denemeleri: aynı örnek veri, on farklı grafik biçimi. Yalnızca seçim yapmak içindir. */
(() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const C = ['#6B2AE6', '#D9781F', '#D12BD6', '#1E9E8A', '#2F6FDB', '#8A8F2A'], GRAY = '#B9B2CC', GOOD = '#2FA57A', BAD = '#D8574E';
  const nf = (v, d = 1) => v.toLocaleString('tr-TR', { maximumFractionDigits: d });
  const short = v => { const a = Math.abs(v); return a >= 1e9 ? nf(v / 1e9, a >= 1e10 ? 1 : 2) + 'Mr' : a >= 1e6 ? nf(v / 1e6, 1) + 'M' : a >= 1e3 ? nf(v / 1e3, 1) + ' Bin' : nf(v, 0); };
  const money = v => '$' + short(v);
  const pct = (x, d = 1) => '%' + nf(x * 100, d);
  const sp = x => (x >= 0 ? '+' : '−') + pct(Math.abs(x));
  const lab = p => p.replace('-Q', ' Ç');
  const nice = v => { const p = 10 ** Math.floor(Math.log10(v)); for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p; };

  const files = Sample.build(), cat = files.find(f => f.type === 'category').rows, pubs = files.find(f => f.type === 'publishers').rows;
  const P = [...new Set(cat.map(r => r.p))].sort(), last = P.at(-1), py = (+last.slice(0, 4) - 1) + last.slice(4);
  const M = new Map(), D = new Map();
  cat.forEach(r => { if (!M.has(r.name)) { M.set(r.name, {}); D.set(r.name, {}); } M.get(r.name)[r.p] = r.rev; D.get(r.name)[r.p] = r.dl; });
  const names = [...M.keys()].sort((a, b) => M.get(b)[last] - M.get(a)[last]);
  const top = names.slice(0, 6), rest = names.slice(6);
  const col = n => { const i = top.indexOf(n); return i < 0 ? GRAY : C[i]; };
  const total = p => names.reduce((s, n) => s + (M.get(n)[p] || 0), 0);
  const yoy = n => (M.get(n)[last] - M.get(n)[py]) / M.get(n)[py];
  const stack = [...top.map(n => ({ name: n, color: col(n), v: P.map(p => M.get(n)[p] || 0) })),
    { name: `Diğer ${rest.length} kategori`, color: GRAY, v: P.map(p => rest.reduce((s, n) => s + (M.get(n)[p] || 0), 0)) }];

  const W = 560, H = 320;
  const S = (inner, h = H) => `<svg viewBox="0 0 ${W} ${h}" role="img">${inner}</svg>`;
  const tip = t => ` data-tip="${esc(t)}"`;
  const legend = items => `<div class="legend">${items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.name)}</span>`).join('')}</div>`;
  function frame(max, fmt, xs, band, min = 0) {
    const m = { l: 86, r: 16, t: 10, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = xs.length;
    const x = i => (band ? m.l + (i + 0.5) * iw / n : m.l + i * iw / (n - 1)), y = v => m.t + ih - ((v - min) / (max - min)) * ih;
    let g = '';
    for (let t = 0; t <= 4; t++) { const v = min + (max - min) * t / 4; g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grid${t ? '' : ' base'}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${esc(fmt(v))}</text>`; }
    xs.forEach((l, i) => { if (i % 2 === (n - 1) % 2) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(l)}</text>`; });
    return { m, iw, ih, x, y, g, n };
  }

  /* A — Yığılmış alan */
  function area() {
    const tots = P.map((_, i) => stack.reduce((s, k) => s + k.v[i], 0)), f = frame(nice(Math.max(...tots)), money, P.map(lab));
    let base = P.map(() => 0), out = '';
    stack.forEach(k => {
      const up = base.map((b, i) => b + k.v[i]);
      const pts = up.map((v, i) => `${f.x(i)},${f.y(v)}`).concat(base.map((v, i) => `${f.x(i)},${f.y(v)}`).reverse());
      out += `<polygon points="${pts.join(' ')}" fill="${k.color}" stroke="#fff" stroke-width="1.5"${tip(`${k.name} · ${lab(last)}: ${money(k.v.at(-1))}`)}/>`;
      base = up;
    });
    return legend(stack) + S(f.g + out);
  }
  /* B — Yığılmış sütun */
  function columns() {
    const tots = P.map((_, i) => stack.reduce((s, k) => s + k.v[i], 0)), f = frame(nice(Math.max(...tots)), money, P.map(lab), true), bw = f.iw / f.n * 0.62;
    let out = '';
    P.forEach((p, i) => { let b = 0; stack.forEach(k => { const y0 = f.y(b), y1 = f.y(b + k.v[i]); b += k.v[i];
      out += `<rect x="${f.x(i) - bw / 2}" y="${y1 + 1}" width="${bw}" height="${Math.max(1, y0 - y1 - 2)}" rx="2" fill="${k.color}"${tip(`${k.name} · ${lab(p)}: ${money(k.v[i])}`)}/>`; }); });
    return legend(stack) + S(f.g + out);
  }
  /* C — Halka (donut) */
  function donut() {
    const items = stack.map(k => ({ name: k.name, color: k.color, v: k.v.at(-1) })), t = items.reduce((s, i) => s + i.v, 0), cx = 150, cy = 160, R = 128, r = 78;
    let a = -Math.PI / 2, out = '';
    const pt = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(1)},${(cy + rad * Math.sin(ang)).toFixed(1)}`;
    items.forEach((i, n) => {
      const b = a + i.v / t * 2 * Math.PI, g = 0.012, lg = b - a > Math.PI ? 1 : 0;
      out += `<path d="M${pt(a + g, R)}A${R},${R} 0 ${lg} 1 ${pt(b - g, R)}L${pt(b - g, r)}A${r},${r} 0 ${lg} 0 ${pt(a + g, r)}Z" fill="${i.color}"${tip(`${i.name}: ${money(i.v)} · ${pct(i.v / t)}`)}/>`;
      out += `<rect x="318" y="${52 + n * 32}" width="11" height="11" rx="3" fill="${i.color}"/><text x="338" y="${62 + n * 32}" class="lbl">${esc(i.name)}</text><text x="${W - 8}" y="${62 + n * 32}" text-anchor="end" class="lbl b">${pct(i.v / t)}</text>`;
      a = b;
    });
    out += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="big">${money(t)}</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" class="axis">${lab(last)} toplam gelir</text>`;
    return S(out);
  }
  /* D — Ağaç haritası (treemap) */
  function treemap() {
    const items = names.map(n => ({ n, v: M.get(n)[last] })), t = total(last), out = [], max = items[0].v;
    (function split(list, x, y, w, h) {
      if (list.length === 1) { out.push({ ...list[0], x, y, w, h }); return; }
      const s = list.reduce((a, b) => a + b.v, 0); let acc = list[0].v, k = 1;
      while (k < list.length - 1 && acc + list[k].v <= s / 2) { acc += list[k].v; k++; }
      const fr = acc / s;
      if (w >= h) { split(list.slice(0, k), x, y, w * fr, h); split(list.slice(k), x + w * fr, y, w * (1 - fr), h); }
      else { split(list.slice(0, k), x, y, w, h * fr); split(list.slice(k), x, y + h * fr, w, h * (1 - fr)); }
    })(items, 0, 0, W, H);
    return S(out.map(o => { const op = 0.3 + 0.7 * o.v / max, dark = op > 0.55;
      return `<g${tip(`${o.n}: ${money(o.v)} · ${pct(o.v / t)}`)}><rect x="${o.x + 1}" y="${o.y + 1}" width="${o.w - 2}" height="${o.h - 2}" rx="5" fill="#6B2AE6" fill-opacity="${op.toFixed(2)}"/>
        ${o.w > 84 && o.h > 40 ? `<text x="${o.x + 10}" y="${o.y + 22}" class="lbl b" style="fill:${dark ? '#fff' : '#1E0B4D'}">${esc(o.n)}</text><text x="${o.x + 10}" y="${o.y + 39}" class="lbl" style="fill:${dark ? '#fff' : '#1E0B4D'}">${pct(o.v / t)}</text>` : ''}</g>`; }).join(''));
  }
  /* E — Sıralama akışı (bump) */
  function bump() {
    const show = names.slice(0, 8), m = { l: 30, r: 150, t: 12, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const rk = P.map(p => [...names].sort((a, b) => M.get(b)[p] - M.get(a)[p]));
    const maxR = Math.max(...show.flatMap(n => rk.map(r => r.indexOf(n)))) + 1;
    const x = i => m.l + i * iw / (P.length - 1), y = r => m.t + (r + 0.5) * ih / maxR;
    let g = '';
    for (let r = 0; r < maxR; r++) g += `<text x="${m.l - 14}" y="${y(r) + 4}" text-anchor="end" class="axis">${r + 1}</text>`;
    P.forEach((p, i) => { if (i % 2 === (P.length - 1) % 2) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${lab(p)}</text>`; });
    show.forEach(n => {
      const pts = rk.map((r, i) => [x(i), y(r.indexOf(n))]), c = col(n);
      g += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>`;
      pts.forEach((p, i) => { g += `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${c}" stroke="#fff" stroke-width="2"${tip(`${n} · ${lab(P[i])}: ${rk[i].indexOf(n) + 1}. sıra`)}/>`; });
      g += `<text x="${pts.at(-1)[0] + 12}" y="${pts.at(-1)[1] + 4}" class="lbl">${esc(n)}</text>`;
    });
    return S(g);
  }
  /* F — Isı haritası */
  function heat() {
    const cols = P.slice(1), lw = 140, cw = (W - lw - 4) / cols.length, rh = 23, h = 26 + names.length * rh;
    const g = (n, i) => (M.get(n)[cols[i]] - M.get(n)[P[i]]) / M.get(n)[P[i]];
    const maxA = Math.max(...names.flatMap(n => cols.map((_, i) => Math.abs(g(n, i)))));
    let out = cols.map((p, i) => `<text x="${lw + i * cw + cw / 2}" y="14" text-anchor="middle" class="axis">${lab(p)}</text>`).join('');
    names.forEach((n, r) => {
      out += `<text x="${lw - 10}" y="${26 + r * rh + 15}" text-anchor="end" class="lbl">${esc(n)}</text>`;
      cols.forEach((p, i) => { const v = g(n, i), a = (0.1 + 0.8 * Math.abs(v) / maxA).toFixed(2);
        out += `<rect x="${lw + i * cw + 1}" y="${26 + r * rh + 1}" width="${cw - 2}" height="${rh - 2}" rx="3" fill="${v >= 0 ? GOOD : BAD}" fill-opacity="${a}"${tip(`${n} · ${lab(p)}: ${sp(v)} (önceki çeyreğe göre)`)}/>
          <text x="${lw + i * cw + cw / 2}" y="${26 + r * rh + 15}" text-anchor="middle" class="cell">${(v >= 0 ? '+' : '−') + nf(Math.abs(v) * 100, 1)}</text>`; });
    });
    return S(out, h);
  }
  /* G — Balon grafiği */
  function bubble() {
    const pts = names.map(n => ({ n, x: M.get(n)[last], y: yoy(n), d: D.get(n)[last] }));
    const maxX = nice(Math.max(...pts.map(p => p.x))), lo = Math.floor(Math.min(...pts.map(p => p.y)) * 10 - 1) / 10, hi = Math.ceil(Math.max(...pts.map(p => p.y)) * 10 + 1) / 10, maxD = Math.max(...pts.map(p => p.d));
    const f = frame(hi, v => sp(v).replace('+%0', '%0').replace('−%0', '%0'), [], false, lo), x = v => f.m.l + v / maxX * f.iw;
    let g = f.g + `<line x1="${f.m.l}" x2="${W - f.m.r}" y1="${f.y(0)}" y2="${f.y(0)}" stroke="#7D7399" stroke-dasharray="4 4"/>`;
    for (let t = 0; t <= 4; t++) g += `<text x="${x(maxX * t / 4)}" y="${H - 8}" text-anchor="${t === 4 ? 'end' : t ? 'middle' : 'start'}" class="axis">${money(maxX * t / 4)}</text>`;
    pts.sort((a, b) => b.d - a.d).forEach(p => { const r = 5 + Math.sqrt(p.d / maxD) * 22;
      g += `<circle cx="${x(p.x)}" cy="${f.y(p.y)}" r="${r.toFixed(1)}" fill="${col(p.n)}" fill-opacity=".75" stroke="#fff" stroke-width="2"${tip(`${p.n}: ${money(p.x)} gelir · ${sp(p.y)} · ${short(p.d)} indirme`)}/>`;
      if (top.includes(p.n)) g += `<text x="${x(p.x)}" y="${f.y(p.y) - r - 5}" text-anchor="middle" class="lbl">${esc(p.n)}</text>`; });
    return S(g) + '<p class="cap">Yatay: gelir · Dikey: geçen yıla göre büyüme · Balon boyutu: indirme</p>';
  }
  /* H — Küçük çoklu grafikler */
  function multiples() {
    return `<div class="multiples">${names.slice(0, 12).map(n => { const v = P.map(p => M.get(n)[p]), mx = Math.max(...v), mn = Math.min(...v) * 0.9, y = yoy(n);
      const pts = v.map((q, i) => `${4 + i * 152 / (v.length - 1)},${44 - (q - mn) / (mx - mn) * 38}`);
      return `<div><b>${esc(n)}</b><span>${money(v.at(-1))} <em class="${y >= 0 ? 'up' : 'down'}">${y >= 0 ? '▲' : '▼'} ${pct(Math.abs(y))}</em></span>
        <svg viewBox="0 0 160 50"><polyline points="${pts.join(' ')}" fill="none" stroke="${col(n)}" stroke-width="2" stroke-linejoin="round"/><circle cx="${pts.at(-1).split(',')[0]}" cy="${pts.at(-1).split(',')[1]}" r="3.5" fill="${col(n)}"/></svg></div>`; }).join('')}</div>
      <p class="cap">Her kutu kendi ölçeğinde çizilir; kutular arasında yükseklik değil eğilim karşılaştırılır.</p>`;
  }
  /* I — Halter (dumbbell) */
  function dumbbell() {
    const show = names.slice(0, 10), lw = 140, max = nice(M.get(names[0])[last]), rh = 27, x = v => lw + v / max * (W - lw - 24);
    let g = '';
    for (let t = 0; t <= 4; t++) { const v = max * t / 4; g += `<line x1="${x(v)}" x2="${x(v)}" y1="8" y2="${14 + show.length * rh}" class="grid"/>${t % 2 ? '' : `<text x="${x(v)}" y="${H - 8}" text-anchor="${t === 4 ? 'end' : 'middle'}" class="axis">${money(v)}</text>`}`; }
    show.forEach((n, i) => { const a = M.get(n)[py], b = M.get(n)[last], yy = 24 + i * rh, c = b >= a ? GOOD : BAD;
      g += `<text x="${lw - 12}" y="${yy + 4}" text-anchor="end" class="lbl">${esc(n)}</text><line x1="${x(a)}" x2="${x(b)}" y1="${yy}" y2="${yy}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="${x(a)}" cy="${yy}" r="6" fill="#fff" stroke="#7D7399" stroke-width="2"${tip(`${n} · ${lab(py)}: ${money(a)}`)}/><circle cx="${x(b)}" cy="${yy}" r="6.5" fill="${c}" stroke="#fff" stroke-width="2"${tip(`${n} · ${lab(last)}: ${money(b)} (${sp((b - a) / a)})`)}/>`; });
    return `<div class="legend"><span><i style="background:#fff;border:2px solid #7D7399"></i>${lab(py)}</span><span><i style="background:${GOOD}"></i>${lab(last)} · büyüdü</span><span><i style="background:${BAD}"></i>${lab(last)} · küçüldü</span></div>` + S(g);
  }
  /* J — Pareto / yoğunlaşma eğrisi */
  function pareto() {
    const r = pubs.filter(p => p.p === last).sort((a, b) => b.rev - a.rev), t = r.reduce((s, p) => s + p.rev, 0), n = r.length;
    const f = frame(1, v => pct(v, 0), [], false), x = k => f.m.l + k / n * f.iw;
    let cum = 0; const c = r.map(p => (cum += p.rev) / t);
    let g = f.g + `<polygon points="${f.m.l},${f.y(0)} ${c.map((v, i) => `${x(i + 1).toFixed(1)},${f.y(v).toFixed(1)}`).join(' ')} ${x(n)},${f.y(0)}" fill="#6B2AE6" fill-opacity=".12"/>
      <polyline points="${f.m.l},${f.y(0)} ${c.map((v, i) => `${x(i + 1).toFixed(1)},${f.y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="#6B2AE6" stroke-width="2.5"/>`;
    [10, 100].forEach(k => { g += `<line x1="${x(k)}" x2="${x(k)}" y1="${f.y(c[k - 1])}" y2="${f.y(0)}" stroke="#7D7399" stroke-dasharray="4 4"/><circle cx="${x(k)}" cy="${f.y(c[k - 1])}" r="5" fill="#6B2AE6" stroke="#fff" stroke-width="2"/>
      <text x="${x(k) + 10}" y="${f.y(c[k - 1]) + (k === 10 ? 4 : 18)}" class="lbl b">İlk ${k}: ${pct(c[k - 1])}</text>`; });
    [1, 100, 200, 300, n].forEach(k => { g += `<text x="${x(k)}" y="${H - 8}" text-anchor="${k === n ? 'end' : k === 1 ? 'start' : 'middle'}" class="axis">${k}. yayıncı</text>`; });
    return S(g);
  }

  const CARDS = [
    ['A', 'Yığılmış alan', 'Toplam pazarın zaman içindeki büyüklüğü ve içindeki kategori dağılımı tek grafikte.', 'Özet · “Toplam pazar trendi” ile “Kategori trendleri”nin yerine', area],
    ['B', 'Yığılmış sütun', 'Her çeyrek ayrı bir sütun; çeyrekler arası toplam ve dağılım karşılaştırması.', 'Özet · “Toplam pazar trendi”nin yerine', columns],
    ['C', 'Halka grafik', 'Seçilen çeyrekte kategorilerin paylaşımı; ortada toplam tutar.', 'Özet · “Kategori payları”nın yerine', donut],
    ['D', 'Ağaç haritası', 'Tüm kategoriler alanlarıyla; hangi kategorinin ne kadar yer kapladığı bir bakışta.', 'Özet · “Kategori payları”nın yerine', treemap],
    ['E', 'Sıralama akışı', 'Kategorilerin gelir sırasının çeyrekten çeyreğe nasıl değiştiği; kim kimi geçti.', 'Kategoriler · yeni grafik', bump],
    ['F', 'Isı haritası', 'Her kategori ve her çeyrek için büyüme oranı; yeşil büyüme, kırmızı küçülme.', 'Kategoriler · tablonun üstüne', heat],
    ['G', 'Balon grafiği', 'Büyüklük ile büyüme hızını birlikte gösterir: sağ üstte büyük ve hızlı büyüyenler.', 'Özet · “Büyüme sıralaması”nın yerine ya da yanına', bubble],
    ['H', 'Küçük çoklu grafikler', 'Her kategori için ayrı mini trend; çok sayıda kategori birbirine karışmadan izlenir.', 'Kategoriler · çizgi grafiğin yerine', multiples],
    ['I', 'Halter grafiği', 'Geçen yıl ile bu yıl arasındaki fark, her kategori için iki nokta ve arasındaki çizgiyle.', 'Özet · “En çok kazandıran kategoriler” listesinin yerine', dumbbell],
    ['J', 'Yoğunlaşma eğrisi', 'Yayıncılar büyükten küçüğe dizildiğinde gelirin ne kadarının ilk sıralarda toplandığı.', 'Yayıncılar · “Yoğunlaşma trendi”nin yanına', pareto],
  ];
  const picked = new Set();
  document.getElementById('gallery').innerHTML = CARDS.map(([k, t, d, w, fn]) => `<section class="card demo"><header><span class="letter">${k}</span><div><h3>${t}</h3><p class="muted">${d}</p></div></header>
    <div class="plot">${fn()}</div><footer><span class="where">${w}</span><label class="pick"><input type="checkbox" data-pick="${k}"> Bunu istiyorum</label></footer></section>`).join('');
  document.addEventListener('change', e => { const k = e.target.dataset.pick; if (!k) return; e.target.checked ? picked.add(k) : picked.delete(k);
    document.getElementById('picked').textContent = picked.size ? 'Seçtiklerin: ' + [...picked].sort().join(', ') : 'Henüz seçim yok'; });
  const tipEl = document.getElementById('tip');
  document.addEventListener('mousemove', e => { const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tipEl.hidden = true; return; }
    tipEl.textContent = t.dataset.tip; tipEl.hidden = false;
    const tw = tipEl.offsetWidth; tipEl.style.left = (e.clientX + 16 + tw > innerWidth ? e.clientX - tw - 16 : e.clientX + 16) + 'px'; tipEl.style.top = (e.clientY + 12) + 'px'; });
})();
