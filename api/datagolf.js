// /api/datagolf.js — Proxy DataGolf in-play model probabilities. Key stays server-side.
// Deploy alongside leaderboard.js / scorecards.js in the golf-proxy Vercel project.
// Requires env var DATAGOLF_KEY set in Vercel project settings — never in the client.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.DATAGOLF_KEY; // Vercel env only; never in client
  if (!key) return res.status(500).json({ error: 'DATAGOLF_KEY not configured in Vercel env' });

  const url = `https://feeds.datagolf.com/preds/in-play?tour=pga&dead_heat=no&odds_format=percent&file_format=json&key=${key}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    res.status(200).json(j);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
