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
    // Step 1: Get current tournament ID
    const scheduleQuery = `
      query Schedule {
        schedule(tourCode: "r") {
          completed {
            id
            tournamentName
          }
          current {
            id
            tournamentName
          }
          upcoming {
            id
            tournamentName
          }
        }
      }
    `;

    const scheduleResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ query: scheduleQuery }),
    });

    if (!scheduleResp.ok) {
      const text = await scheduleResp.text();
      return res.status(502).json({ error: 'Schedule API error', status: scheduleResp.status, detail: text.substring(0, 500) });
    }

    const scheduleData = await scheduleResp.json();
    
    if (scheduleData.errors) {
      return res.status(502).json({ error: 'Schedule GraphQL error', detail: scheduleData.errors[0]?.message });
    }

    const schedule = scheduleData?.data?.schedule;
    const currentTournament = schedule?.current?.[0];
    
    if (!currentTournament?.id) {
      return res.status(404).json({ 
        error: 'No active tournament',
        schedule: {
          current: schedule?.current,
          upcoming: schedule?.upcoming?.slice(0, 3)
        }
      });
    }

    // Step 2: Get leaderboard with tournament ID
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
        variables: { id: currentTournament.id }
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
      return res.status(404).json({ error: 'No leaderboard data', tournamentId: currentTournament.id });
    }

    // Transform to simpler format
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
      tournamentId: currentTournament.id,
      roundStatus: lb.roundStatus,
      playerCount: players.length,
      players
    });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Proxy error', message: err.message });
  }
}
