// golf-proxy /api/leaderboard — v1.2 (2026-07-23)
// v1.2 fixes:
//   1. thru 'F*' (back-nine starters, ~half the field) fell through
//      `parseInt('F*') || 0` => thru 0 / status ACTIVE, so finished players
//      were reported as "not started". Asterisk is now stripped before parsing.
//   2. WD detection read scoring.status, which PGA Tour does not emit (always
//      null). The real field is scoringData.playerState ('COMPLETE' | 'WITHDRAWN'
//      | ...), so withdrawals were reported as ACTIVE. Now read from playerState.
//   3. Non-numeric thru values ('-', '', tee times like '1:55 PM') clamp to 0.
//   4. Raw thru + playerState passed through (thruDisplay / playerState) so the
//      dashboard never has to re-derive what the feed already states.
// CUT is still never derived from the feed (historic false-CUT bug, e.g. Min Woo Lee).

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

      // Thru — 'F' and 'F*' both mean the round is finished ('*' = started on 10).
      // '-', '' and tee-time strings ('1:55 PM') mean not started => 0.
      const thruRaw  = scoring.thru == null ? '' : String(scoring.thru).trim();
      const thruNorm = thruRaw.replace(/\*/g, '').trim().toUpperCase();
      let thru = 0;
      if (thruNorm === 'F') {
        thru = 18;
      } else if (/^\d{1,2}$/.test(thruNorm)) {
        thru = Math.min(Math.max(parseInt(thruNorm, 10), 0), 18);
      }

      // Status — driven by playerState (the field PGA Tour actually populates).
      // scoring.status is always null in the feed; kept only as a fallback.
      const state = String(scoring.playerState || scoring.status || '').toUpperCase();
      let status = 'ACTIVE';
      if (state === 'WITHDRAWN' || state === 'WD') {
        status = 'WD';
      } else if (state === 'COMPLETE' || thruNorm === 'F') {
        status = 'COMPLETE';
      }
      // CUT is never derived here — that caused false CUTs (e.g. Min Woo Lee).

      return {
        name: playerInfo.displayName || `${playerInfo.firstName} ${playerInfo.lastName}`,
        position: scoring.position || '',
        total,
        thru,
        thruDisplay: thruRaw,
        round: scoring.currentRound || 0,
        status,
        playerState: state || null,
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
