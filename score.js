"use strict";

/** Standard voyage length before possible overtime ties. */
export const STANDARD_ROUNDS = 10;

/** @deprecated use STANDARD_ROUNDS — kept for older imports */
export const TOTAL_ROUNDS = STANDARD_ROUNDS;

/** Max cards dealt in a hand (round 10 and overtime). */
export const MAX_CARDS = 10;

/**
 * Classic Skull King bid scoring (rulebook “The Skull King’s Scoring”).
 * Correct non-zero: +20 × tricks.
 * Correct zero: +10 × cards dealt.
 * Missed non-zero: −10 × |bid − won|.
 * Missed zero: −10 × cards dealt (not −10 × tricks taken).
 */
export function classicBidPoints(bid, won, cardsDealt) {
  const b = Number(bid) || 0;
  const w = Number(won) || 0;
  const cards = Number(cardsDealt) || 1;
  if (b === w) {
    if (b === 0) return 10 * cards;
    return 20 * w;
  }
  if (b === 0) return -10 * cards;
  return -10 * Math.abs(b - w);
}

/**
 * Rascal / Grapeshot scoring: 10 pts per card dealt.
 * Correct → full; off by 1 → half; else 0.
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

/** Cannonball: 15 pts per card if exact; else 0. */
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

/** Cards dealt for a round number (overtime stays at MAX_CARDS). */
export function cardsInRound(roundNumber) {
  return Math.min(Math.max(1, Number(roundNumber) || 1), MAX_CARDS);
}

/**
 * Recompute a player's round scores and running totals.
 * cardsDealt uses round index + 1, capped at MAX_CARDS for overtime.
 */
export function recomputePlayerTotals(rounds, scoringMode) {
  let running = 0;
  return (rounds || []).map((r, i) => {
    const cardsDealt = cardsInRound(i + 1);
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

function newId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `sk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createPlayer(name, id) {
  return {
    id: id || newId(),
    name: String(name || "").trim() || "Pirate",
    rounds: Array.from({ length: STANDARD_ROUNDS }, () => emptyRound()),
  };
}

/** Grow each player's rounds array through `throughRound` (1-based). */
export function ensureRoundSlots(game, throughRound) {
  const need = Math.max(1, Number(throughRound) || 1);
  for (const p of game.players) {
    while (p.rounds.length < need) {
      p.rounds.push(emptyRound());
    }
  }
  return game;
}

export function createGame({ players, scoringMode = "classic", title } = {}) {
  const names = (players || []).map((p) => (typeof p === "string" ? p : p.name));
  return {
    id: newId(),
    title: title || defaultGameTitle(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    scoringMode: scoringMode === "rascal" ? "rascal" : "classic",
    currentRound: 1,
    /** @type {"bidding"|"tricks"|"bonuses"|"review"|"finished"} */
    phase: "bidding",
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

/** True when two or more players share the top score. */
export function isTiedForFirst(game) {
  const board = leaderboard(game);
  if (board.length < 2) return false;
  return board[0].total === board[1].total;
}

/**
 * After completing the current round review: continue if under 10 rounds,
 * or if still tied for first (overtime 11, 12, …).
 */
export function shouldContinueVoyage(game) {
  if (game.currentRound < STANDARD_ROUNDS) return true;
  return isTiedForFirst(game);
}

export function totalTricksWon(game, roundIndex) {
  return game.players.reduce((sum, p) => {
    const w = p.rounds[roundIndex]?.won;
    return sum + (typeof w === "number" ? w : 0);
  }, 0);
}

/** Highest contiguous completed round index from the start (0-based), or -1. */
export function lastCompletedRoundIndex(game) {
  let last = -1;
  const len = Math.max(...game.players.map((p) => p.rounds.length), 0);
  for (let i = 0; i < len; i++) {
    if (game.players.every((p) => p.rounds[i]?.completed)) last = i;
    else break;
  }
  return last;
}

/** 1-based round numbers that are fully completed (may include gaps while editing). */
export function completedRoundNumbers(game) {
  const len = Math.max(...game.players.map((p) => p.rounds.length), 0);
  const out = [];
  for (let i = 0; i < len; i++) {
    if (game.players.every((p) => p.rounds[i]?.completed)) out.push(i + 1);
  }
  return out;
}
