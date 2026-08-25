import { describe, expect, it } from "vitest";
import {
  classicBidPoints,
  rascalBidPoints,
  cannonballBidPoints,
  applyBonus,
  computeBidPoints,
  recomputePlayerTotals,
  cardsInRound,
  createGame,
  ensureRoundSlots,
  leaderboard,
  isTiedForFirst,
  shouldContinueVoyage,
  lastCompletedRoundIndex,
  completedRoundNumbers,
  STANDARD_ROUNDS,
  MAX_CARDS,
} from "../score.js";

describe("classicBidPoints (Skull King’s scoring)", () => {
  it("awards +20 per trick on exact non-zero bids", () => {
    expect(classicBidPoints(3, 3, 5)).toBe(60);
    expect(classicBidPoints(1, 1, 1)).toBe(20);
  });

  it("awards +10 × cards dealt on exact zero", () => {
    expect(classicBidPoints(0, 0, 1)).toBe(10);
    expect(classicBidPoints(0, 0, 7)).toBe(70);
    expect(classicBidPoints(0, 0, 10)).toBe(100);
  });

  it("penalizes missed zero bids by −10 × cards dealt (not tricks taken)", () => {
    // Rulebook: Johnny bids 0 in round 9, takes 2 → −90
    expect(classicBidPoints(0, 2, 9)).toBe(-90);
    expect(classicBidPoints(0, 1, 9)).toBe(-90);
    expect(classicBidPoints(0, 5, 4)).toBe(-40);
  });

  it("penalizes missed non-zero bids by −10 × |bid − won|", () => {
    expect(classicBidPoints(2, 4, 5)).toBe(-20);
    expect(classicBidPoints(3, 1, 4)).toBe(-20);
    expect(classicBidPoints(1, 0, 1)).toBe(-10);
  });
});

describe("rascal / cannonball scoring", () => {
  it("grapeshot: full / half / none of 10×cards", () => {
    expect(rascalBidPoints(2, 2, 4)).toBe(40);
    expect(rascalBidPoints(2, 1, 4)).toBe(20);
    expect(rascalBidPoints(2, 0, 4)).toBe(0);
  });

  it("cannonball: 15×cards if exact else 0", () => {
    expect(cannonballBidPoints(3, 3, 6)).toBe(90);
    expect(cannonballBidPoints(3, 2, 6)).toBe(0);
  });

  it("computeBidPoints routes modes", () => {
    expect(computeBidPoints(0, 1, 5, "classic")).toBe(-50);
    expect(computeBidPoints(1, 1, 5, "rascal", "grapeshot")).toBe(50);
    expect(computeBidPoints(1, 1, 5, "rascal", "cannonball")).toBe(75);
  });
});

describe("bonuses", () => {
  it("classic bonuses only when bid is exact", () => {
    expect(applyBonus(40, 1, 1, "classic")).toBe(40);
    expect(applyBonus(40, 1, 0, "classic")).toBe(0);
    expect(applyBonus(40, 0, 1, "classic")).toBe(0);
  });

  it("rascal scales bonuses with accuracy", () => {
    expect(applyBonus(20, 1, 1, "rascal", "grapeshot")).toBe(20);
    expect(applyBonus(20, 1, 0, "rascal", "grapeshot")).toBe(10);
    expect(applyBonus(20, 1, 3, "rascal", "grapeshot")).toBe(0);
    expect(applyBonus(20, 1, 0, "rascal", "cannonball")).toBe(0);
  });
});

describe("cardsInRound / overtime slots", () => {
  it("caps cards at MAX_CARDS for overtime rounds", () => {
    expect(cardsInRound(1)).toBe(1);
    expect(cardsInRound(10)).toBe(10);
    expect(cardsInRound(11)).toBe(MAX_CARDS);
    expect(cardsInRound(15)).toBe(MAX_CARDS);
  });

  it("ensureRoundSlots grows player rounds for overtime", () => {
    const g = createGame({ players: ["A", "B"] });
    expect(g.players[0].rounds).toHaveLength(STANDARD_ROUNDS);
    ensureRoundSlots(g, 12);
    expect(g.players[0].rounds).toHaveLength(12);
    expect(g.players[1].rounds).toHaveLength(12);
  });
});

describe("running totals scenario (scorepad example)", () => {
  it("matches classic pad walkthrough for round 1–2", () => {
    // Rascal 0/0 +0 → +10; Alyra 0/0 → +10; Greybeard 1/1 +10 bonus → +30
    const roundsA = [
      { bid: 0, won: 0, bonus: 0, completed: true },
      { bid: 1, won: 1, bonus: 30, completed: true },
    ];
    const roundsB = [
      { bid: 0, won: 0, bonus: 0, completed: true },
      { bid: 2, won: 0, bonus: 0, completed: true },
    ];
    const roundsC = [
      { bid: 1, won: 1, bonus: 10, completed: true },
      { bid: 0, won: 1, bonus: 0, completed: true },
    ];

    const a = recomputePlayerTotals(roundsA, "classic");
    const b = recomputePlayerTotals(roundsB, "classic");
    const c = recomputePlayerTotals(roundsC, "classic");

    expect(a[0].bidPoints).toBe(10);
    expect(a[0].runningTotal).toBe(10);
    expect(a[1].bidPoints).toBe(20);
    expect(a[1].bonusPoints).toBe(30);
    expect(a[1].roundPoints).toBe(50);
    expect(a[1].runningTotal).toBe(60);

    expect(b[1].bidPoints).toBe(-20);
    expect(b[1].runningTotal).toBe(-10);

    expect(c[0].roundPoints).toBe(30);
    expect(c[1].bidPoints).toBe(-20); // missed zero on 2 cards
    expect(c[1].runningTotal).toBe(10);
  });

  it("missed zero on round 2 is −20 (cards dealt), not −10", () => {
    const scored = recomputePlayerTotals(
      [
        { bid: 0, won: 0, bonus: 0, completed: true },
        { bid: 0, won: 1, bonus: 0, completed: true },
      ],
      "classic"
    );
    expect(scored[1].bidPoints).toBe(-20);
    expect(scored[1].bonusPoints).toBe(0);
    expect(scored[1].runningTotal).toBe(-10);
  });
});

describe("ties and voyage continuation", () => {
  function completeRound(game, roundIndex, results) {
    ensureRoundSlots(game, roundIndex + 1);
    game.players.forEach((p, i) => {
      const r = results[i];
      p.rounds[roundIndex] = {
        bid: r.bid,
        won: r.won,
        bonus: r.bonus || 0,
        bidType: "grapeshot",
        completed: true,
      };
    });
    game.currentRound = roundIndex + 1;
  }

  it("detects a tie for first", () => {
    const g = createGame({ players: ["A", "B", "C"] });
    completeRound(g, 0, [
      { bid: 0, won: 0 },
      { bid: 0, won: 0 },
      { bid: 1, won: 0 },
    ]);
    // A +10, B +10, C −10
    expect(isTiedForFirst(g)).toBe(true);
    const board = leaderboard(g);
    expect(board[0].total).toBe(10);
    expect(board[1].total).toBe(10);
  });

  it("continues past round 10 when tied; finishes when sole leader", () => {
    const g = createGame({ players: ["A", "B"] });
    for (let i = 0; i < STANDARD_ROUNDS; i++) {
      completeRound(g, i, [
        { bid: 0, won: 0 },
        { bid: 0, won: 0 },
      ]);
    }
    g.currentRound = STANDARD_ROUNDS;
    expect(isTiedForFirst(g)).toBe(true);
    expect(shouldContinueVoyage(g)).toBe(true);

    // Break the tie in overtime round 11 (10 cards): A nails a 5-bid, B misses zero
    ensureRoundSlots(g, 11);
    completeRound(g, 10, [
      { bid: 5, won: 5 },
      { bid: 0, won: 1 },
    ]);
    g.currentRound = 11;
    expect(isTiedForFirst(g)).toBe(false);
    expect(shouldContinueVoyage(g)).toBe(false);
    expect(leaderboard(g)[0].name).toBe("A");
    expect(leaderboard(g)[0].total).toBeGreaterThan(leaderboard(g)[1].total);
  });

  it("completedRoundNumbers lists all completed rounds even with gaps", () => {
    const g = createGame({ players: ["A", "B"] });
    completeRound(g, 0, [
      { bid: 0, won: 0 },
      { bid: 0, won: 0 },
    ]);
    completeRound(g, 1, [
      { bid: 0, won: 0 },
      { bid: 0, won: 0 },
    ]);
    ensureRoundSlots(g, 4);
    g.players.forEach((p) => {
      p.rounds[3] = { bid: 0, won: 0, bonus: 0, bidType: "grapeshot", completed: true };
    });
    expect(completedRoundNumbers(g)).toEqual([1, 2, 4]);
    expect(lastCompletedRoundIndex(g)).toBe(1);
  });
});
