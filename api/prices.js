// Vercel serverless function: GET /api/prices
// Add new holdings to SOURCES. The key must match the ticker typed in the app.
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" };
const UITF_URL = "https://uitf.com.ph/home/daily_navpu.php?bank_id=31"; // ATRAM daily NAVPU table

const SOURCES = {
  GCASH:   { yahoo: "GCASH.PS" },
  RCR:     { yahoo: "RCR.PS" },
  ATRGTEC: { uitf: "ATRAM Global Technology Feeder Fund (A PHP Unit Class)" },
};

async function yahoo(symbol) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`, { headers: UA });
  if (!r.ok) throw new Error("Yahoo returned " + r.status);
  const meta = (await r.json()).chart.result[0].meta;
  return { price: Number(meta.regularMarketPrice), asof: new Date(meta.regularMarketTime * 1000).toISOString(), source: "Yahoo Finance" };
}

async function uitf(fundName) {
  const r = await fetch(UITF_URL, { headers: UA });
  if (!r.ok) throw new Error("uitf.com.ph returned " + r.status);
  const html = await r.text();
  for (const row of html.split(/<\/tr>/i)) {
    const text = row.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (text.includes(fundName)) {
      const m = text.match(/([\d,]+\.\d+)\s*\*?\s*as of ([A-Za-z]+ \d+, \d{4})/);
      if (m) return { price: Number(m[1].replace(/,/g, "")), asof: m[2], source: "uitf.com.ph" };
    }
  }
  throw new Error("fund row not found");
}

module.exports = async (req, res) => {
  const out = {};
  await Promise.all(Object.entries(SOURCES).map(async ([ticker, src]) => {
    try { out[ticker] = src.yahoo ? await yahoo(src.yahoo) : await uitf(src.uitf); }
    catch (e) { out[ticker] = { error: e.message }; } // one bad source must not break the rest
  }));
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.status(200).json(out);
};
