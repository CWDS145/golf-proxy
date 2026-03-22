export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Fetch PGA Tour leaderboard page
    const pageResp = await fetch('https://www.pgatour.com/leaderboard', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!pageResp.ok) {
      return res.status(502).json({ error: 'Failed to fetch PGA Tour page', status: pageResp.status });
    }

    const html = await pageResp.text();
    
    // Extract __NEXT_DATA__ JSON
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
    if (!match) {
      return res.status(502).json({ error: 'Could not find __NEXT_DATA__ in page' });
    }

    const nextData = JSON.parse(match[1]);
    const pageProps = nextData?.props?.pageProps;
    
    if (!pageProps) {
      return res.status(502).json({ error: 'Invalid page data structure' });
    }

    // Get tournament info
    const tournament = pageProps.tournament;
    const leaderboardId = pageProps.leaderboardId;

    // Find leaderboard and odds in dehydrated state
    const queries = pageProps.dehydratedState?.queries || [];
    const lbQuery = queries.find(q => q.queryKey?.[0] === 'leaderboard');
    const oddsQuery = queries.find(q => q.queryKey?.[0] === 'oddsToWin');
    
    const leaderboard = lbQuery?.state?.data;
    const oddsData = oddsQuery?.state?.data;

    if (!leaderboard?.players) {
      return res.status(404).json({ 
        error: 'No leaderboard data',
        tournament: tournament?.tournamentName,
        status: tournament?.tournamentStatus
      });
    }

    // Build odds lookup by player ID
    const oddsMap = {};
    if (oddsData?.players) {
      oddsData.players.forEach(p => {
        // Convert "+2200" to numeric 22, "+100000" to 1000, etc.
        const oddsStr = p.odds || '';
        let oddsNum = null;
        if (oddsStr.startsWith('+')) {
          oddsNum = parseInt(oddsStr.substring(1)) / 100;
        } else if (oddsStr.startsWith('-')) {
          oddsNum = 100 / Math.abs(parseInt(oddsStr));
        }
        oddsMap[p.playerId] = oddsNum;
      });
    }

    // Transform players
    const players = leaderboard.players.map(p => {
      const scoring = p.scoringData || {};
      const playerInfo = p.player || {};
      
      // Parse total score (e.g., "-11" -> -11, "E" -> 0)
      let total = 0;
      const totalStr = scoring.total || '';
      if (totalStr === 'E') total = 0;
      else if (totalStr) total = parseInt(totalStr) || 0;

      // Parse thru (e.g., "F", "12", "")
      let thru = scoring.thru || '';
      if (thru === 'F' || thru === '') thru = 18;
      else thru = parseInt(thru) || 0;

      // Determine status
      let status = 'ACTIVE';
      if (scoring.status === 'cut') status = 'CUT';
      else if (scoring.status === 'wd') status = 'WD';
      else if (thru === 18 || scoring.thru === 'F') status = 'COMPLETE';

      return {
        name: playerInfo.displayName || `${playerInfo.firstName} ${playerInfo.lastName}`,
        position: scoring.position || '',
        total,
        thru,
        round: scoring.currentRound || 0,
        status,
        odds: oddsMap[playerInfo.id] || null
      };
    });

    return res.status(200).json({
      tournament: tournament?.tournamentName,
      tournamentId: leaderboardId,
      roundStatus: tournament?.roundStatusDisplay || tournament?.roundStatus,
      round: tournament?.currentRound,
      playerCount: players.length,
      players
    });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Proxy error', message: err.message });
  }
}
