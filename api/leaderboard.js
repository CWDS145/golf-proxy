export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=120');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const tournamentId = req.query.tournamentId || 'R2026011';
    const data = await fetchPGATour(tournamentId);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function fetchPGATour(tournamentId) {
  // Fetch PGA Tour leaderboard page
  const url = 'https://www.pgatour.com/tournaments/2026/the-players-championship/' + tournamentId + '/leaderboard';
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!resp.ok) throw new Error('PGA Tour HTTP ' + resp.status);
  const html = await resp.text();

  // Extract __NEXT_DATA__ JSON
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('No __NEXT_DATA__ found');
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf('</script>', jsonStart);
  const nextData = JSON.parse(html.substring(jsonStart, jsonEnd));

  const ds = nextData.props?.pageProps?.dehydratedState;
  if (!ds) throw new Error('No dehydratedState');

  // Extract leaderboard
  const lbQuery = ds.queries.find(q => JSON.stringify(q.queryKey).includes('leaderboard'));
  if (!lbQuery) throw new Error('No leaderboard query');
  const lbPlayers = (lbQuery.state.data.players || []).filter(p => p && p.player);

  // Extract odds
  const oddsQuery = ds.queries.find(q => JSON.stringify(q.queryKey).includes('oddsToWin'));
  const oddsPlayers = oddsQuery?.state?.data?.players || [];
  const oddsEnabled = oddsQuery?.state?.data?.oddsEnabled || false;

  // Build odds lookup by playerId (oddsSort = decimal odds)
  const oddsMap = {};
  oddsPlayers.forEach(o => {
    if (o.playerId && o.oddsSort > 0) {
      oddsMap[o.playerId] = {
        decimal: o.oddsSort,
        american: o.odds,
        direction: o.oddsDirection
      };
    }
  });

  // Merge leaderboard + odds
  const players = lbPlayers.map(p => {
    const odds = oddsMap[p.id] || null;
    return {
      name: p.player.displayName,
      id: p.id,
      position: p.scoringData.position,
      total: p.scoringData.total,
      thru: p.scoringData.thru,
      score: p.scoringData.score,
      status: p.scoringData.playerState || 'ACTIVE',
      country: p.player.country,
      odds: odds ? odds.decimal : null,
      oddsAmerican: odds ? odds.american : null,
      oddsDirection: odds ? odds.direction : null
    };
  });

  // Tournament info
  const tournInfo = ds.queries.find(q => JSON.stringify(q.queryKey).includes('"tournament"') && JSON.stringify(q.queryKey).includes(tournamentId));
  const tData = tournInfo?.state?.data || {};

  return {
    tournament: tData.tournamentName || 'THE PLAYERS Championship',
    course: tData.tournamentLocation || 'TPC Sawgrass',
    status: tData.tournamentStatus || '',
    round: lbQuery.state.data.rounds?.length || 0,
    lastUpdated: new Date().toISOString(),
    playerCount: players.length,
    oddsEnabled: oddsEnabled,
    oddsCount: Object.keys(oddsMap).length,
    oddsSource: 'pgatour.com',
    players
  };
}
