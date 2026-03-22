export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // PGA Tour GraphQL endpoint
    const url = 'https://orchestrator.pgatour.com/graphql';
    const apiKey = 'da2-gsrx5bibzbb4njvhl7t37wqyl4';
    
    // Query for current tournament leaderboard
    const query = `
      query Leaderboard {
        leaderboardV3(tourCode: "r") {
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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('PGA API error:', response.status, text);
      return res.status(502).json({ 
        error: 'PGA Tour API error', 
        status: response.status,
        detail: text.substring(0, 200)
      });
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return res.status(502).json({ 
        error: 'GraphQL error', 
        detail: data.errors[0]?.message || 'Unknown'
      });
    }

    const lb = data?.data?.leaderboardV3;
    if (!lb) {
      return res.status(404).json({ 
        error: 'No leaderboard data',
        detail: 'Tournament may not be active'
      });
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
      roundStatus: lb.roundStatus,
      playerCount: players.length,
      players
    });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ 
      error: 'Proxy error', 
      message: err.message 
    });
  }
}
