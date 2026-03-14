export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=120');

  if (req.method === 'OPTIONS') { return res.status(200).end(); }

  try {
    const tournamentId = req.query.tournamentId || '';
    const espnUrl = tournamentId
      ? `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?tournamentId=${tournamentId}`
      : 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

    const resp = await fetch(espnUrl, {
      headers: { 'User-Agent': 'SawgrassDashboard/1.0' }
    });

    if (!resp.ok) {
      return res.status(502).json({ error: 'ESPN API error', status: resp.status });
    }

    const data = await resp.json();
    const event = data.events?.[0];
    if (!event) {
      return res.status(404).json({ error: 'No active event found' });
    }

    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];

    const players = competitors.map(c => {
      const athlete = c.athlete || {};
      return {
        name: athlete.displayName || athlete.shortName || 'Unknown',
        id: athlete.id,
        position: parseInt(c.status?.position?.id) || c.sortOrder || 999,
        positionDisplay: c.status?.position?.displayName || c.status?.type?.description || '-',
        toPar: c.status?.toPar || 0,
        toParDisplay: c.status?.displayValue || '-',
        thru: c.status?.thru || c.status?.period || '-',
        round: c.linescores?.length || 0,
        status: c.status?.type?.name || 'active',
        country: athlete.flag?.alt || '',
      };
    });

    players.sort((a, b) => a.position - b.position);

    return res.status(200).json({
      tournament: event.name || 'Unknown',
      course: competition?.venue?.fullName || '',
      status: event.status?.type?.description || '',
      round: competition?.status?.period || 0,
      lastUpdated: new Date().toISOString(),
      playerCount: players.length,
      players
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
