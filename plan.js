// Plan scenarija "ako–onda" za jedan vremenski okvir.
// Zajednički za aplikaciju (index.html) i čuvara na Cloudflareu (worker/src/index.js).

export const HIGHER_TF = { "5m": "1h", "15m": "1h", "1h": "4h", "4h": "1d", "1d": null };

export function atr(c, p = 14) {
  if (c.length <= p) return null;
  const tr = i => Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  let a = 0;
  for (let i = 1; i <= p; i++) a += tr(i);
  a /= p;
  for (let i = p + 1; i < c.length; i++) a = (a * (p - 1) + tr(i)) / p;
  return a;
}

// Pivot vrhovi i dna grupirani unutar 0,6×ATR; ista logika kao razine na grafu.
export function levels(c, atrNow) {
  const w = 5, hi = [], lo = [];
  for (let i = w; i < c.length - w; i++) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      // Kod jednakih vrhova pivot je prvi od njih.
      if (j < i ? c[j].h >= c[i].h : c[j].h > c[i].h) isH = false;
      if (j < i ? c[j].l <= c[i].l : c[j].l < c[i].l) isL = false;
    }
    if (isH) hi.push(c[i].h);
    if (isL) lo.push(c[i].l);
  }
  const pts = [...hi, ...lo].sort((a, b) => a - b);
  const tol = atrNow * 0.6, groups = [];
  for (const p of pts) {
    const g = groups[groups.length - 1];
    if (g && p - g.min <= tol) { g.sum += p; g.n++; } else groups.push({ sum: p, n: 1, min: p });
  }
  const price = c[c.length - 1].c;
  const lv = groups.map(g => ({ price: g.sum / g.n, touches: g.n }));
  return {
    sup: lv.filter(l => l.price < price).sort((a, b) => b.price - a.price).slice(0, 3),
    res: lv.filter(l => l.price > price).sort((a, b) => a.price - b.price).slice(0, 3),
  };
}

const f = x => Math.round(x).toLocaleString("hr-HR");
const pct = (x, p) => (x > p ? "+" : "−") + Math.abs((x / p - 1) * 100).toLocaleString("hr-HR", { maximumFractionDigits: 2 }) + " %";
const trend = s => s >= 2 ? "gore" : s <= -2 ? "dolje" : "bočno";
const touches = n => `${n} ${n === 1 ? "dodir" : "dodira"}`;

// score i higherScore su ocjene okvira od −4 do +4 (EMA, MACD, RSI), rsi je RSI ovog okvira.
export function buildPlan({ tf, candles, score, rsi, higherTf, higherScore }) {
  const A = atr(candles);
  const p = candles[candles.length - 1].c;
  const { sup, res } = levels(candles, A);
  const [R1, R2] = res, [S1, S2] = sup;
  const lean = score + (higherScore ?? 0) * 1.5;
  const dir = lean >= 3 ? 1 : lean <= -3 ? -1 : 0;

  const head = `📍 <b>Plan za ${tf}</b>: BTC ${f(p)}, trend ${trend(score)}` + (higherTf ? `, na ${higherTf} ${trend(higherScore)}` : "");
  const ctx = [];
  if (R1 && R1.price - p < A * 0.3) ctx.push(`Cijena je tik ispod otpora ${f(R1.price)}. Test razine je u tijeku.`);
  if (S1 && p - S1.price < A * 0.3) ctx.push(`Cijena je tik iznad podrške ${f(S1.price)}. Test razine je u tijeku.`);

  let up, down;
  if (R1) {
    const target = R2 ? R2.price : R1.price + A * 1.5;
    up = `🔼 <b>Ako probije ${f(R1.price)}</b> (otpor, ${touches(R1.touches)}) i svijeća se zatvori iznad, sljedeća meta je <b>${f(target)}</b> (${pct(target, p)}). ` +
      `Ako se vrati ispod ${f(R1.price - A * 0.6)}, probijanje nije uspjelo.` +
      (S1 ? ` Ako se odbije od otpora, vjerojatan je povratak prema ${f(S1.price)}.` : "");
  } else {
    up = `🔼 Iznad cijene nema jasnog otpora. Okvirna meta rasta je <b>${f(p + A * 2)}</b> (2 ATR-a).`;
  }
  if (S1) {
    const target = S2 ? S2.price : S1.price - A * 1.5;
    down = `🔽 <b>Ako probije ${f(S1.price)}</b> (podrška, ${touches(S1.touches)}) i svijeća se zatvori ispod, sljedeća meta je <b>${f(target)}</b> (${pct(target, p)}). ` +
      `Ako se vrati iznad ${f(S1.price + A * 0.6)}, probijanje nije uspjelo.` +
      (R1 ? ` Ako podrška drži, vjerojatan je odskok prema ${f(R1.price)}.` : "");
  } else {
    down = `🔽 Ispod cijene nema jasne podrške. Okvirna meta pada je <b>${f(p - A * 2)}</b> (2 ATR-a).`;
  }

  let range = null;
  if (R1 && S1) {
    const w = R1.price - S1.price;
    range = w < A * 2.5
      ? `↔️ Između ${f(S1.price)} i ${f(R1.price)} je samo ${f(w)} $, a prosječna svijeća (ATR) je ${f(A)} $. Premalo prostora za trade, čekaj probijanje.`
      : `↔️ Raspon ${f(S1.price)}–${f(R1.price)} (${f(w)} $). Unutar raspona long ima smisla blizu ${f(S1.price)}, a short blizu ${f(R1.price)}, uz stop izvan raspona.`;
  }

  const why = `Trend: ${tf} ${trend(score)}` + (higherTf ? `, ${higherTf} ${trend(higherScore)}` : "");
  const bias = dir > 0 ? `🧭 Vjerojatniji smjer je <b>gore</b> (${why}). Probijanje otpora vjerojatnije je od probijanja podrške.`
    : dir < 0 ? `🧭 Vjerojatniji smjer je <b>dolje</b> (${why}). Probijanje podrške vjerojatnije je od probijanja otpora.`
    : `🧭 Nema jasnog smjera (${why}). Veća je šansa da razine drže (odbijanja) nego da se probiju.`;

  const lines = [...ctx, ...(dir < 0 ? [down, up] : [up, down]), ...(range ? [range] : []), bias];
  if (rsi != null && rsi > 70) lines.push(`RSI ${Math.round(rsi)}: prekupljeno, rast se može usporiti prije mete.`);
  if (rsi != null && rsi < 30) lines.push(`RSI ${Math.round(rsi)}: preprodano, pad se može usporiti prije mete.`);

  return { tf, price: p, atr: A, head, lines, note: "Ovo su scenariji, ne prognoza. Prije ulaza pričekaj da se svijeća zatvori iznad ili ispod razine." };
}

export function planText(plan) {
  return [plan.head, ...plan.lines, `<i>${plan.note}</i>`].join("\n\n");
}
