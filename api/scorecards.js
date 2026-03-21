// /api/scorecards.js — Fetch hole-by-hole scorecards + compute DK fantasy points
// Deploy alongside leaderboard.js in your golf-proxy Vercel project

const GQL_URL = 'https://orchestrator.pgatour.com/graphql';
const API_KEY = 'da2-gsrx5bibzbb4njvhl7t37wqyl4';

const SCORECARD_QUERY = `query Scorecard($tournamentId: ID!, $playerId: ID!) {
  scorecardV3(tournamentId: $tournamentId, playerId: $playerId) {
    id currentRound playerState
    roundScores {
      roundNumber currentRound complete total scoreToPar parTotal
      firstNine { holes { holeNumber par score status roundScore } }
      secondNine { holes { holeNumber par score status roundScore } }
    }
  }
}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const tournamentId = req.query.tournamentId || 'R2026475';
    const ids = (req.query.ids || '').split(',').filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'ids parameter required (comma-separated player IDs)' });
    if (ids.length > 80) return res.status(400).json({ error: 'Max 80 players per request' });

    // Fetch scorecards in parallel (batches of 10 to avoid rate limiting)
    const results = [];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(id => fetchScorecard(tournamentId, id))
      );
      results.push(...batchResults);
    }

    return res.status(200).json({
      tournamentId,
      lastUpdated: new Date().toISOString(),
      playerCount: results.length,
      players: results
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function fetchScorecard(tournamentId, playerId) {
  try {
    const resp = await fetch(GQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify({
        operationName: 'Scorecard',
        query: SCORECARD_QUERY,
        variables: { tournamentId, playerId }
      })
    });
    if (!resp.ok) return { playerId, error: 'HTTP ' + resp.status };
    const data = await resp.json();
    if (data.errors) return { playerId, error: data.errors[0].message };

    const sc = data.data.scorecardV3;
    if (!sc) return { playerId, error: 'No scorecard data' };

    // Process all rounds
    const rounds = (sc.roundScores || []).map(rs => {
      const holes = [
        ...(rs.firstNine?.holes || []),
        ...(rs.secondNine?.holes || [])
      ];
      const played = holes.filter(h => h.score !== '-' && h.score !== '' && h.score != null);
      const dk = computeDKPoints(played, rs.complete, parseInt(rs.total) || 0);
      return {
        roundNumber: rs.roundNumber,
        isCurrent: rs.currentRound,
        complete: rs.complete,
        total: rs.total,
        scoreToPar: rs.scoreToPar,
        holesPlayed: played.length,
        holes: played.map(h => ({
          hole: h.holeNumber,
          par: h.par,
          score: parseInt(h.score),
          status: h.status
        })),
        dk: dk
      };
    });

    // Sum DK points across all rounds
    const totalDK = rounds.reduce((sum, r) => sum + r.dk.total, 0);

    return {
      playerId,
      playerState: sc.playerState,
      currentRound: sc.currentRound,
      rounds,
      dkPointsTotal: Math.round(totalDK * 100) / 100,
      // CRITICAL: Only return current round DK pts if round is IN PROGRESS.
      // If the round is complete, those points are already in the CSV snapshot.
      // Adding them again would double-count.
      dkPointsCurrentRound: (() => {
        const cr = rounds.find(r => r.isCurrent);
        if (!cr) return 0;
        if (cr.complete) return 0; // Already in CSV — don't double-count
        if (cr.holesPlayed === 0) return 0; // Round hasn't started
        return cr.dk.total;
      })()
    };
  } catch (err) {
    return { playerId, error: err.message };
  }
}

function computeDKPoints(holes, roundComplete, roundStrokes) {
  let points = 0;
  let bogeyFree = true;
  let birdieStreak = 0;
  let streakBonusAwarded = false; // MAX 1 streak bonus per round
  const breakdown = { doubleEagles: 0, eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, worseThanDouble: 0, holeInOnes: 0 };

  holes.forEach(h => {
    const score = parseInt(h.score);
    const par = h.par;
    if (isNaN(score) || isNaN(par)) return;
    const diff = score - par;

    if (diff <= -3) {
      // Double Eagle (Albatross) or better: +13
      points += 13;
      breakdown.doubleEagles++;
      if (score === 1) {
        // Hole in one bonus: +10 (on top of eagle/double eagle pts)
        // A HIO on a par 3 is eagle (+8 normally, but here it's -2 so eagle)
        // A HIO on a par 4 is double eagle (+13)
        // The +10 is a separate bonus
        points += 10;
        breakdown.holeInOnes++;
      }
      birdieStreak++;
    } else if (diff === -2) {
      // Eagle: +8
      points += 8;
      breakdown.eagles++;
      if (score === 1) {
        // Hole in one on a par 3
        points += 10;
        breakdown.holeInOnes++;
      }
      birdieStreak++;
    } else if (diff === -1) {
      // Birdie: +3
      points += 3;
      breakdown.birdies++;
      birdieStreak++;
    } else if (diff === 0) {
      // Par: +0.5
      points += 0.5;
      breakdown.pars++;
      // Par breaks birdie streak — check before resetting
      if (birdieStreak >= 3 && !streakBonusAwarded) {
        points += 3;
        streakBonusAwarded = true;
      }
      birdieStreak = 0;
    } else if (diff === 1) {
      // Bogey: -0.5
      points -= 0.5;
      breakdown.bogeys++;
      bogeyFree = false;
      if (birdieStreak >= 3 && !streakBonusAwarded) {
        points += 3;
        streakBonusAwarded = true;
      }
      birdieStreak = 0;
    } else if (diff === 2) {
      // Double Bogey: -1
      points -= 1;
      breakdown.doubles++;
      bogeyFree = false;
      if (birdieStreak >= 3 && !streakBonusAwarded) {
        points += 3;
        streakBonusAwarded = true;
      }
      birdieStreak = 0;
    } else {
      // Worse than Double Bogey: -1
      points -= 1;
      breakdown.worseThanDouble++;
      bogeyFree = false;
      if (birdieStreak >= 3 && !streakBonusAwarded) {
        points += 3;
        streakBonusAwarded = true;
      }
      birdieStreak = 0;
    }
  });

  // Check if birdie streak was active at end of holes played
  if (birdieStreak >= 3 && !streakBonusAwarded) {
    points += 3;
    streakBonusAwarded = true;
  }

  // Bogey-free round bonus: +3 (only if round is complete and all 18 holes played)
  let bogeyFreeBonus = 0;
  if (roundComplete && holes.length === 18 && bogeyFree) {
    points += 3;
    bogeyFreeBonus = 3;
  }

  // Under 70 strokes bonus: +3 (only if round complete)
  let under70Bonus = 0;
  if (roundComplete && roundStrokes > 0 && roundStrokes < 70) {
    points += 3;
    under70Bonus = 3;
  }

  return {
    total: Math.round(points * 100) / 100,
    breakdown,
    streakBonus: streakBonusAwarded ? 3 : 0,
    bogeyFreeBonus,
    under70Bonus
  };
}

// Tournament finish position bonus points
// Applied to total DK points based on final or projected position
const FINISH_POINTS = {
  1: 30, 2: 20, 3: 18, 4: 16, 5: 14,
  6: 12, 7: 10, 8: 9, 9: 8, 10: 7
};
function getFinishBonus(position) {
  if (!position) return 0;
  // Parse position string like "T16", "1", "T3"
  const num = parseInt(String(position).replace(/^T/i, ''));
  if (isNaN(num) || num < 1) return 0;
  if (FINISH_POINTS[num]) return FINISH_POINTS[num];
  if (num <= 15) return 6;
  if (num <= 20) return 5;
  if (num <= 25) return 4;
  if (num <= 30) return 3;
  if (num <= 40) return 2;
  if (num <= 50) return 1;
  return 0;
}
