"use strict";

/** Number of rounds in a standard Skull King game. */
export const TOTAL_ROUNDS = 10;

/**
 * Classic Skull King bid scoring.
 * Correct non-zero: +20 × tricks. Correct zero: +10 × cards dealt.
 * Miss: −10 × |bid − won|.
 */
export function classicBidPoints(bid, won, cardsDealt) {
  const b = Number(bid) || 0;
  const w = Number(won) || 0;
  const cards = Number(cardsDealt) || 1;
  if (b === w) {
    if (b === 0) return 10 * cards;
    return 20 * w;
  }
  return -10 * Math.abs(b - w);
}

/**
 * Rascal / Grapeshot scoring: 10 pts per card dealt.
 * Correct → full; off by 1 → half; else 0.
 * Multiplier applies to bonuses the same way.
 */
export function rascalMultiplier(bid, won) {
  const diff = Math.abs((Number(bid) || 0) - (Number(won) || 0));
  if (diff === 0) return 1;
  if (diff === 1) return 0.5;
  return 0;
}

export function rascalBidPoints(bid, won, cardsDealt) {
  const potential = 10 * (Number(cardsDealt) || 1);
  return potential * rascalMultiplier(bid, won);
}

/**
 * Cannonball: 15 pts per card if exact; else 0. Bonuses also all-or-nothing.
 */
export function cannonballBidPoints(bid, won, cardsDealt) {
  if ((Number(bid) || 0) === (Number(won) || 0)) {
    return 15 * (Number(cardsDealt) || 1);
  }
  return 0;
}

export function cannonballMultiplier(bid, won) {
  return (Number(bid) || 0) === (Number(won) || 0) ? 1 : 0;
}

/**
 * @param {"classic"|"rascal"} scoringMode
 * @param {"grapeshot"|"cannonball"|null} bidType — only used in rascal mode
 */
export function computeBidPoints(bid, won, cardsDealt, scoringMode, bidType) {
  if (scoringMode === "rascal") {
    if (bidType === "cannonball") {
      return cannonballBidPoints(bid, won, cardsDealt);
    }
    return rascalBidPoints(bid, won, cardsDealt);
  }
  return classicBidPoints(bid, won, cardsDealt);
}

/**
 * Bonus multiplier for the round (classic: only if bid exact; rascal/cannonball as above).
 */
export function computeBonusMultiplier(bid, won, scoringMode, bidType) {
  if (scoringMode === "rascal") {
    if (bidType === "cannonball") return cannonballMultiplier(bid, won);
    return rascalMultiplier(bid, won);
  }
  return (Number(bid) || 0) === (Number(won) || 0) ? 1 : 0;
}

export function applyBonus(rawBonus, bid, won, scoringMode, bidType) {
  const raw = Number(rawBonus) || 0;
  const mult = computeBonusMultiplier(bid, won, scoringMode, bidType);
  return Math.round(raw * mult);
}

export function roundPoints(bidPoints, bonusPoints) {
  return (Number(bidPoints) || 0) + (Number(bonusPoints) || 0);
}

/**
 * Recompute a player's round scores and running totals.
 * @param {Array<{bid:number|null, won:number|null, bonus:number, bidType?:string, completed?:boolean}>} rounds
 */
export function recomputePlayerTotals(rounds, scoringMode) {
  let running = 0;
  return rounds.map((r, i) => {
    const cardsDealt = i + 1;
    const bid = r.bid;
    const won = r.won;
    const incomplete = bid == null || won == null || !r.completed;
    let bidPts = 0;
    let bonusPts = 0;
    let roundPts = 0;
    if (!incomplete) {
      bidPts = computeBidPoints(bid, won, cardsDealt, scoringMode, r.bidType || "grapeshot");
      bonusPts = applyBonus(r.bonus || 0, bid, won, scoringMode, r.bidType || "grapeshot");
      roundPts = roundPoints(bidPts, bonusPts);
      running += roundPts;
    }
    return {
      ...r,
      cardsDealt,
      bidPoints: incomplete ? null : bidPts,
      bonusPoints: incomplete ? null : bonusPts,
      roundPoints: incomplete ? null : roundPts,
      runningTotal: incomplete ? null : running,
    };
  });
}

export function emptyRound() {
  return {
    bid: null,
    won: null,
    bonus: 0,
    bidType: "grapeshot",
    completed: false,
  };
}

export function createPlayer(name, id) {
  return {
    id: id || crypto.randomUUID(),
    name: String(name || "").trim() || "Pirate",
    rounds: Array.from({ length: TOTAL_ROUNDS }, () => emptyRound()),
  };
}

export function createGame({ players, scoringMode = "classic", title } = {}) {
  const names = (players || []).map((p) => (typeof p === "string" ? p : p.name));
  return {
    id: crypto.randomUUID(),
    title: title || defaultGameTitle(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    scoringMode: scoringMode === "rascal" ? "rascal" : "classic",
    currentRound: 1,
    /** @type {"bidding"|"tricks"|"bonuses"|"review"|"finished"} */
    phase: "bidding",
    /** Index of player whose turn it is within the current phase (0-based). */
    turnIndex: 0,
    players: names.map((n) => createPlayer(n)),
  };
}

export function defaultGameTitle(date = new Date()) {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function leaderboard(game) {
  const mode = game.scoringMode;
  return game.players
    .map((p) => {
      const scored = recomputePlayerTotals(p.rounds, mode);
      const last = [...scored].reverse().find((r) => r.runningTotal != null);
      return {
        id: p.id,
        name: p.name,
        total: last ? last.runningTotal : 0,
        rounds: scored,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function totalTricksWon(game, roundIndex) {
  return game.players.reduce((sum, p) => {
    const w = p.rounds[roundIndex]?.won;
    return sum + (typeof w === "number" ? w : 0);
  }, 0);
}

export function cardsInRound(roundNumber) {
  return Math.min(Math.max(1, roundNumber), TOTAL_ROUNDS);
}
