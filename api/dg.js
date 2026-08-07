// /api/dg.js - General DataGolf passthrough. Key stays server-side (DATAGOLF_KEY).
// Only paths on the allowlist below can be reached; all query params except
// `path` and `key` are forwarded to feeds.datagolf.com.

const ALLOWED = new Set([
  'preds/pre-tournament',
  'preds/pre-tournament-archive',
  'preds/in-play',
  'preds/player-decompositions',
  'betting-tools/outrights',
  'historical-odds/outrights',
  'historical-odds/event-list',
  'get-schedule',
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.DATAGOLF_KEY;
  if (!key) return res.status(500).json({ error: 'DATAGOLF_KEY not configured in Vercel env' });

  const { path, key: _drop, ...rest } = req.query;
  if (!path || !ALLOWED.has(path)) {
    return res.status(400).json({ error: 'path missing or not allowlisted', allowed: [...ALLOWED] });
  }
  const qs = new URLSearchParams({ file_format: 'json', ...rest, key });
  try {
    const r = await fetch(`https://feeds.datagolf.com/${path}?${qs}`);
    const text = await r.text();
    res.status(r.status);
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
