/* Market Intelligence v2 — single-file app. Shares the IndexedDB store with the classic view. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PAL = ['#7B5BD9', '#D9884A', '#C774BF', '#3FA58C', '#5A82D4', '#97A04A'], OTHER = '#D6D3E1', GOOD = '#3FA58C', BAD = '#D9796F'; // soft but validated for colour-blind separation
  const SEG = { ai: 'AI kullanan', nonai: 'AI kullanmayan' }, SEGC = { ai: '#7B5BD9', nonai: '#D9884A' };
  const TYPE = { category: 'Kategori pazar büyüklüğü', apps: 'En büyük uygulamalar', publishers: 'En büyük yayıncılar' };
  const VIEWS = [
    ['overview', 'Pazar Özeti', '<path d="M2 13.5h12M4 11V7M8 11V3M12 11V5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>'],
    ['apps', 'Uygulamalar', '<rect x="2" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/>'],
    ['publishers', 'Yayıncı Yoğunlaşması', '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2v6l4.5 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>'],
    ['ai', 'Yapay Zekâ Segmenti', '<path d="M8 1.8l1.6 4.6 4.6 1.6-4.6 1.6L8 14.2 6.4 9.6 1.8 8l4.6-1.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'],
    ['data', 'Veri Yönetimi', '<ellipse cx="8" cy="4" rx="5.5" ry="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 4v8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4M2.5 8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2" fill="none" stroke="currentColor" stroke-width="1.5"/>'],
  ];
  const AI_RE = /(^|[^a-z])(ai|chatbot|chat ?bot|copilot|gemini|claude|llm|genai|assistant)([^a-z]|$)|gpt/i; // "gpt" anywhere, so ChatGPT counts

  /* ---------- state ---------- */
  const F = { metric: 'both', period: '', from: '', pick: '', cal: false, cmp: 'yoy', dev: '', ctry: '', pop: false, appCat: '', appQ: '', appLim: 10, pubQ: '', pubLim: 10, catLim: 10, tagQ: '', tagOnly: '', sort: { cat: ['v', -1] } };
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const AI = { tags: new Set(ls('pa-ai-tags', [])), ex: new Set(ls('pa-ai-ex', [])), auto: ls('pa-ai-auto', true) };
  const saveAI = () => { aiMemo = new Map(); cache = {}; localStorage.setItem('pa-ai-tags', JSON.stringify([...AI.tags])); localStorage.setItem('pa-ai-ex', JSON.stringify([...AI.ex])); localStorage.setItem('pa-ai-auto', JSON.stringify(AI.auto)); };
  let FILES = [], cache = {}, after = [], STAGE = [], CTX = { P: [], p: '' };
  const PICK = ls('pa-app-compare', []); // up to 5 app names (lowercase) chosen for comparison
  const savePick = () => localStorage.setItem('pa-app-compare', JSON.stringify(PICK));

  /* ---------- storage ---------- */
  const DB = (() => {
    let db;
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pazar-analizi', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' }); r.onsuccess = () => res(db = r.result); r.onerror = () => rej(r.error); });
    const tx = (mode, fn) => new Promise((res, rej) => { const t = db.transaction('files', mode), rq = fn(t.objectStore('files')); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); });
    return { open, all: () => tx('readonly', s => s.getAll()), put: r => tx('readwrite', s => s.put(r)), del: id => tx('readwrite', s => s.delete(id)), clear: () => tx('readwrite', s => s.clear()) };
  })();
  const isGames = n => /^(games?|oyun(lar)?)(\s*[\/:>–-].*)?$/i.test(String(n || '').trim());
  async function purge() { // games rows/files and the retired 'ai' upload type are never kept
    for (const f of await DB.all()) {
      if ((f.type === 'category' && f.group && f.group !== 'app') || f.type === 'ai') { await DB.del(f.id); continue; }
      const keep = f.type === 'category' ? f.rows.filter(r => !isGames(r.name)) : f.type === 'apps' ? f.rows.filter(r => !isGames(r.cat)) : f.rows;
      if (keep.length === f.rows.length) continue;
      if (!keep.length) await DB.del(f.id); else await DB.put({ ...f, rows: keep, periods: [...new Set(keep.map(r => r.p))].sort() });
    }
  }
  async function reload() { FILES = await DB.all(); cache = {}; render(); }

  /* ---------- data ---------- */
  function raw(type, group) {
    const k = 'raw|' + type + '|' + String(group);
    if (cache[k]) return cache[k];
    const m = new Map();
    FILES.filter(f => f.type === type && (group == null || (f.group || '') === group)).sort((a, b) => a.addedAt - b.addedAt)
      .forEach(f => f.rows.forEach(r => m.set(r.p + '|' + r.name.toLowerCase() + '|' + (r.dev || '') + '|' + (r.ctry || ''), r)));
    let rows = [...m.values()];
    if (type === 'category') { const dimP = new Set(rows.filter(r => r.dev || r.ctry).map(r => r.p)); rows = rows.filter(r => (r.dev || r.ctry || !dimP.has(r.p)) && !isGames(r.name)); }
    else if (type === 'apps') rows = rows.filter(r => !isGames(r.cat));
    return cache[k] = rows;
  }
  function catRows() { // category rows after device/country filters, summed to quarter + category
    const k = 'cat|' + F.dev + '|' + F.ctry;
    if (cache[k]) return cache[k];
    const acc = new Map();
    for (const r of raw('category', 'app')) {
      if ((F.dev && r.dev !== F.dev) || (F.ctry && r.ctry !== F.ctry)) continue;
      const key = r.p + '|' + r.name; let o = acc.get(key);
      if (!o) acc.set(key, o = { p: r.p, name: r.name, rev: 0, dl: 0 });
      o.rev += r.rev; o.dl += r.dl;
    }
    return cache[k] = [...acc.values()];
  }
  let regionNames; try { regionNames = new Intl.DisplayNames(['tr'], { type: 'region' }); } catch (e) {}
  function dims() {
    if (cache.dims) return cache.dims;
    const d = new Set(), c = new Set();
    for (const r of raw('category', 'app')) { if (r.dev) d.add(r.dev); if (r.ctry) c.add(r.ctry); }
    const nm = x => { try { return (/^[A-Z]{2}$/.test(x) && regionNames.of(x)) || x; } catch (e) { return x; } };
    return cache.dims = { devs: [...d].sort(), ctrys: [...c].map(x => [x, nm(x)]).sort((a, b) => a[1].localeCompare(b[1])) };
  }
  function pubSource() { for (const g of ['', 'ai', 'nonai']) { const rows = raw('publishers', g); if (rows.length) return { rows, g }; } return { rows: [], g: '' }; }
  let aiMemo = new Map();
  const isAI = r => { let v = aiMemo.get(r.name); if (v === undefined) { const k = r.name.toLowerCase(); aiMemo.set(r.name, v = AI.tags.has(k) || (AI.auto && !AI.ex.has(k) && AI_RE.test(r.name))); } return v; };

  const periods = rows => { const s = new Set(); for (const r of rows) s.add(r.p); return [...s].sort(); };
  const isPartial = p => new Date() < new Date(+p.slice(0, 4), +p.slice(6) * 3, 1);
  const prevYear = p => (+p.slice(0, 4) - 1) + p.slice(4);
  const prevQ = p => { const y = +p.slice(0, 4), q = +p.slice(6); return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`; };
  const ql = p => (p ? p.replace('-Q', ' Ç') + (isPartial(p) ? ' (yarım)' : '') : '');
  /* rows of one quarter; indexed once per array because app files hold 10,000 rows per quarter */
  const idx = new WeakMap();
  const at = (rows, p) => { let m = idx.get(rows); if (!m) { m = new Map(); for (const r of rows) { let a = m.get(r.p); if (!a) m.set(r.p, a = []); a.push(r); } idx.set(rows, m); } return (m.get(p) || []).slice(); };
  const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
  const delta = (a, b) => (b > 0 ? (a - b) / b : null);
  /* The quarter each view shows: the bar's choice if that dataset has it, else its latest complete quarter */
  function ctx(rows) {
    const P = periods(rows), full = P.filter(x => !isPartial(x));
    const p = P.includes(F.period) ? F.period : (full.at(-1) || P.at(-1) || '');
    const from = F.from && P.includes(F.from) && F.from < p ? F.from : '';
    // a range picked in the calendar compares its end quarter with its start quarter
    const c = !p || isPartial(p) ? null : from ? (isPartial(from) ? null : from) : F.cmp === 'yoy' ? prevYear(p) : prevQ(p);
    CTX = { P, p };
    CTX.from = from;
    const last8 = from ? full.filter(x => x >= from && x <= p) : full.filter(x => x <= p).slice(-8);
    if (from) return { P, p, c, last8, cmpName: 'Dönem', cmpText: `${ql(from)} dönemine göre` };
    return { P, p, c, last8, cmpName: F.cmp === 'yoy' ? 'Yıllık' : 'Çeyreklik', cmpText: F.cmp === 'yoy' ? 'geçen yıla göre' : 'önceki çeyreğe göre' };
  }

  /* ---------- formatting ---------- */
  const nf = (v, d = 1) => v.toLocaleString('tr-TR', { maximumFractionDigits: d });
  const num = v => { const a = Math.abs(v); return a >= 1e9 ? nf(v / 1e9, a >= 1e10 ? 1 : 2) + 'Mr' : a >= 1e6 ? nf(v / 1e6, 1) + 'M' : a >= 1e3 ? nf(v / 1e3, 1) + ' Bin' : nf(v, 0); };
  const money = v => '$' + num(v);
  const fm = m => (m === 'rev' ? money : num);
  const pct = (x, d = 1) => '%' + nf(x * 100, d);
  const sp = x => (x >= 0 ? '+' : '−') + pct(Math.abs(x));
  const pill = (d, pp) => (d == null ? '<span class="d na">–</span>' : `<span class="d ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${pp ? nf(Math.abs(d) * 100, 1) + ' puan' : pct(Math.abs(d))}</span>`);
  const link = (r, inner) => (r.url && /^https?:\/\//i.test(r.url) ? `<a class="ext" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner);
  /* every card / KPI / callout title gets a ⓘ explanation, matched by the start of its plain text */
  const TITLE_HELP = [
    ['Toplam pazar geliri', 'Toplam pazar geliri\n• Seçili çeyrekte oyun dışı bütün uygulama kategorilerinin toplam geliridir.\n• iOS ve Android birlikte, dünya genelini kapsar.\n• Altındaki rozet, karşılaştırma dönemine göre değişimi gösterir.'],
    ['Toplam indirme', 'Toplam indirme\n• Seçili çeyrekte oyun dışı bütün uygulama kategorilerinin toplam indirme sayısıdır.\n• iOS ve Android birlikte, dünya genelini kapsar.\n• Altındaki rozet, karşılaştırma dönemine göre değişimi gösterir.'],
    ['En hızlı büyüyen kategori', 'En hızlı büyüyen kategori\n• Karşılaştırma dönemine göre yüzde olarak en çok büyüyen kategoridir.\n• Üstte seçili olan ölçüye (gelir ya da indirme) göre hesaplanır.'],
    ['Çeyreklik trend', 'Çeyreklik trend\n• Pazarın çeyrek çeyrek toplam büyüklüğünü gösterir.\n• Her sütun bir çeyreğin toplamıdır; sütunun üstünde toplam tutar yazar.\n• Renkli dilimler en büyük 6 kategoriyi, gri dilim geri kalan kategorileri gösterir.\n• Bir rengin üzerine geldiğinde o kategori grafikte ve listede vurgulanır.'],
    ['Pazar payı', 'Pazar payı\n• Seçili çeyrekte en büyük 8 kategoriyi gösterir.\n• Her kategorinin tutarı ve toplam içindeki payı yazar.'],
    ['Kategori sıralaması', 'Kategori sıralaması\n• Bütün kategorilerin gelir, indirme ve değişim rakamlarını gösterir.\n• Sütun başlığına tıklayarak sıralamayı değiştirebilirsin.\n• Sağdaki küçük grafik, kategorinin son 8 çeyrekteki yönünü gösterir.'],
    ['Uygulama karşılaştırması', 'Uygulama karşılaştırması\n• Listeden seçtiğin en fazla 5 uygulamayı yan yana gösterir.\n• Her satırda önde olan uygulamanın değeri vurgulanır.\n• Sıra satırında küçük sayı daha iyidir.\n• Alttaki grafik, seçilen uygulamaların çeyrek çeyrek seyrini gösterir.\n• Seçimi kaldırmak için üstteki etiketlerdeki çarpıya ya da listedeki kutuya bas.'],
    ['Gelir liderleri', 'Gelir liderleri\n• Seçili çeyrekte en çok gelir elde eden 3 uygulamadır.'],
    ['En çok düşenler', 'En çok düşenler\n• Karşılaştırma dönemine göre yüzde olarak en çok gerileyen 3 uygulamadır.\n• Yalnızca karşılaştırma döneminde ilk 250 içinde olan uygulamalar değerlendirilir.'],
    ['Uygulamalar', 'Uygulamalar\n• Seçili çeyrekte uygulamaların sıralamasıdır.\n• Değişim sütunu, karşılaştırma dönemine göre hesaplanır.\n• “Yeni” etiketi, uygulamanın karşılaştırma döneminin listesinde olmadığını gösterir.\n• İndirme başına gelir, gelirin indirme sayısına bölünmesiyle bulunur.'],
    ['Gelir · ', 'Toplam yayıncı geliri\n• Yüklenen dosyadaki bütün yayıncıların seçili çeyrekteki toplam geliridir.\n• Başlıkta dosyadaki yayıncı sayısı yazar.'],
    ['Yoğunlaşma eğrisi', 'Yoğunlaşma eğrisi\n• Gelirin kaç şirkette toplandığını gösterir.\n• Yayıncılar en büyükten en küçüğe doğru dizilir ve gelirleri sırayla toplanır.\n• Eğri hızlı yükseliyorsa gelirin büyük kısmı birkaç şirketin elindedir.\n• İşaretli noktalar ilk 10, ilk 50 ve ilk 100 yayıncının payını gösterir.'],
    ['Yayıncılar', 'Yayıncılar\n• Seçili çeyrekte yayıncıların gelire göre sıralamasıdır.\n• Her yayıncının payı, birikimli payı ve karşılaştırma dönemine göre değişimi yazar.'],
    ['AI geliri', 'AI geliri\n• Yapay zekâ olarak etiketlenen uygulamaların seçili çeyrekteki toplam geliridir.\n• Altındaki rozet, karşılaştırma dönemine göre değişimi gösterir.'],
    ['AI indirmesi', 'AI indirmesi\n• Yapay zekâ olarak etiketlenen uygulamaların seçili çeyrekteki toplam indirme sayısıdır.\n• Altındaki rozet, karşılaştırma dönemine göre değişimi gösterir.'],
    ['Pazar gelirindeki pay', 'Pazar gelirindeki pay\n• Yapay zekâ uygulamalarının toplam pazar gelirindeki payıdır.\n• AI geliri, kategori dosyalarındaki toplam pazar gelirine bölünerek hesaplanır.'],
    ['İzlenen AI uygulaması', 'İzlenen AI uygulaması\n• Seçili çeyrekte verisi olan ve yapay zekâ olarak etiketlenen uygulama sayısıdır.\n• Altındaki sayı, bütün çeyreklerde etiketlenen uygulamaların toplamıdır.'],
    ['AI segmenti trendi', 'AI segmenti trendi\n• Yapay zekâ uygulamalarının çeyrek çeyrek toplamını gösterir.\n• Üstte seçili olan ölçüye (gelir ya da indirme) göre çizilir.'],
    ['En büyük AI uygulamaları', 'En büyük AI uygulamaları\n• Seçili çeyrekteki en büyük 8 yapay zekâ uygulamasıdır.\n• Sağdaki rozet, karşılaştırma dönemine göre değişimi gösterir.'],
    ['Saklanan veriler', 'Saklanan veriler\n• Bu tarayıcıda kayıtlı olan bütün dosyalardır.\n• Dosyalar türlerine göre gruplanır.\n• Silinen bir dosya geri getirilemez; yeniden yüklemen gerekir.'],
    ['dosyayı gözden geçir', 'Dosyaları gözden geçir\n• Bıraktığın dosyalar henüz kaydedilmedi.\n• Her dosyanın türünü ve sütunlarını kontrol et.\n• Her şey doğruysa “içe aktar” düğmesine bas.'],
  ];
  const plain = h => String(h).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const withHelp = t => { if (/class="info"/.test(t)) return t; const p = plain(t), h = TITLE_HELP.find(([k]) => p.startsWith(k) || (k.startsWith('dosya') && p.includes(k))); return h ? `${t} <i class="info" tabindex="0" role="img" aria-label="${esc(h[1])}" data-tip="${esc(h[1])}">!</i>` : t; };
  const kpi = (label, value, sub, txt) => `<div class="kpi"><span>${withHelp(label)}</span><b class="${txt ? 'txt' : ''}" title="${esc(value)}">${esc(value)}</b><small>${sub || ''}</small></div>`;
  const card = (title, sub, body, extra) => `<section class="panel-card"><header><div><h2>${withHelp(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${extra || ''}</header>${body}</section>`;
  const empty = (t, d) => `<div class="empty"><h2>${t}</h2><p>${d}</p><a class="btn primary" href="#data">Veri Yönetimini aç</a></div>`;
  const tipA = t => ` data-tip="${esc(t)}"`;
  /* small ⓘ next to abbreviations / jargon; hover (or keyboard focus) shows what it means */
  const HELP = {
    CR10: 'İlk 10 yayıncının toplam gelirdeki payı\n• Yayıncılar gelire göre sıralanır ve ilk 10 yayıncının gelirleri toplanır.\n• Bu toplam, yüklenen dosyadaki bütün yayıncıların gelirine bölünür.\n• Oran yüksekse pazar birkaç büyük şirketin elinde toplanmış demektir.\n• Altındaki “puan”, iki oran arasındaki düz farktır. Örneğin yüzde 40’tan yüzde 42’ye çıkış 2 puanlık artıştır.',
    CR50: 'İlk 50 yayıncının toplam gelirdeki payı\n• Yayıncılar gelire göre sıralanır ve ilk 50 yayıncının gelirleri toplanır.\n• Bu toplam, yüklenen dosyadaki bütün yayıncıların gelirine bölünür.\n• Altındaki “puan”, iki oran arasındaki düz farktır.',
    CR100: 'İlk 100 yayıncının toplam gelirdeki payı\n• Yayıncılar gelire göre sıralanır ve ilk 100 yayıncının gelirleri toplanır.\n• Bu toplam, yüklenen dosyadaki bütün yayıncıların gelirine bölünür.\n• Altındaki “puan”, iki oran arasındaki düz farktır.',
    pp: 'Puan nedir?\n• İki yüzde oranı arasındaki düz farktır.\n• Örneğin yüzde 40’tan yüzde 42’ye çıkış 2 puanlık artıştır; yüzde 5’lik artış değildir.',
    rpd: 'İndirme başına gelir\n• Bir indirmenin ortalama ne kadar gelir getirdiğini gösterir.\n• Toplam gelir, toplam indirme sayısına bölünerek hesaplanır.\n• Yüksek olması kullanıcıların uygulamaya daha çok para harcadığını gösterir.',
    yoy: 'Yıllık karşılaştırma\n• Seçili çeyrek, geçen yılın aynı çeyreğiyle karşılaştırılır.\n• Örneğin 2026 yılının 3. çeyreği, 2025 yılının 3. çeyreğiyle karşılaştırılır.\n• Mevsimsel etkileri dışarıda bıraktığı için büyümeyi daha doğru gösterir.',
    qoq: 'Çeyreklik karşılaştırma\n• Seçili çeyrek, hemen önceki çeyrekle karşılaştırılır.\n• Örneğin 2026 yılının 3. çeyreği, 2026 yılının 2. çeyreğiyle karşılaştırılır.\n• Kısa dönemli değişimleri görmek için kullanılır.',
    range: 'Aralık karşılaştırması\n• Takvimde bir aralık seçtiğinde değişimler bu şekilde hesaplanır.\n• Aralığın bitiş çeyreği, başlangıç çeyreğiyle karşılaştırılır.',
    matrix: 'Büyüme matrisi\nKategorileri büyüklüklerine ve büyüme hızlarına göre dört gruba ayırır.\n• Yatay eksen: kategorinin pazar büyüklüğü. Sağa gittikçe büyür.\n• Dikey eksen: büyüme oranı. Yukarı çıktıkça daha hızlı büyür.\n• Kesikli dikey çizgi: kategorilerin ortanca büyüklüğü.\n• Yıldızlar (sağ üst): büyük ve büyüyen kategoriler.\n• Yükselenler (sol üst): küçük ama hızlı büyüyen kategoriler.\n• Nakit inekleri (sağ alt): büyük ama yavaş büyüyen ya da küçülen kategoriler.\n• Geride kalanlar (sol alt): küçük ve küçülen kategoriler.',
    entrants: 'Yeni girenler\n• Bu çeyreğin listesinde olup karşılaştırma döneminin listesinde olmayan uygulamalardır.\n• Bu uygulamalar o dönem hiç olmayabilir ya da yalnızca ilk sıraların dışında kalmış olabilir.',
    movers: 'En çok yükselenler\n• Karşılaştırma dönemine göre yüzde olarak en çok büyüyen 3 uygulamadır.\n• Yalnızca iki dönemde de ilk 250 içinde olan uygulamalar değerlendirilir.\n• Böylece çok küçük uygulamaların çok büyük yüzdeleri listeyi doldurmaz.',
    cum: 'Birikimli pay\n• Bu satıra kadar olan bütün yayıncıların toplam gelirdeki payıdır.\n• Örneğin 10. satırda yüzde 44 yazıyorsa ilk 10 yayıncı toplam gelirin yüzde 44’ünü alıyor demektir.',
    share: 'Pay\n• Yayıncının toplam gelirdeki payıdır.\n• Pazarın tamamına göre değil, yüklenen dosyadaki yayıncılara göre hesaplanır.',
    partial: 'Yarım dönem\n• Henüz bitmemiş bir çeyrektir.\n• Rakamları eksik olduğu için trendlere ve karşılaştırmalara dahil edilmez.',
    aiGroups: 'AI kullanan ve AI kullanmayan yayıncılar\n• İki ayrı yayıncı dosyasını yan yana karşılaştırır.\n• Sol taraf: AI kullanan yayıncılar dosyası.\n• Sağ taraf: AI kullanmayan yayıncılar dosyası.\n• Değerlerin altındaki rozetler, karşılaştırma dönemine göre değişimi gösterir.',
    aiTag: 'AI uygulamalarını etiketleme\n• Hangi uygulamaların yapay zekâ uygulaması sayılacağını belirler.\n• Adında AI, GPT, Chatbot, Copilot, Gemini, Claude ya da Assistant geçen uygulamalar otomatik olarak seçilir.\n• Listedeki kutuları işaretleyerek ya da işareti kaldırarak seçimi düzeltebilirsin.',
    sparkline: '8 çeyreklik trend\n• Kategorinin son 8 çeyrekteki seyrini gösteren küçük grafiktir.\n• Her satırın grafiği kendi ölçeğindedir.\n• Satırlar arasında yükseklik değil, yön karşılaştırılır: yükseliyor mu, düşüyor mu?',
  };
  const info = k => `<i class="info" tabindex="0" role="img" aria-label="${esc(HELP[k])}"${tipA(HELP[k])}>!</i>`;

  /* ---------- charts (drawn to the container's width) ---------- */
  const plot = fn => { const id = 'p' + after.length; after.push(() => { const el = document.getElementById(id); if (el) el.innerHTML = fn(Math.max(280, el.clientWidth)); }); return `<div class="plot" id="${id}"></div>`; };
  const svg = (W, H, inner, label) => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
  const nice = v => { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p; return 10 * p; };
  const legend = items => `<div class="legend">${items.map((i, k) => `<span data-s="${k}">${i.dash ? `<i class="dash" style="border-color:${i.color}"></i>` : `<i style="background:${i.color}"></i>`}${esc(i.name)}</span>`).join('')}</div>`;
  function yAxis(W, H, max, fmt, min = 0, ml = 58, mr = 12) {
    const m = { l: ml, r: mr, t: 22, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b, y = v => m.t + ih - ((v - min) / (max - min)) * ih;
    let g = '';
    for (let t = 0; t <= 4; t++) { const v = min + (max - min) * t / 4; g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grid${Math.abs(v) < 1e-9 ? ' base' : ''}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${esc(fmt(v))}</text>`; }
    return { m, iw, ih, y, g };
  }
  /* "Gelir + İndirme": revenue chart on top, a shorter downloads chart right below it, same quarters */
  const pair = (revFn, dlFn, legendHtml) => `<div class="pair lr"><div class="pcol"><div class="ph rev"><i></i>Gelir ($)</div>${plot(revFn)}</div><div class="pcol"><div class="ph dl"><i></i>İndirme</div>${plot(dlFn)}</div>${legendHtml ? `<div class="pleg">${legendHtml}</div>` : ''}</div>`; // revenue left, downloads right
  /* second (right) y-axis used when revenue and downloads are drawn together */
  function rightAxis(W, a, max, fmt, color) { const y = v => a.m.t + a.ih - (v / max) * a.ih; let g = '';
    for (let t = 0; t <= 4; t++) { const v = max * t / 4; g += `<text x="${W - a.m.r + 8}" y="${y(v) + 4}" class="ax" style="fill:${color}">${esc(fmt(v))}</text>`; }
    return { y, g }; }
  function stackedBars(W, labels, stack, fmt, line2, opt = {}) {
    const H = opt.H || 300, n = labels.length, tots = labels.map((_, i) => stack.reduce((s, k) => s + k.v[i], 0)), a = yAxis(W, H, nice(Math.max(...tots, 1) * 1.08), fmt, 0, 58, line2 ? 62 : 12);
    const R = line2 ? rightAxis(W, a, nice(Math.max(...line2.v.filter(v => v != null), 1) * 1.08), line2.fmt, line2.color) : null;
    const bw = Math.min(64, a.iw / n * 0.62), x = i => a.m.l + (i + 0.5) * a.iw / n;
    let g = a.g;
    labels.forEach((l, i) => {
      g += `<rect class="hit" x="${x(i) - a.iw / n / 2}" y="${a.m.t}" width="${a.iw / n}" height="${a.ih}"${tipA(`${l}\nToplam: ${fmt(tots[i])}\n` + (line2 && line2.v[i] != null ? `${line2.name}: ${line2.fmt(line2.v[i])}\n` : '') + stack.slice().reverse().filter(k => k.v[i] > 0).map(k => `${k.name}: ${fmt(k.v[i])} (${pct(k.v[i] / (tots[i] || 1), 0)})`).join('\n'))}/>`;
      let b = 0;
      stack.forEach((k, si) => { const y0 = a.y(b), y1 = a.y(b + k.v[i]); b += k.v[i]; if (y0 - y1 > 0.5) g += `<rect data-s="${si}" class="segm" x="${(x(i) - bw / 2).toFixed(1)}" y="${(y1 + 1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y0 - y1 - 1.5).toFixed(1)}" rx="2.5" fill="${k.color}"${tipA(`${k.name}\n${l}: ${fmt(k.v[i])} · toplamın ${pct(k.v[i] / (tots[i] || 1), 0)}`)}/>`; });
      const slot = a.iw / n, every = Math.max(1, Math.ceil(62 / slot)), show = (n - 1 - i) % every === 0; // skip labels that would collide
      g += `${show && slot * every >= 52 ? `<text x="${x(i)}" y="${a.y(tots[i]) - 7}" text-anchor="middle" class="lb b">${esc(fmt(tots[i]))}</text>` : ''}${show ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(l)}</text>` : ''}`;
    });
    if (R) { // downloads as a line on the right axis
      let d = ''; line2.v.forEach((v, i) => { if (v != null) d += (d ? 'L' : 'M') + x(i).toFixed(1) + ' ' + R.y(v).toFixed(1); });
      g += R.g + `<path d="${d}" fill="none" stroke="${line2.color}" stroke-width="2.2" stroke-dasharray="5 4" stroke-linejoin="round"/>`;
      line2.v.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i).toFixed(1)}" cy="${R.y(v).toFixed(1)}" r="4" fill="#fff" stroke="${line2.color}" stroke-width="2"${tipA(`${line2.name}\n${labels[i]}: ${line2.fmt(v)}`)}/>`; });
    }
    return svg(W, H, g, 'Çeyreklik trend') + (opt.noLegend ? '' : legend(line2 ? [...stack, { name: line2.name + ' (sağ eksen)', color: line2.color, dash: true }] : stack));
  }
  function lines(W, labels, series, fmt, yMax, fmt2, opt = {}) {
    const L = series.filter(s => !s.right), Rs = series.filter(s => s.right);
    const H = opt.H || 260, n = labels.length, a = yAxis(W, H, yMax || nice(Math.max(...L.flatMap(s => s.v.filter(v => v != null)), 1) * 1.05), fmt, 0, 58, Rs.length ? 62 : 12);
    const R = Rs.length ? rightAxis(W, a, nice(Math.max(...Rs.flatMap(s => s.v.filter(v => v != null)), 1) * 1.05), fmt2, '#6F6690') : null;
    const Y = s => (s.right ? R.y : a.y);
    const x = i => a.m.l + (n < 2 ? a.iw / 2 : i * a.iw / (n - 1));
    let g = a.g;
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(a.iw / 70))));
    labels.forEach((l, i) => { if ((n - 1 - i) % step === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}" class="ax">${esc(l)}</text>`; });
    if (R) g += R.g;
    series.forEach(s => { const yy = Y(s);
      let d = '', pen = false;
      s.v.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yy(v).toFixed(1); pen = true; });
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.right ? ' stroke-dasharray="5 4"' : ''}/>`;
      s.v.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i).toFixed(1)}" cy="${yy(v).toFixed(1)}" r="3.5" fill="${s.right ? '#fff' : s.color}" stroke="${s.right ? s.color : '#fff'}" stroke-width="1.5"/>`; });
    });
    const cw = a.iw / Math.max(1, n - 1);
    labels.forEach((l, i) => { g += `<rect class="hit" x="${x(i) - cw / 2}" y="${a.m.t}" width="${cw}" height="${a.ih}"${tipA(l + '\n' + series.filter(s => s.v[i] != null).map(s => `${s.name}: ${(s.right ? fmt2 : fmt)(s.v[i])}`).join('\n'))}/>`; });
    return svg(W, H, g, 'Trend') + (series.length > 1 && !opt.noLegend ? legend(series.map(s => s.right ? { ...s, dash: true } : s)) : '');
  }
  function scatter(W, pts, fx, xName, yName) {
    const H = 340, P = pts.filter(p => p.x > 0), xs = P.map(p => p.x), lo = Math.log10(Math.min(...xs)) - 0.15, hi = Math.log10(Math.max(...xs)) + 0.15;
    // y-axis: nice step, always includes 0
    const ys = P.map(p => p.y), span = Math.max(0.1, Math.max(...ys, 0) - Math.min(...ys, 0)), stp = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find(v => span / v <= 5) || 10;
    const y0 = Math.floor(Math.min(...ys, 0) / stp) * stp, y1 = Math.ceil(Math.max(...ys, 0) / stp) * stp || stp;
    const m = { l: 58, r: 14, t: 26, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b, y = v => m.t + ih - (v - y0) / (y1 - y0) * ih, x = v => m.l + (Math.log10(v) - lo) / (hi - lo) * iw;
    let g = '';
    for (let v = y0; v <= y1 + 1e-9; v += stp) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grid${Math.abs(v) < 1e-9 ? ' base' : ''}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${Math.abs(v) < 1e-9 ? '%0' : (v > 0 ? '+' : '−') + '%' + nf(Math.abs(v) * 100, 0)}</text>`;
    const sorted = [...xs].sort((p, q) => p - q), med = sorted[Math.floor(sorted.length / 2)];
    g += `<line x1="${x(med)}" x2="${x(med)}" y1="${m.t}" y2="${m.t + ih}" class="base" stroke-dasharray="3 4"/>`;
    g += `<text x="${m.l}" y="${m.t - 10}" class="q">YÜKSELENLER</text><text x="${W - m.r}" y="${m.t - 10}" text-anchor="end" class="q">YILDIZLAR</text>`;
    for (let t = 0; t <= 3; t++) { const v = 10 ** (lo + (hi - lo) * t / 3); g += `<text x="${x(v)}" y="${H - 8}" text-anchor="${t === 0 ? 'start' : t === 3 ? 'end' : 'middle'}" class="ax">${esc(fx(v))}</text>`; }
    g += `<text x="${m.l + 6}" y="${m.t + ih - 6}" class="q">GERİDE KALANLAR</text><text x="${W - m.r - 6}" y="${m.t + ih - 6}" text-anchor="end" class="q">NAKİT İNEKLERİ</text>`;
    const dots = P.map(p => ({ p, cx: x(p.x), cy: y(p.y) }));
    dots.forEach(({ p, cx, cy }) => { g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="${p.y >= 0.15 ? '#C774BF' : p.y >= 0 ? '#7B5BD9' : '#D9796F'}" fill-opacity=".9" stroke="#fff" stroke-width="1.5"${tipA(`${p.name}\n${xName}: ${fx(p.x)}\n${yName}: ${sp(p.y)}`)}/>`; });
    // label the biggest and fastest-growing points; skip any label that would overlap another label, a dot or a quadrant name
    const want = [...new Set([...P].sort((a, b) => b.x - a.x).slice(0, 6).concat([...P].sort((a, b) => b.y - a.y).slice(0, 3)))];
    const boxes = [[m.l, m.t + ih - 18, m.l + 120, m.t + ih], [W - m.r - 110, m.t + ih - 18, W - m.r, m.t + ih]];
    const hit = (r, q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1];
    want.forEach(p => {
      const d = dots.find(o => o.p === p), w = p.name.length * 6.6;
      for (const [dx, anchor, dy] of [[10, 'start', 4], [-10, 'end', 4], [0, 'middle', -10], [0, 'middle', 18]]) {
        const x0 = anchor === 'start' ? d.cx + dx : anchor === 'end' ? d.cx + dx - w : d.cx - w / 2, r = [x0, d.cy + dy - 11, x0 + w, d.cy + dy + 3];
        if (r[0] < m.l || r[2] > W - 2 || r[1] < m.t - 2 || r[3] > m.t + ih) continue;
        if (boxes.some(q => hit(r, q)) || dots.some(o => o !== d && hit(r, [o.cx - 6, o.cy - 6, o.cx + 6, o.cy + 6]))) continue;
        boxes.push(r); g += `<text x="${(d.cx + dx).toFixed(1)}" y="${(d.cy + dy).toFixed(1)}" text-anchor="${anchor}" class="lb">${esc(p.name)}</text>`; break;
      }
    });
    return svg(W, H, g, 'Büyüme matrisi');
  }
  function pareto(W, revs) {
    const H = 260, n = revs.length, t = revs.reduce((s, v) => s + v, 0) || 1, a = yAxis(W, H, 1, v => pct(v, 0)), x = k => a.m.l + k / n * a.iw;
    let cum = 0; const c = revs.map(v => (cum += v) / t), ln = c.map((v, i) => `${x(i + 1).toFixed(1)},${a.y(v).toFixed(1)}`).join(' ');
    let g = a.g + `<polygon points="${a.m.l},${a.y(0)} ${ln} ${x(n)},${a.y(0)}" fill="#8B6BE6" fill-opacity=".1"/><polyline points="${a.m.l},${a.y(0)} ${ln}" fill="none" stroke="#8B6BE6" stroke-width="2"/>`;
    [10, 50, 100].filter(k => k < n).forEach((k, i) => { g += `<circle cx="${x(k)}" cy="${a.y(c[k - 1])}" r="4" fill="#8B6BE6" stroke="#fff" stroke-width="1.5"${tipA(`İlk ${k} yayıncı\nGelirin ${pct(c[k - 1])} kadarı`)}/><text x="${x(k) + 8}" y="${a.y(c[k - 1]) + 14 + i * 2}" class="lb">İlk ${k} · ${pct(c[k - 1])}</text>`; });
    g += `<text x="${a.m.l}" y="${H - 8}" class="ax">#1</text><text x="${W - a.m.r}" y="${H - 8}" text-anchor="end" class="ax">#${nf(n, 0)}</text>`;
    return svg(W, H, g, 'Yoğunlaşma eğrisi');
  }
  function spark(vals, color = '#8B6BE6') {
    const v = vals.filter(x => x != null); if (v.length < 2) return '<span class="muted">–</span>';
    const mx = Math.max(...v), mn = Math.min(...v), n = vals.length, pts = [];
    vals.forEach((q, i) => { if (q != null) pts.push(`${(2 + i * 92 / (n - 1)).toFixed(1)},${(22 - (mx === mn ? 0.5 : (q - mn) / (mx - mn)) * 18).toFixed(1)}`); });
    return `<svg viewBox="0 0 96 26" width="96" height="26" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${pts.at(-1).split(',')[0]}" cy="${pts.at(-1).split(',')[1]}" r="2.5" fill="${color}"/></svg>`;
  }
  const th = (tbl, key, label, cls = 'r') => { const [k, d] = F.sort[tbl] || []; return `<th class="${cls}${k === key ? ' act' : ''}" data-sort="${tbl}:${key}">${label}${k === key ? (d < 0 ? ' ↓' : ' ↑') : ''}</th>`; };
  const sorter = tbl => { const [k, d] = F.sort[tbl]; return (a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return typeof x === 'string' ? d * x.localeCompare(y) : d * (x - y); }; };

  /* ---------- views ---------- */
  /* Intro shown at the top of Pazar Özeti; can be folded away (remembered per browser) */
  function intro() {
    const open = ls('pa-intro-open', true);
    return `<section class="intro${open ? '' : ' closed'}"><header><div class="ic" aria-hidden="true"><svg viewBox="0 0 16 16" width="18" height="18"><path d="M2 13.5h12M4 11V7M8 11V3M12 11V5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg></div>
      <div><h2>Bu panel ne işe yarar?</h2><p>Mobil uygulama pazarını Sensor Tower verisiyle çeyrek çeyrek izlemek ve yatırım fırsatlarını hızlıca görmek için.</p></div>
      <button class="btn ghost" data-act="intro" aria-expanded="${open}">${open ? 'Gizle' : 'Göster'}</button></header>
      ${open ? `<div class="introbody">
        <div><h3>Hangi sorulara cevap verir?</h3><ul>
          <li><b>Pazar ne kadar büyük, nereye gidiyor?</b> Toplam gelir ve indirme, çeyreklik trend.</li>
          <li><b>En çok para kazandıran alt sektörler hangileri?</b> Kategori payları ve sıralaması.</li>
          <li><b>Hangi kategoriler yükselişte?</b> Büyüme matrisi: büyüklük ile büyüme hızı yan yana.</li>
          <li><b>Büyük oyuncular kim, kim yükselip kim düşüyor?</b> Uygulamalar sayfası.</li>
          <li><b>Pazar birkaç şirketin elinde mi?</b> Yayıncı Yoğunlaşması (CR10, CR50, CR100).</li>
          <li><b>Yapay zekâ ne kadar yer kaplıyor?</b> Yapay Zekâ Segmenti.</li></ul></div>
        <div><h3>Ne için kullanılabilir?</h3><ul>
          <li>Yatırım tezleri ve sektör seçimi için hızlı pazar taraması</li>
          <li>Portföy şirketlerinin bulunduğu kategorilerin izlenmesi</li>
          <li>Yatırım komitesi ve sunumlar için güncel rakamlar</li>
          <li>Yeni giren ve hızla büyüyen uygulamaları erkenden fark etmek</li></ul>
          <h3>Nasıl kullanılır?</h3><ol>
          <li>Üstten ölçüyü (gelir / indirme) ve dönemi seç; takvimde iki çeyreğe tıklayarak aralık kurabilirsin.</li>
          <li>Değişimleri <b>Çeyreklik</b> ya da <b>Yıllık</b> karşılaştır.</li>
          <li>Başlıkların yanındaki <i class="info static">!</i> işaretinin üzerine gelerek açıklamaları oku.</li>
          <li>Yeni çeyrek verisini <a href="#data">Veri Yönetimi</a>’nden yükle.</li></ol></div>
        <div class="srcnote"><b>Veri kaynağı:</b> Sensor Tower dışa aktarımları · iOS + Android, dünya geneli · oyunlar hariç. Tutarlar ABD doları; M = milyon, Mr = milyar. Veriler yalnızca bu tarayıcıda saklanır.</div>
      </div>` : ''}</section>`;
  }
  function vOverview() {
    const rows = catRows();
    if (!raw('category', 'app').length) return empty('Henüz kategori verisi yok', 'Pazar büyüklüğü, trendler ve büyüme matrisi için kategori pazar büyüklüğü dosyalarını yükle.');
    if (!rows.length) return '<div class="empty"><h2>Bu filtrelerle veri yok</h2><p>Verileri yeniden görmek için cihaz ya da ülke filtresini temizle.</p></div>';
    const { p, c, last8, cmpName, cmpText } = ctx(rows), both = F.metric === 'both', m = both ? 'rev' : F.metric, f = fm(m), mName = m === 'rev' ? 'Gelir' : 'İndirme';
    const piv = new Map(); rows.forEach(r => { if (!piv.has(r.name)) piv.set(r.name, {}); piv.get(r.name)[r.p] = r; });
    const tot = (q, k) => sum(at(rows, q), k), val = (n, q, k = m) => piv.get(n)[q]?.[k];
    const list = [...piv.keys()].map(n => ({ name: n, v: val(n, p) || 0, rev: val(n, p, 'rev') || 0, dl: val(n, p, 'dl') || 0, qoq: isPartial(p) ? null : delta(val(n, p) || 0, val(n, prevQ(p))), yoy: isPartial(p) ? null : delta(val(n, p) || 0, val(n, prevYear(p))), g: c ? delta(val(n, p) || 0, val(n, c)) : null }));
    const fast = list.filter(x => x.g != null).sort((a, b) => b.g - a.g)[0];
    const d = k => (c ? delta(tot(p, k), tot(c, k)) : null), gm = d(m);
    const byRev = [...list].sort((a, b) => b.rev - a.rev), top = byRev.slice(0, 6), color = new Map(top.map((x, i) => [x.name, PAL[i]]));
    const stack = [...top.map(x => ({ name: x.name, color: color.get(x.name), v: last8.map(q => val(x.name, q) || 0) })),
      ...(byRev.length > 6 ? [{ name: `Diğer (${byRev.length - 6})`, color: OTHER, v: last8.map(q => byRev.slice(6).reduce((s, x) => s + (val(x.name, q) || 0), 0)) }] : [])];
    const pts = list.filter(x => x.g != null && x.v > 0).map(x => ({ name: x.name, x: x.v, y: x.g }));
    const rowsT = [...list].sort(sorter('cat'));
    return `${intro()}<div class="kpis">${kpi('Toplam pazar geliri', money(tot(p, 'rev')), `${pill(d('rev'))} ${cmpText}`)}${kpi('Toplam indirme', num(tot(p, 'dl')), `${pill(d('dl'))} ${cmpText}`)}
        ${(() => { const rpd = q => { const dl = tot(q, 'dl'); return dl ? tot(q, 'rev') / dl : null; }, a = rpd(p), b = c ? rpd(c) : null; return kpi(`İndirme başına gelir ${info('rpd')}`, a == null ? '—' : '$' + nf(a, 2), `${pill(a != null && b != null ? delta(a, b) : null)} ${cmpText}`); })()}${kpi('En hızlı büyüyen kategori', fast ? fast.name : '—', fast ? `${pill(fast.g)} ${mName.toLocaleLowerCase('tr')}, ${cmpName.toLocaleLowerCase('tr')}` : 'Karşılaştırma çeyreği gerekli', true)}</div>
      ${card('Çeyreklik trend', `${both ? 'Kategorilere göre gelir (solda) ve indirme (sağda)' : `Kategorilere göre ${mName.toLocaleLowerCase('tr')}`} · ${last8.length ? ql(last8[0]) + ' – ' + ql(last8.at(-1)) : ''}`, last8.length > 1 ? (both ? pair(W => stackedBars(W, last8.map(ql), stack, money, null, { noLegend: true }), W => stackedBars(W, last8.map(ql), stack.map(k => ({ ...k, v: last8.map((q, i) => k.name.startsWith('Diğer') ? byRev.slice(6).reduce((t, x) => t + (val(x.name, q, 'dl') || 0), 0) : (val(k.name, q, 'dl') || 0)) })), num, null, { noLegend: true }), `<div class="plot">${legend(stack)}</div>`) : plot(W => stackedBars(W, last8.map(ql), stack, f))) : '<p class="muted">Trend için en az iki çeyrek yükle.</p>')}
      <div class="two">${card(`Büyüme matrisi ${info('matrix')}`, `Pazar büyüklüğü ve ${cmpName.toLocaleLowerCase('tr')} büyüme${both ? ' · gelire göre' : ''} · ${ql(p)}`, pts.length > 1 ? plot(W => scatter(W, pts, f, mName, cmpName + ' büyüme')) : `<p class="muted">Büyüme için ${c ? ql(c) : 'karşılaştırma çeyreği'} verisi gerekli.</p>`)}
        ${card('Pazar payı', `${both ? 'Gelir ve indirme' : mName} · ${ql(p)}`, `<table>${both ? '<thead><tr><th>Kategori</th><th class="r">Gelir</th><th class="r">Pay</th><th class="r">İndirme</th><th class="r">Pay</th></tr></thead>' : ''}<tbody>${[...list].sort((a, b) => b.v - a.v).slice(0, 8).map(x => `<tr><td class="name">${color.has(x.name) ? `<i class="sw" style="background:${color.get(x.name)}"></i>` : '<i class="sw" style="background:#C9C9D4"></i>'}${esc(x.name)}</td>${both ? `<td class="r num">${money(x.rev)}</td><td class="r num muted">${pct(x.rev / (tot(p, 'rev') || 1))}</td><td class="r num">${num(x.dl)}</td><td class="r num muted">${pct(x.dl / (tot(p, 'dl') || 1))}</td>` : `<td class="r num">${f(x.v)}</td><td class="r num muted">${pct(x.v / (tot(p, m) || 1))}</td>`}</tr>`).join('')}</tbody></table>`)}</div>
      ${card('Kategori sıralaması', `${ql(p)} · ${rowsT.length > F.catLim ? `ilk ${F.catLim} / ${rowsT.length} kategori · ` : ''}sıralamak için sütun başlığına tıkla`, `<div class="tw"><table><thead><tr><th>#</th>${th('cat', 'name', 'Kategori', '')}${th('cat', 'rev', 'Gelir')}${th('cat', 'dl', 'İndirme')}${th('cat', 'qoq', 'Çeyreklik')}${th('cat', 'yoy', 'Yıllık')}<th class="r">8 çeyreklik trend ${info('sparkline')}</th></tr></thead>
        <tbody>${rowsT.slice(0, F.catLim).map((x, i) => `<tr><td class="rank">${i + 1}</td><td class="name">${esc(x.name)}</td><td class="r num">${money(x.rev)}</td><td class="r num">${num(x.dl)}</td><td class="r">${pill(x.qoq)}</td><td class="r">${pill(x.yoy)}</td><td class="r">${spark(last8.map(q => val(x.name, q) ?? null))}</td></tr>`).join('')}</tbody></table></div>${rowsT.length > F.catLim ? `<button class="btn more" data-more="catLim">10 tane daha göster · ${rowsT.length - F.catLim} kaldı</button>` : ''}`)}
      ${periods(rows).some(isPartial) ? `<p class="note">${info('partial')} Henüz bitmemiş çeyrekler “yarım” diye işaretlenir; trendlere ve karşılaştırmalara dahil edilmez.</p>` : ''}`;
  }

  function vApps() {
    const rows = raw('apps');
    if (!rows.length) return empty('Henüz uygulama verisi yok', 'Liderleri, yükselenleri, yeni girenleri ve düşenleri görmek için En büyük uygulamalar dosyalarını yükle.');
    const { p, c, cmpName } = ctx(rows), both = F.metric === 'both', m = both ? 'rev' : F.metric, f = fm(m);
    const cats = [...new Set(at(rows, p).map(r => r.cat).filter(Boolean))].sort();
    if (!cats.includes(F.appCat)) F.appCat = '';
    const inCat = r => !F.appCat || r.cat === F.appCat, key = r => r.name.toLowerCase();
    const cur = at(rows, p).filter(inCat).sort((a, b) => b[m] - a[m]), prev = c ? at(rows, c).filter(inCat) : [], pm = new Map(prev.map(r => [key(r), r]));
    const withD = cur.map((r, i) => ({ r, rank: i + 1, d: pm.has(key(r)) ? delta(r[m], pm.get(key(r))[m]) : null, isNew: prev.length > 0 && !pm.has(key(r)) }));
    const li = (o, right) => `<li><span title="${esc(o.r.name)}">${esc(o.r.name)}</span><span>${right}</span></li>`;
    const box = (t, items, right, none) => `<div class="callout"><h3>${withHelp(t)}</h3>${items.length ? `<ol>${items.map(o => li(o, right(o))).join('')}</ol>` : `<p class="none">${none}</p>`}</div>`;
    // movers are taken from the top 250 only, so tiny apps with huge percentage swings do not crowd out real moves
    const prank = new Map([...prev].sort((a, b) => b[m] - a[m]).map((r, i) => [key(r), i + 1]));
    const moved = withD.filter(o => o.d != null && (o.rank <= 250 || prank.get(key(o.r)) <= 250)), noPrev = c ? `${ql(c)} verisi yok` : 'Karşılaştırma çeyreği gerekli';
    const q = F.appQ.trim().toLowerCase(), shown = withD.filter(o => !q || (o.r.name + ' ' + o.r.pub).toLowerCase().includes(q));
    /* ---- comparison of up to 5 apps ---- */
    const allNow = at(rows, p), rankAll = new Map([...allNow].sort((a, b) => b[m] - a[m]).map((r, i) => [key(r), i + 1]));
    const byName = new Map(); for (const r of rows) { const k = key(r); if (!byName.has(k)) byName.set(k, new Map()); byName.get(k).set(r.p, r); }
    const sel = PICK.filter(k => byName.has(k)).map((k, i) => { const h = byName.get(k), r = h.get(p), pr = c ? h.get(c) : null, any = r || [...h.values()].at(-1);
      return { k, i, color: PAL[i], name: any.name, pub: any.pub, cat: any.cat, url: any.url, r, pr }; });
    const full = periods(rows).filter(x => !isPartial(x) && x <= p), tq = CTX.from ? full.filter(x => x >= CTX.from) : full.slice(-8);
    const lead = (vals, hi = true) => { const v = vals.filter(x => x != null); if (v.length < 2) return -1; const best = hi ? Math.max(...v) : Math.min(...v); return vals.indexOf(best); };
    const cmpRow = (label, vals, fmt, hi = true, raw) => { const L = lead(vals, hi);
      return `<tr><th scope="row">${label}</th>${vals.map((v, i) => `<td style="--c:${sel[i].color}" class="${i === L ? 'best' : ''}"><span class="cv">${raw ? raw[i] : v == null ? '<span class="muted">–</span>' : fmt(v)}</span>${i === L ? `<span class="crown" title="Bu satırda önde">${hi ? 'En yüksek' : 'En iyi'}</span>` : ''}</td>`).join('')}</tr>`; };
    const tray = sel.length ? `<div class="tray"><span class="tl">Karşılaştırma · ${sel.length}/5</span>${sel.map(o => `<span class="chip" style="--c:${o.color}"><i></i>${esc(o.name)}<button data-unpick="${esc(o.k)}" aria-label="${esc(o.name)} karşılaştırmadan çıkar">✕</button></span>`).join('')}
        ${sel.length < 2 ? '<span class="muted hint">Karşılaştırmak için listeden en az bir uygulama daha seç.</span>' : ''}<button class="btn ghost" data-act="pickClear">Temizle</button></div>` : '';
    const compare = sel.length >= 2 ? card(`Uygulama karşılaştırması`, `${ql(p)} · değişimler ${CTX.from ? ql(CTX.from) + ' dönemine' : F.cmp === 'yoy' ? 'geçen yıla' : 'önceki çeyreğe'} göre`, `<div class="tw"><table class="cmpt"><thead><tr><th class="corner"></th>${sel.map(o => `<th style="--c:${o.color}" scope="col"><div class="apph"><span class="av" aria-hidden="true">${esc((o.name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toLocaleUpperCase('tr'))}</span><span class="an">${link(o, esc(o.name))}<small>${esc(o.pub || '–')}${o.cat ? ' · ' + esc(o.cat) : ''}</small></span><button class="rm" data-unpick="${esc(o.k)}" aria-label="${esc(o.name)} karşılaştırmadan çıkar" title="Karşılaştırmadan çıkar">✕</button></div></th>`).join('')}</tr></thead><tbody>
        ${cmpRow('Gelir', sel.map(o => o.r ? o.r.rev : null), money)}
        ${cmpRow('İndirme', sel.map(o => o.r ? o.r.dl : null), num)}
        ${cmpRow(`İndirme başına gelir ${info('rpd')}`, sel.map(o => o.r && o.r.dl ? o.r.rev / o.r.dl : null), v => '$' + nf(v, 2))}
        ${cmpRow(`Gelir değişimi`, sel.map(o => o.r && o.pr ? delta(o.r.rev, o.pr.rev) : null), v => pill(v))}
        ${cmpRow(`İndirme değişimi`, sel.map(o => o.r && o.pr ? delta(o.r.dl, o.pr.dl) : null), v => pill(v))}
        ${cmpRow(`Sıra (${m === 'rev' ? 'gelire' : 'indirmeye'} göre)`, sel.map(o => o.r ? rankAll.get(o.k) : null), v => nf(v, 0) + '.', false)}
      </tbody></table></div>
      ${tq.length > 1 ? (() => { const ser = k => sel.map(o => ({ name: o.name, color: o.color, v: tq.map(x => byName.get(o.k).get(x)?.[k] ?? null) }));
          return both ? `<h3 class="cmph">Gelir ve indirme trendi</h3>${pair(W => lines(W, tq.map(ql), ser('rev'), money, null, null, { noLegend: true }), W => lines(W, tq.map(ql), ser('dl'), num, null, null, { noLegend: true }), `<div class="plot">${legend(ser('rev'))}</div>`)}` : `<h3 class="cmph">${m === 'rev' ? 'Gelir' : 'İndirme'} trendi</h3>${plot(W => lines(W, tq.map(ql), ser(m), f))}`; })() : '<p class="muted" style="margin-top:12px">Trend için en az iki çeyreklik uygulama verisi gerekli.</p>'}
      ${sel.some(o => !o.r) ? `<p class="note" style="margin-top:10px">${sel.filter(o => !o.r).map(o => esc(o.name)).join(', ')} için ${ql(p)} verisi yok.</p>` : ''}`) : '';
    return `<div class="toolbar"><select data-f="appCat" aria-label="Kategori"><option value="">Tüm kategoriler</option>${cats.map(x => `<option ${x === F.appCat ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <input class="input grow" id="appQ" type="search" data-q="appQ" value="${esc(F.appQ)}" placeholder="Uygulama ya da yayıncı ara"></div>
      <div class="callouts">${box('Gelir liderleri', [...cur].sort((a, b) => b.rev - a.rev).slice(0, 3).map(r => ({ r })), o => money(o.r.rev), 'Uygulama yok')}
        ${box(`En çok yükselenler ${info('movers')} · ${cmpName.toLocaleLowerCase('tr')}`, [...moved].filter(o => o.d > 0 && o.rank <= 250 && prank.get(key(o.r)) <= 250).sort((a, b) => b.d - a.d).slice(0, 3), o => sp(o.d), noPrev)}
        ${box(`Yeni girenler ${info('entrants')}${withD.some(o => o.isNew) ? ` · ${nf(withD.filter(o => o.isNew).length, 0)} uygulama` : ''}`, withD.filter(o => o.isNew).slice(0, 3), o => f(o.r[m]), prev.length ? 'Bu çeyrekte yok' : noPrev)}
        ${box(`En çok düşenler · ${cmpName.toLocaleLowerCase('tr')}`, [...moved].filter(o => o.d < 0 && prank.get(key(o.r)) <= 250).sort((a, b) => a.d - b.d).slice(0, 3), o => sp(o.d), prev.length ? 'Düşen yok' : noPrev)}</div>
      ${tray}${compare}
      ${card('Uygulamalar', `${ql(p)} · ${m === 'rev' ? 'gelire' : 'indirmeye'} göre sıralı${F.appCat ? ' · ' + esc(F.appCat) : ''}`, `<div class="tw"><table><thead><tr><th class="pk" title="Karşılaştırmaya ekle (en fazla 5)">Seç</th><th>#</th><th>Uygulama</th><th>Yayıncı</th><th>Kategori</th><th class="r">Gelir</th><th class="r">İndirme</th><th class="r">${cmpName}</th><th class="r">İndirme başına gelir ${info('rpd')}</th></tr></thead>
        <tbody>${shown.slice(0, F.appLim).map(o => { const on = PICK.includes(key(o.r)), full5 = PICK.length >= 5 && !on; return `<tr class="${on ? 'picked' : ''}"><td class="pk"><input type="checkbox" data-pick="${esc(key(o.r))}" ${on ? 'checked' : ''} ${full5 ? 'disabled title="En fazla 5 uygulama seçilebilir"' : ''} aria-label="${esc(o.r.name)} karşılaştırmaya ekle"></td><td class="rank">${o.rank}</td><td class="name">${link(o.r, esc(o.r.name))}</td><td class="sub">${esc(o.r.pub)}</td><td class="sub">${esc(o.r.cat)}</td><td class="r num">${money(o.r.rev)}</td><td class="r num">${num(o.r.dl)}</td>
          <td class="r">${o.isNew ? '<span class="newtag">Yeni</span>' : pill(o.d)}</td><td class="r num muted">${o.r.dl ? '$' + nf(o.r.rev / o.r.dl, 2) : '–'}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">Eşleşen uygulama yok.</td></tr>'}</tbody></table></div>
        ${shown.length > F.appLim ? `<button class="btn more" data-more="appLim">10 tane daha göster · ${shown.length - F.appLim} kaldı</button>` : ''}`)}
      <p class="note">Yükselenler iki çeyrekte de ilk 250’de olan uygulamalardan, düşenler karşılaştırma çeyreğinde ilk 250’de olanlardan seçilir. “Yeni girenler” karşılaştırma çeyreğinin listesinde olmayan uygulamalardır; o dönem yalnızca ilk sıraların dışında kalmış olabilirler.</p>`;
  }

  function vPublishers() {
    const src = pubSource(), rows = src.rows;
    if (!rows.length) return empty('Henüz yayıncı verisi yok', 'Yoğunlaşma oranları ve hâkimiyet eğrisi için En büyük yayıncılar dosyalarını yükle.');
    const { p, c, last8, cmpText } = ctx(rows), both = F.metric === 'both', m = both ? 'rev' : F.metric, f = fm(m);
    const stat = q => { const r = at(rows, q).sort((a, b) => b.rev - a.rev), t = sum(r, 'rev'), cr = n => (t ? sum(r.slice(0, n), 'rev') / t : null); return { r, t, c10: cr(10), c50: cr(50), c100: cr(100) }; };
    const s = stat(p), pv = c ? stat(c) : { r: [], t: 0 }, pmap = new Map(pv.r.map(r => [r.name.toLowerCase(), r.rev]));
    const crk = (label, a, b) => kpi(label, a == null ? '—' : pct(a), `${pill(a != null && b != null ? a - b : null, true)} ${cmpText}`);
    const segStat = g => { const all = raw('publishers', g), r = at(all, p), rev = sum(r, 'rev'), dl = sum(r, 'dl'), pr = c ? at(all, c) : [], byRev = [...r].sort((a, b) => b.rev - a.rev);
      const pRev = sum(pr, 'rev'), pDl = sum(pr, 'dl'), pBy = [...pr].sort((a, b) => b.rev - a.rev);
      const prev = pr.length ? { rev: pRev, dl: pDl, n: pr.length, avg: pRev / pr.length, rpd: pDl ? pRev / pDl : null, top10: pRev ? sum(pBy.slice(0, 10), 'rev') / pRev : null } : null;
      return { g, all, r, n: r.length, rev, dl, rpd: dl ? rev / dl : null, avg: r.length ? rev / r.length : null, top10: rev ? sum(byRev.slice(0, 10), 'rev') / rev : null, gr: pr.length ? delta(rev, pRev) : null, prev }; };
    const A = segStat('ai'), B = segStat('nonai');
    const chg = (v, pv, pp) => (v == null || pv == null ? '' : `<small class="chg">${pill(pp ? v - pv : delta(v, pv), pp)}</small>`);
    /* head-to-head rows: value + change | bar | metric pill (+ who leads, by how much) | bar | value + change */
    const h2h = (label, a, b, fmt, k, pp) => { const mx = Math.max(Math.abs(a || 0), Math.abs(b || 0)) || 1, w = v => (v == null ? 0 : Math.max(3, Math.abs(v) / mx * 100));
      const da = k && A.prev ? chg(a, A.prev[k], pp) : '', db = k && B.prev ? chg(b, B.prev[k], pp) : '';
      const la = a != null && b != null && a > b, lb = a != null && b != null && b > a, d = a != null && b != null ? (pp ? a - b : delta(Math.max(a, b), Math.min(a, b))) : null;
      const gapTxt = d == null ? '' : Math.abs(pp ? d : d) < 0.0005 ? '<em class="g eq">eşit</em>' : `<em class="g ${la ? 'ai' : 'nonai'}">${la ? '◀ ' : ''}${pp ? nf(Math.abs(d) * 100, 1) + ' puan' : '%' + nf(Math.abs(d) * 100, Math.abs(d) >= 1 ? 0 : 1)} fazla${lb ? ' ▶' : ''}</em>`;
      return `<div class="h2h"><b class="${la ? 'lead' : ''}">${a == null ? '—' : fmt(a)}${da}</b><span class="t l"><i class="${la ? 'on' : ''}" style="width:${w(a)}%;background:${SEGC.ai}"></i></span>
        <span class="what"><span class="wl">${label}</span>${gapTxt}</span><span class="t"><i class="${lb ? 'on' : ''}" style="width:${w(b)}%;background:${SEGC.nonai}"></i></span><b class="${lb ? 'lead' : ''}">${b == null ? '—' : fmt(b)}${db}</b></div>`; };
    const segAll = [...new Set([...A.all, ...B.all].map(r => r.p))].sort().filter(x => !isPartial(x) && x <= p), segL8 = CTX.from ? segAll.filter(x => x >= CTX.from) : segAll.slice(-8); // follows the calendar range
    const compare = A.n || B.n ? card(`${SEG.ai} ve ${SEG.nonai} yayıncılar ${info('aiGroups')}`, c && (A.prev || B.prev) ? `${ql(p)} değerleri · rozetler ${cmpText} değişim · ortada hangi grubun ne kadar önde olduğu yazar` : `${ql(p)} değerleri · ortada hangi grubun ne kadar önde olduğu yazar`,
      `<div class="h2hh"><span class="gh ai"><i></i>${SEG.ai}<small>${A.n ? nf(A.n, 0) + ' yayıncı' : 'veri yok'}</small></span><span class="gh nonai"><small>${B.n ? nf(B.n, 0) + ' yayıncı' : 'veri yok'}</small>${SEG.nonai}<i></i></span></div>
        ${h2h('Toplam gelir', A.n ? A.rev : null, B.n ? B.rev : null, money, 'rev')}${h2h('Toplam indirme', A.n ? A.dl : null, B.n ? B.dl : null, num, 'dl')}${h2h('Yayıncı sayısı', A.n || null, B.n || null, v => nf(v, 0))}
        ${h2h('Yayıncı başına gelir', A.avg, B.avg, money, 'avg')}${h2h(`İndirme başına gelir ${info('rpd')}`, A.rpd, B.rpd, v => '$' + nf(v, 2), 'rpd')}${h2h('İlk 10’un gelir payı', A.top10, B.top10, v => pct(v), 'top10', true)}
        ${segL8.length > 1 && A.all.length && B.all.length ? `<div style="margin-top:22px">${(() => { const ser = k => ['ai', 'nonai'].map(g => ({ name: SEG[g], color: SEGC[g], v: segL8.map(x => { const r = at(g === 'ai' ? A.all : B.all, x); return r.length ? sum(r, k) : null; }) }));
          return both ? pair(W => lines(W, segL8.map(ql), ser('rev'), money, null, null, { noLegend: true }), W => lines(W, segL8.map(ql), ser('dl'), num, null, null, { noLegend: true }), `<div class="plot">${legend(ser('rev'))}</div>`) : plot(W => lines(W, segL8.map(ql), ser(m), f)); })()}</div>` : ''}`) : '';
    const q = F.pubQ.trim().toLowerCase(); let cum = 0;
    const tbl = s.r.map((r, i) => ({ r, rank: i + 1, share: r.rev / (s.t || 1), cum: (cum += r.rev) / (s.t || 1) })).filter(o => !q || o.r.name.toLowerCase().includes(q));
    return `<div class="kpis">${crk(`CR10 ${info('CR10')} · ilk 10’un payı`, s.c10, pv.c10)}${crk(`CR50 ${info('CR50')} · ilk 50’nin payı`, s.c50, pv.c50)}${crk(`CR100 ${info('CR100')} · ilk 100’ün payı`, s.c100, pv.c100)}${kpi(`Gelir · ${nf(s.r.length, 0)} yayıncı`, money(s.t), `${pill(c ? delta(s.t, pv.t) : null)} ${cmpText}`)}</div>
      <div class="two">${card('Yoğunlaşma eğrisi', `En büyükten küçüğe birikimli gelir payı · ${ql(p)}`, plot(W => pareto(W, s.r.map(x => x.rev))))}
        ${card(`Zaman içinde yoğunlaşma ${info('CR10')}`, 'İlk 10, 50 ve 100 yayıncının gelir payı (CR10, CR50, CR100)', last8.length > 1 ? plot(W => lines(W, last8.map(ql), [['CR10', 'c10', PAL[0]], ['CR50', 'c50', PAL[1]], ['CR100', 'c100', PAL[3]]].map(([name, k, color]) => ({ name, color, v: last8.map(x => stat(x)[k]) })), v => pct(v, 0), 1)) : '<p class="muted">Trend için en az iki çeyrek yükle.</p>')}</div>
      ${compare}
      ${card('Yayıncılar', `${ql(p)} · gelire göre sıralı${src.g ? ` · “${SEG[src.g]}” dosyalarından` : ''}`, `<div class="tw"><table><thead><tr><th>#</th><th>Yayıncı</th><th class="r">Gelir</th><th class="r">Pay ${info('share')}</th><th class="r">Birikimli ${info('cum')}</th><th class="r">İndirme</th><th class="r">${F.cmp === 'yoy' ? 'Yıllık' : 'Çeyreklik'}</th></tr></thead>
        <tbody>${tbl.slice(0, F.pubLim).map(o => `<tr><td class="rank">${o.rank}</td><td class="name">${link(o.r, esc(o.r.name))}</td><td class="r num">${money(o.r.rev)}</td><td class="r num">${pct(o.share)}</td><td class="r num muted">${pct(o.cum)}</td><td class="r num">${num(o.r.dl)}</td><td class="r">${pill(delta(o.r.rev, pmap.get(o.r.name.toLowerCase())))}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Eşleşen yayıncı yok.</td></tr>'}</tbody></table></div>
        ${tbl.length > F.pubLim ? `<button class="btn more" data-more="pubLim">10 tane daha göster · ${nf(tbl.length - F.pubLim, 0)} kaldı</button>` : ''}`, `<input class="input" id="pubQ" type="search" data-q="pubQ" value="${esc(F.pubQ)}" placeholder="Yayıncı ara" style="width:220px">`)}
      <p class="note">Paylar pazarın tamamına değil, yüklenen dosyalardaki yayıncılara göre hesaplanır.</p>`;
  }

  function vAI() {
    const apps = raw('apps');
    if (!apps.length) return empty('Henüz uygulama verisi yok', 'Yapay zekâ segmenti En büyük uygulamalar dosyalarından oluşturulur. Onları yükle, sonra burada AI uygulamalarını etiketle.');
    const { p, c, last8, cmpText, cmpName } = ctx(apps), both = F.metric === 'both', m = both ? 'rev' : F.metric, f = fm(m), ai = cache.aiRows || (cache.aiRows = apps.filter(isAI)), cur = at(ai, p).sort((a, b) => b[m] - a[m]);
    const mk = catRows(), mkT = sum(at(mk, p), 'rev'), d = k => (c && at(ai, c).length ? delta(sum(at(ai, p), k), sum(at(ai, c), k)) : null);
    let best = cache['best|' + p]; if (!best) { best = cache['best|' + p] = new Map(); for (const r of apps) { if (!best.has(r.name) || r.p === p) best.set(r.name, r); } }
    const q = F.tagQ.trim().toLowerCase(), list = [...best.values()].filter(r => !F.tagOnly || isAI(r)).sort((a, b) => b.rev - a.rev).filter(r => !q || (r.name + ' ' + r.pub).toLowerCase().includes(q));
    const nTag = [...best.values()].filter(isAI).length;
    return `<div class="kpis">${kpi('AI geliri', money(sum(at(ai, p), 'rev')), `${pill(d('rev'))} ${cmpText}`)}${kpi('AI indirmesi', num(sum(at(ai, p), 'dl')), `${pill(d('dl'))} ${cmpText}`)}
        ${kpi('Pazar gelirindeki pay', mkT ? pct(sum(at(ai, p), 'rev') / mkT) : '—', mkT ? ql(p) : 'Kategori verisi gerekli')}${kpi('İzlenen AI uygulaması', nf(cur.length, 0), `tüm çeyreklerde ${nf(nTag, 0)} etiketli`)}</div>
      <div class="two">${card('AI segmenti trendi', both ? 'Etiketli uygulamaların geliri (solda) ve indirmesi (sağda)' : `Etiketli uygulamaların ${m === 'rev' ? 'geliri' : 'indirmesi'}`, last8.length > 1 ? (both ? pair(W => stackedBars(W, last8.map(ql), [{ name: 'AI uygulamaları', color: PAL[0], v: last8.map(x => sum(at(ai, x), 'rev')) }], money, null, { noLegend: true }), W => stackedBars(W, last8.map(ql), [{ name: 'AI uygulamaları', color: '#3FA58C', v: last8.map(x => sum(at(ai, x), 'dl')) }], num, null, { noLegend: true })) : plot(W => stackedBars(W, last8.map(ql), [{ name: 'AI uygulamaları', color: PAL[0], v: last8.map(x => sum(at(ai, x), m)) }], f))) : '<p class="muted">Trend için en az iki çeyreklik uygulama verisi yükle.</p>')}
        ${card('En büyük AI uygulamaları', `${ql(p)} · ${both ? 'gelir, indirme ve gelirin ' : ''}${cmpName.toLocaleLowerCase('tr')} değişim`, cur.length ? `<table><tbody>${cur.slice(0, 8).map((r, i) => { const pr = c && at(ai, c).find(x => x.name.toLowerCase() === r.name.toLowerCase()); return `<tr><td class="rank">${i + 1}</td><td class="name">${link(r, esc(r.name))}</td>${both ? `<td class="r num">${money(r.rev)}</td><td class="r num muted">${num(r.dl)}</td>` : `<td class="r num">${f(r[m])}</td>`}<td class="r">${pill(pr ? delta(r[m], pr[m]) : null)}</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">Bu çeyrek için etiketli AI uygulaması yok.</p>')}</div>
      ${card(`AI uygulamalarını etiketle ${info('aiTag')}`, `Otomatik etiketleme adında AI, GPT, Chatbot, Copilot, Gemini, Claude, Assistant geçen uygulamaları işaretler. İstediğin uygulamanın kutusunu işaretleyip kaldırarak düzeltebilirsin.`, `<div class="toolbar"><div class="seg" role="group" aria-label="Göster"><button data-set="tagOnly:" class="${F.tagOnly ? '' : 'on'}">Tüm uygulamalar</button><button data-set="tagOnly:1" class="${F.tagOnly ? 'on' : ''}">Etiketli · ${nf(nTag, 0)}</button></div><input class="input grow" id="tagQ" type="search" data-q="tagQ" value="${esc(F.tagQ)}" placeholder="Uygulama ya da yayıncı ara"></div>
        <div class="taglist">${list.slice(0, 200).map(r => `<label><input type="checkbox" data-tag="${esc(r.name.toLowerCase())}" ${isAI(r) ? 'checked' : ''}><span>${esc(r.name)}<small>${esc(r.pub)}${r.cat ? ' · ' + esc(r.cat) : ''}</small></span><em>${money(r.rev)}</em></label>`).join('')}</div>`,
        `<label class="btn"><input type="checkbox" data-auto ${AI.auto ? 'checked' : ''} style="accent-color:#6B2AE6"> Anahtar sözcükle otomatik etiketle</label>`)}`;
  }

  /* ---------- Data Manager ---------- */
  const guessType = (H, fn) => { const has = re => H.some(h => re.test(h) && !/\bid\b/i.test(h)); return has(/^unified name$|app name|^app$/i) ? 'apps' : has(/publisher/i) ? 'publishers' : 'category'; };
  const guessSeg = fn => (/(non|no|not|without|ex|excl\w*)[\s_.-]*ai([^a-z]|$)|kullanmayan/i.test(fn) ? 'nonai' : /(^|[^a-z])(ai|genai)([^a-z]|$)|with[\s_.-]*ai|kullanan/i.test(fn) ? 'ai' : '');
  function setType(st, type) {
    const H = st.parsed.headers; st.type = type; st.map = Parse.guess(H, type); st.fnPeriod = Parse.toQuarter(st.name); st.map.period = st.fnPeriod || ''; st.map.catText = '';
    if (type !== 'category') st.map.dev = st.map.ctry = -1;
    if (type === 'category') st.map.url = -1; else if (st.map.url < 0) st.map.url = H.findIndex((h, i) => st.parsed.rows.slice(0, 20).some(r => /^https?:\/\//i.test(String(r[i] || '').trim())));
    return st;
  }
  function check(st) {
    const { parsed, map, type } = st, errs = [], H = parsed.headers;
    st.norm = Parse.normalize(parsed, map);
    const n0 = st.norm.rows.length;
    if (type === 'category') st.norm.rows = st.norm.rows.filter(r => !isGames(r.name));
    if (type === 'apps') st.norm.rows = st.norm.rows.filter(r => !isGames(r.cat));
    st.games = n0 - st.norm.rows.length;
    if (!H.length || !parsed.rows.length) errs.push('Dosya boş ya da okunamadı.');
    else {
      if (type === 'category' && /genre/i.test(H[map.name] || '')) errs.push('Oyun türü dosyaları içe aktarılmaz.');
      if (map.name < 0) errs.push('Ad sütununu seç.');
      if (map.rev < 0 && map.dl < 0) errs.push('Gelir ya da indirme sütunu seç.');
      if (map.date < 0 && !map.period) errs.push('Çeyreği seç.');
      if (!errs.length && !st.norm.rows.length) errs.push(st.games ? 'Yalnızca oyun satırları var; oyunlar içe aktarılmaz.' : 'Okunabilen satır yok; tarih sütununu kontrol et.');
    }
    return st.errs = errs;
  }
  async function stage(files, type, seg) {
    for (const file of files) {
      let parsed; try { parsed = Parse.parseCSV(Parse.decode(await file.arrayBuffer())); } catch (e) { parsed = { headers: [], rows: [] }; }
      const st = setType({ name: file.name, parsed, seg: seg ?? guessSeg(file.name), open: false }, type || guessType(parsed.headers, file.name));
      check(st); STAGE.push(st);
    }
    if (location.hash !== '#data') location.hash = '#data'; else render();
  }
  async function importStage() {
    let any = false;
    for (const st of STAGE.filter(s => !s.errs.length)) {
      await DB.put({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), type: st.type, group: st.type === 'category' ? 'app' : st.type === 'publishers' ? st.seg : '', name: st.name, addedAt: Date.now(), rows: st.norm.rows, periods: periods(st.norm.rows) });
      any = true;
    }
    if (any) for (const f of FILES.filter(f => f.sample)) await DB.del(f.id); // real data replaces the demo
    STAGE = STAGE.filter(s => s.errs.length);
    await reload();
  }
  const qOpts = () => { const o = []; for (let y = new Date().getFullYear(); y >= 2020; y--) for (let q = 4; q >= 1; q--) o.push(`${y}-Q${q}`); return o; };
  function vData() {
    const ok = STAGE.filter(s => !s.errs.length).length;
    const colSel = (st, i, k, label, none = '— yok —') => `<label>${label}<select data-col="${i}:${k}"><option value="-1">${none}</option>${st.parsed.headers.map((h, j) => `<option value="${j}" ${st.map[k] === j ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`;
    const review = STAGE.length ? card(`${STAGE.length} dosyayı gözden geçir`, 'Sütunlar otomatik eşleştirildi. İçe aktarmak için onayla ya da önce istediğin dosyayı düzelt.', `<div class="stage">${STAGE.map((st, i) => { const H = st.parsed.headers, mp = st.map, ps = st.errs.length ? [] : periods(st.norm.rows);
        return `<div class="row"><i class="st ${st.errs.length ? 'bad' : 'ok'}">${st.errs.length ? '!' : '✓'}</i><div class="fn"><b title="${esc(st.name)}">${esc(st.name)}</b>
          ${st.errs.length ? `<small class="err">${esc(st.errs.join(' '))}</small>` : `<small>${nf(st.norm.rows.length, 0)} satır · ${ps.length > 1 ? ql(ps[0]) + ' – ' + ql(ps.at(-1)) : ql(ps[0])} · ${esc(H[mp.name])}${mp.rev >= 0 ? ' · ' + esc(H[mp.rev]) : ''}${mp.dl >= 0 ? ' · ' + esc(H[mp.dl]) : ''}${st.games ? ` · ${st.games} oyun satırı atlandı` : ''}</small>`}</div>
          <select data-st="${i}:type" aria-label="Veri türü">${Object.entries(TYPE).map(([v, l]) => `<option value="${v}" ${v === st.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${st.type === 'publishers' ? `<select data-st="${i}:seg" aria-label="Yayıncı grubu"><option value="">Grupsuz</option>${Object.entries(SEG).map(([v, l]) => `<option value="${v}" ${v === st.seg ? 'selected' : ''}>${l}</option>`).join('')}</select>` : '<span></span>'}
          <span><button class="btn ghost" data-open="${i}">${st.open ? 'Sütunları gizle' : 'Sütunları düzenle'}</button><button class="btn ghost" data-drop-st="${i}" aria-label="Dosyayı çıkar">✕</button></span>
          ${st.open ? `<div class="cols">${colSel(st, i, 'name', 'Ad')}${st.type === 'apps' ? colSel(st, i, 'pub', 'Yayıncı') + colSel(st, i, 'cat', 'Kategori') : ''}${colSel(st, i, 'rev', 'Gelir')}${colSel(st, i, 'dl', 'İndirme')}${colSel(st, i, 'date', 'Tarih / çeyrek', '— çeyrek seç —')}
            ${mp.date < 0 ? `<label>Çeyrek<select data-col="${i}:period"><option value="">—</option>${qOpts().map(q => `<option value="${q}" ${q === mp.period ? 'selected' : ''}>${ql(q)}</option>`).join('')}</select></label>` : ''}
            ${st.type === 'category' ? colSel(st, i, 'dev', 'Cihaz') + colSel(st, i, 'ctry', 'Ülke') : colSel(st, i, 'url', 'Bağlantı')}</div>` : ''}</div>`; }).join('')}</div>`,
      `<span class="toolbar"><button class="btn" data-act="stageClear">Vazgeç</button><button class="btn primary" data-act="import" ${ok ? '' : 'disabled'}>${ok} dosyayı içe aktar</button></span>`) : '';
    const byType = t => FILES.filter(f => f.type === t).sort((a, b) => (b.periods.at(-1) || '').localeCompare(a.periods.at(-1) || '') || a.name.localeCompare(b.name));
    const files = FILES.length ? card('Saklanan veriler', `Bu tarayıcıda ${FILES.length} dosya`, Object.keys(TYPE).map(t => { const fs = byType(t); if (!fs.length) return '';
      const P = [...new Set(fs.flatMap(f => f.periods))].sort();
      return `<details ${fs.length <= 6 ? 'open' : ''} style="border-top:1px solid #F4F4F7;padding:10px 0"><summary class="grp"><span class="chev" aria-hidden="true"></span>${TYPE[t]} <span class="muted" style="font-weight:400">· ${fs.length} dosya · ${ql(P[0])}${P.length > 1 ? ' – ' + ql(P.at(-1)) : ''}</span></summary>
        <div class="tw" style="margin-top:8px"><table><tbody>${fs.map(f => `<tr><td class="name" title="${esc(f.name)}">${esc(f.name)}</td><td class="sub">${[f.group && SEG[f.group] ? SEG[f.group] : '', f.sample ? 'Örnek veri' : ''].filter(Boolean).join(' · ')}</td><td class="sub">${f.periods.length > 1 ? ql(f.periods[0]) + ' – ' + ql(f.periods.at(-1)) : ql(f.periods[0])}</td><td class="r num muted">${nf(f.rows.length, 0)} satır</td><td class="r"><button class="btn ghost" data-del="${esc(f.id)}">Sil</button></td></tr>`).join('')}</tbody></table></div></details>`; }).join(''),
      `<button class="btn danger" data-act="reset">Tüm veriyi sıfırla</button>`) : '';
    return `<div class="drop" data-zone=""><h2>Sensor Tower dosyalarını buraya bırak</h2><p>Kategori pazar büyüklüğü, en büyük uygulamalar ve en büyük yayıncılar CSV dosyaları. Her dosyanın türü ve çeyreği otomatik tanınır.</p>
        <span class="toolbar" style="justify-content:center"><button class="btn primary" data-pickz="">Dosyaları seç</button>${FILES.some(f => !f.sample) ? '' : `<button class="btn" data-act="demo">${FILES.some(f => f.sample) ? 'Örnek veriyi yeniden yükle' : 'Örnek veri yükle'}</button>`}</span></div>
      <div class="two">${Object.keys(SEG).map(g => `<div class="drop small" data-zone="publishers" data-seg="${g}"><div><h3><i class="sw" style="background:${SEGC[g]}"></i>${SEG[g]} yayıncılar</h3><p>Bu grubun yayıncı dosyalarını buraya bırak ya da seç. ${FILES.filter(f => f.type === 'publishers' && f.group === g).length} dosya saklı.</p></div><button class="btn" data-pickz="publishers" data-seg="${g}">Seç</button></div>`).join('')}</div>
      ${review}${files}
      <p class="note">Veriler yalnızca bu tarayıcıda saklanır. Oyun satırları içe aktarılmaz. Çeyrekler her dosyanın tarih sütunundan okunur.</p>`;
  }

  /* ---------- demo data ---------- */
  function demo() {
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const Q = ['2024-Q4', '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'];
    const cats = ['Entertainment', 'Photo & Video', 'Social Networking', 'Productivity', 'Lifestyle', 'Music', 'Health & Fitness', 'Education', 'Finance', 'Utilities', 'Shopping', 'Books', 'Business', 'Travel'];
    const mk = (type, group, name, rows) => ({ id: 'sample-' + type + '-' + (group || 'x'), type, group, name, sample: true, addedAt: 0, rows, periods: [...new Set(rows.map(r => r.p))].sort() });
    const cat = []; cats.forEach((name, k) => { let rev = 2.1e9 * Math.pow(0.74, k) * (0.85 + rnd() * 0.3), dl = rev * (0.2 + rnd()); const drift = 0.95 + rnd() * 0.13;
      Q.forEach(p => { cat.push({ p, name, pub: '', cat: '', rev: Math.round(rev), dl: Math.round(dl) }); rev *= drift * (0.97 + rnd() * 0.06); dl *= 0.98 + rnd() * 0.05; }); });
    const aiNames = ['ChatGPT-style AI Assistant', 'Copilot Notes', 'GPT Writer Pro', 'AI Photo Enhancer', 'Gemini Tutor', 'Claude Companion', 'AI Video Studio', 'Chatbot Buddy'];
    const apps = []; cats.slice(0, 8).forEach((c, ci) => { for (let i = 1; i <= 26; i++) { const aiN = (c === 'Productivity' || c === 'Photo & Video' || c === 'Education') && i % 6 === 2 ? aiNames[(ci + i) % aiNames.length] + (i > 8 ? ' ' + i : '') : '';
      let rev = 2.6e8 * Math.pow(0.86, i) * (1 - ci * 0.08) * (0.8 + rnd() * 0.4), g = aiN ? 1.12 + rnd() * 0.1 : 0.95 + rnd() * 0.12; const from = rnd() < 0.12 ? 2 + Math.floor(rnd() * 5) : 0, till = rnd() < 0.1 ? 5 : 8;
      Q.forEach((p, qi) => { if (qi >= from && qi < till) apps.push({ p, name: aiN || `${c} App ${i}`, pub: `Studio ${String.fromCharCode(65 + (i * 7 + ci) % 26)}${(i * 3 + ci) % 30}`, cat: c, rev: Math.round(rev), dl: Math.round(rev * (0.15 + rnd() * 0.8)) }); rev *= g * (0.96 + rnd() * 0.08); }); } });
    const pa = [], pn = []; for (let i = 1; i <= 320; i++) { let rev = 5.2e8 / Math.pow(i, 0.9) * (0.85 + rnd() * 0.3); const sh = i % 9 === 3 ? 0.2 + rnd() * 0.4 : 0.9 + rnd() * 0.1, g = 0.97 + rnd() * 0.1;
      Q.forEach((p, qi) => { const a = Math.round(rev * (1 + qi * 0.012)); pa.push({ p, name: `Publisher ${i}`, pub: '', cat: '', rev: a, dl: Math.round(a * (0.3 + rnd() * 0.6)) }); pn.push({ p, name: `Publisher ${i}`, pub: '', cat: '', rev: Math.round(rev * sh), dl: Math.round(rev * sh * (0.3 + rnd() * 0.6)) }); rev *= g; }); }
    return [mk('category', 'app', 'Örnek · kategori pazar büyüklüğü', cat), mk('apps', '', 'Örnek · en büyük uygulamalar', apps), mk('publishers', 'ai', 'Örnek · AI kullanan yayıncılar', pa), mk('publishers', 'nonai', 'Örnek · AI kullanmayan yayıncılar', pn)];
  }
  async function loadDemo() { for (const f of FILES.filter(f => f.sample)) await DB.del(f.id); for (const f of demo()) await DB.put(f); localStorage.removeItem('pa-v2-demo-off'); await reload(); }

  /* ---------- quarter calendar: presets + year × quarter grid, two clicks pick a range ---------- */
  function calendar(P) {
    const have = new Set(P), full = P.filter(x => !isPartial(x)), y0 = +P[0].slice(0, 4), y1 = +P.at(-1).slice(0, 4), last = full.at(-1) || P.at(-1);
    const yr = +last.slice(0, 4), ofY = y => full.filter(x => x.startsWith(y + '-'));
    const pre = [['Son çeyrek', last, last], ['Son 4 çeyrek', full.at(-4), last], ['Son 8 çeyrek', full.at(-8), last], [`${yr} yılı`, ofY(yr)[0], last], [`${yr - 1} yılı`, ofY(yr - 1)[0], ofY(yr - 1).at(-1)], ['Tüm dönem', full[0], last]].filter(x => x[1] && x[2]);
    const a = CTX.from || CTX.p, b = CTX.p, lo = F.pick || a, hi = F.pick || b;
    let grid = '';
    for (let y = y0; y <= y1; y++) grid += `<b>${y}</b>` + [1, 2, 3, 4].map(q => { const v = `${y}-Q${q}`, ok = have.has(v), cls = [v === lo || v === hi ? 'on' : '', v > lo && v < hi ? 'in' : '', ok && isPartial(v) ? 'part' : ''].join(' ');
      return `<button type="button" data-cal="${v}" class="${cls}" ${ok ? '' : 'disabled'} title="${ok ? (isPartial(v) ? 'Yarım dönem' : ql(v)) : 'Veri yok'}"><span>Ç${q}</span></button>`; }).join('');
    const label = CTX.from ? `${ql(CTX.from)} – ${ql(CTX.p)}` : ql(CTX.p);
    return `<details class="pop cal2" ${F.cal ? 'open' : ''}><summary class="btn"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>${label}</summary>
      <div class="panel calp"><div class="calhead"><div><small>Başlangıç</small><b>${ql(lo)}</b></div><span>→</span><div class="${F.pick ? 'wait' : ''}"><small>Bitiş</small><b>${F.pick ? 'seç…' : ql(hi)}</b></div></div>
      <div class="calbody"><div class="calpre">${pre.map(([t, x, z]) => `<button type="button" data-pre="${x}|${z}" class="${!F.pick && a === x && b === z ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="calgrid"><i></i><i>Ç1</i><i>Ç2</i><i>Ç3</i><i>Ç4</i>${grid}</div></div>
      <p class="calfoot">${F.pick ? 'Bitiş çeyreğine tıkla.' : 'İki çeyreğe tıklayarak aralık seç; tek çeyrek için aynı kutuya iki kez tıkla. Aralıkta değişimler başlangıç çeyreğine göre hesaplanır.'}</p></div></details>`;
  }
  const setRange = (x, z) => { if (x > z) [x, z] = [z, x]; F.period = z; F.from = x === z ? '' : x; F.pick = ''; F.cal = false; };

  /* ---------- shell ---------- */
  const view = () => { const h = location.hash.slice(1); return VIEWS.some(v => v[0] === h) ? h : 'overview'; };
  function render() {
    const v = view(), act = document.activeElement, fid = act && act.id, pos = act && act.selectionStart;
    $('#nav').innerHTML = VIEWS.map(([k, l, ic], i) => `${i === 4 ? '<div class="sep"></div>' : ''}<a href="#${k}" class="${k === v ? 'on' : ''}" ${k === v ? 'aria-current="page"' : ''}><svg viewBox="0 0 16 16" aria-hidden="true">${ic}</svg>${l}</a>`).join('');
    after = []; CTX = { P: [], p: '' };
    $('#view').innerHTML = { overview: vOverview, apps: vApps, publishers: vPublishers, ai: vAI, data: vData }[v]();
    const d = dims(), hasDims = v === 'overview' && (d.devs.length || d.ctrys.length > 1);
    $('#bar').innerHTML = `<h1>${VIEWS.find(x => x[0] === v)[1]}</h1>` + (v === 'data' || !CTX.P.length ? '' : `
      <div class="seg" role="group" aria-label="Ölçü">${[['both', 'Gelir + İndirme'], ['rev', 'Gelir ($)'], ['dl', 'İndirme']].map(([k, l]) => `<button data-set="metric:${k}" class="${F.metric === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${calendar(CTX.P)}
      ${CTX.from ? `<button class="btn" data-act="clearRange" title="Aralığı kaldır">${ql(CTX.from)} ile karşılaştırılıyor ✕</button>` : `<div class="seg" role="group" aria-label="Karşılaştırma">${[['qoq', 'Çeyreklik'], ['yoy', 'Yıllık']].map(([k, l]) => `<button data-set="cmp:${k}" class="${F.cmp === k ? 'on' : ''}"${tipA(HELP[k])}>${l}</button>`).join('')}</div>`}
      ${hasDims ? `<details class="pop" ${F.pop ? 'open' : ''}><summary class="btn">Filtreler${F.dev || F.ctry ? '<i class="dotbadge"></i>' : ''}</summary><div class="panel">
        ${d.devs.length ? `<label>Cihaz<select data-f="dev"><option value="">Tüm cihazlar</option>${d.devs.map(x => `<option ${x === F.dev ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}
        ${d.ctrys.length > 1 ? `<label>Ülke<select data-f="ctry"><option value="">Tüm ülkeler</option>${d.ctrys.map(([c, n]) => `<option value="${esc(c)}" ${c === F.ctry ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
        ${F.dev || F.ctry ? '<button class="btn" data-act="clearDims">Filtreleri temizle</button>' : ''}</div></details>` : ''}`);
    $('#demo').innerHTML = FILES.some(f => f.sample) ? `<div class="demo"><span><b>Örnek veri.</b> Bu rakamlar uydurmadır. Kendi dosyalarını Veri Yönetimi’nden yüklediğinde örnek verinin yerini alır.</span><button class="btn" data-act="demoOff">Örnek veriyi kaldır</button></div>` : '';
    after.forEach(fn => fn());
    for (const el of document.querySelectorAll('.pop .panel')) { if (!el.offsetParent) continue; el.style.left = el.style.right = ''; const r = el.getBoundingClientRect(); if (r.right > innerWidth - 12) el.style.left = (innerWidth - 12 - r.right) + 'px'; } // keep pop-overs on screen
    if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
  }

  /* ---------- events ---------- */
  let pickType = '', pickSeg;
  document.addEventListener('click', async e => {
    const t = e.target;
    if ((F.pop || F.cal) && !t.closest('.pop')) { F.pop = false; F.cal = false; F.pick = ''; render(); }
    const b = t.closest('button, th[data-sort]'); if (!b) return; const d = b.dataset;
    if (d.cal) { if (!F.pick) F.pick = d.cal; else setRange(F.pick, d.cal); render(); }
    else if (d.pre) { const [x, z] = d.pre.split('|'); setRange(x, z); render(); }
    else if (d.act === 'clearRange') { F.from = ''; render(); }
    else if (d.set) { const [k, v] = d.set.split(':'); F[k] = v; render(); }
    else if (d.sort) { const [tbl, k] = d.sort.split(':'), cur = F.sort[tbl]; F.sort[tbl] = [k, cur[0] === k ? -cur[1] : (k === 'name' ? 1 : -1)]; render(); }
    else if (d.more) { F[d.more] += 10; render(); }
    else if (d.pickz !== undefined) { pickType = d.pickz; pickSeg = d.seg; $('#pick').value = ''; $('#pick').click(); }
    else if (d.open) { STAGE[+d.open].open = !STAGE[+d.open].open; render(); }
    else if (d.dropSt) { STAGE.splice(+d.dropSt, 1); render(); }
    else if (d.del) { if (confirm('Bu dosya tarayıcıdan silinsin mi?')) { await DB.del(d.del); await reload(); } }
    else if (d.unpick) { const i = PICK.indexOf(d.unpick); if (i >= 0) PICK.splice(i, 1); savePick(); render(); }
    else if (d.act === 'pickClear') { PICK.length = 0; savePick(); render(); }
    else if (d.act === 'intro') { localStorage.setItem('pa-intro-open', JSON.stringify(!ls('pa-intro-open', true))); render(); }
    else if (d.act === 'import') await importStage();
    else if (d.act === 'stageClear') { STAGE = []; render(); }
    else if (d.act === 'demo') await loadDemo();
    else if (d.act === 'demoOff') { for (const f of FILES.filter(f => f.sample)) await DB.del(f.id); localStorage.setItem('pa-v2-demo-off', '1'); await reload(); }
    else if (d.act === 'reset') { if (confirm('Yüklenen tüm veriler bu tarayıcıdan silinsin mi? Bu işlem geri alınamaz.')) { await DB.clear(); STAGE = []; localStorage.setItem('pa-v2-demo-off', '1'); await reload(); } }
    else if (d.act === 'clearDims') { F.dev = F.ctry = ''; cache = {}; render(); }
  });
  document.addEventListener('change', e => {
    const t = e.target, d = t.dataset;
    if (d.f) { F[d.f] = t.value; if (d.f === 'appCat') F.appLim = 10; render(); }
    else if (d.st) { const [i, k] = d.st.split(':'), st = STAGE[+i]; if (k === 'type') setType(st, t.value); else st.seg = t.value; check(st); render(); }
    else if (d.col) { const [i, k] = d.col.split(':'), st = STAGE[+i]; st.map[k] = k === 'period' ? t.value : +t.value; check(st); render(); }
    else if (d.pick) { const i = PICK.indexOf(d.pick); if (t.checked && i < 0 && PICK.length < 5) PICK.push(d.pick); else if (!t.checked && i >= 0) PICK.splice(i, 1); savePick(); render(); }
    else if (d.tag) { const k = d.tag; if (t.checked) { AI.tags.add(k); AI.ex.delete(k); } else { AI.tags.delete(k); AI.ex.add(k); } saveAI(); render(); }
    else if ('auto' in d) { AI.auto = t.checked; saveAI(); render(); }
    else if (t.id === 'pick' && t.files.length) stage([...t.files], pickType || undefined, pickSeg);
  });
  document.addEventListener('input', e => { const k = e.target.dataset.q; if (k) { F[k] = e.target.value; render(); } });
  document.addEventListener('toggle', e => { const c = e.target.classList; if (!c || !c.contains('pop')) return; if (c.contains('cal2')) { if (F.cal !== e.target.open) { F.cal = e.target.open; F.pick = ''; render(); } } else F.pop = e.target.open; }, true);
  document.addEventListener('dragover', e => { const z = e.target.closest('[data-zone]'); e.preventDefault(); if (z) z.classList.add('over'); });
  document.addEventListener('dragleave', e => { const z = e.target.closest('[data-zone]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
  document.addEventListener('drop', e => { e.preventDefault(); const z = e.target.closest('[data-zone]'), fs = [...e.dataTransfer.files]; if (z) z.classList.remove('over'); if (fs.length) stage(fs, (z && z.dataset.zone) || undefined, z ? z.dataset.seg : undefined); });
  document.addEventListener('mousemove', e => { const t = e.target.closest && e.target.closest('[data-tip]'), tip = $('#tip'); if (!t) { tip.hidden = true; return; }
    tip.innerHTML = tipHTML(t.dataset.tip); tip.hidden = false; const tw = tip.offsetWidth, thh = tip.offsetHeight;
    tip.style.left = Math.max(8, e.clientX + 14 + tw > innerWidth ? e.clientX - tw - 14 : e.clientX + 14) + 'px'; tip.style.top = Math.min(innerHeight - thh - 8, e.clientY + 14) + 'px'; });
  document.addEventListener('focusin', e => { const t = e.target.closest && e.target.closest('.info'), tip = $('#tip'); if (!t) return; const r = t.getBoundingClientRect(); tip.innerHTML = tipHTML(t.dataset.tip); tip.hidden = false; tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.left)) + 'px'; tip.style.top = (r.bottom + 8) + 'px'; });
  document.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('.info')) $('#tip').hidden = true; });
  /* tooltip text → title line, paragraphs and a hanging-indent list (all escaped) */
  const tipHTML = txt => { const L = String(txt).split('\n'); let h = '', ul = false;
    L.forEach((l, i) => { const b = /^•\s*/.test(l);
      if (b && !ul) { h += '<ul>'; ul = true; } if (!b && ul) { h += '</ul>'; ul = false; }
      h += b ? `<li>${esc(l.replace(/^•\s*/, ''))}</li>` : i === 0 && L.length > 1 ? `<b>${esc(l)}</b>` : `<p>${esc(l)}</p>`; });
    return h + (ul ? '</ul>' : ''); };
  const hlSeries = (plotEl, k) => { plotEl.classList.toggle('hl', k != null); plotEl.querySelectorAll('[data-s]').forEach(el => el.classList.toggle('on', k != null && el.dataset.s === k)); };
  document.addEventListener('mouseover', e => { const t = e.target.closest && e.target.closest('.plot [data-s]'); const pl = e.target.closest && (e.target.closest('.pair') || e.target.closest('.plot')); if (pl) hlSeries(pl, t ? t.dataset.s : null); });
  document.addEventListener('mouseout', e => { const pl = e.target.closest && (e.target.closest('.pair') || e.target.closest('.plot')); if (pl && !pl.contains(e.relatedTarget)) hlSeries(pl, null); });
  window.addEventListener('hashchange', () => { F.metric = 'both'; window.scrollTo(0, 0); render(); }); // every page opens with revenue + downloads together
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });

  DB.open().then(purge).then(async () => { FILES = await DB.all(); if ((!FILES.length && !localStorage.getItem('pa-v2-demo-off')) || FILES.some(f => f.sample && /^Demo ·/.test(f.name))) await loadDemo(); else await reload(); }) // older English demo files are refreshed
    .catch(() => { $('#view').innerHTML = '<div class="empty"><h2>Tarayıcı depolaması kullanılamıyor</h2><p>Bu sayfayı normal (gizli olmayan) bir pencerede aç.</p></div>'; });
  window.__mi = { stage, F, get files() { return FILES; }, DB, reload }; // for local testing only
})();
