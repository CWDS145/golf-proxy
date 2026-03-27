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

    const tournament = pageProps.tournament;
    const leaderboardId = pageProps.leaderboardId;

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

    // Build odds lookup
    const oddsMap = {};
    if (oddsData?.players) {
      oddsData.players.forEach(p => {
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
      
      // Total score
      let total = 0;
      const totalStr = scoring.total || '';
      if (totalStr === 'E') total = 0;
      else if (totalStr) total = parseInt(totalStr) || 0;

      // Thru
      let thruRaw = scoring.thru || '';
      let thru = 0;

      if (thruRaw === 'F') {
        thru = 18;
      } else {
        thru = parseInt(thruRaw) || 0;
      }

      // ✅ FIXED STATUS LOGIC
      let status = 'ACTIVE';

      // Only trust WD explicitly
      if (scoring.status && scoring.status.toLowerCase() === 'wd') {
        status = 'WD';
      }

      // Completed round
      else if (thruRaw === 'F') {
        status = 'COMPLETE';
      }

      // 🚫 DO NOT assign CUT from scoring.status
      // This was the bug causing false CUTs (e.g., Min Woo Lee)

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
