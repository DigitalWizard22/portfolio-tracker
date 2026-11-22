// Vercel serverless function: GET /api/prices?t=PH:RCR,US:NVDA,FUND:ATRGTEC
// Returns { quotes: { "PH:RCR": {price, chg, asof, source} | {error} }, fx: USD->PHP }
const UA = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};
const UITF_URL = "https://uitf.com.ph/home/daily_navpu.php?bank_id=31"; // ATRAM daily NAVPU table
const FUNDS = { ATRGTEC: "ATRAM Global Technology Feeder Fund (A PHP Unit Class)" }; // add more funds here

async function get(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r;
}
const stripTags = h => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const num = s => Number(String(s).replace(/,/g, "").replace("−", "-"));

async function stockanalysis(mkt, t) {
  const url = mkt === "US" ? `https://stockanalysis.com/stocks/${t.toLowerCase()}/` : `https://stockanalysis.com/quote/pse/${t}/`;
  const text = stripTags(await (await get(url)).text());
  const m = text.match(/([\d,]+\.\d+)\s+[+\-−]?[\d,.]+\s+\(([+\-−]?[\d.]+)%\)\s+(?:At close|Last updated)[:\s]+([A-Za-z]{3} \d{1,2}, \d{4})/i);
  if (!m) throw new Error("price not found on page");
  return { price: num(m[1]), chg: num(m[2]), asof: m[3], source: "stockanalysis.com" };
}
async function google(mkt, t) {
  for (const ex of mkt === "US" ? ["NASDAQ", "NYSE"] : ["PSE"]) {
    try {
      const html = await (await get(`https://www.google.com/finance/quote/${t}:${ex}`)).text();
      const m = html.match(/data-last-price="([\d.]+)"/);
      if (m) return { price: Number(m[1]), source: "Google Finance" };
    } catch (e) { /* try next exchange */ }
  }
  throw new Error("not found");
}
async function yahoo(mkt, t) {
  const sym = mkt === "US" ? t : t + ".PS";
  const meta = (await (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`)).json()).chart.result[0].meta;
  const price = Number(meta.regularMarketPrice), prev = Number(meta.chartPreviousClose);
  return { price, chg: prev > 0 ? (price / prev - 1) * 100 : undefined, asof: new Date(meta.regularMarketTime * 1000).toISOString(), source: "Yahoo Finance" };
}
async function stock(mkt, t) {
  const errs = [];
  for (const [name, fn] of [["stockanalysis", stockanalysis], ["google", google], ["yahoo", yahoo]]) {
    try { const q = await fn(mkt, t); if (Number.isFinite(q.price) && q.price > 0) return q; errs.push(name + ": bad price"); }
    catch (e) { errs.push(name + ": " + e.message); }
  }
  throw new Error(errs.join("; "));
}
async function fund(t) {
  const name = FUNDS[t];
  if (!name) throw new Error("no fund source set up for " + t + " (add it to FUNDS)");
  const html = await (await get(UITF_URL)).text();
  for (const row of html.split(/<\/tr>/i)) {
    const text = stripTags(row).trim();
    if (text.includes(name)) {
      const m = text.match(/([\d,]+\.\d+)\s*\*?\s*as of ([A-Za-z]+ \d+, \d{4})/);
      if (m) return { price: num(m[1]), asof: m[2], source: "uitf.com.ph" };
    }
  }
  throw new Error("fund row not found");
}
async function usdphp() {
  try { const j = await (await get("https://open.er-api.com/v6/latest/USD")).json(); return Number(j.rates.PHP) || undefined; }
  catch (e) { return undefined; }
}

async function psei() { // PSE Edge index summary table
  const text = stripTags(await (await get("https://edge.pse.com.ph/index/form.do")).text());
  const m = text.match(/PSEi\s+([\d,]+\.\d+)\s+[\d,.]+\s+[\d.]+/);
  if (!m) throw new Error("PSEi not found");
  return num(m[1]);
}
async function spx() { // S&P 500 on Google Finance
  const html = await (await get("https://www.google.com/finance/quote/.INX:INDEXSP")).text();
  const m = html.match(/data-last-price="([\d.,]+)"/);
  if (!m) throw new Error("S&P 500 not found");
  return num(m[1]);
}

module.exports = async (req, res) => {
  const tokens = String(req.query.t || "").split(",").filter(x => /^(PH|US|FUND):[A-Za-z0-9.\-]{1,10}$/.test(x)).slice(0, 25);
  const quotes = {};
  const bench = {};
  const [fx] = await Promise.all([usdphp(), psei().then(v => { bench.psei = v; }).catch(() => {}), spx().then(v => { bench.spx = v; }).catch(() => {}), ...tokens.map(async tok => {
    const [mkt, raw] = tok.split(":"), t = raw.toUpperCase();
    try { quotes[tok] = mkt === "FUND" ? await fund(t) : await stock(mkt, t); }
    catch (e) { quotes[tok] = { error: e.message }; } // one bad source must not break the rest
  })]);
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.status(200).json({ quotes, fx, bench });
};