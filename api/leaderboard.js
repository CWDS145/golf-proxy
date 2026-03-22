export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = 'https://orchestrator.pgatour.com/graphql';
  const apiKey = 'da2-gsrx5bibzbb4njvhl7t37wqyl4';

  try {
    // Step 1: Get current/active tournaments
    const tournamentsQuery = `
      query CurrentTournaments {
        tournamentsInProgress(tourCodes: ["r"]) {
          id
          tournamentName
          status
        }
      }
    `;

    const tournResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ query: tournamentsQuery }),
    });

    if (!tournResp.ok) {
      const text = await tournResp.text();
      return res.status(502).json({ error: 'Tournaments API error', status: tournResp.status, detail: text.substring(0, 500) });
    }

    const tournData = await tournResp.json();
    
    if (tournData.errors) {
      // Try alternate query if tournamentsInProgress doesn't exist
      const altQuery = `
        query ActiveTournament {
          activeTournament(tourCode: "r") {
            id
            tournamentName
          }
        }
      `;
      
      const altResp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ query: altQuery }),
      });
      
      const altData = await altResp.json();
      
      if (altData.errors) {
        return res.status(502).json({ 
          error: 'Cannot find active tournament', 
          detail1: tournData.errors[0]?.message,
          detail2: altData.errors[0]?.message
        });
      }
      
      const activeTourney = altData?.data?.activeTournament;
      if (activeTourney?.id) {
        return await getLeaderboard(res, url, apiKey, activeTourney.id);
      }
      
      return res.status(404).json({ error: 'No active tournament found' });
    }

    const tournaments = tournData?.data?.tournamentsInProgress;
    
    if (!tournaments || tournaments.length === 0) {
      return res.status(404).json({ error: 'No tournaments in progress' });
    }

    const currentTournament = tournaments[0];
    return await getLeaderboard(res, url, apiKey, currentTournament.id);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Proxy error', message: err.message });
  }
}

async function getLeaderboard(res, url, apiKey, tournamentId) {
  const leaderboardQuery = `
    query Leaderboard($id: ID!) {
      leaderboardV3(id: $id, tourCode: "r") {
        tournamentName
        roundStatus
        players {
          firstName
          lastName
          position
          total
          thru
          currentRound
          status
          oddsToWin
        }
      }
    }
  `;

  const lbResp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ 
      query: leaderboardQuery,
      variables: { id: tournamentId }
    }),
  });

  if (!lbResp.ok) {
    const text = await lbResp.text();
    return res.status(502).json({ error: 'Leaderboard API error', status: lbResp.status, detail: text.substring(0, 500) });
  }

  const lbData = await lbResp.json();
  
  if (lbData.errors) {
    return res.status(502).json({ error: 'Leaderboard GraphQL error', detail: lbData.errors[0]?.message });
  }

  const lb = lbData?.data?.leaderboardV3;
  if (!lb) {
    return res.status(404).json({ error: 'No leaderboard data', tournamentId });
  }

  const players = (lb.players || []).map(p => ({
    name: `${p.firstName} ${p.lastName}`,
    position: p.position,
    total: p.total,
    thru: p.thru,
    round: p.currentRound,
    status: p.status,
    odds: p.oddsToWin ? parseFloat(p.oddsToWin) : null
  }));

  return res.status(200).json({
    tournament: lb.tournamentName,
    tournamentId,
    roundStatus: lb.roundStatus,
    playerCount: players.length,
    players
  });
}
