/* CSV okuma, sütun tahmini ve çeyrek dönüşümü */
const Parse = (() => {
  function decode(buf) {
    const b = new Uint8Array(buf);
    let enc = 'utf-8';
    if (b[0] === 0xff && b[1] === 0xfe) enc = 'utf-16le';
    else if (b[0] === 0xfe && b[1] === 0xff) enc = 'utf-16be';
    else if (b.length > 3 && b[1] === 0 && b[3] === 0) enc = 'utf-16le'; // BOM'suz UTF-16
    let text = new TextDecoder(enc).decode(buf);
    // UTF-8 değilse (Excel'in Türkçe Windows kaydı) ş, ğ, ı, İ bozulmasın diye windows-1254 denenir
    if (enc === 'utf-8' && text.includes('\uFFFD')) { try { text = new TextDecoder('windows-1254').decode(buf); } catch (e) {} }
    return text.replace(/^﻿/, '');
  }

  function detectDelimiter(text) {
    const line = text.slice(0, text.search(/\r?\n/) >>> 0 || text.length);
    let best = ',', n = -1;
    for (const d of ['\t', ',', ';']) {
      const c = line.split(d).length;
      if (c > n) { n = c; best = d; }
    }
    return best;
  }

  function parseCSV(text) {
    const d = detectDelimiter(text);
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(c => c.trim() !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row);
    const headers = (rows.shift() || []).map(h => h.trim());
    return { headers, rows };
  }

  function num(s) {
    if (s == null) return 0;
    let t = String(s).trim();
    if (!t) return 0;
    const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
    t = t.replace(/[()$€£%\s,-]/g, '');
    let mul = 1;
    const m = t.match(/([kmb])$/i);
    if (m) { mul = { k: 1e3, m: 1e6, b: 1e9 }[m[1].toLowerCase()]; t = t.slice(0, -1); }
    const v = parseFloat(t);
    return isNaN(v) ? 0 : (neg ? -v : v) * mul;
  }

  const q = (y, m) => `${y}-Q${Math.ceil(m / 3)}`;
  function toQuarter(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    let m;
    if ((m = s.match(/(\d{4})\s*[-_ ]?\s*[QÇ]\s*([1-4])/i))) return `${m[1]}-Q${m[2]}`;
    if ((m = s.match(/[QÇ]\s*([1-4])\s*[-_ ']?\s*(\d{4})/i))) return `${m[2]}-Q${m[1]}`;
    if ((m = s.match(/(\d{4})-(\d{1,2})(?:-\d{1,2})?/))) return +m[2] >= 1 && +m[2] <= 12 ? q(+m[1], +m[2]) : null;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      const mo = +m[1] > 12 ? +m[2] : +m[1]; // Sensor Tower: ay/gün/yıl
      return q(y, mo);
    }
    const dt = new Date(s);
    return isNaN(dt) ? null : q(dt.getFullYear(), dt.getMonth() + 1);
  }

  const BAD_METRIC = /change|growth|prior|rpd|ratio|share|%|arpu|rank/i;
  function pick(headers, tests, exclude) {
    for (const re of tests) {
      const i = headers.findIndex(h => re.test(h) && !(exclude && exclude.test(h)));
      if (i >= 0) return i;
    }
    return -1;
  }

  /* Dosya türüne göre sütun tahmini. -1 = bulunamadı */
  function guess(headers, type) {
    const ID = /\bid\b/i;
    const nameTests = {
      apps: [/^unified name$/i, /app name/i, /^app$/i, /^name$/i, /unified name/i, /uygulama/i],
      publishers: [/^unified publisher name$/i, /^publisher name$/i, /publisher|yayıncı/i],
      category: [/sub-?genre/i, /genre/i, /^category/i, /categor|kategori/i, /^name$/i],
      ai: [/segment|taxonomy|tag|label/i, /^unified name$/i, /app name/i, /^name$/i, /categor/i],
    }[type];
    return {
      name: pick(headers, nameTests, ID),
      pub: type === 'apps' ? pick(headers, [/^unified publisher name$/i, /^publisher name$/i, /publisher|yayıncı/i], ID) : -1,
      cat: type === 'apps' ? pick(headers, [/sub-?genre/i, /genre/i, /^category/i, /categor|kategori/i], ID) : -1,
      rev: pick(headers, [/^absolute \(revenue/i, /^revenue \(absolute/i, /^revenue\b/i, /revenue|gelir/i], BAD_METRIC),
      dl: pick(headers, [/^absolute \(downloads/i, /^downloads \(absolute/i, /^downloads\b/i, /downloads|indirme/i], BAD_METRIC),
      date: pick(headers, [/^date$/i, /quarter|period|çeyrek|dönem|tarih/i, /date/i]),
      dev: pick(headers, [/^device$/i, /device|cihaz/i], ID),
      ctry: pick(headers, [/country|ülke/i], ID),
      url: pick(headers, [/^(app |store |unified )?(url|link)$/i, /url|link|bağlantı/i]),
    };
  }

  /* Ham satırları {p,name,pub,cat,rev,dl} satırlarına indirger; aynı çeyrek+ad toplanır */
  function normalize(parsed, map) {
    const acc = new Map(); let skipped = 0;
    const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    for (const r of parsed.rows) {
      const name = cell(r, map.name);
      const p = map.date >= 0 ? toQuarter(cell(r, map.date)) : map.period;
      if (!name || !p) { skipped++; continue; }
      const pub = cell(r, map.pub), dev = cell(r, map.dev ?? -1), ctry = cell(r, map.ctry ?? -1);
      const key = p + '|' + name + '|' + pub + '|' + dev + '|' + ctry;
      let o = acc.get(key);
      if (!o) acc.set(key, o = { p, name, pub, cat: map.cat >= 0 ? cell(r, map.cat) : (map.catText || ''), rev: 0, dl: 0 });
      if (dev) o.dev = dev;
      if (ctry) o.ctry = ctry;
      const url = cell(r, map.url ?? -1);
      if (!o.url && /^https?:\/\//i.test(url)) o.url = url; // yalnızca http(s) bağlantıları saklanır
      o.rev += num(cell(r, map.rev));
      o.dl += num(cell(r, map.dl));
    }
    return { rows: [...acc.values()], skipped };
  }

  return { decode, parseCSV, guess, normalize, toQuarter, num };
})();
