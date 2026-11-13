/* Pazar Analizi — görünüm ve durum yönetimi */
const $ = s => document.querySelector(s);
const esc = Charts.esc;
const COLORS = ['#6B2AE6', '#D9781F', '#D12BD6', '#1E9E8A', '#2F6FDB', '#8A8F2A']; // doğrulanmış kategorik sıra
const GROUPS = { app: 'Uygulama kategorileri' }; // oyun verisi siteye alınmaz
const SEGS = { ai: 'AI kullanan', nonai: 'AI kullanmayan' }; // yayıncı dosyalarının iki grubu
const SEG_COLOR = { ai: '#6B2AE6', nonai: '#D9781F' };
const groupLabel = g => GROUPS[g] || SEGS[g] || '';
const TYPES = {
  category: { title: 'Kategori pazar büyüklüğü', nameLabel: 'Kategori',
    hint: 'Market Analysis → Category Overview · Unified, Worldwide · çeyreklik, son 8 çeyrek · Revenue ve Downloads. Oyun (Games) satırları yüklenirken atılır.' },
  apps: { title: 'En büyük uygulamalar', nameLabel: 'Uygulama adı',
    hint: 'Top Charts → Top Apps, kategori filtreli · Unified, Worldwide · son çeyrek ve geçen yılın aynı çeyreği · kategori başına ilk 20–50. Kategorisi Games olan uygulamalar yüklenirken atılır.' },
  publishers: { title: 'En büyük yayıncılar', nameLabel: 'Yayıncı adı',
    hint: 'İlk 1.500 yayıncının dışa aktarımı, çeyreklik. AI kullanan ve AI kullanmayan yayıncı listelerini ayrı dosyalar olarak yükle; grup dosya adından tanınır, yanlışsa “Düzelt” ile değiştirilir.' },
};
const VIEWS = [['ozet', 'Özet'], ['kategoriler', 'Kategoriler'], ['uygulamalar', 'Uygulamalar'], ['yayincilar', 'Yayıncılar'], ['ai', 'Yapay Zekâ'], ['veri', 'Veri']];

const S = {
  catGroup: 'app', metric: 'rev', period: '', cmp: 'yoy', cats: new Set(), catsOpen: false, calOpen: false, from: '', calPick: '', fDev: '', fCtry: '', appsPeriod: '', appsCat: '', appsQ: '', appsLimit: 10, catLimit: 10,
  pubPeriod: '', pubLimit: 25, aiQ: '', imp: null, impIdx: -1, batch: [], batchOpen: false, fMetric: '', fPeriod: '', pickType: '',
  aiTags: new Set(JSON.parse(localStorage.getItem('pa-ai-tags') || '[]')),
};
let FILES = [], cache = {}, after = [];

/* ---------- Depolama (IndexedDB) ---------- */
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('pazar-analizi', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
    r.onsuccess = () => res(db = r.result); r.onerror = () => rej(r.error);
  });
  const tx = (mode, fn) => new Promise((res, rej) => {
    const t = db.transaction('files', mode), rq = fn(t.objectStore('files'));
    t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error);
  });
  return { open, all: () => tx('readonly', s => s.getAll()), put: r => tx('readwrite', s => s.put(r)),
    del: id => tx('readwrite', s => s.delete(id)), clear: () => tx('readwrite', s => s.clear()) };
})();
/* Saklı veride kalmış oyun dosyaları ve oyun satırları kalıcı olarak silinir */
async function purgeGames() {
  for (const f of await DB.all()) {
    if ((f.type === 'category' && f.group && f.group !== 'app') || f.type === 'ai') { await DB.del(f.id); continue; } // oyun dosyaları ve kaldırılan yapay zekâ segmenti türü
    const keep = f.type === 'category' ? f.rows.filter(r => !isGames(r.name)) : f.type === 'apps' ? f.rows.filter(r => !isGames(r.cat)) : f.rows;
    if (keep.length === f.rows.length) continue;
    if (!keep.length) await DB.del(f.id);
    else await DB.put({ ...f, rows: keep, periods: [...new Set(keep.map(r => r.p))].sort() });
  }
}
async function reload() { FILES = await DB.all(); cache = {}; render(); }

/* ---------- Veri yardımcıları ---------- */
/* Ham satırlar: dosyalar birleştirilir, aynı anahtarda yeni dosya eskisini ezer */
function raw(type, group) {
  const k = 'raw|' + type + '|' + String(group);
  if (cache[k]) return cache[k];
  const m = new Map();
  FILES.filter(f => f.type === type && (group == null || (f.group || '') === group)).sort((a, b) => a.addedAt - b.addedAt)
    .forEach(f => f.rows.forEach(r => m.set(r.p + '|' + r.name.toLowerCase() + '|' + (r.dev || '') + '|' + (r.ctry || ''), r)));
  let rows = [...m.values()];
  if (type === 'category') {
    const dimP = new Set(rows.filter(r => r.dev || r.ctry).map(r => r.p));
    rows = rows.filter(r => r.dev || r.ctry || !dimP.has(r.p)); // kırılımlı dosya geldiyse o çeyreğin eski toplam satırları sayılmaz
    rows = rows.filter(r => !isGames(r.name));
  } else if (type === 'apps') rows = rows.filter(r => !isGames(r.cat));
  return cache[k] = rows;
}
/* Kategori verisi cihaz ve ülke filtresinden geçip çeyrek + kategori bazında toplanır */
function data(type, group) {
  if (type !== 'category') return raw(type, group);
  const k = ['cat', group, S.fDev, S.fCtry].join('|');
  if (cache[k]) return cache[k];
  const acc = new Map();
  for (const r of raw(type, group)) {
    if ((S.fDev && r.dev !== S.fDev) || (S.fCtry && r.ctry !== S.fCtry)) continue;
    const key = r.p + '|' + r.name;
    let o = acc.get(key);
    if (!o) acc.set(key, o = { p: r.p, name: r.name, key: group + '|' + r.name, rev: 0, dl: 0 });
    o.rev += r.rev; o.dl += r.dl;
  }
  return cache[k] = [...acc.values()];
}
let regionNames; try { regionNames = new Intl.DisplayNames(['tr'], { type: 'region' }); } catch (e) {}
const ctryName = c => { try { return (/^[A-Z]{2}$/.test(c) && regionNames.of(c)) || c; } catch (e) { return c; } };
function dims() {
  if (cache.dims) return cache.dims;
  const devs = new Set(), ctrys = new Set();
  for (const r of raw('category')) { if (r.dev) devs.add(r.dev); if (r.ctry) ctrys.add(r.ctry); }
  return cache.dims = { devs: [...devs].sort(), ctrys: [...ctrys].map(c => [c, ctryName(c)]).sort((a, b) => a[1].localeCompare(b[1], 'tr')) };
}
const periods = rows => [...new Set(rows.map(r => r.p))].sort();
/* Bitmemiş çeyrek = yarım dönem: işaretlenir, karşılaştırmalara ve trendlere girmez */
const isPartial = p => new Date() < new Date(+p.slice(0, 4), +p.slice(6) * 3, 1);
const full = rows => { const all = periods(rows), f = all.filter(p => !isPartial(p)); return f.length ? f : all; };
const partialNote = rows => { const pp = periods(rows).filter(isPartial); return pp.length && pp.length < periods(rows).length ? `<p class="note">${pp.map(plabel).join(', ')} henüz bitmediği için özetlere, trendlere ve karşılaştırmalara dahil edilmedi.</p>` : ''; };
const plabel = p => p ? p.replace('-Q', ' Ç') + (isPartial(p) ? ' (yarım)' : '') : '';
const prevYear = p => (+p.slice(0, 4) - 1) + p.slice(4);
const prevQ = p => { const y = +p.slice(0, 4), q = +p.slice(6); return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`; };
const at = (rows, p) => rows.filter(r => r.p === p);
const tot = (rows, p, m) => rows.reduce((s, r) => s + (r.p === p ? r[m] : 0), 0);
const delta = (cur, prev) => (prev > 0 ? (cur - prev) / prev : null);
const isGames = n => /^(games?|oyun(lar)?)(\s*[\/:>–-].*)?$/i.test(String(n || '').trim()); // "Games", "Games/Puzzle" ...
function pivot(rows) {
  const m = new Map();
  for (const r of rows) { if (!m.has(r.name)) m.set(r.name, {}); m.get(r.name)[r.p] = r; }
  return m;
}
/* Toplam pazar: uygulama kategorilerinin toplamı (oyun hariç) */
const market = () => data('category', 'app');
/* Genel yayıncı bölümlerinin kaynağı: gruplar karıştırılmaz. Önce grupsuz dosyalar, yoksa AI kullanan, yoksa AI kullanmayan */
function pubSource() {
  for (const g of ['', 'ai', 'nonai']) { const rows = raw('publishers', g); if (rows.length) return { rows, g }; }
  return { rows: [], g: '' };
}
function aiData() {
  const seg = data('ai');
  if (seg.length) return { rows: seg, src: 'segment' };
  return { rows: data('apps').filter(r => S.aiTags.has(r.name.toLowerCase())), src: 'tags' };
}

/* ---------- Biçimlendirme ---------- */
/* Türkçe büyük/küçük harf: İ→i, I→ı. Aramada I/İ/ı/i ayrımı yapılmaz */
const trLower = s => String(s).toLocaleLowerCase('tr');
const fold = s => trLower(s).replace(/ı/g, 'i');
const nf = (v, d = 1) => v.toLocaleString('tr-TR', { maximumFractionDigits: d });
function short(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return nf(v / 1e9, a >= 1e10 ? 1 : 2) + 'Mr';
  if (a >= 1e6) return nf(v / 1e6, 1) + 'M';
  if (a >= 1e3) return nf(v / 1e3, 1) + ' Bin';
  return nf(v, 0);
}
const money = v => '$' + short(v);
const fmtM = m => (m === 'rev' ? money : short);
const pct = (x, d = 1) => '%' + nf(x * 100, d);
function pill(d, unit) {
  if (d == null) return '<span class="pill na" title="Karşılaştırma verisi yok">–</span>';
  const txt = unit === 'pp' ? nf(Math.abs(d) * 100, 1) + ' puan' : pct(Math.abs(d));
  return `<span class="pill ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${txt}</span>`;
}
const seg = (k, opts, cur) => `<div class="seg" role="group">${opts.map(([v, l, dis]) =>
  `<button type="button" data-act="set" data-k="${k}" data-v="${v}" class="${v === cur ? 'on' : ''}" ${dis ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</div>`;
const sel = (k, opts, cur, label) => `<label class="field"><span>${label}</span><select data-set="${k}">${opts.map(([v, l]) =>
  `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
/* Satırda bağlantı varsa adı yeni sekmede açılan linke çevirir */
const link = (r, inner) => (r.url && /^https?:\/\//i.test(r.url) ? `<a class="ext" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner);
const empty = (title, text) => `<div class="card empty"><h3>${title}</h3><p>${text}</p>
  <a class="btn primary" href="#veri">Veri yükle</a></div>`;
function barList(items, fmt) {
  const max = Math.max(...items.map(i => i.value), 1);
  return `<ol class="bars">${items.map((i, n) => `<li>
    <span class="rank">${n + 1}</span>
    <span class="bname" title="${esc(i.name)}">${link(i, esc(i.name))}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</span>
    <span class="track"><i style="width:${Math.max(1, i.value / max * 100)}%"></i></span>
    <span class="bval">${esc(fmt(i.value))}</span>${i.delta !== undefined ? pill(i.delta) : ''}</li>`).join('')}</ol>`;
}
const chart = opts => { const id = 'c' + after.length; after.push(() => Charts.line(document.getElementById(id), opts)); return `<div class="chart" id="${id}"></div>`; };

/* ---------- Ortak filtreler ---------- */
function fixPeriod(rows) {
  if (!periods(rows).includes(S.period)) S.period = full(rows).at(-1) || '';
  if (S.from && !(periods(rows).includes(S.from) && S.from < S.period)) S.from = '';
  if (!['yoy', 'qoq'].includes(S.cmp) && !(S.cmp < S.period)) S.cmp = 'yoy';
}
/* Trendlerde gösterilecek çeyrekler: aralık seçiliyse başlangıç–bitiş arası, değilse son 16 tam çeyrek */
const rangeP = rows => (S.from ? full(rows).filter(p => p >= S.from && p <= S.period) : full(rows).slice(-16));
const cmpOf = p => (!p || isPartial(p) ? null : S.cmp === 'yoy' ? prevYear(p) : S.cmp === 'qoq' ? prevQ(p) : S.cmp);
const cmpText = () => (S.cmp === 'yoy' ? 'geçen yıla göre' : S.cmp === 'qoq' ? 'önceki çeyreğe göre' : plabel(S.cmp) + ' dönemine göre');
/* Seçili kategoriler bu satırlarda varsa yalnızca onlar, yoksa hepsi */
function scopeCats(rows) {
  const keys = new Set(rows.map(r => r.key)), n = [...S.cats].filter(k => keys.has(k)).length;
  return { rows: n ? rows.filter(r => S.cats.has(r.key)) : rows, n };
}
/* Çeyrek takvimi: solda hazır aralıklar, sağda yıl × çeyrek ızgarası. İki tıklamayla aralık seçilir;
   seçili aralık kesintisiz bir şerit olarak boyanır (paintCal), ikinci tıklamadan önce üzerine gelinen çeyreğe kadar önizlenir */
function quarterCalendar(ps) {
  const have = new Set(ps), asc = [...ps].sort(), fullP = asc.filter(p => !isPartial(p)), y0 = +asc[0].slice(0, 4), y1 = +asc.at(-1).slice(0, 4), pick = S.calPick;
  let rows = '';
  for (let y = y0; y <= y1; y++) rows += `<b>${y}</b>` + [1, 2, 3, 4].map(q => { const p = `${y}-Q${q}`, ok = have.has(p), part = ok && isPartial(p);
    return `<button type="button" data-act="pickPeriod" data-v="${p}" class="${part ? 'part' : ''}" ${ok ? '' : 'disabled'} title="${ok ? (part ? 'Yarım dönem (henüz bitmedi)' : plabel(p)) : 'Bu çeyrek için veri yok'}"><span>Ç${q}</span></button>`; }).join('');
  const last = fullP.at(-1), yr = last ? +last.slice(0, 4) : 0, ofYear = y => fullP.filter(p => p.startsWith(y + '-'));
  const presets = last ? [['Son çeyrek', last, last], ['Son 4 çeyrek', fullP.at(-4), last], ['Son 8 çeyrek', fullP.at(-8), last],
    [`${yr} yılı`, ofYear(yr)[0], last], [`${yr - 1} yılı`, ofYear(yr - 1)[0], ofYear(yr - 1).at(-1)], ['Tüm dönem', fullP[0], last]].filter(x => x[1] && x[2]) : [];
  const curA = S.from || S.period, label = S.from ? `${plabel(S.from)} – ${plabel(S.period)}` : plabel(S.period);
  return `<div class="field"><span>Dönem</span><details class="cal" ${S.calOpen ? 'open' : ''}>
    <summary><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>${label}</span><i class="chev" aria-hidden="true"></i></summary>
    <div class="calpop c2">
      <div class="c2head"><div><small>Başlangıç</small><b id="calA"></b></div><span class="arrow" aria-hidden="true">→</span><div class="${pick ? 'wait' : ''}"><small>Bitiş</small><b id="calB"></b></div></div>
      <div class="c2body">
        <div class="c2presets"><small>Hızlı seçim</small>${presets.map(([t, a, b]) => `<button type="button" data-act="calPreset" data-a="${a}" data-b="${b}" class="${!pick && curA === a && S.period === b ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div class="c2grid"><i></i><i>1. çeyrek</i><i>2. çeyrek</i><i>3. çeyrek</i><i>4. çeyrek</i>${rows}</div>
      </div>
      <p class="c2foot">${pick ? 'Bitiş çeyreğine tıkla.' : 'İki çeyreğe tıklayarak aralık seç; tek çeyrek için aynı kutuya iki kez tıkla.'} <span><i class="k part"></i>yarım dönem</span><span><i class="k off"></i>veri yok</span></p>
    </div></details></div>`;
}
function paintCal(hov) {
  const g = document.querySelector('.c2grid');
  if (!g) return;
  const p = S.calPick, lo = p ? (hov && hov < p ? hov : p) : S.from || S.period, hi = p ? (hov && hov > p ? hov : p) : S.period;
  g.querySelectorAll('button').forEach(b => { const v = b.dataset.v, c = b.classList, end = v === lo || v === hi;
    c.toggle('on', end); c.toggle('in', v > lo && v < hi); c.toggle('a', lo !== hi && v === lo); c.toggle('b', lo !== hi && v === hi);
    b.setAttribute('aria-pressed', end); });
  const A = document.getElementById('calA'), B = document.getElementById('calB');
  if (A) A.textContent = plabel(lo);
  if (B) B.textContent = p && (!hov || hov === p) ? 'seç…' : plabel(hi);
}
function setRange(a, b) {
  if (a > b) [a, b] = [b, a];
  S.calPick = ''; S.period = b; S.from = a === b ? '' : a; S.cmp = S.from && !isPartial(S.from) ? S.from : 'yoy'; S.calOpen = false;
}
function filterBar(rows, o = {}) {
  const ps = periods(rows).slice().reverse(), d = dims();
  const opts = [...new Map(rows.map(r => [r.key, r.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'tr'));
  const n = opts.filter(([k]) => S.cats.has(k)).length;
  const active = n || S.from || S.fDev || S.fCtry || (o.cmp && S.cmp !== 'yoy') || (ps.length && S.period !== full(rows).at(-1));
  return `<div class="controls filters">
    ${ps.length ? quarterCalendar(ps) : ''}
    ${o.cmp && ps.length ? sel('cmp', [['yoy', 'Geçen yılın aynı çeyreği'], ['qoq', 'Önceki çeyrek'], ...ps.filter(x => x < S.period && !isPartial(x)).map(x => [x, plabel(x)])], S.cmp, 'Karşılaştır') : ''}
    <div class="field"><span>Ölçü</span>${seg('metric', [['rev', 'Gelir'], ['dl', 'İndirme']], S.metric)}</div>
    ${opts.length ? `<div class="field"><span>Kategori</span><details class="multi" ${S.catsOpen ? 'open' : ''}><summary>${n ? n + ' kategori seçili' : 'Tüm kategoriler'}</summary>
      <div class="multilist">${n ? '<button type="button" class="btn small" data-act="catsClear">Seçimi temizle</button>' : ''}
      ${opts.map(([k, name]) => `<label><input type="checkbox" data-cat="${esc(k)}" ${S.cats.has(k) ? 'checked' : ''}><span>${esc(name)}</span></label>`).join('')}</div></details></div>` : ''}
    ${d.devs.length ? sel('fDev', [['', 'Tüm cihazlar'], ...d.devs.map(x => [x, x])], S.fDev, 'Cihaz') : ''}
    ${d.ctrys.length > 1 ? sel('fCtry', [['', 'Tüm ülkeler'], ...d.ctrys], S.fCtry, 'Ülke') : ''}
    ${active ? '<button type="button" class="btn small reset" data-act="resetFilters">Filtreleri sıfırla</button>' : ''}</div>`;
}
const noMatch = '<div class="card empty"><h3>Bu filtreyle veri yok</h3><p>Seçilen cihaz ya da ülke için yüklenmiş satır bulunamadı. Filtreleri sıfırlayıp yeniden dene.</p></div>';

/* Pay grafiği: tek sıra yığılmış çubuk + değerli gösterge */
function shareChart(items, f) {
  const t = items.reduce((s, i) => s + i.value, 0) || 1;
  return `<div class="sharebar" role="img" aria-label="Kategori payları">${items.map(i => `<i style="flex:${Math.max(i.value / t, 0.004)};background:${i.color}" data-tip="${esc(i.name)} · ${esc(f(i.value))} · ${pct(i.value / t)}"></i>`).join('')}</div>
    <ul class="sharelegend">${items.map(i => `<li><i class="dot" style="background:${i.color}"></i><span title="${esc(i.name)}">${esc(i.name)}</span><em>${esc(f(i.value))}</em><b>${pct(i.value / t)}</b></li>`).join('')}</ul>`;
}
/* Artı/eksi çubuklar: büyüyenler sağa, küçülenler sola */
function divBars(items) {
  const max = Math.max(...items.map(i => Math.abs(i.d)), 0.01);
  return `<ol class="div">${items.map(i => `<li><span class="bname" title="${esc(i.name)}">${esc(i.name)}</span>
    <span class="dtrack"><i class="${i.d >= 0 ? 'pos' : 'neg'}" style="width:${Math.max(0.5, Math.abs(i.d) / max * 50)}%" data-tip="${esc(i.name)} · ${i.d >= 0 ? '+' : '−'}${pct(Math.abs(i.d))}"></i></span>${pill(i.d)}</li>`).join('')}</ol>`;
}

/* ---------- Ek grafikler (genişliğe göre çizilir) ---------- */
const plot = fn => { const id = 'p' + after.length; after.push(() => { const el = document.getElementById(id); if (el) el.innerHTML = fn(Math.max(300, el.clientWidth)); }); return `<div class="plot" id="${id}"></div>`; };
const tipAttr = t => ` data-tip="${esc(t)}"`;
const legendHtml = items => `<div class="legend">${items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.name)}</span>`).join('')}</div>`;
const svgWrap = (W, H, inner, label) => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
function niceMax(v) { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p; return 10 * p; }
function frame(W, H, max, fmt, xs, min = 0, mr = 24) {
  const m = { l: 76, r: mr, t: 10, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = xs.length;
  const x = i => m.l + (n < 2 ? iw / 2 : i * iw / (n - 1)), y = v => m.t + ih - ((v - min) / (max - min)) * ih;
  let g = '';
  for (let t = 0; t <= 4; t++) { const v = min + (max - min) * t / 4; g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grid${t ? '' : ' base'}"/><text x="${m.l - 10}" y="${y(v) + 4}" text-anchor="end" class="axis">${esc(fmt(v))}</text>`; }
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 74))));
  xs.forEach((l, i) => { if ((n - 1 - i) % step === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(l)}</text>`; });
  return { m, iw, ih, x, y, g, n };
}
/* Yığılmış alan: stack = [{name,color,v:[]}]. Üstte koyu toplam çizgisi ve toplam etiketleri,
   sağda her bandın adı, son değeri ve payı; dar ekranda sağ etiketler yerine üstte gösterge */
function areaChart(W, labels, stack, fmt) {
  const H = 360, n = labels.length, wide = W >= 900, mid = W >= 620, mr = wide ? 250 : mid ? 170 : 24;
  const tots = labels.map((_, i) => stack.reduce((s, k) => s + k.v[i], 0)), f = frame(W, H, niceMax(Math.max(...tots) * 1.1), fmt, labels, 0, mr);
  let base = labels.map(() => 0), out = '', ends = [];
  stack.forEach(k => {
    const up = base.map((b, i) => b + k.v[i]);
    out += `<polygon points="${up.map((v, i) => `${f.x(i).toFixed(1)},${f.y(v).toFixed(1)}`).concat(base.map((v, i) => `${f.x(i).toFixed(1)},${f.y(v).toFixed(1)}`).reverse()).join(' ')}" fill="${k.color}" fill-opacity=".9" stroke="#fff" stroke-width="1.5"/>`;
    ends.push({ k, y0: f.y(base[n - 1] + k.v[n - 1] / 2), v: k.v[n - 1] });
    base = up;
  });
  // toplam çizgisi + etiketleri
  out += `<polyline points="${tots.map((v, i) => `${f.x(i).toFixed(1)},${f.y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="#1E0B4D" stroke-width="2.5" stroke-linejoin="round"/>`;
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(f.iw / 96))));
  tots.forEach((v, i) => {
    out += `<circle cx="${f.x(i).toFixed(1)}" cy="${f.y(v).toFixed(1)}" r="4" fill="#1E0B4D" stroke="#fff" stroke-width="2"/>`;
    if ((n - 1 - i) % step === 0) out += `<text x="${f.x(i).toFixed(1)}" y="${(f.y(v) - 11).toFixed(1)}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="lbl b">${esc(fmt(v))}</text>`;
  });
  // sağ etiketler: üst üste binmesin
  if (mid) {
    const t = tots[n - 1] || 1, lx = f.x(n - 1);
    ends.sort((a, b) => a.y0 - b.y0);
    ends.forEach((e, i) => { e.y = i ? Math.max(e.y0, ends[i - 1].y + 17) : Math.max(e.y0, f.m.t + 8); });
    const over = ends.at(-1).y - (f.m.t + f.ih - 2);
    if (over > 0) for (let i = ends.length - 1; i >= 0; i--) { ends[i].y = Math.min(ends[i].y, (i === ends.length - 1 ? f.m.t + f.ih - 2 : ends[i + 1].y - 17)); }
    ends.forEach(e => {
      const nm = !wide && e.k.name.length > 16 ? e.k.name.slice(0, 15) + '…' : e.k.name;
      out += `<path d="M${lx + 4},${e.y0.toFixed(1)} L${lx + 14},${e.y.toFixed(1)}" stroke="${e.k.color}" stroke-width="1.5" fill="none"/><circle cx="${lx + 18}" cy="${e.y.toFixed(1)}" r="4" fill="${e.k.color}"/>
        <text x="${lx + 27}" y="${(e.y + 4).toFixed(1)}" class="lbl"><tspan font-weight="600">${esc(nm)}</tspan><tspan class="sub"> ${wide ? esc(fmt(e.v)) + ' · ' : ''}${pct(e.v / t, 0)}</tspan></text>`;
    });
  }
  // çeyrek sütunları: üzerine gelince dikey şerit + ayrıntı kutusu
  const cw = f.iw / Math.max(1, n - 1);
  labels.forEach((l, i) => { out += `<rect class="hitcol" x="${f.x(i) - cw / 2}" y="${f.m.t}" width="${cw}" height="${f.ih}"${tipAttr(`${l}\nToplam: ${fmt(tots[i])}\n` + stack.slice().reverse().map(k => `${k.name}: ${fmt(k.v[i])} (${pct(k.v[i] / (tots[i] || 1), 0)})`).join('\n'))}/>`; });
  return (mid ? '' : legendHtml(stack)) + svgWrap(W, H, f.g + out, 'Toplam pazar ve kategori dağılımı');
}
/* Ağaç haritası: items = [{name,v}] büyükten küçüğe */
function treemap(W, items, fmt) {
  const H = 320, list0 = items.filter(i => i.v > 0), t = list0.reduce((s, i) => s + i.v, 0), out = [];
  if (!list0.length) return '<p class="muted">Bu çeyrekte veri yok.</p>';
  const max = list0[0].v;
  (function split(list, x, y, w, h) {
    if (list.length === 1) { out.push({ ...list[0], x, y, w, h }); return; }
    const s = list.reduce((a, b) => a + b.v, 0); let acc = list[0].v, k = 1;
    while (k < list.length - 1 && acc + list[k].v <= s / 2) { acc += list[k].v; k++; }
    const fr = acc / s;
    if (w >= h) { split(list.slice(0, k), x, y, w * fr, h); split(list.slice(k), x + w * fr, y, w * (1 - fr), h); }
    else { split(list.slice(0, k), x, y, w, h * fr); split(list.slice(k), x, y + h * fr, w, h * (1 - fr)); }
  })(list0, 0, 0, W, H);
  return svgWrap(W, H, out.map(o => { const op = o.dim ? 0.1 : 0.28 + 0.72 * o.v / max, ink = op > 0.55 ? '#fff' : '#1E0B4D', fits = o.w > o.name.length * 7.4 + 18 && o.h > 44;
    return `<g class="tm${o.sel ? ' sel' : ''}"${o.key ? ` data-act="catToggle" data-key="${esc(o.key)}" role="button" tabindex="0" aria-pressed="${!!o.sel}"` : ''}${tipAttr(`${o.name}\n${fmt(o.v)} · ${pct(o.v / t)}${o.key ? (o.sel ? '\nSeçimi kaldırmak için tıkla' : '\nBu kategoriye göre süzmek için tıkla') : ''}`)}><rect x="${(o.x + 1).toFixed(1)}" y="${(o.y + 1).toFixed(1)}" width="${Math.max(0, o.w - 2).toFixed(1)}" height="${Math.max(0, o.h - 2).toFixed(1)}" rx="5" fill="#6B2AE6" fill-opacity="${op.toFixed(2)}"${o.sel ? ' stroke="#1E0B4D" stroke-width="2.5"' : ''}/>
      ${fits ? `<text x="${o.x + 10}" y="${o.y + 22}" class="lbl b" style="fill:${ink}">${esc(o.name)}</text><text x="${o.x + 10}" y="${o.y + 39}" class="lbl" style="fill:${ink}">${pct(o.v / t)}</text>` : o.w > 46 && o.h > 22 ? `<text x="${o.x + 8}" y="${o.y + 17}" class="cell" style="fill:${ink}">${pct(o.v / t)}</text>` : ''}</g>`; }).join(''), 'Kategori payları');
}
/* Isı haritası: rows = [{name, vals:[oran|null]}], cols = çeyrek etiketleri; genişliğe sığan son sütunlar çizilir */
function heatmap(W, rows, cols) {
  const lw = Math.min(170, Math.round(W * 0.34)), k = Math.max(1, Math.min(cols.length, Math.floor((W - lw) / 46))), off = cols.length - k, cw = (W - lw - 2) / k, rh = 25, H = 28 + rows.length * rh;
  const all = rows.flatMap(r => r.vals.slice(off)).filter(v => v != null).map(Math.abs), cap = Math.max(0.01, Math.min(0.5, Math.max(...all, 0)));
  let out = cols.slice(off).map((l, i) => `<text x="${lw + i * cw + cw / 2}" y="14" text-anchor="middle" class="axis">${esc(l)}</text>`).join('');
  rows.forEach((r, ri) => {
    const y = 28 + ri * rh, nm = r.name.length > lw / 7 ? r.name.slice(0, Math.floor(lw / 7) - 1) + '…' : r.name;
    out += `<text x="${lw - 10}" y="${y + 16}" text-anchor="end" class="lbl">${esc(nm)}</text>`;
    r.vals.slice(off).forEach((v, i) => {
      const x = lw + i * cw;
      if (v == null) { out += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${rh - 2}" rx="3" fill="#F3F0F9"/><text x="${x + cw / 2}" y="${y + 16}" text-anchor="middle" class="cell" style="fill:#B0A8C6">–</text>`; return; }
      out += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${rh - 2}" rx="3" fill="${v >= 0 ? '#2FA57A' : '#D8574E'}" fill-opacity="${(0.1 + 0.8 * Math.min(1, Math.abs(v) / cap)).toFixed(2)}"${tipAttr(`${r.name} · ${cols[off + i]}\n${v >= 0 ? '+' : '−'}${pct(Math.abs(v))} (önceki çeyreğe göre)`)}/>
        <text x="${x + cw / 2}" y="${y + 16}" text-anchor="middle" class="cell">${(v >= 0 ? '+' : '−') + nf(Math.abs(v) * 100, cw < 52 ? 0 : 1)}</text>`;
    });
  });
  return svgWrap(W, H, out, 'Büyüme ısı haritası');
}
/* Balon: pts = [{name,x,y,d,color,label}] */
function bubbleChart(W, pts, fx, fd, dName) {
  const H = 320, maxX = niceMax(Math.max(...pts.map(p => p.x))), maxD = Math.max(...pts.map(p => p.d), 1);
  const lo = Math.min(0, Math.floor(Math.min(...pts.map(p => p.y)) * 10 - 0.5) / 10), hi = Math.max(0.1, Math.ceil(Math.max(...pts.map(p => p.y)) * 10 + 0.5) / 10);
  const f = frame(W, H, hi, v => (Math.abs(v) < 1e-9 ? '%0' : (v > 0 ? '+' : '−') + pct(Math.abs(v), 0)), [], lo), x = v => f.m.l + v / maxX * f.iw;
  let g = f.g + `<line x1="${f.m.l}" x2="${W - f.m.r}" y1="${f.y(0)}" y2="${f.y(0)}" stroke="#7D7399" stroke-dasharray="4 4"/>`;
  [0, 0.5, 1].forEach(t => { g += `<text x="${x(maxX * t)}" y="${H - 8}" text-anchor="${t === 1 ? 'end' : t ? 'middle' : 'start'}" class="axis">${esc(fx(maxX * t))}</text>`; });
  pts.slice().sort((a, b) => b.d - a.d).forEach(p => { const r = 5 + Math.sqrt(p.d / maxD) * Math.min(24, W / 22);
    g += `<circle cx="${x(p.x).toFixed(1)}" cy="${f.y(p.y).toFixed(1)}" r="${r.toFixed(1)}" fill="${p.color}" fill-opacity=".75" stroke="#fff" stroke-width="2"${tipAttr(`${p.name}\n${fx(p.x)} · ${p.y >= 0 ? '+' : '−'}${pct(Math.abs(p.y))}\n${dName}: ${fd(p.d)}`)}/>`;
    if (p.label) g += `<text x="${Math.min(W - 6, Math.max(f.m.l, x(p.x))).toFixed(1)}" y="${Math.max(12, f.y(p.y) - r - 5).toFixed(1)}" text-anchor="${x(p.x) > W - 90 ? 'end' : 'middle'}" class="lbl">${esc(p.name)}</text>`; });
  return svgWrap(W, H, g, 'Büyüklük ve büyüme');
}
/* Yoğunlaşma eğrisi: revs büyükten küçüğe */
function paretoChart(W, revs) {
  const H = 300, n = revs.length, t = revs.reduce((s, v) => s + v, 0) || 1, f = frame(W, H, 1, v => pct(v, 0), []), x = k => f.m.l + k / n * f.iw;
  let cum = 0; const c = revs.map(v => (cum += v) / t), line = c.map((v, i) => `${x(i + 1).toFixed(1)},${f.y(v).toFixed(1)}`).join(' ');
  let g = f.g + `<polygon points="${f.m.l},${f.y(0)} ${line} ${x(n)},${f.y(0)}" fill="#6B2AE6" fill-opacity=".12"/><polyline points="${f.m.l},${f.y(0)} ${line}" fill="none" stroke="#6B2AE6" stroke-width="2.5" stroke-linejoin="round"/>`;
  [10, 100].filter(k => k < n).forEach((k, i) => { g += `<line x1="${x(k)}" x2="${x(k)}" y1="${f.y(c[k - 1])}" y2="${f.y(0)}" stroke="#7D7399" stroke-dasharray="4 4"/><circle cx="${x(k)}" cy="${f.y(c[k - 1])}" r="5" fill="#6B2AE6" stroke="#fff" stroke-width="2"${tipAttr(`İlk ${k} yayıncı\nGelirin ${pct(c[k - 1])} kadarı`)}/>
    <text x="${x(k) + 10}" y="${f.y(c[k - 1]) + (i ? 18 : 4)}" class="lbl b">İlk ${k}: ${pct(c[k - 1])}</text>`; });
  g += `<text x="${f.m.l}" y="${H - 8}" class="axis">1. yayıncı</text><text x="${W - f.m.r}" y="${H - 8}" text-anchor="end" class="axis">${n}. yayıncı</text>`;
  return svgWrap(W, H, g, 'Yoğunlaşma eğrisi');
}

/* Bağlantılı sıralama: solda bir ölçüye, sağda diğer ölçüye göre ilk N; iki listede de olanlar çizgiyle bağlanır.
   L, R = [{name, v, other}] (other = karşı listedeki sıra) */
function rankLink(W, L, R, fl, fr, lName, rName) {
  const rh = 36, top = 34, H = top + Math.max(L.length, R.length) * rh + 6, xl = Math.round(W * 0.4), xr = Math.round(W * 0.6), vw = 104;
  const cut = (s, w) => { const n = Math.max(4, Math.floor(w / 7)); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const y = i => top + i * rh + rh / 2, rIdx = new Map(R.map((r, i) => [r.name, i]));
  let g = `<text x="0" y="16" class="lbl b">${esc(lName)} göre ilk ${L.length}</text><text x="${W}" y="16" text-anchor="end" class="lbl b">${esc(rName)} göre ilk ${R.length}</text>`;
  const tipOf = (name, a, ar, b, br) => tipAttr(`${name}\nGelir: ${a} (${ar}. sıra)\nİndirme: ${b} (${br}. sıra)`);
  L.forEach((o, i) => {
    const j = rIdx.get(o.name), both = j != null;
    let s = `<rect x="0" y="${y(i) - rh / 2 + 2}" width="${xl + 6}" height="${rh - 4}" rx="8" class="rowbg"/>
      <text x="8" y="${y(i) + 4}" class="axis">${i + 1}</text><text x="30" y="${y(i) + 4}" class="lbl${both ? ' b' : ''}">${esc(cut(o.name, xl - 30 - vw - 14))}</text>
      <text x="${xl - 14}" y="${y(i) + 4}" text-anchor="end" class="lbl num">${esc(fl(o.v))}</text><circle cx="${xl}" cy="${y(i)}" r="5" fill="${both ? '#6B2AE6' : '#B9B2CC'}"/>`;
    if (both) s += `<path d="M${xl},${y(i)} C${(xl + xr) / 2},${y(i)} ${(xl + xr) / 2},${y(j)} ${xr},${y(j)}" class="lnk"/>`;
    else s += `<path d="M${xl},${y(i)} h${Math.round((xr - xl) * 0.28)}" class="stub"/><text x="${xl + Math.round((xr - xl) * 0.28) + 6}" y="${y(i) + 4}" class="axis">${o.other}. sırada</text>`;
    g += `<g class="rl"${tipOf(o.name, fl(o.v), i + 1, fr(o.ov), o.other)}>${s}</g>`;
  });
  const lSet = new Set(L.map(o => o.name));
  R.forEach((o, i) => {
    const both = lSet.has(o.name);
    let s = `<rect x="${xr - 6}" y="${y(i) - rh / 2 + 2}" width="${W - xr + 6}" height="${rh - 4}" rx="8" class="rowbg"/>
      <circle cx="${xr}" cy="${y(i)}" r="5" fill="${both ? '#6B2AE6' : '#B9B2CC'}"/><text x="${xr + 14}" y="${y(i) + 4}" class="axis">${i + 1}</text>
      <text x="${xr + 36}" y="${y(i) + 4}" class="lbl${both ? ' b' : ''}">${esc(cut(o.name, W - xr - 36 - vw - 8))}</text><text x="${W - 8}" y="${y(i) + 4}" text-anchor="end" class="lbl num">${esc(fr(o.v))}</text>`;
    if (!both) s += `<path d="M${xr},${y(i)} h-${Math.round((xr - xl) * 0.28)}" class="stub"/><text x="${xr - Math.round((xr - xl) * 0.28) - 6}" y="${y(i) + 4}" text-anchor="end" class="axis">${o.other}. sırada</text>`;
    g += `<g class="rl"${tipOf(o.name, fl(o.ov), o.other, fr(o.v), i + 1)}>${s}</g>`;
  });
  return svgWrap(W, H, g, 'Gelir ve indirme sıralaması karşılaştırması');
}

/* ---------- Görünümler ---------- */
function viewOzet() {
  if (!FILES.length) return `<div class="card hero">
    <h1>Mobil uygulama pazarını çeyrek çeyrek izle</h1>
    <p>Sensor Tower’dan aldığın CSV dosyalarını yükle; kategori büyüklükleri, büyük oyuncular, yayıncı yoğunlaşması ve yapay zekâ segmenti otomatik olarak grafiğe dönüşsün.</p>
    <div class="row"><a class="btn primary" href="#veri">Veri yükle</a><button class="btn" data-act="sample">Örnek veriyle gez</button></div></div>`;

  const all = market(), hasCat = raw('category').length > 0, m = S.metric, f = fmtM(m), mName = m === 'rev' ? 'Gelir' : 'İndirme';
  fixPeriod(all);
  const p = S.period, c = cmpOf(p), { rows, n } = scopeCats(all);
  const pubs = pubSource().rows, pp = periods(pubs).includes(p) ? p : full(pubs).at(-1);
  const ai = aiData().rows, ap = periods(ai).includes(p) ? p : full(ai).at(-1);
  const apps = data('apps'), lp = periods(apps).includes(p) ? p : full(apps).at(-1);
  const tile = (label, value, sub) => `<div class="tile"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  const none = '<a href="#veri">Veri yükle</a>';
  const ch = k => `${pill(c ? delta(tot(rows, p, k), tot(rows, c, k)) : null)} ${cmpText()}`;
  const yoy = (r, per, k) => `${pill(isPartial(per) ? null : delta(tot(r, per, k), tot(r, prevYear(per), k)))} geçen yıla göre`;
  const scopeTxt = n ? ` · ${n} kategori` : '';
  let tiles = '';
  tiles += p ? tile(`Toplam gelir · ${plabel(p)}${scopeTxt}`, money(tot(rows, p, 'rev')), ch('rev')) : tile('Toplam gelir', '—', none);
  tiles += p ? tile(`Toplam indirme · ${plabel(p)}${scopeTxt}`, short(tot(rows, p, 'dl')), ch('dl')) : tile('Toplam indirme', '—', none);
  if (pp) {
    const sh = per => { const r = at(pubs, per).sort((a, b) => b.rev - a.rev), t = r.reduce((s, x) => s + x.rev, 0); return t ? r.slice(0, 10).reduce((s, x) => s + x.rev, 0) / t : null; };
    const cur = sh(pp), prev = isPartial(pp) ? null : sh(prevYear(pp));
    tiles += tile(`İlk 10 yayıncının payı · ${plabel(pp)}`, pct(cur), `${pill(prev == null ? null : cur - prev, 'pp')} geçen yıla göre`);
  } else tiles += tile('İlk 10 yayıncının payı', '—', none);
  tiles += ap ? tile(`Yapay zekâ geliri · ${plabel(ap)}`, money(tot(ai, ap, 'rev')), yoy(ai, ap, 'rev')) : tile('Yapay zekâ geliri', '—', '<a href="#ai">Uygulamaları etiketle</a>');

  let body = '';
  if (p) {
    const fps = rangeP(rows), piv = new Map();
    for (const r of rows) { if (!piv.has(r.key)) piv.set(r.key, {}); piv.get(r.key)[r.p] = r; }
    const byRev = at(rows, p).sort((a, b) => b.rev - a.rev), top = byRev.slice(0, 6);
    // Renk kategoriye bağlıdır: seçim yapılınca kategoriler renk değiştirmez
    const gcol = new Map(at(all, p).sort((a, b) => b.rev - a.rev).slice(0, 6).map((r, i) => [r.key, COLORS[i]])), color = new Map(), used = new Set();
    top.forEach(r => { if (gcol.has(r.key)) { color.set(r.key, gcol.get(r.key)); used.add(gcol.get(r.key)); } });
    top.forEach(r => { if (!color.has(r.key)) { const c = COLORS.find(x => !used.has(x)); used.add(c); color.set(r.key, c); } });
    const cur = at(rows, p).sort((a, b) => b[m] - a[m]);
    const span = fps.length > 1 ? `${plabel(fps[0])} – ${plabel(fps.at(-1))}` : plabel(fps[0]);
    const rest = byRev.slice(6).reduce((s, r) => s + r[m], 0);
    const shares = [...top.map(r => ({ name: r.name, color: color.get(r.key), value: r[m] })), ...(rest > 0 ? [{ name: `Diğer ${byRev.length - 6} kategori`, color: '#B9B2CC', value: rest }] : [])];
    const withD = cur.map(r => ({ name: r.name, value: r[m], d: c ? delta(r[m], piv.get(r.key)[c]?.[m]) : null }));
    let growth = withD.filter(r => r.d != null).sort((a, b) => b.d - a.d);
    const cut = growth.length > 10;
    growth = growth.slice(0, 10); // yalnızca en çok büyüyen ilk 10
    const noCmp = `<p class="muted">${isPartial(p) ? 'Yarım dönemde karşılaştırma yapılmaz.' : plabel(c) + ' verisi yüklenince görünür.'}</p>`;
    const stackS = [...top.map(r => ({ name: r.name, color: color.get(r.key), v: fps.map(x => piv.get(r.key)[x]?.[m] || 0) })),
      ...(byRev.length > 6 ? [{ name: `Diğer ${byRev.length - 6} kategori`, color: '#B9B2CC', v: fps.map(x => byRev.slice(6).reduce((t, r) => t + (piv.get(r.key)[x]?.[m] || 0), 0)) }] : [])];
    const om = m === 'rev' ? 'dl' : 'rev', omName = m === 'rev' ? 'İndirme' : 'Gelir';
    const bub = cur.map(r => ({ name: r.name, x: r[m], y: c ? delta(r[m], piv.get(r.key)[c]?.[m]) : null, d: r[om], color: color.get(r.key) || '#B9B2CC', label: color.has(r.key) })).filter(q => q.y != null);
    body += `<section class="card"><h3>Toplam pazar ve kategori dağılımı</h3><p class="muted">${mName} · ${span}${scopeTxt} · her renkli bant bir kategori, bandın kalınlığı o kategorinin ${trLower(mName)} tutarı; koyu çizgi ve üstündeki rakamlar toplam pazar</p>
        ${fps.length > 1 ? plot(W => areaChart(W, fps.map(plabel), stackS, f)) : '<p class="muted">Trend için en az iki çeyrek gerekir.</p>'}</section>
    <div class="grid2">
      <section class="card"><h3>Kategori payları</h3><p class="muted">${plabel(p)} · her kutunun alanı ${trLower(mName)} payı kadardır · bir kutuya tıkla: sayfa o kategoriye göre süzülür${n ? ', yeniden tıkla: seçim kalkar' : ''}</p>${plot(W => treemap(W, at(all, p).sort((a, b) => b[m] - a[m]).map(r => ({ name: r.name, v: r[m], key: r.key, sel: n > 0 && S.cats.has(r.key), dim: n > 0 && !S.cats.has(r.key) })), f))}
        ${n ? '<button type="button" class="btn small" data-act="catsClear">Seçimi temizle</button>' : ''}</section>
      <section class="card"><h3>Büyüklük ve büyüme</h3><p class="muted">${plabel(p)} · yatay: ${trLower(mName)} · dikey: değişim, ${cmpText()} · balon boyutu: ${trLower(omName)}</p>${bub.length ? plot(W => bubbleChart(W, bub, f, fmtM(om), omName)) : noCmp}</section></div>
    <div class="grid2">
      <section class="card"><h3>${m === 'rev' ? 'En çok kazandıran kategoriler' : 'En çok indirilen kategoriler'}</h3><p class="muted">${plabel(p)} · değişim ${cmpText()}</p>${barList(withD.slice(0, 10).map(r => ({ name: r.name, value: r.value, delta: r.d })), f)}</section>
      <section class="card"><h3>Büyüme sıralaması</h3><p class="muted">${plabel(p)} · ${trLower(mName)} değişimi, ${cmpText()}${cut ? ' · en çok büyüyen ilk 10 kategori' : ''}</p>${growth.length ? divBars(growth) : noCmp}</section></div>`;
  } else if (hasCat) body += noMatch;
  let g2 = '';
  if (lp) g2 += `<section class="card"><h3>En büyük uygulamalar</h3><p class="muted">${plabel(lp)} · ${trLower(mName)}</p>${barList(at(apps, lp).sort((a, b) => b[m] - a[m]).slice(0, 8).map(r => ({ name: r.name, sub: r.pub, value: r[m], url: r.url })), f)}</section>`;
  if (pp) g2 += `<section class="card"><h3>En büyük yayıncılar</h3><p class="muted">${plabel(pp)} · ${trLower(mName)}</p>${barList(at(pubs, pp).sort((a, b) => b[m] - a[m]).slice(0, 8).map(r => ({ name: r.name, value: r[m], url: r.url })), f)}</section>`;
  if (g2) body += `<div class="grid2">${g2}</div>`;
  const dimNote = (S.fDev || S.fCtry) && (lp || pp) ? '<p class="note">Cihaz ve ülke filtreleri yalnızca kategori verisine uygulanır; uygulama ve yayıncı listeleri dünya geneli toplamdır.</p>' : '';
  return `${hasCat ? filterBar(all, { cmp: true }) : ''}<div class="tiles">${tiles}</div>${body}${dimNote}${partialNote(all)}`;
}

function viewKategoriler() {
  S.catGroup = 'app';
  if (!raw('category', 'app').length) return empty('Kategori verisi yok', 'Category Overview dışa aktarımını yükleyince pazar büyüklüğü ve trendler burada görünür.');
  const all = data('category', S.catGroup), m = S.metric, f = fmtM(m), mName = m === 'rev' ? 'Gelir' : 'İndirme';
  fixPeriod(all);
  const head = filterBar(all);
  if (!all.length) return head + noMatch;
  const { rows, n } = scopeCats(all), p = S.period, part = isPartial(p);
  const ps = rangeP(rows), piv = pivot(rows);
  const byRev = [...piv.keys()].sort((a, b) => (piv.get(b)[p]?.rev || 0) - (piv.get(a)[p]?.rev || 0));
  const color = new Map(byRev.slice(0, 6).map((x, i) => [x, COLORS[i]]));
  const series = byRev.slice(0, 6).map(x => ({ name: x, color: color.get(x), values: ps.map(q => piv.get(x)[q]?.[m] ?? null) }));
  const total = tot(rows, p, m);
  const list = [...piv.keys()].map(x => { const o = piv.get(x), v = o[p]?.[m] || 0; return { n: x, v, q: part ? null : delta(v, o[prevQ(p)]?.[m]), y: part ? null : delta(v, o[prevYear(p)]?.[m]) }; })
    .sort((a, b) => b.v - a.v);
  return `${head}
    <section class="card"><h3>${mName} trendi · ${trLower(GROUPS[S.catGroup])}</h3>
      <p class="muted">${n ? 'Seçilen kategoriler' : `${plabel(p)} gelirine göre ilk 6`}${n > 6 ? ' (gelire göre ilk 6)' : ''} · ${plabel(ps[0])} – ${plabel(ps.at(-1))}</p>${ps.length > 1 ? chart({ labels: ps.map(plabel), series, fmt: f }) : '<p class="muted">Trend için en az iki çeyrek gerekir.</p>'}</section>
    ${ps.length > 1 ? `<section class="card"><h3>Büyüme ısı haritası</h3><p class="muted">Her çeyrekte önceki çeyreğe göre ${trLower(mName)} değişimi (%) · yeşil büyüme, kırmızı küçülme</p>
      ${plot(W => heatmap(W, list.slice(0, S.catLimit).map(r => ({ name: r.n, vals: ps.slice(1).map(q => delta(piv.get(r.n)[q]?.[m] || 0, piv.get(r.n)[prevQ(q)]?.[m])) })), ps.slice(1).map(plabel)))}</section>` : ''}
    <section class="card"><h3>${list.length > S.catLimit ? `İlk ${S.catLimit} uygulama kategorisi` : `${n ? 'Seçilen' : 'Tüm'} ${trLower(GROUPS[S.catGroup])}`} · ${plabel(p)}</h3>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Kategori</th><th class="r">${mName}</th><th class="r">Pay</th><th class="r">Önceki çeyreğe göre</th><th class="r">Geçen yıla göre</th></tr></thead>
      <tbody>${list.slice(0, S.catLimit).map((r, i) => `<tr><td class="dim">${i + 1}</td><td>${color.has(r.n) ? `<i class="dot" style="background:${color.get(r.n)}"></i>` : ''}${esc(r.n)}</td>
        <td class="r num">${f(r.v)}</td><td class="r num">${total ? pct(r.v / total) : '–'}</td><td class="r">${pill(r.q)}</td><td class="r">${pill(r.y)}</td></tr>`).join('')}</tbody></table></div>
      ${list.length > S.catLimit ? `<button class="btn more" data-act="more" data-k="catLimit" data-n="10">10 tane daha göster (${list.length - S.catLimit} kaldı)</button>` : ''}</section>${partialNote(all)}`;
}

function viewUygulamalar() {
  const rows = data('apps');
  if (!rows.length) return empty('Uygulama verisi yok', 'Top Apps dışa aktarımını yükleyince büyük oyuncular, yeni girenler ve listeden düşenler burada görünür.');
  const ps = periods(rows);
  if (!ps.includes(S.appsPeriod)) S.appsPeriod = full(rows).at(-1);
  const p = S.appsPeriod, py = prevYear(p), part = isPartial(p), hasPrev = !part && ps.includes(py);
  const cats = [...new Set(at(rows, p).map(r => r.cat).filter(Boolean))].sort();
  if (!cats.includes(S.appsCat)) S.appsCat = '';
  const scope = r => !S.appsCat || r.cat === S.appsCat;
  const m = S.metric, cur = at(rows, p).filter(scope).sort((a, b) => b[m] - a[m]);
  const prev = hasPrev ? at(rows, py).filter(scope).sort((a, b) => b[m] - a[m]) : [];
  const key = r => r.name.toLowerCase();
  const prevMap = new Map(prev.map((r, i) => [key(r), { r, rank: i + 1 }]));
  const curKeys = new Set(cur.map(key));
  const q = fold(S.appsQ.trim());
  const shown = cur.map((r, i) => ({ r, rank: i + 1 })).filter(o => !q || fold(o.r.name + ' ' + o.r.pub).includes(q));
  const dropped = prev.map((r, i) => ({ r, rank: i + 1 })).filter(o => !curKeys.has(key(o.r)));
  const newCount = hasPrev ? cur.filter(r => !prevMap.has(key(r))).length : 0;
  const move = o => {
    if (!hasPrev) return '';
    const pr = prevMap.get(key(o.r));
    if (!pr) return '<span class="badge new">Yeni</span>';
    const d = pr.rank - o.rank;
    return d === 0 ? '<span class="dim">=</span>' : `<span class="mv ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`;
  };
  return `<div class="controls">${sel('appsPeriod', ps.slice().reverse().map(x => [x, plabel(x)]), p, 'Dönem')}
      ${sel('appsCat', [['', 'Tüm kategoriler'], ...cats.map(c => [c, c])], S.appsCat, 'Kategori')}
      <div class="field"><span>Sıralama</span>${seg('metric', [['rev', 'Gelir'], ['dl', 'İndirme']], m)}</div>
      <label class="field grow"><span>Ara</span><input id="appsQ" type="search" data-input="appsQ" value="${esc(S.appsQ)}" placeholder="Uygulama ya da yayıncı"></label></div>
    <div class="tiles three"><div class="tile"><span>Listelenen uygulama</span><b>${cur.length}</b><small>${plabel(p)}</small></div>
      <div class="tile"><span>Listeye yeni giren</span><b>${hasPrev ? newCount : '—'}</b><small>${hasPrev ? plabel(py) + ' listesinde yoktu' : part ? 'Yarım dönemde karşılaştırma yapılmaz' : plabel(py) + ' yüklenince hesaplanır'}</small></div>
      <div class="tile"><span>Listeden düşen</span><b>${hasPrev ? dropped.length : '—'}</b><small>${hasPrev ? plabel(py) + ' listesindeydi' : part ? 'Yarım dönemde karşılaştırma yapılmaz' : plabel(py) + ' yüklenince hesaplanır'}</small></div></div>
    <section class="card"><h3>${m === 'rev' ? 'Gelire' : 'İndirmeye'} göre sıralama · ${plabel(p)}</h3>
      <div class="tablewrap"><table><thead><tr><th>#</th><th></th><th>Uygulama</th><th>Yayıncı</th><th>Kategori</th><th class="r">Gelir</th><th class="r">İndirme</th><th class="r">Geçen yıla göre</th></tr></thead>
      <tbody>${shown.slice(0, S.appsLimit).map(o => `<tr><td class="dim">${o.rank}</td><td>${move(o)}</td><td><b>${link(o.r, esc(o.r.name))}</b></td><td>${esc(o.r.pub)}</td><td class="dim">${esc(o.r.cat)}</td>
        <td class="r num">${money(o.r.rev)}</td><td class="r num">${short(o.r.dl)}</td><td class="r">${pill(delta(o.r[m], prevMap.get(key(o.r))?.r[m]))}</td></tr>`).join('') || '<tr><td colspan="8" class="dim">Eşleşen uygulama yok.</td></tr>'}</tbody></table></div>
      ${shown.length > S.appsLimit ? `<button class="btn more" data-act="more" data-k="appsLimit" data-n="10">10 tane daha göster (${shown.length - S.appsLimit} kaldı)</button>` : ''}</section>
    ${hasPrev && dropped.length ? `<section class="card"><h3>Listeden düşenler</h3><p class="muted">${plabel(py)} listesinde olup ${plabel(p)} listesinde olmayanlar${dropped.length > 10 ? ' · ilk 10' : ''}</p>
      <div class="tablewrap"><table><thead><tr><th>Eski sıra</th><th>Uygulama</th><th>Yayıncı</th><th>Kategori</th><th class="r">${plabel(py)} geliri</th></tr></thead>
      <tbody>${dropped.slice(0, 10).map(o => `<tr><td class="dim">${o.rank}</td><td><b>${link(o.r, esc(o.r.name))}</b></td><td>${esc(o.r.pub)}</td><td class="dim">${esc(o.r.cat)}</td><td class="r num">${money(o.r.rev)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <p class="note">“Yeni” ve “düşen” ayrımı yüklenen listelerin kapsamına göredir: listede olmayan bir uygulama pazarda olmayabilir ya da yalnızca ilk sıraların dışında kalmış olabilir.</p>`;
}

function viewYayincilar() {
  const src = pubSource(), rows = src.rows;
  if (!rows.length) return empty('Yayıncı verisi yok', 'Top Publishers dışa aktarımını yükleyince yoğunlaşma oranları burada görünür.');
  const ps = periods(rows);
  fixPeriod(rows); // dönem ve aralık diğer sayfalarla ortak
  const p = S.period, py = prevYear(p);
  const stat = per => {
    const r = at(rows, per).sort((a, b) => b.rev - a.rev), t = r.reduce((s, x) => s + x.rev, 0);
    const top = n => (t ? r.slice(0, n).reduce((s, x) => s + x.rev, 0) / t : null);
    return { r, t, t10: top(10), t100: top(100) };
  };
  const fp = rangeP(rows), c = stat(p), pv = stat(isPartial(p) ? '' : py), prevMap = new Map(pv.r.map(r => [r.name.toLowerCase(), r.rev]));
  const pp = (a, b) => `${pill(b == null ? null : a - b, 'pp')} geçen yıla göre`;
  let cum = 0;
  const trend = fp.length > 1 ? `<section class="card"><h3>Yoğunlaşma trendi</h3><p class="muted">İlk 10 ve ilk 100 yayıncının toplam gelirdeki payı</p>${chart({
    labels: fp.map(plabel), fmt: v => '%' + nf(v, 0), yMax: 100,
    series: [{ name: 'İlk 10', color: COLORS[0], values: fp.map(x => stat(x).t10 * 100) }, { name: 'İlk 100', color: COLORS[1], values: fp.map(x => stat(x).t100 * 100) }] })}</section>` : '';
  const curve = `<section class="card"><h3>Yoğunlaşma eğrisi</h3><p class="muted">${plabel(p)} · yayıncılar büyükten küçüğe dizildiğinde gelirin birikimli payı</p>${plot(W => paretoChart(W, c.r.map(x => x.rev)))}</section>`;
  const byDl = [...c.r].sort((a, b) => b.dl - a.dl), dlRank = new Map(byDl.map((r, i) => [r.name, i + 1]));
  // AI kullanan ve kullanmayan yayıncılar yan yana
  const m = S.metric, f = fmtM(m), mName = m === 'rev' ? 'Gelir' : 'İndirme';
  const segStat = g => { const all = raw('publishers', g), r = at(all, p).sort((a, b) => b[m] - a[m]), sum = (rr, k) => rr.reduce((t, x) => t + x[k], 0);
    const rev = sum(r, 'rev'), dl = sum(r, 'dl'), prevR = isPartial(p) ? [] : at(all, py), byRev = [...r].sort((a, b) => b.rev - a.rev);
    return { g, all, r, n: r.length, rev, dl, rpd: dl ? rev / dl : null, top10: rev ? sum(byRev.slice(0, 10), 'rev') / rev : null, avg: r.length ? rev / r.length : null,
      yoy: prevR.length ? delta(rev, sum(prevR, 'rev')) : null }; };
  const A = segStat('ai'), B = segStat('nonai'), hasSeg = A.n || B.n;
  const h2h = (label, a, b, fmt) => { const mx = Math.max(Math.abs(a || 0), Math.abs(b || 0)) || 1, w = v => (v == null ? 0 : Math.max(2, Math.abs(v) / mx * 100));
    return `<div class="h2h"><b class="${a != null && (b == null || a >= b) ? 'lead' : ''}">${a == null ? '—' : fmt(a)}</b><span class="bar l"><i style="width:${w(a)}%;background:${SEG_COLOR.ai}"></i></span>
      <span class="what">${label}</span><span class="bar"><i style="width:${w(b)}%;background:${SEG_COLOR.nonai}"></i></span><b class="${b != null && (a == null || b > a) ? 'lead' : ''}">${b == null ? '—' : fmt(b)}</b></div>`; };
  const segCol = st => `<div class="segcol"><h4><i class="dot" style="background:${SEG_COLOR[st.g]}"></i>${SEGS[st.g]} · ilk 10</h4>
      ${st.n ? barList(st.r.slice(0, 10).map(r => ({ name: r.name, value: r[m], url: r.url })), f).replace(/<i style="width/g, `<i style="background:${SEG_COLOR[st.g]};width`) : `<p class="muted">Bu grup için ${plabel(p)} verisi yüklenmedi. Veri sayfasından “${SEGS[st.g]}” yayıncı dosyasını yükle.</p>`}</div>`;
  const segPs = rangeP([...A.all, ...B.all]), segTrend = segPs.length > 1 && A.all.length && B.all.length;
  const compare = hasSeg ? `<section class="card"><h3>AI kullanan ve kullanmayan yayıncılar · ${plabel(p)}</h3>
      <p class="muted">Solda AI kullanan, sağda AI kullanmayan yayıncılar. Çubuklar iki grubu aynı ölçekte karşılaştırır; öndeki değer kalın yazılır.</p>
      <div class="h2hhead"><span><i class="dot" style="background:${SEG_COLOR.ai}"></i>${SEGS.ai}</span><span>${SEGS.nonai}<i class="dot r" style="background:${SEG_COLOR.nonai}"></i></span></div>
      ${h2h('Toplam gelir', A.n ? A.rev : null, B.n ? B.rev : null, money)}${h2h('Toplam indirme', A.n ? A.dl : null, B.n ? B.dl : null, short)}
      ${h2h('Yayıncı sayısı', A.n || null, B.n || null, v => nf(v, 0))}${h2h('Yayıncı başına gelir', A.avg, B.avg, money)}
      ${h2h('İndirme başına gelir', A.rpd, B.rpd, v => '$' + nf(v, 2))}${h2h('İlk 10’un gelir payı', A.top10, B.top10, v => pct(v))}
      ${A.yoy != null || B.yoy != null ? h2h('Gelir değişimi (geçen yıla göre)', A.yoy, B.yoy, v => (v >= 0 ? '+' : '−') + pct(Math.abs(v))) : ''}
      <div class="grid2 segs">${segCol(A)}${segCol(B)}</div>
      ${segTrend ? `<h4 class="subhead">${mName} trendi</h4>${chart({ labels: segPs.map(plabel), fmt: f, height: 260, series: ['ai', 'nonai'].map(g => ({ name: SEGS[g], color: SEG_COLOR[g], values: segPs.map(x => { const r = at(g === 'ai' ? A.all : B.all, x); return r.length ? r.reduce((t, q) => t + q[m], 0) : null; }) })) })}` : ''}
    </section>` : `<section class="card empty"><h3>AI kullanan ve kullanmayan karşılaştırması</h3><p>Karşılaştırma için iki ayrı yayıncı dosyası yükle: biri AI kullanan, diğeri AI kullanmayan yayıncılar. Dosya adında “AI” ya da “Non-AI / AI kullanmayan” geçerse grup kendiliğinden tanınır.</p><a class="btn primary" href="#veri">Veri yükle</a></section>`;
  return `<div class="controls filters">${quarterCalendar(ps)}<div class="field"><span>Ölçü</span>${seg('metric', [['rev', 'Gelir'], ['dl', 'İndirme']], m)}</div>${S.from ? '<button type="button" class="btn small reset" data-act="resetFilters">Filtreleri sıfırla</button>' : ''}</div>
    ${src.g ? `<p class="note">Aşağıdaki genel bölümler (paylar, yoğunlaşma, sıralama) “${SEGS[src.g]}” dosyalarından hesaplanır; iki grup birbirine karıştırılmaz.</p>` : ''}
    <div class="tiles three"><div class="tile"><span>İlk 10 yayıncının payı</span><b>${pct(c.t10)}</b><small>${pp(c.t10, pv.t10)}</small></div>
      <div class="tile"><span>İlk 100 yayıncının payı</span><b>${pct(c.t100)}</b><small>${pp(c.t100, pv.t100)}</small></div>
      <div class="tile"><span>Toplam gelir · ${c.r.length} yayıncı</span><b>${money(c.t)}</b><small>${pill(delta(c.t, pv.t))} geçen yıla göre</small></div></div>
    ${compare}
    ${trend ? `<div class="grid2">${curve}${trend}</div>` : curve}
    <section class="card"><h3>Yayıncı sıralaması · ${plabel(p)}</h3>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Yayıncı</th><th class="r">Gelir</th><th class="r">Pay</th><th class="r">Kümülatif pay</th><th class="r">İndirme</th><th class="r">İndirme sırası</th><th class="r">Geçen yıla göre</th></tr></thead>
      <tbody>${c.r.slice(0, S.pubLimit).map((r, i) => { cum += r.rev; return `<tr><td class="dim">${i + 1}</td><td><b>${link(r, esc(r.name))}</b></td><td class="r num">${money(r.rev)}</td>
        <td class="r num">${pct(r.rev / c.t)}</td><td class="r num">${pct(cum / c.t)}</td><td class="r num">${short(r.dl)}</td><td class="r num dim">${dlRank.get(r.name)}.</td><td class="r">${pill(delta(r.rev, prevMap.get(r.name.toLowerCase())))}</td></tr>`; }).join('')}</tbody></table></div>
      ${c.r.length > S.pubLimit ? `<button class="btn more" data-act="more" data-k="pubLimit" data-n="75">75 tane daha göster (${c.r.length - S.pubLimit} kaldı)</button>` : ''}</section>
    <p class="note">Paylar, yüklenen dosyadaki yayıncıların toplam gelirine göre hesaplanır (pazarın tamamına göre değil).</p>${partialNote(rows)}`;
}

function viewAI() {
  const { rows, src } = aiData(), apps = data('apps');
  const tagger = () => {
    if (!apps.length) return '';
    const lp = periods(apps).at(-1), q = fold(S.aiQ.trim());
    const best = new Map();
    for (const r of apps) { const k = r.name.toLowerCase(); if (!best.has(k) || r.p === lp) best.set(k, r); }
    const list = [...best.values()].sort((a, b) => S.aiTags.has(b.name.toLowerCase()) - S.aiTags.has(a.name.toLowerCase()) || b.rev - a.rev)
      .filter(r => !q || fold(r.name + ' ' + r.pub).includes(q));
    return `<section class="card"><h3>Yapay zekâ uygulamalarını etiketle</h3>
      <p class="muted">En büyük uygulamalar listesinden yapay zekâ uygulamalarını işaretle; segment bu seçimden hesaplanır. ${S.aiTags.size} uygulama etiketli.</p>
      <div class="controls"><label class="field grow"><span>Ara</span><input id="aiQ" type="search" data-input="aiQ" value="${esc(S.aiQ)}" placeholder="Uygulama ya da yayıncı"></label>
        <button class="btn" data-act="aiSuggest">Adında “AI / GPT / Chat” geçenleri işaretle</button>${S.aiTags.size ? '<button class="btn" data-act="aiClear">Etiketleri temizle</button>' : ''}</div>
      <div class="taglist">${list.slice(0, 150).map(r => `<label><input type="checkbox" data-tag="${esc(r.name.toLowerCase())}" ${S.aiTags.has(r.name.toLowerCase()) ? 'checked' : ''}>
        <span><b>${esc(r.name)}</b><small>${esc(r.pub)}${r.cat ? ' · ' + esc(r.cat) : ''}</small></span><em>${money(r.rev)}</em></label>`).join('')}</div></section>`;
  };
  if (!rows.length) return (apps.length
    ? `<div class="card empty"><h3>Yapay zekâ segmenti henüz tanımlı değil</h3><p>Aşağıdaki listeden yapay zekâ uygulamalarını işaretle; segment bu seçimden hesaplanır.</p></div>`
    : empty('Yapay zekâ verisi yok', 'Önce “En büyük uygulamalar” verisini yükle; sonra bu sayfada yapay zekâ uygulamalarını işaretleyebilirsin.')) + tagger();

  const ps = full(rows).slice(-8), last = ps.at(-1), m = S.metric, f = fmtM(m);
  const mkt = market(), share = tot(mkt, last, 'rev') ? tot(rows, last, 'rev') / tot(mkt, last, 'rev') : null;
  const yoy = k => `${pill(delta(tot(rows, last, k), tot(rows, prevYear(last), k)))} geçen yıla göre`;
  const top = at(rows, last).sort((a, b) => b[m] - a[m]).slice(0, 10);
  return `<div class="controls">${seg('metric', [['rev', 'Gelir'], ['dl', 'İndirme']], m)}
      <span class="muted">${src === 'segment' ? 'Kaynak: yüklenen Sensor Tower AI segmenti' : `Kaynak: elle etiketlenen ${S.aiTags.size} uygulama`}</span></div>
    <div class="tiles three"><div class="tile"><span>AI geliri · ${plabel(last)}</span><b>${money(tot(rows, last, 'rev'))}</b><small>${yoy('rev')}</small></div>
      <div class="tile"><span>AI indirmesi · ${plabel(last)}</span><b>${short(tot(rows, last, 'dl'))}</b><small>${yoy('dl')}</small></div>
      <div class="tile"><span>Toplam pazar gelirindeki pay</span><b>${share == null ? '—' : pct(share)}</b><small>${share == null ? 'Kategori verisi yüklenince hesaplanır' : plabel(last)}</small></div></div>
    ${ps.length > 1 ? `<section class="card"><h3>Çeyreklik AI ${m === 'rev' ? 'geliri' : 'indirmesi'}</h3><p class="muted">${plabel(ps[0])} – ${plabel(last)} · segment toplamı</p>
      ${chart({ labels: ps.map(plabel), fmt: f, series: [{ name: 'Yapay zekâ', color: COLORS[0], values: ps.map(p => tot(rows, p, m)) }] })}</section>` : ''}
    <section class="card"><h3>Segmentin en büyükleri · ${plabel(last)}</h3>${barList(top.map(r => ({ name: r.name, sub: r.pub, value: r[m], url: r.url })), f)}</section>
    ${src === 'tags' ? tagger() : ''}${partialNote(rows)}`;
}

function viewVeri() {
  const kind = f => (/revenue|gelir/i.test(f.name) ? 'rev' : /download|indirme/i.test(f.name) ? 'dl' : '');
  const allP = [...new Set(FILES.flatMap(f => f.periods))].sort().reverse();
  if (!allP.includes(S.fPeriod)) S.fPeriod = '';
  const match = f => (!S.fMetric || kind(f) === S.fMetric) && (!S.fPeriod || f.periods.includes(S.fPeriod));
  const shownCount = FILES.filter(match).length;
  const card = (type, i) => {
    const all = FILES.filter(f => f.type === type), files = all.filter(match).sort((a, b) => (b.periods.at(-1) || '').localeCompare(a.periods.at(-1) || '') || a.name.localeCompare(b.name));
    return `<section class="card drop" data-drop="${type}"><div class="drophead"><div><h3>${i} · ${TYPES[type].title}</h3><p class="muted">${TYPES[type].hint}</p></div>
      <button class="btn" data-act="pick" data-type="${type}">${type === 'publishers' ? 'Grupsuz yükle' : 'Bu türe yükle'}</button></div>
      ${type === 'publishers' ? `<div class="segzones">${Object.keys(SEGS).map(g => `<div class="segzone" data-drop="publishers" data-seg="${g}">
        <b><i class="dot" style="background:${SEG_COLOR[g]}"></i>${SEGS[g]} yayıncılar</b><small>${all.filter(x => x.group === g).length} dosya yüklü</small>
        <button class="btn primary small" data-act="pick" data-type="publishers" data-seg="${g}">Dosya seç</button><small>ya da dosyaları bu kutuya sürükle</small></div>`).join('')}</div>` : ''}
      ${files.length ? '' : `<p class="dropnote">${all.length ? `Bu filtreyle eşleşen dosya yok (${all.length} dosya gizli).` : 'Henüz dosya yok.'}</p>`}
      ${files.length ? `<ul class="files scroll">${files.map(f => `<li><span><b>${esc(f.name)}</b><small>${groupLabel(f.group) ? groupLabel(f.group) + ' · ' : ''}${f.periods.length > 1 ? plabel(f.periods[0]) + ' – ' + plabel(f.periods.at(-1)) : plabel(f.periods[0])} · ${f.rows.length} satır${f.sample ? ' · örnek' : ''}</small></span>
        <button class="btn small" data-act="del" data-id="${esc(f.id)}">Sil</button></li>`).join('')}</ul>` : ''}</section>`;
  };
  return `<div class="pagehead"><div><h2>Veri</h2><p class="muted">Sensor Tower CSV dosyalarını toplu yükle. Aynı çeyrek tekrar yüklenirse yeni dosyadaki değerler geçerli olur.</p></div>
    <div class="row">${FILES.length ? '' : '<button class="btn" data-act="sample">Örnek veri yükle</button>'}${FILES.length ? '<button class="btn danger" data-act="clear">Tüm veriyi sil</button>' : ''}</div></div>
    <section class="card drop bulk" data-drop=""><div class="drophead"><div><h3>Toplu yükleme</h3>
      <p class="muted">Tüm CSV dosyalarını tek seferde seç ya da bu kutuya sürükle. Her dosyanın türü (kategori, uygulama, yayıncı) ve çeyreği otomatik tanınır.</p></div>
      <button class="btn primary" data-act="pick" data-type="">Dosyaları seç</button></div>${batchPanel()}</section>
    ${FILES.length ? `<div class="controls filebar"><h3 class="subhead">Yüklü dosyalar</h3>
      ${seg('fMetric', [['', 'Tümü'], ['rev', 'Revenue'], ['dl', 'Downloads']], S.fMetric)}
      ${sel('fPeriod', [['', 'Tüm çeyrekler'], ...allP.map(x => [x, plabel(x)])], S.fPeriod, 'Çeyrek')}
      <span class="muted">${FILES.length} dosyadan ${shownCount} tanesi gösteriliyor</span></div>` : ''}
    ${Object.keys(TYPES).map((t, i) => card(t, i + 1)).join('')}`;
}

/* ---------- İçe aktarma: toplu yükleme + düzeltme penceresi ---------- */
function quarterOptions() {
  const o = [];
  for (let y = new Date().getFullYear() + 1; y >= 2020; y--) for (let q = 4; q >= 1; q--) o.push(`${y}-Q${q}`);
  return o;
}
function detectType(headers, fn) {
  const has = re => headers.some(h => re.test(h) && !/\bid\b/i.test(h));
  if (has(/^unified name$|app name|^app$/i)) return 'apps';
  if (has(/publisher|yayıncı/i)) return 'publishers';
  return 'category';
}
/* Yayıncı dosyasının grubu dosya adından: önce "AI kullanmayan" kalıpları, sonra "AI" */
function detectSeg(fn) {
  if (/(non|no|not|without|ex|excl\w*)[\s_.-]*ai([^a-z]|$)|ai[\s_.-]*(olmayan|kullanmayan|hari[cç]|d[ıi][sş][ıi]|siz|s[ıi]z)|kullanmayan|yapay zek[aâ]s[ıi]z/i.test(fn)) return 'nonai';
  if (/(^|[^a-z])(ai|genai)([^a-z]|$)|yapay|kullanan|generative/i.test(fn)) return 'ai';
  return '';
}
function retype(imp, type) {
  const H = imp.parsed.headers;
  imp.type = type;
  imp.map = Parse.guess(H, type);
  imp.fnPeriod = Parse.toQuarter(imp.name);
  imp.map.period = imp.fnPeriod || quarterOptions()[5];
  imp.map.catText = '';
  if (type !== 'category') imp.map.dev = imp.map.ctry = -1;
  if (type === 'category') imp.map.url = -1;
  else if (imp.map.url < 0) imp.map.url = H.findIndex((h, i) => imp.parsed.rows.slice(0, 20).some(r => /^https?:\/\//i.test(String(r[i] || '').trim()))); // başlıktan bulunamadıysa içerikten
  const h = H[imp.map.name] || '';
  imp.group = 'app';
  if (imp.seg == null) imp.seg = detectSeg(imp.name);
  imp.gameFile = type === 'category' && /genre/i.test(h); // oyun türü / alt türü dosyası
  return imp;
}
async function prepare(file, type, seg) {
  let parsed;
  try { parsed = Parse.parseCSV(Parse.decode(await file.arrayBuffer())); } catch (e) { parsed = { headers: [], rows: [] }; }
  return retype({ name: file.name, parsed, seg }, type || detectType(parsed.headers, file.name)); // seg verilmişse dosya adı tahmininin yerine geçer
}
/* strict: otomatik yüklemede dönem de kesin bulunmalı */
function check(imp, strict) {
  const { parsed, map, type } = imp, errs = [];
  imp.norm = Parse.normalize(parsed, map);
  const before = imp.norm.rows.length; // oyun satırları hiç saklanmaz
  if (type === 'category') imp.norm.rows = imp.norm.rows.filter(r => !isGames(r.name));
  if (type === 'apps') imp.norm.rows = imp.norm.rows.filter(r => !isGames(r.cat));
  imp.norm.games = before - imp.norm.rows.length;
  if (!parsed.headers.length || !parsed.rows.length) errs.push('Dosya okunamadı ya da boş.');
  else {
    if (imp.gameFile) errs.push('Bu dosya oyun türlerini içeriyor; oyun verisi siteye alınmıyor.');
    if (map.name < 0) errs.push(`“${TYPES[type].nameLabel}” sütunu bulunamadı.`);
    if (map.rev < 0 && map.dl < 0) errs.push('Gelir ya da indirme sütunu bulunamadı.');
    if (strict && map.date < 0 && !imp.fnPeriod) errs.push('Dönem bulunamadı; çeyreği elle seç.');
    if (!errs.length && !imp.norm.rows.length) errs.push(imp.norm.games ? 'Dosyada yalnızca oyun satırları var; oyun verisi siteye alınmıyor.' : 'Okunabilen satır çıkmadı; tarih sütununu kontrol et.');
  }
  return errs;
}
async function store(imp) {
  const rec = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), type: imp.type, group: imp.type === 'category' ? imp.group : imp.type === 'publishers' ? imp.seg : '',
    name: imp.name, addedAt: Date.now(), rows: imp.norm.rows, periods: periods(imp.norm.rows) };
  await DB.put(rec);
  return rec;
}
async function dropSamples() { for (const f of FILES.filter(f => f.sample)) await DB.del(f.id); } // gerçek veri gelince örnek veri kalkar
async function bulkImport(files, type, seg) {
  const batch = [];
  for (const file of files) {
    const imp = await prepare(file, type, seg), errs = check(imp, true);
    batch.push({ imp, errs, rec: errs.length ? null : await store(imp) });
  }
  if (batch.some(b => b.rec)) await dropSamples();
  S.batch = batch; S.batchOpen = false;
  if (currentView() !== 'veri') location.hash = '#veri';
  await reload();
}
function openFix(i) {
  S.impIdx = i; S.imp = S.batch[i].imp;
  renderDialog();
  if (!$('#dlg').open) $('#dlg').showModal();
}
function renderDialog() {
  const imp = S.imp, { type, name, parsed, map, group } = imp, H = parsed.headers;
  const errs = check(imp, false), norm = imp.norm, ps = periods(norm.rows);
  const colSel = (k, label, noneLabel) => `<label class="field"><span>${label}</span><select data-map="${k}">
    <option value="-1">${noneLabel || '— yok —'}</option>${H.map((h, i) => `<option value="${i}" ${map[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`;
  $('#dlgBody').innerHTML = `<h3>Dosyayı eşleştir</h3><p class="muted fname">${esc(name)} · ${parsed.rows.length} satır</p>
    <div class="mapgrid">
      <label class="field"><span>Veri türü</span><select data-imp="type">${Object.entries(TYPES).map(([v, t]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${t.title}</option>`).join('')}</select></label>
      ${type === 'publishers' ? `<label class="field"><span>Yayıncı grubu</span><select data-imp="seg"><option value="">Genel (grupsuz)</option>${Object.entries(SEGS).map(([v, l]) => `<option value="${v}" ${v === imp.seg ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      ${colSel('name', TYPES[type].nameLabel)}
      ${type === 'apps' ? colSel('pub', 'Yayıncı') + colSel('cat', 'Kategori', '— elle yaz —') : ''}
      ${type === 'apps' && map.cat < 0 ? `<label class="field"><span>Kategori adı</span><input data-mapText="catText" value="${esc(map.catText)}" placeholder="örn. Productivity"></label>` : ''}
      ${type !== 'category' ? colSel('url', 'Link (isteğe bağlı)') : ''}${colSel('rev', 'Gelir ($)')}${colSel('dl', 'İndirme')}${colSel('date', 'Tarih / çeyrek', '— elle seç —')}
      ${map.date < 0 ? `<label class="field"><span>Dönem</span><select data-mapPeriod>${quarterOptions().map(q => `<option value="${q}" ${q === map.period ? 'selected' : ''}>${plabel(q)}</option>`).join('')}</select></label>` : ''}
    </div>
    ${errs.length ? `<p class="err">${errs.join(' ')}</p>` : `<div class="preview"><p><b>${norm.rows.length}</b> kayıt · dönemler: <b>${ps.map(plabel).join(', ')}</b>${norm.skipped ? ` · ${norm.skipped} satır atlandı (ad ya da tarih boş)` : ''}${norm.games ? ` · ${norm.games} oyun satırı atıldı` : ''}</p>
      <table><thead><tr><th>Dönem</th><th>Ad</th>${type === 'apps' ? '<th>Yayıncı</th><th>Kategori</th>' : ''}<th class="r">Gelir</th><th class="r">İndirme</th></tr></thead>
      <tbody>${norm.rows.slice(0, 4).map(r => `<tr><td>${plabel(r.p)}</td><td>${esc(r.name)}</td>${type === 'apps' ? `<td>${esc(r.pub)}</td><td>${esc(r.cat)}</td>` : ''}<td class="r num">${money(r.rev)}</td><td class="r num">${short(r.dl)}</td></tr>`).join('')}</tbody></table></div>`}
    <div class="row end"><button type="button" class="btn" data-act="impClose">Vazgeç</button>
      <button type="button" class="btn primary" data-act="impSave" ${errs.length ? 'disabled' : ''}>Kaydet</button></div>`;
}
async function saveImport() {
  const item = S.batch[S.impIdx];
  if (item.rec) await DB.del(item.rec.id);
  item.rec = await store(S.imp); item.errs = [];
  await dropSamples();
  S.imp = null; $('#dlg').close();
  await reload();
}
function batchPanel() {
  const b = S.batch;
  if (!b.length) return '';
  const ok = b.filter(x => x.rec).length, wait = b.length - ok;
  return `<p class="batchsum"><b>${b.length} dosyadan ${ok} tanesi yüklendi.</b>${wait ? ` ${wait} dosya eşleştirme bekliyor.` : ' Tür ya da çeyrek yanlış tanındıysa “Düzelt” ile değiştir.'}</p>
    ${ok ? `<button class="btn small" data-act="toggle" data-k="batchOpen">${S.batchOpen ? 'Yüklenenleri gizle' : `Yüklenen ${ok} dosyayı göster`}</button>` : ''}
    <ul class="files batch scroll">${b.map((x, i) => { const m = x.rec; if (m && !S.batchOpen) return ''; return `<li><i class="st ${m ? 'ok' : 'wait'}" aria-hidden="true">${m ? '✓' : '!'}</i>
      <span><b>${esc(x.imp.name)}</b><small>${m ? `${TYPES[m.type].title.replace(' (isteğe bağlı)', '')}${groupLabel(m.group) ? ' · ' + groupLabel(m.group) : ''} · ${m.periods.length > 1 ? plabel(m.periods[0]) + ' – ' + plabel(m.periods.at(-1)) : plabel(m.periods[0])} · ${m.rows.length} kayıt` : `<span class="errtxt">Yüklenmedi: ${esc(x.errs.join(' '))}</span>`}</small></span>
      <button class="btn small ${m ? '' : 'primary'}" data-act="fix" data-i="${i}">${m ? 'Düzelt' : 'Eşleştir'}</button></li>`; }).join('')}</ul>`;
}

/* ---------- Çizim ve olaylar ---------- */
function currentView() { const h = location.hash.slice(1); return VIEWS.some(v => v[0] === h) ? h : 'ozet'; }
function render() {
  const v = currentView(), a = document.activeElement, fid = a && a.id, pos = a && a.selectionStart;
  $('#nav').innerHTML = VIEWS.map(([k, l]) => `<a href="#${k}" class="${k === v ? 'on' : ''}" ${k === v ? 'aria-current="page"' : ''}>${l}</a>`).join('');
  $('#banner').innerHTML = FILES.some(f => f.sample) ? `<div class="banner"><span><b>Örnek veri gösteriliyor.</b> Rakamlar uydurmadır; ilk gerçek CSV yüklendiğinde otomatik silinir.</span><button class="btn small" data-act="clearSample">Örnek veriyi kaldır</button></div>` : '';
  after = [];
  $('#app').innerHTML = { ozet: viewOzet, kategoriler: viewKategoriler, uygulamalar: viewUygulamalar, yayincilar: viewYayincilar, ai: viewAI, veri: viewVeri }[v]();
  after.forEach(f => f());
  paintCal();
  for (const ml of document.querySelectorAll('.multilist, .calpop')) { // açılır kutular ekranın sağından taşmasın
    if (!ml.offsetParent) continue; const r = ml.getBoundingClientRect(); if (r.right > innerWidth - 12) ml.style.left = (innerWidth - 12 - r.right) + 'px'; }
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
}
const saveTags = () => localStorage.setItem('pa-ai-tags', JSON.stringify([...S.aiTags]));

document.addEventListener('click', async e => {
  if (S.catsOpen && !e.target.closest('.multi')) { S.catsOpen = false; render(); }
  if (S.calOpen && !e.target.closest('.cal')) { S.calOpen = false; S.calPick = ''; render(); }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = b.dataset;
  switch (d.act) {
    case 'set': S[d.k] = d.v; render(); break;
    case 'toggle': S[d.k] = !S[d.k]; render(); break;
    case 'resetFilters': S.cats.clear(); S.fDev = S.fCtry = S.period = S.from = S.calPick = ''; S.cmp = 'yoy'; S.catsOpen = S.calOpen = false; render(); break;
    case 'pickPeriod': if (!S.calPick) S.calPick = d.v; else setRange(S.calPick, d.v); render(); break; // ilk tıklama başlangıç, ikincisi bitiş
    case 'calPreset': setRange(d.a, d.b); render(); break;
    case 'catToggle': S.cats.has(d.key) ? S.cats.delete(d.key) : S.cats.add(d.key); render(); break;
    case 'catsClear': S.cats.clear(); render(); break;
    case 'more': S[d.k] += +d.n; render(); break;
    case 'pick': S.pickType = d.type; S.pickSeg = d.seg || ''; $('#filePick').value = ''; $('#filePick').click(); break;
    case 'sample': for (const f of Sample.build()) await DB.put(f); await reload(); if (currentView() === 'veri') location.hash = '#ozet'; break;
    case 'clearSample': for (const f of FILES.filter(f => f.sample)) await DB.del(f.id); await reload(); break;
    case 'del': if (confirm('Bu dosya silinsin mi?')) { await DB.del(d.id); S.batch = S.batch.filter(x => !x.rec || x.rec.id !== d.id); await reload(); } break;
    case 'clear': if (confirm('Yüklenen tüm veri bu tarayıcıdan silinecek. Emin misin?')) { await DB.clear(); S.batch = []; await reload(); } break;
    case 'impSave': await saveImport(); break;
    case 'impClose': S.imp = null; $('#dlg').close(); break;
    case 'fix': openFix(+d.i); break;
    case 'aiSuggest': data('apps').forEach(r => { if (/(^|[^a-z])(ai|gpt|chat|chatbot|copilot|gemini|claude|assistant)([^a-z]|$)/i.test(r.name)) S.aiTags.add(r.name.toLowerCase()); }); saveTags(); render(); break;
    case 'aiClear': S.aiTags.clear(); saveTags(); render(); break;
  }
});
document.addEventListener('mouseover', e => { if (!S.calPick) return; const b = e.target.closest && e.target.closest('.c2grid button:not(:disabled)'); if (b) paintCal(b.dataset.v); });
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('g.tm[data-act]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.set) { S[t.dataset.set] = t.value; if (t.dataset.set === 'appsPeriod' || t.dataset.set === 'appsCat') S.appsLimit = 10; render(); }
  else if (t.dataset.map) { S.imp.map[t.dataset.map] = +t.value; renderDialog(); }
  else if (t.dataset.imp === 'type') { retype(S.imp, t.value); renderDialog(); }
  else if (t.dataset.imp) { S.imp[t.dataset.imp] = t.value; }
  else if ('mapperiod' in t.dataset) { S.imp.map.period = t.value; renderDialog(); }
  else if (t.dataset.maptext) { S.imp.map[t.dataset.maptext === 'cattext' ? 'catText' : t.dataset.maptext] = t.value; renderDialog(); }
  else if (t.dataset.cat) { const sc = t.closest('.multilist').scrollTop; t.checked ? S.cats.add(t.dataset.cat) : S.cats.delete(t.dataset.cat); render(); const ml = $('.multilist'); if (ml) ml.scrollTop = sc; }
  else if (t.dataset.tag) { t.checked ? S.aiTags.add(t.dataset.tag) : S.aiTags.delete(t.dataset.tag); saveTags(); render(); }
  else if (t.id === 'filePick' && t.files.length) bulkImport([...t.files], S.pickType || undefined, S.pickSeg || undefined);
});
document.addEventListener('input', e => { const k = e.target.dataset.input; if (k) { S[k] = e.target.value; render(); } });
document.addEventListener('dragover', e => { const z = e.target.closest('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
document.addEventListener('dragleave', e => { const z = e.target.closest('[data-drop]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
document.addEventListener('drop', e => {
  const z = e.target.closest('[data-drop]');
  e.preventDefault();
  if (z) { z.classList.remove('over'); if (e.dataTransfer.files.length) bulkImport([...e.dataTransfer.files], z.dataset.drop || undefined, z.dataset.seg || undefined); }
});
document.addEventListener('toggle', e => {
  const c = e.target.classList, k = c && (c.contains('multi') ? 'catsOpen' : c.contains('cal') ? 'calOpen' : '');
  if (k && S[k] !== e.target.open) { S[k] = e.target.open; if (k === 'calOpen') S.calPick = ''; render(); }
}, true);
document.addEventListener('mousemove', e => {
  const t = e.target.closest && e.target.closest('[data-tip]'), tip = $('#tip');
  if (!t) { if (tip.dataset.src) { tip.hidden = true; tip.dataset.src = ''; } return; }
  tip.dataset.src = '1'; tip.textContent = t.dataset.tip; tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = (e.clientX + 16 + tw > innerWidth ? e.clientX - tw - 16 : e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 12) + 'px';
});
$('#dlg').addEventListener('cancel', () => { S.imp = null; });
window.addEventListener('hashchange', render);
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });

DB.open().then(purgeGames).then(reload).catch(() => { $('#app').innerHTML = '<div class="card empty"><h3>Tarayıcı depolaması açılamadı</h3><p>Gizli pencere kullanıyorsan normal pencerede dene.</p></div>'; });
