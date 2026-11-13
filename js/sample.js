/* Arayüzü denemek için uydurma örnek veri. Gerçek rakam değildir. */
const Sample = (() => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const PERIODS = ['2024-Q4', '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'];

  function trend(names, base, decay) {
    const rows = [];
    names.forEach((name, k) => {
      let rev = base * Math.pow(decay, k) * (0.8 + rnd() * 0.4);
      let dl = rev * (0.15 + rnd() * 1.2);
      const drift = 0.94 + rnd() * 0.16;
      for (const p of PERIODS) {
        rows.push({ p, name, pub: '', cat: '', rev: Math.round(rev), dl: Math.round(dl) });
        rev *= drift * (0.96 + rnd() * 0.08); dl *= 0.97 + rnd() * 0.07;
      }
    });
    return rows;
  }

  function build() {
    seed = 42;
    const appCats = ['Entertainment', 'Social Networking', 'Photo & Video', 'Productivity', 'Music', 'Lifestyle',
      'Health & Fitness', 'Education', 'Finance', 'Utilities', 'Shopping', 'Books', 'Business'];
    const mk = (type, group, name, rows) => ({
      id: 'sample-' + type + '-' + (group || 'x'), type, group, name, sample: true, addedAt: 0,
      rows, periods: [...new Set(rows.map(r => r.p))].sort(),
    });

    const appRows = trend(appCats, 21e9, 0.72);
    const apps = [];
    for (const p of ['2025-Q3', '2026-Q3']) {
      seed = 7; // iki çeyrekte de aynı uygulama havuzu
      appCats.slice(0, 9).forEach((cat, c) => {
        for (let i = 1; i <= 30; i++) {
          const inList = p === '2026-Q3' ? i <= 26 || i > 28 : i <= 28; // yeni girenler ve düşenler
          const growth = p === '2026-Q3' ? 0.7 + rnd() * 0.8 : 1;
          const rev = 4e8 * Math.pow(0.86, i) * (1 - c * 0.07) * (0.8 + rnd() * 0.4) * growth;
          if (inList) apps.push({ p, name: `Örnek ${cat} ${i}`, pub: `Yayıncı ${String.fromCharCode(65 + (i * 7 + c) % 26)}${(i * 3 + c) % 40}`,
            cat, rev: Math.round(rev), dl: Math.round(rev * (0.1 + rnd())) });
        }
      });
    }
    const pubs = [];
    for (const p of ['2025-Q3', '2026-Q3']) {
      seed = 11;
      for (let i = 1; i <= 400; i++) {
        const rev = 2.4e9 / Math.pow(i, 0.92) * (0.85 + rnd() * 0.3) * (p === '2026-Q3' ? 0.85 + rnd() * 0.45 : 1);
        pubs.push({ p, name: `Örnek Yayıncı ${i}`, pub: '', cat: '', rev: Math.round(rev), dl: Math.round(rev * (0.2 + rnd())) });
      }
    }
    const ai = PERIODS.flatMap((p, i) => ['AI Chatbot', 'AI Görsel Üretimi', 'AI Asistan'].map((name, k) => ({
      p, name, pub: '', cat: '', rev: Math.round(3.2e8 * Math.pow(1.22 - k * 0.04, i) / (k + 1)), dl: Math.round(1.6e8 * Math.pow(1.15, i) / (k + 1)),
    })));

    return [
      mk('category', 'app', 'Örnek · uygulama kategorileri', appRows),
      mk('apps', '', 'Örnek · en büyük uygulamalar', apps),
      mk('publishers', '', 'Örnek · en büyük yayıncılar', pubs),
    ];
  }
  return { build };
})();
