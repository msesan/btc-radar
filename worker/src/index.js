// BTC Radar čuvar: svake minute provjerava BTC i šalje obavijesti na Telegram.
// Postavke se mijenjaju iz aplikacije (POST /settings s PIN-om) ili Telegram naredbama.

import { buildPlan, planText, HIGHER_TF } from "../../plan.js";

const APP_URL = "https://msesan.github.io/btc-radar/";
const DEFAULTS = { moveOn: true, moveUsd: 400, moveMin: 5, signalOn: true, signalThr: 50, paused: false };
const LIMITS = { moveUsd: [50, 20000], moveMin: [1, 60], signalThr: [20, 90] };
const MOVE_COOLDOWN_MS = 15 * 60 * 1000;
const TFS = ["5m", "15m", "1h", "4h", "1d"];
const TF_WEIGHT = { "5m": 0.5, "15m": 1, "1h": 1.5, "4h": 2, "1d": 2 };
const TF_MS = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
const MEXC_TF = { "1m": "Min1", "5m": "Min5", "15m": "Min15", "1h": "Min60", "4h": "Hour4", "1d": "Day1" };

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env).catch(e => console.error("run", e.stack || e)));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    try {
      if (url.pathname === "/telegram" && req.method === "POST") return await onTelegram(req, env);
      if (url.pathname === "/settings") return cors(await onSettings(req, env));
      if (url.pathname === "/test" && req.method === "POST") return cors(await onTest(req, env));
      return cors(json({ ok: true, name: "BTC Radar čuvar" }));
    } catch (e) {
      console.error(e.stack || e);
      return cors(json({ ok: false, error: "Greška na čuvaru: " + e.message }, 500));
    }
  },
};

// ---------- Glavna provjera (svake minute) ----------
async function run(env) {
  const chat = await env.KV.get("chat");
  if (!chat) return;
  const s = await getSettings(env);
  if (s.paused) return;
  const st = JSON.parse((await env.KV.get("state")) || "{}");
  const before = JSON.stringify(st);
  const now = Date.now();

  if (s.moveOn) {
    const c = await candles("1m", s.moveMin + 1);
    const win = c.slice(-s.moveMin);
    const price = c[c.length - 1].c;
    const hi = Math.max(...win.map(k => k.h)), lo = Math.min(...win.map(k => k.l));
    if (hi - price >= s.moveUsd && now - (st.down || 0) > MOVE_COOLDOWN_MS) {
      st.down = now;
      await send(env, chat, moveMsg(-1, hi - price, hi, price, s));
    }
    if (price - lo >= s.moveUsd && now - (st.up || 0) > MOVE_COOLDOWN_MS) {
      st.up = now;
      await send(env, chat, moveMsg(1, price - lo, lo, price, s));
    }
  }

  // Signal trenda računamo svakih 5 minuta, kad se zatvori 5m svijeća.
  if (s.signalOn && new Date(now).getUTCMinutes() % 5 === 0) {
    const sig = await signal();
    if (sig.score >= s.signalThr && sig.up >= 4 && st.sig !== 1) {
      st.sig = 1;
      await send(env, chat, signalMsg(sig));
    } else if (sig.score <= -s.signalThr && sig.down >= 4 && st.sig !== -1) {
      st.sig = -1;
      await send(env, chat, signalMsg(sig));
    } else if (Math.abs(sig.score) < s.signalThr - 20 && st.sig) {
      st.sig = 0;
    }
  }

  if (JSON.stringify(st) !== before) await env.KV.put("state", JSON.stringify(st));
}

function moveMsg(dir, diff, from, price, s) {
  const head = dir > 0 ? `🚀 <b>BTC nagli rast: +${usd(diff)} u ${s.moveMin} min</b>` : `🔻 <b>BTC nagli pad: −${usd(diff)} u ${s.moveMin} min</b>`;
  return `${head}\nCijena: <b>${usd(price)}</b> (${dir > 0 ? "s dna" : "s vrha"} ${usd(from)})\nPrag obavijesti: ${usd(s.moveUsd)}\n\n<a href="${APP_URL}">Otvori BTC Radar</a>`;
}
function signalMsg(g) {
  const bull = g.score > 0;
  const tfs = TFS.map(tf => `${tf} ${g.tf[tf] > 0 ? "▲" : g.tf[tf] < 0 ? "▼" : "•"}`).join("  ");
  return `${bull ? "🟢" : "🔴"} <b>Jak ${bull ? "bikovski" : "medvjeđi"} signal: ocjena ${g.score > 0 ? "+" : ""}${g.score}</b>\n` +
    `Okviri: ${tfs}\n` +
    `RSI 1h: ${g.rsi1h == null ? "—" : Math.round(g.rsi1h)}${g.funding != null ? ` · Funding: ${(g.funding * 100).toFixed(4)} %` : ""}\n` +
    `Cijena: <b>${usd(g.price)}</b>\n\nNije savjet za ulaz. Provjeri graf i kalkulator.\n<a href="${APP_URL}">Otvori BTC Radar</a>`;
}

// ---------- Podaci: MEXC, a Binance kao rezerva ----------
let lastSource = "MEXC";
async function candles(tf, n) {
  try {
    const end = Math.floor(Date.now() / 1000), start = end - Math.ceil((n + 2) * TF_MS[tf] / 1000);
    const r = await getJSON(`https://contract.mexc.com/api/v1/contract/kline/BTC_USDT?interval=${MEXC_TF[tf]}&start=${start}&end=${end}`);
    const d = r.data;
    if (!r.success || !d?.time?.length) throw new Error("MEXC prazan odgovor");
    const out = d.time.map((t, i) => ({ t: t * 1000, o: +d.open[i], h: +d.high[i], l: +d.low[i], c: +d.close[i] }));
    lastSource = "MEXC";
    return out.slice(-n);
  } catch (e) {
    console.warn("MEXC", e.message);
    const r = await getJSON(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${tf}&limit=${n}`);
    lastSource = "Binance";
    return r.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
  }
}
async function funding() {
  try {
    const r = await getJSON("https://contract.mexc.com/api/v1/contract/ticker?symbol=BTC_USDT");
    return r.data ? { rate: +r.data.fundingRate, price: +r.data.lastPrice, chg: +r.data.riseFallRate } : null;
  } catch (e) { return null; }
}
async function getJSON(u) {
  const res = await fetch(u, { headers: { "User-Agent": "btc-radar-alert" } });
  if (!res.ok) throw new Error(res.status + " " + u);
  return res.json();
}

// ---------- Analiza (ista logika kao u aplikaciji) ----------
function ema(v, p) {
  const out = new Array(v.length).fill(null);
  if (v.length < p) return out;
  const k = 2 / (p + 1);
  let prev = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < v.length; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function rsi(v, p = 14) {
  if (v.length <= p) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = v[i] - v[i - 1]; d > 0 ? g += d : l -= d; }
  g /= p; l /= p;
  for (let i = p + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (p - 1) + Math.max(d, 0)) / p;
    l = (l * (p - 1) + Math.max(-d, 0)) / p;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function macdHist(v) {
  const e12 = ema(v, 12), e26 = ema(v, 26);
  const line = v.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null).filter(x => x != null);
  const sig = ema(line, 9);
  return line.length && sig[sig.length - 1] != null ? line[line.length - 1] - sig[sig.length - 1] : null;
}
const lastOf = a => a[a.length - 1];
function tfScore(c) {
  const close = c.map(k => k.c), price = lastOf(close);
  const E20 = lastOf(ema(close, 20)), E50 = lastOf(ema(close, 50)), E200 = lastOf(ema(close, 200));
  const R = rsi(close), H = macdHist(close);
  let score = 0;
  if (E200 != null) score += price > E200 ? 1 : -1;
  if (E20 != null && E50 != null) score += E20 > E50 ? 1 : -1;
  if (H != null) score += H > 0 ? 1 : -1;
  if (R != null) score += R > 55 ? 1 : R < 45 ? -1 : 0;
  return { score, rsi: R, price };
}
async function signal() {
  const [res, fund] = await Promise.all([Promise.all(TFS.map(tf => candles(tf, 300))), funding()]);
  const tf = {};
  let tech = 0, wsum = 0, rsi1h = null, price = null;
  res.forEach((c, i) => {
    const a = tfScore(c), name = TFS[i];
    tf[name] = a.score;
    tech += (a.score / 4) * TF_WEIGHT[name];
    wsum += TF_WEIGHT[name];
    if (name === "1h") rsi1h = a.rsi;
    if (name === "5m") price = a.price;
  });
  // Futures dio: samo funding, jer MEXC javno ne daje long/short omjer.
  let fut = 0;
  const fr = fund?.rate;
  if (fr != null) { if (fr * 100 > 0.03) fut = -0.5; else if (fr * 100 < -0.01) fut = 0.5; }
  const score = Math.round(((tech / wsum) * 0.7 + fut * 0.3) * 100);
  const vals = Object.values(tf);
  return { score, tf, up: vals.filter(x => x > 0).length, down: vals.filter(x => x < 0).length, rsi1h, funding: fr, price: fund?.price || price };
}

async function planFor(tf) {
  const htf = HIGHER_TF[tf];
  const [c, hc] = await Promise.all([candles(tf, 500), htf ? candles(htf, 300) : null]);
  const a = tfScore(c);
  const p = buildPlan({ tf, candles: c, score: a.score, rsi: a.rsi, higherTf: htf, higherScore: hc ? tfScore(hc).score : null });
  return planText(p) + `\n\n<a href="${APP_URL}">Otvori BTC Radar</a>`;
}

// ---------- Postavke ----------
async function getSettings(env) {
  const s = JSON.parse((await env.KV.get("settings")) || "{}");
  return { ...DEFAULTS, ...s };
}
function clean(input, cur) {
  const s = { ...cur };
  for (const k of ["moveOn", "signalOn", "paused"]) if (typeof input[k] === "boolean") s[k] = input[k];
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Math.round(Number(input[k]));
    if (Number.isFinite(v)) s[k] = Math.min(hi, Math.max(lo, v));
  }
  return s;
}
async function okPin(req, env) {
  const pin = req.headers.get("X-Pin") || "";
  return env.ALERT_PIN && pin === env.ALERT_PIN;
}
async function onSettings(req, env) {
  if (!(await okPin(req, env))) return json({ ok: false, error: "Pogrešan PIN." }, 401);
  let s = await getSettings(env);
  if (req.method === "POST") {
    s = clean(await req.json(), s);
    await env.KV.put("settings", JSON.stringify(s));
  }
  return json({ ok: true, settings: s, telegram: !!(await env.KV.get("chat")) });
}
async function onTest(req, env) {
  if (!(await okPin(req, env))) return json({ ok: false, error: "Pogrešan PIN." }, 401);
  const chat = await env.KV.get("chat");
  if (!chat) return json({ ok: false, error: "Telegram još nije povezan. Pošalji /start svom botu." }, 400);
  const s = await getSettings(env);
  const c = await candles("1m", 1);
  await send(env, chat, `✅ <b>Probna poruka</b>\nČuvar radi. BTC: <b>${usd(c[0].c)}</b> (izvor: ${lastSource})\n${settingsText(s)}`);
  return json({ ok: true });
}
function settingsText(s) {
  return `Nagli pomak: ${s.moveOn ? `uključeno, ${usd(s.moveUsd)} u ${s.moveMin} min` : "isključeno"}\n` +
    `Signal trenda: ${s.signalOn ? `uključeno, ocjena ±${s.signalThr}` : "isključeno"}` +
    (s.paused ? "\n⏸ Obavijesti su pauzirane." : "");
}

// ---------- Telegram ----------
async function sha(text) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
async function onTelegram(req, env) {
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await sha(env.ALERT_PIN || ""))) return new Response("forbidden", { status: 403 });
  const upd = await req.json();
  const msg = upd.message;
  if (!msg?.text) return new Response("ok");
  const chatId = String(msg.chat.id);
  const owner = await env.KV.get("chat");
  const [cmd, arg] = msg.text.trim().split(/\s+/);
  const c = cmd.toLowerCase().replace(/@.*/, "");

  // Prvi koji pošalje /start postaje vlasnik bota; ostali dobivaju odbijenicu.
  if (!owner) {
    if (c !== "/start") return new Response("ok");
    await env.KV.put("chat", chatId);
    await send(env, chatId, `👋 <b>BTC Radar je povezan.</b>\nOd sada ti ovdje stižu obavijesti.\n\n${settingsText(await getSettings(env))}\n\n${HELP}`);
    return new Response("ok");
  }
  if (owner !== chatId) { await send(env, chatId, "Ovaj bot je privatan."); return new Response("ok"); }

  let s = await getSettings(env);
  const save = async patch => { s = clean(patch, s); await env.KV.put("settings", JSON.stringify(s)); };
  let reply;
  if (c === "/start" || c === "/pomoc" || c === "/help") reply = HELP;
  else if (c === "/status") {
    const g = await signal().catch(() => null);
    reply = g ? `BTC: <b>${usd(g.price)}</b>\nOcjena trenda: <b>${g.score > 0 ? "+" : ""}${g.score}</b> (${g.up} okvira gore, ${g.down} dolje)\n\n${settingsText(s)}` : `Ne mogu dohvatiti podatke s burze.\n\n${settingsText(s)}`;
  } else if (c === "/plan") {
    const tf = (arg || "15m").toLowerCase();
    if (!TFS.includes(tf)) reply = "Okvir mora biti jedan od: 5m, 15m, 1h, 4h, 1d. Npr. <code>/plan 1h</code>";
    else reply = await planFor(tf).catch(e => "Ne mogu dohvatiti podatke s burze. Pokušaj ponovno za minutu.");
  } else if (c === "/prag") {
    if (!Number(arg)) reply = "Napiši iznos u dolarima, npr. <code>/prag 600</code>";
    else { await save({ moveUsd: arg, moveOn: true }); reply = `Prag za nagli pomak: <b>${usd(s.moveUsd)}</b> u ${s.moveMin} min.`; }
  } else if (c === "/prozor") {
    if (!Number(arg)) reply = "Napiši broj minuta, npr. <code>/prozor 5</code>";
    else { await save({ moveMin: arg }); reply = `Vremenski prozor: <b>${s.moveMin} min</b>.`; }
  } else if (c === "/signal") {
    const on = !/^(off|ne|0|isk)/i.test(arg || "");
    await save({ signalOn: on }); reply = `Signal trenda je ${on ? "uključen" : "isključen"}.`;
  } else if (c === "/pauza") { await save({ paused: true }); reply = "⏸ Obavijesti su pauzirane. Nastavi s /nastavi."; }
  else if (c === "/nastavi") { await save({ paused: false }); reply = "▶️ Obavijesti su ponovno uključene."; }
  else reply = HELP;
  await send(env, chatId, reply);
  return new Response("ok");
}
const HELP = "<b>Naredbe</b>\n/plan: scenariji za 15m (ili /plan 1h)\n/status: cijena, ocjena i postavke\n/prag 600: obavijest kad BTC napravi 600 $\n/prozor 5: u koliko minuta\n/signal on ili /signal off\n/pauza i /nastavi\n\nSve to možeš mijenjati i u aplikaciji pod Obavijesti.";

async function send(env, chat, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("telegram", res.status, await res.text());
}

// ---------- Pomoćne ----------
const usd = x => Math.round(x).toLocaleString("hr-HR") + " $";
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
function cors(res) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Headers", "Content-Type, X-Pin");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(res.body, { status: res.status, headers: h });
}
