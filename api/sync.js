// GET /api/sync  -> { rev, data }      PUT /api/sync { baseRev, data } -> { rev }
// Stores one JSON blob in Upstash Redis (Vercel Marketplace). Guarded by the SYNC_PASSWORD env var.
const crypto = require("crypto");
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "portfolio:state";

async function redis(cmd) {
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: "Bearer " + TOK, "content-type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const pw = process.env.SYNC_PASSWORD;
  if (!pw || !URL_ || !TOK) return res.status(503).json({ error: "Sync isn't set up on the server yet." });
  if (!same(req.headers["x-sync-key"] || "", pw)) {
    await new Promise(r => setTimeout(r, 600)); // slow down password guessing
    return res.status(401).json({ error: "Wrong sync password." });
  }
  try {
    const cur = JSON.parse((await redis(["GET", KEY])) || "null") || { rev: 0, data: null };
    if (req.method === "GET") return res.status(200).json(cur);
    if (req.method === "PUT") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      if (b.baseRev !== cur.rev) return res.status(409).json({ error: "conflict", rev: cur.rev });
      if (!b.data || typeof b.data !== "object" || JSON.stringify(b.data).length > 900000) return res.status(400).json({ error: "bad data" });
      const next = { rev: cur.rev + 1, at: new Date().toISOString(), data: b.data };
      await redis(["SET", KEY, JSON.stringify(next)]);
      return res.status(200).json({ rev: next.rev });
    }
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: "storage error" });
  }
};
