"use strict";

import { GameDB } from "./db.js";
import {
  STANDARD_ROUNDS,
  createGame,
  cardsInRound,
  recomputePlayerTotals,
  leaderboard,
  totalTricksWon,
  ensureRoundSlots,
  shouldContinueVoyage,
  lastCompletedRoundIndex,
  completedRoundNumbers,
  isTiedForFirst,
  effectiveBid,
  formatBidDisplay,
  startingPlayerForRound,
  nextTurnIndex,
  firstTurnIndexForPhase,
  allBidsLocked,
  allTricksEntered,
  allBonusesEntered,
  normalizeGame,
} from "./score.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const SETTINGS_KEY = "skull-king.settings.v1";
const BUILD_HASH = "__BUILD_HASH__";

const DEFAULT_SETTINGS = {
  defaultScoring: "classic",
  warnTrickMismatch: true,
  wakeLock: true,
  haptic: true,
};

const state = {
  view: "home",
  game: null,
  playTab: "turn",
  setupNames: ["", "", ""],
  setupStartingPlayer: 0,
  /** Pending crew when 2-player ghost prompt is shown */
  pendingStart: null,
  settingsReturnView: "home",
  settings: loadSettings(),
  wakeLockSentinel: null,
  hapticAudio: null,
  /** Cached Vibration API usability; null until first probe. */
  vibrateOk: null,
  /** 1-based completed round being browsed; null = live turn UI */
  browseRound: null,
  /** Restore point after editing a past round */
  resumeAfterEdit: null,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function scoringLabel(mode) {
  return mode === "rascal" ? "Rascal’s (Cannonball / Grapeshot)" : "Classic";
}

/**
 * Prefer the Vibration API when it is present and reports success.
 * Only fall back to haptic.mp3 when vibrate is missing or returns false.
 */
function isVibrationAvailable() {
  if (state.vibrateOk != null) return state.vibrateOk;
  if (typeof navigator.vibrate !== "function") {
    state.vibrateOk = false;
    return false;
  }
  try {
    // Cancel any ongoing vibration; false means the API is not usable here.
    state.vibrateOk = navigator.vibrate(0) === true;
  } catch {
    state.vibrateOk = false;
  }
  return state.vibrateOk;
}

function playHapticAudio() {
  try {
    if (!state.hapticAudio) {
      state.hapticAudio = new Audio("./haptic.mp3");
      state.hapticAudio.preload = "auto";
    }
    const a = state.hapticAudio;
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    /* ignore autoplay / decode errors */
  }
}

/** Light tick for steppers / chips. */
function hapticTick() {
  if (!state.settings.haptic) return;
  if (isVibrationAvailable()) {
    try {
      if (navigator.vibrate(12)) return;
      state.vibrateOk = false;
    } catch {
      state.vibrateOk = false;
    }
  }
  playHapticAudio();
}

/** Stronger confirm for lock / advance. */
function hapticConfirm() {
  if (!state.settings.haptic) return;
  if (isVibrationAvailable()) {
    try {
      if (navigator.vibrate([16, 40, 16])) return;
      state.vibrateOk = false;
    } catch {
      state.vibrateOk = false;
    }
  }
  playHapticAudio();
}

function toast(msg, ms = 2200) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

function setView(name) {
  state.view = name;
  $("#app").dataset.view = name;
  $$("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== name;
  });
  syncWakeLock();
}

async function saveGame() {
  if (!state.game) return;
  state.game = await GameDB.put(state.game);
}

function phaseLabel(phase) {
  switch (phase) {
    case "bidding":
      return "Bidding";
    case "tricks":
      return "Tricks";
    case "bonuses":
      return "Bonuses";
    case "review":
      return "Round review";
    case "finished":
      return "Final standings";
    default:
      return phase;
  }
}

function currentRoundIndex(game) {
  return Math.max(0, (Number(game.currentRound) || 1) - 1);
}

function playerRound(player, roundIndex) {
  return player.rounds[roundIndex];
}

function roundCount(game) {
  return Math.max(STANDARD_ROUNDS, game.currentRound, ...(game.players.map((p) => p.rounds.length) || [0]));
}

/** Round number shown in history browse, or live current. */
function displayedRoundNumber(game) {
  return state.browseRound || game.currentRound;
}

/* ---------- HOME ---------- */

async function renderHome() {
  const list = $("#gameList");
  const empty = $("#homeEmpty");
  const games = await GameDB.list();
  list.innerHTML = "";
  empty.hidden = games.length > 0;

  for (const g of games) {
    const board = leaderboard(g);
    const leader = board[0];
    const done = g.phase === "finished";
    const card = document.createElement("button");
    card.type = "button";
    card.className = "game-card";
    card.setAttribute("role", "listitem");
    card.innerHTML = `
      <div class="game-card-top">
        <span class="game-card-title">${escapeHtml(g.title)}</span>
        <span class="pill ${done ? "pill-done" : ""}">${done ? "Finished" : `R${g.currentRound}`}</span>
      </div>
      <div class="game-card-meta">
        ${g.players.length} pirates · ${g.scoringMode === "rascal" ? "Rascal" : "Classic"}
        ${leader ? ` · ${escapeHtml(leader.name)} ${leader.total}` : ""}
      </div>
      <div class="game-card-actions">
        <span class="linkish danger" data-delete="${g.id}">Delete</span>
      </div>
    `;
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-delete]")) return;
      openGame(g.id);
    });
    card.querySelector("[data-delete]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this voyage?")) return;
      await GameDB.remove(g.id);
      renderHome();
      toast("Deleted");
    });
    list.appendChild(card);
  }
}

async function openGame(id) {
  const g = await GameDB.get(id);
  if (!g) {
    toast("Game not found");
    return;
  }
  normalizeGame(g);
  state.game = g;
  state.playTab = "turn";
  state.browseRound = null;
  state.resumeAfterEdit = null;
  setView("play");
  renderPlay();
}

/* ---------- SETUP ---------- */

function renderSetup() {
  const wrap = $("#playersSetup");
  wrap.innerHTML = "";
  state.setupNames.forEach((name, i) => {
    const row = document.createElement("label");
    row.className = "field player-row";
    row.innerHTML = `
      <span>Pirate ${i + 1}</span>
      <div class="player-row-inputs">
        <input type="text" maxlength="20" autocomplete="nickname" data-player-i="${i}" value="${escapeAttr(name)}" placeholder="Name" />
        ${
          state.setupNames.length > 2
            ? `<button type="button" class="icon-btn danger" data-remove-i="${i}" aria-label="Remove">×</button>`
            : ""
        }
      </div>
    `;
    wrap.appendChild(row);
  });

  const filled = state.setupNames.map((n) => n.trim()).filter(Boolean);
  let leadField = $("#startingPlayerField");
  if (!leadField) {
    const setupBody = $(".setup-body");
    const addBtn = $("#addPlayerBtn");
    leadField = document.createElement("label");
    leadField.className = "field";
    leadField.id = "startingPlayerField";
    setupBody.insertBefore(leadField, addBtn);
  }
  updateStartingPlayerSelect();

  wrap.querySelectorAll("input[data-player-i]").forEach((input) => {
    input.addEventListener("input", () => {
      state.setupNames[+input.dataset.playerI] = input.value;
      updateStartingPlayerSelect();
    });
  });
  wrap.querySelectorAll("[data-remove-i]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = +btn.dataset.removeI;
      if (state.setupNames.length <= 2) return;
      state.setupNames.splice(i, 1);
      if (state.setupStartingPlayer >= state.setupNames.length) {
        state.setupStartingPlayer = 0;
      }
      renderSetup();
    });
  });
}

function updateStartingPlayerSelect() {
  const leadField = $("#startingPlayerField");
  if (!leadField) return;
  const filled = state.setupNames.map((n) => n.trim()).filter(Boolean);
  if (filled.length < 2) {
    leadField.hidden = true;
    return;
  }
  if (state.setupStartingPlayer >= filled.length) state.setupStartingPlayer = 0;
  leadField.hidden = false;
  leadField.innerHTML = `
    <span>First to lead (round 1)</span>
    <select id="startingPlayerSelect">
      ${filled
        .map(
          (n, i) =>
            `<option value="${i}" ${i === state.setupStartingPlayer ? "selected" : ""}>${escapeHtml(n)}</option>`
        )
        .join("")}
    </select>
  `;
  $("#startingPlayerSelect")?.addEventListener("change", (e) => {
    state.setupStartingPlayer = Number(e.target.value) || 0;
  });
}

function startSetup() {
  state.setupNames = ["", "", ""];
  state.setupStartingPlayer = 0;
  state.pendingStart = null;
  $("#scoringModeSelect").value = state.settings.defaultScoring === "rascal" ? "rascal" : "classic";
  setView("setup");
  renderSetup();
}

function collectSetupNames() {
  const fromDom = $$("#playersSetup input[data-player-i]").map((el) => el.value.trim());
  return (fromDom.length ? fromDom : state.setupNames).map((n) => n.trim()).filter(Boolean);
}

async function launchGame({ names, scoringMode, withGhost = false, startingPlayerIndex = 0 }) {
  const players = withGhost
    ? [{ name: names[0] }, { name: "Greybeard's Ghost", ghost: true }, { name: names[1] }]
    : names.map((name) => ({ name }));
  const startIdx = withGhost ? (startingPlayerIndex === 0 ? 0 : 2) : startingPlayerIndex;
  state.game = createGame({ players, scoringMode, startingPlayerIndex: startIdx });
  state.game.turnIndex = firstTurnIndexForPhase(state.game, 1, "bidding");
  await saveGame();
  state.playTab = "turn";
  state.browseRound = null;
  state.resumeAfterEdit = null;
  state.pendingStart = null;
  setView("play");
  renderPlay();
  toast("Round 1 — place your bids");
}

function openGhostSheet(names, scoringMode, startingPlayerIndex) {
  state.pendingStart = { names, scoringMode, startingPlayerIndex };
  const sheet = $("#ghostSheet");
  if (sheet) sheet.hidden = false;
}

function closeGhostSheet() {
  const sheet = $("#ghostSheet");
  if (sheet) sheet.hidden = true;
  state.pendingStart = null;
}

async function startGame() {
  const names = collectSetupNames();
  if (names.length < 2) {
    toast("Need at least 2 pirates");
    return;
  }
  if (names.length > 8) {
    toast("Max 8 pirates");
    return;
  }
  const scoringMode = $("#scoringModeSelect").value;
  const filled = names;
  let startingPlayerIndex = 0;
  const leadSel = $("#startingPlayerSelect");
  if (leadSel) {
    startingPlayerIndex = Math.min(Number(leadSel.value) || 0, filled.length - 1);
  }

  if (names.length === 2) {
    openGhostSheet(names, scoringMode, startingPlayerIndex);
    return;
  }

  await launchGame({ names, scoringMode, startingPlayerIndex });
}

/* ---------- PLAY ---------- */

function renderPlay() {
  const g = state.game;
  if (!g) return;

  const browsing = state.browseRound != null;
  const showRound = displayedRoundNumber(g);
  const cards = cardsInRound(showRound);

  if (g.phase === "finished" && !browsing) {
    $("#playTitle").textContent = "Final";
    $("#playPhase").textContent = phaseLabel(g.phase);
  } else if (browsing) {
    $("#playTitle").textContent = `Round ${showRound} · ${cards} cards`;
    $("#playPhase").textContent = "History — swipe to browse";
  } else {
    $("#playTitle").textContent = `Round ${g.currentRound} · ${cardsInRound(g.currentRound)} cards`;
    const leader = startingPlayerForRound(g, g.currentRound);
    const phaseText =
      g.currentRound > STANDARD_ROUNDS ? `Overtime · ${phaseLabel(g.phase)}` : phaseLabel(g.phase);
    $("#playPhase").textContent = leader ? `${phaseText} · Leads: ${leader.name}` : phaseText;
  }

  const prog = $("#playProgress");
  const dots = roundCount(g);
  prog.innerHTML = Array.from({ length: dots }, (_, i) => {
    const n = i + 1;
    let cls = "dot";
    const completed = g.players.every((p) => p.rounds[i]?.completed);
    if (completed) cls += " done";
    if (browsing ? n === state.browseRound : n === g.currentRound && g.phase !== "finished") {
      cls += " current";
    }
    if (g.phase === "finished" && !browsing && n === g.currentRound) cls += " current";
    return `<button type="button" class="${cls}" data-round-dot="${n}" title="Round ${n}" aria-label="Round ${n}"></button>`;
  }).join("");

  $$("#playTabs .tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === state.playTab);
  });

  const body = $("#playBody");
  if (state.playTab === "pad") {
    body.innerHTML = renderScorepad(g);
    bindScorepadControls(body);
  } else if (state.playTab === "standings") {
    body.innerHTML = renderStandings(g);
    bindStandingsControls(body);
  } else if (browsing) {
    body.innerHTML = renderHistoryRound(g, state.browseRound - 1);
    bindTurnControls(body);
  } else {
    body.innerHTML = renderTurn(g);
    bindTurnControls(body);
  }
  bindRoundSwipe(body);
  syncWakeLock();
}

function renderStandings(g) {
  const board = leaderboard(g);
  const finished = g.phase === "finished";
  const tied = isTiedForFirst(g);
  const winner = board[0];

  let hero = "";
  if (finished && winner && !tied) {
    hero = `
      <div class="winner-banner" aria-live="polite">
        <div class="winner-name">${escapeHtml(winner.name)}</div>
        <div class="winner-wins">Wins!</div>
      </div>`;
  } else if (finished && tied) {
    hero = `<p class="crown">☠ Deadlock — keep sailing</p>`;
  }

  return `
    <div class="standings">
      ${hero}
      <ol class="standings-list">
        ${board
          .map(
            (p, i) => `
          <li class="standings-row ${i === 0 ? "leader" : ""}">
            <span class="rank">${i + 1}</span>
            <span class="name">${escapeHtml(p.name)}</span>
            <span class="score">${p.total}</span>
          </li>`
          )
          .join("")}
      </ol>
    </div>
  `;
}

function bindStandingsControls() {
  /* no-op reserved */
}

function playerScored(player, mode) {
  if (player.ghost) {
    let run = 0;
    return player.rounds.map((r) => {
      const row = {
        bid: r?.bid ?? null,
        won: r?.won ?? null,
        bidPoints: 0,
        bonusPoints: 0,
        roundPoints: 0,
        runningTotal: run,
        completed: !!r?.completed,
        bidType: r?.bidType,
      };
      return row;
    });
  }
  return recomputePlayerTotals(player.rounds, mode);
}

function renderScorepad(g) {
  const mode = g.scoringMode;
  const players = g.players.map((p) => ({
    ...p,
    scored: playerScored(p, mode),
  }));
  const rowsN = Math.max(...players.map((p) => p.scored.length), STANDARD_ROUNDS);

  const head = players
    .map((p) => `<th scope="col"><span>${escapeHtml(p.name)}</span></th>`)
    .join("");

  const rows = Array.from({ length: rowsN }, (_, ri) => {
    const lead = startingPlayerForRound(g, ri + 1);
    const cells = players
      .map((p) => {
        const r = p.scored[ri] || { bid: null, won: null, completed: false };
        const raw = p.rounds[ri];
        const bid = p.ghost || raw?.bid == null ? "—" : formatBidDisplay(raw);
        const won = r.won == null ? "—" : r.won;
        const bidPts = r.bidPoints == null ? "" : formatPts(r.bidPoints);
        const bonus = r.completed ? String(r.bonusPoints ?? 0) : "";
        const roundPts = r.roundPoints == null ? "" : formatPts(r.roundPoints);
        const run = r.runningTotal == null ? "" : formatPts(r.runningTotal);
        const bidType =
          mode === "rascal" && r.bid != null
            ? `<span class="bid-type" title="${r.bidType}">${r.bidType === "cannonball" ? "●" : "○"}</span>`
            : "";
        return `
          <td>
            <div class="cell ${ri + 1 === g.currentRound && g.phase !== "finished" ? "cell-current" : ""} ${r.completed ? "cell-done" : ""}" data-edit-round="${ri + 1}">
              <div class="cell-row">
                <span class="bid-result">${bid}/${won}</span>
                <span class="bid-pts">${bidPts}</span>
              </div>
              <div class="cell-row">
                <span class="bonus">${bonus}${bidType}</span>
                <span class="running">${run}</span>
              </div>
              <div class="cell-round">${roundPts}</div>
            </div>
          </td>`;
      })
      .join("");
    return `
      <tr>
        <th scope="row" class="round-label" data-edit-round="${ri + 1}">
          <span class="rn">${ri + 1}</span>
          <span class="cards">${cardsInRound(ri + 1)}</span>
          <span class="lead-tag" title="Leads: ${escapeAttr(lead.name)}">⚓ ${escapeHtml(lead.name.split(/\s+/)[0])}</span>
        </th>
        ${cells}
      </tr>`;
  }).join("");

  const totals = players
    .map((p) => {
      const last = [...p.scored].reverse().find((r) => r.runningTotal != null);
      return `<td class="total-cell">${last ? formatPts(last.runningTotal) : "0"}</td>`;
    })
    .join("");

  return `
    <div class="scorepad-scroll">
      <table class="scorepad">
        <thead>
          <tr>
            <th class="corner" scope="col">R</th>
            ${head}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th scope="row">Σ</th>
            ${totals}
          </tr>
        </tfoot>
      </table>
      <p class="legend muted">Tap a completed round to edit · bid/won · bid pts · bonus · round · running</p>
    </div>
  `;
}

function bindScorepadControls(root) {
  root.querySelectorAll("[data-edit-round]").forEach((el) => {
    el.addEventListener("click", async () => {
      const n = Number(el.dataset.editRound);
      const g = state.game;
      if (!g || !g.players.every((p) => p.rounds[n - 1]?.completed)) return;
      await browseOrEditRound(n, { edit: true });
    });
  });
}

function renderTurn(g) {
  if (g.phase === "finished") {
    return renderStandings(g);
  }

  const ri = currentRoundIndex(g);
  const cards = cardsInRound(g.currentRound);
  const player = g.players[g.turnIndex % g.players.length];
  const round = playerRound(player, ri);

  if (g.phase === "review") {
    return renderReview(g, ri);
  }

  if (g.phase === "bidding") {
    const harryAdj = Number(round.harryAdjust) || 0;
    const effBid = effectiveBid(round, cards);
    return `
      <div class="turn-card">
        <p class="turn-who"><span class="eyebrow">Bid</span> ${escapeHtml(player.name)}</p>
        <p class="hint">Tricks you’ll take this round (0–${cards})</p>
        <div class="stepper" data-stepper="bid">
          <button type="button" class="stepper-btn" data-delta="-1" aria-label="Decrease">−</button>
          <div class="stepper-value" id="stepValue">${round.bid ?? 0}</div>
          <button type="button" class="stepper-btn" data-delta="1" aria-label="Increase">+</button>
        </div>
        ${
          harryAdj !== 0
            ? `<p class="hint harry-hint">Scoring bid: <strong>${effBid}</strong> (Harry ${harryAdj > 0 ? "+" : ""}${harryAdj})</p>`
            : ""
        }
        <div class="harry-row" role="group" aria-label="Harry the Giant bid adjustment">
          <button type="button" class="btn btn-secondary harry-btn ${harryAdj === 1 ? "active" : ""}" data-harry="1">Add Harry (+1)</button>
          <button type="button" class="chip ${harryAdj === -1 ? "active" : ""}" data-harry="-1">−1</button>
          <button type="button" class="chip ${harryAdj === 0 ? "active" : ""}" data-harry="0">Clear</button>
        </div>
        ${
          g.scoringMode === "rascal"
            ? `
          <div class="bid-type-toggle" role="group" aria-label="Bid type">
            <button type="button" class="chip ${round.bidType !== "cannonball" ? "active" : ""}" data-bid-type="grapeshot">Grapeshot ○</button>
            <button type="button" class="chip ${round.bidType === "cannonball" ? "active" : ""}" data-bid-type="cannonball">Cannonball ●</button>
          </div>`
            : ""
        }
        <div class="turn-actions">
          <button type="button" class="btn btn-primary btn-block" id="confirmTurnBtn">Lock bid</button>
        </div>
        <div class="roster">${renderRosterBids(g, ri)}</div>
      </div>
    `;
  }

  if (g.phase === "tricks") {
    const wonTotal = totalTricksWon(g, ri);
    const bidLabel = formatBidDisplay(round);
    return `
      <div class="turn-card">
        <p class="turn-who"><span class="eyebrow">Tricks won</span> ${escapeHtml(player.name)}</p>
        <p class="hint">Bid was <strong>${bidLabel}</strong> · ${wonTotal} / ${cards} tricks claimed</p>
        <div class="stepper" data-stepper="won">
          <button type="button" class="stepper-btn" data-delta="-1" aria-label="Decrease">−</button>
          <div class="stepper-value" id="stepValue">${round.won ?? 0}</div>
          <button type="button" class="stepper-btn" data-delta="1" aria-label="Increase">+</button>
        </div>
        <div class="quick-row">
          ${Array.from({ length: cards + 1 }, (_, n) => n)
            .map((n) => `<button type="button" class="chip quick" data-set="${n}">${n}</button>`)
            .join("")}
        </div>
        <div class="turn-actions">
          <button type="button" class="btn btn-primary btn-block" id="confirmTurnBtn">Next pirate</button>
        </div>
        <div class="roster">${renderRosterTricks(g, ri)}</div>
      </div>
    `;
  }

  // bonuses
  return `
    <div class="turn-card">
      <p class="turn-who"><span class="eyebrow">Bonus</span> ${escapeHtml(player.name)}</p>
      <p class="hint">Bid ${formatBidDisplay(round)}/${round.won} · enter raw bonus (only counts if bid is exact)</p>
      <div class="stepper" data-stepper="bonus">
        <button type="button" class="stepper-btn" data-delta="-10" aria-label="Decrease">−10</button>
        <div class="stepper-value" id="stepValue">${round.bonus ?? 0}</div>
        <button type="button" class="stepper-btn" data-delta="10" aria-label="Increase">+10</button>
      </div>
      <div class="quick-row">
        ${[0, 10, 20, 30, 40, 50]
          .map((n) => `<button type="button" class="chip quick" data-set="${n}">${n}</button>`)
          .join("")}
      </div>
      <div class="turn-actions">
        <button type="button" class="btn btn-primary btn-block" id="confirmTurnBtn">Next pirate</button>
      </div>
      <div class="roster">${renderRosterBonuses(g, ri)}</div>
    </div>
  `;
}

function renderHistoryRound(g, ri) {
  return `
    ${renderReview(g, ri, { history: true })}
    <p class="swipe-hint muted">Swipe for other rounds · tap Edit to fix mistakes</p>
  `;
}

function renderReview(g, ri, opts = {}) {
  const mode = g.scoringMode;
  const roundNum = ri + 1;
  const rows = g.players
    .map((p) => {
      const scored = playerScored(
        { ...p, rounds: p.rounds.map((r, i) => (i === ri ? { ...r, completed: true } : r)) },
        mode
      )[ri];
      return `
        <li class="review-row">
          <span class="name">${escapeHtml(p.name)}</span>
          <span class="bid-result">${p.ghost ? `${scored.won ?? "—"}` : `${formatBidDisplay(p.rounds[ri])}/${scored.won}`}</span>
          <span class="pts">${p.ghost ? "—" : formatPts(scored.roundPoints)}</span>
          <span class="run">${p.ghost ? "—" : formatPts(scored.runningTotal)}</span>
        </li>`;
    })
    .join("");

  const history = !!opts.history;
  const resume = state.resumeAfterEdit;
  const returningToFinished = resume?.phase === "finished";
  const returningToLive = resume && resume.currentRound !== g.currentRound;
  const continueOn = shouldContinueVoyage(g);
  const overtime = g.currentRound >= STANDARD_ROUNDS && continueOn;

  let primaryLabel;
  if (history) {
    primaryLabel = g.phase === "finished" ? "Back to final" : "Back to live";
  } else if (returningToFinished) {
    primaryLabel = "Back to final";
  } else if (returningToLive) {
    primaryLabel = `Back to round ${resume.currentRound}`;
  } else if (!continueOn) {
    primaryLabel = "Finish voyage";
  } else if (overtime || g.currentRound >= STANDARD_ROUNDS) {
    primaryLabel = `Overtime · deal round ${g.currentRound + 1}`;
  } else {
    primaryLabel = `Deal round ${g.currentRound + 1}`;
  }

  return `
    <div class="turn-card review">
      <p class="turn-who"><span class="eyebrow">${history ? "History" : "Review"}</span> Round ${roundNum}</p>
      <ul class="review-list">${rows}</ul>
      <div class="turn-actions">
        ${
          history
            ? `<button type="button" class="btn btn-primary btn-block" id="exitHistoryBtn">${primaryLabel}</button>`
            : `<button type="button" class="btn btn-primary btn-block" id="advanceRoundBtn">${primaryLabel}</button>`
        }
        <button type="button" class="btn btn-secondary btn-block" id="editRoundBtn" data-edit-round="${roundNum}">Edit this round</button>
      </div>
    </div>
  `;
}

function renderRosterBids(g, ri) {
  return g.players
    .map((p, i) => {
      const r = p.rounds[ri];
      const active = g.phase === "bidding" && i === g.turnIndex;
      let val = "…";
      if (p.ghost) val = "—";
      else if (r.bid != null) val = formatBidDisplay(r);
      return `<span class="roster-chip ${active ? "active" : ""} ${r.bid != null || p.ghost ? "set" : ""}">${escapeHtml(p.name)} <em>${val}</em></span>`;
    })
    .join("");
}

function renderRosterTricks(g, ri) {
  return g.players
    .map((p, i) => {
      const r = p.rounds[ri];
      const active = i === g.turnIndex;
      const bidPart = p.ghost ? "" : `bid ${formatBidDisplay(r)}`;
      const val = r.won == null ? bidPart : `${r.won}/${p.ghost ? "—" : formatBidDisplay(r)}`;
      return `<span class="roster-chip ${active ? "active" : ""} ${r.won != null ? "set" : ""}">${escapeHtml(p.name)} <em>${val}</em></span>`;
    })
    .join("");
}

function renderRosterBonuses(g, ri) {
  return g.players
    .map((p, i) => {
      const r = p.rounds[ri];
      const active = i === g.turnIndex;
      return `<span class="roster-chip ${active ? "active" : ""}">${escapeHtml(p.name)} <em>+${r.bonus || 0}</em></span>`;
    })
    .join("");
}

function bindTurnControls(root) {
  const g = state.game;
  if (!g) return;
  const ri = currentRoundIndex(g);
  const player = g.players[g.turnIndex % g.players.length];
  const round = playerRound(player, ri);
  const cards = cardsInRound(g.currentRound);

  let value =
    g.phase === "bidding"
      ? round.bid ?? 0
      : g.phase === "tricks"
        ? round.won ?? 0
        : round.bonus ?? 0;

  const max =
    g.phase === "bidding" || g.phase === "tricks" ? cards : 200;
  const min = g.phase === "bonuses" ? 0 : 0;

  const valueEl = $("#stepValue", root);
  const setValue = (n) => {
    const next = Math.min(max, Math.max(min, n));
    if (next !== value) hapticTick();
    value = next;
    if (valueEl) valueEl.textContent = String(value);
  };

  root.querySelectorAll("[data-delta]").forEach((btn) => {
    btn.addEventListener("click", () => setValue(value + Number(btn.dataset.delta)));
  });
  root.querySelectorAll("[data-set]").forEach((btn) => {
    btn.addEventListener("click", () => setValue(Number(btn.dataset.set)));
  });
  root.querySelectorAll("[data-bid-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      round.bidType = btn.dataset.bidType;
      hapticTick();
      root.querySelectorAll("[data-bid-type]").forEach((b) => {
        b.classList.toggle("active", b.dataset.bidType === round.bidType);
      });
    });
  });

  root.querySelectorAll("[data-harry]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = Number(btn.dataset.harry);
      round.harryAdjust = next;
      hapticTick();
      root.querySelectorAll("[data-harry]").forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.harry) === next);
      });
      $(".harry-btn", root)?.classList.toggle("active", next === 1);
      const hint = $(".harry-hint", root);
      const adj = Number(round.harryAdjust) || 0;
      const eff = effectiveBid(round, cards);
      if (adj !== 0) {
        if (hint) {
          hint.innerHTML = `Scoring bid: <strong>${eff}</strong> (Harry ${adj > 0 ? "+" : ""}${adj})`;
        } else {
          const stepper = $(".stepper", root);
          const p = document.createElement("p");
          p.className = "hint harry-hint";
          p.innerHTML = `Scoring bid: <strong>${eff}</strong> (Harry ${adj > 0 ? "+" : ""}${adj})`;
          stepper?.insertAdjacentElement("afterend", p);
        }
      } else if (hint) {
        hint.remove();
      }
    });
  });

  $("#confirmTurnBtn", root)?.addEventListener("click", async () => {
    hapticConfirm();
    await confirmTurn(value);
  });
  $("#advanceRoundBtn", root)?.addEventListener("click", async () => {
    hapticConfirm();
    await advanceRound();
  });
  $("#exitHistoryBtn", root)?.addEventListener("click", () => {
    hapticTick();
    exitHistoryBrowse();
  });
  $("#editRoundBtn", root)?.addEventListener("click", async () => {
    hapticTick();
    const n = Number($("#editRoundBtn", root)?.dataset.editRound) || g.currentRound;
    await startEditRound(n);
  });
}

function exitHistoryBrowse() {
  state.browseRound = null;
  const g = state.game;
  if (g?.phase === "finished") {
    state.playTab = "standings";
  } else {
    state.playTab = "turn";
  }
  renderPlay();
}

async function browseOrEditRound(roundNumber, { edit = false } = {}) {
  const g = state.game;
  if (!g) return;
  const ri = roundNumber - 1;
  if (ri < 0) return;
  const completed = g.players.every((p) => p.rounds[ri]?.completed);
  if (!completed && edit) return;
  if (edit) {
    await startEditRound(roundNumber);
    return;
  }
  if (!completed) {
    state.browseRound = null;
    if (g.phase === "finished") state.playTab = "standings";
    renderPlay();
    return;
  }
  state.browseRound = roundNumber;
  state.playTab = "turn";
  renderPlay();
}

async function startEditRound(roundNumber) {
  const g = state.game;
  if (!g) return;
  ensureRoundSlots(g, roundNumber);
  const ri = roundNumber - 1;

  if (!state.resumeAfterEdit) {
    state.resumeAfterEdit = {
      currentRound: g.currentRound,
      phase: g.phase,
      turnIndex: g.turnIndex,
    };
  }

  g.players.forEach((p) => {
    if (p.rounds[ri]) p.rounds[ri].completed = false;
  });
  g.currentRound = roundNumber;
  g.phase = "bidding";
  g.turnIndex = firstTurnIndexForPhase(g, roundNumber, "bidding");
  state.browseRound = null;
  state.playTab = "turn";
  await saveGame();
  renderPlay();
  toast(`Editing round ${roundNumber}`);
}

/** Restore live/final position after editing a round. */
async function restoreAfterEdit() {
  const g = state.game;
  const resume = state.resumeAfterEdit;
  if (!g || !resume) return false;

  state.resumeAfterEdit = null;
  state.browseRound = null;
  ensureRoundSlots(g, resume.currentRound);
  g.currentRound = resume.currentRound;
  g.turnIndex = resume.turnIndex || 0;

  if (resume.phase === "finished") {
    const lastDone = lastCompletedRoundIndex(g) + 1;
    if (lastDone >= STANDARD_ROUNDS && isTiedForFirst(g)) {
      g.currentRound = lastDone + 1;
      ensureRoundSlots(g, g.currentRound);
      g.phase = "bidding";
      g.turnIndex = firstTurnIndexForPhase(g, g.currentRound, "bidding");
      await saveGame();
      state.playTab = "turn";
      renderPlay();
      toast(`Still tied — overtime round ${g.currentRound}`);
      return true;
    }
    g.phase = "finished";
    g.currentRound = Math.max(lastDone, STANDARD_ROUNDS, resume.currentRound);
    await saveGame();
    state.playTab = "standings";
    renderPlay();
    toast("Back to final");
    return true;
  }

  g.phase = resume.phase;
  await saveGame();
  state.playTab = "turn";
  renderPlay();
  toast(`Back to round ${g.currentRound}`);
  return true;
}

function shouldReturnAfterEdit() {
  const resume = state.resumeAfterEdit;
  if (!resume) return false;
  if (resume.phase === "finished") return true;
  return resume.currentRound !== state.game?.currentRound;
}

async function confirmTurn(value) {
  const g = state.game;
  ensureRoundSlots(g, g.currentRound);
  const ri = currentRoundIndex(g);
  const player = g.players[g.turnIndex];
  const round = player.rounds[ri];
  const cards = cardsInRound(g.currentRound);

  if (g.phase === "bidding") {
    round.bid = Math.min(cards, Math.max(0, value));
    if (allBidsLocked(g, ri)) {
      g.phase = "tricks";
      g.turnIndex = firstTurnIndexForPhase(g, g.currentRound, "tricks");
      toast("Tricks phase — tally wins");
    } else {
      g.turnIndex = nextTurnIndex(g, g.turnIndex, "bidding");
    }
  } else if (g.phase === "tricks") {
    round.won = Math.min(cards, Math.max(0, value));
    if (allTricksEntered(g, ri)) {
      const claimed = totalTricksWon(g, ri);
      if (claimed !== cards && state.settings.warnTrickMismatch) {
        toast(`Tricks claimed (${claimed}) ≠ ${cards} dealt — adjust if needed`);
      }
      g.phase = "bonuses";
      g.turnIndex = firstTurnIndexForPhase(g, g.currentRound, "bonuses");
      toast("Bonuses — then review");
    } else {
      g.turnIndex = (g.turnIndex + 1) % g.players.length;
    }
  } else if (g.phase === "bonuses") {
    round.bonus = Math.max(0, value);
    if (allBonusesEntered(g, ri)) {
      g.players.forEach((p) => {
        if (p.rounds[ri]) p.rounds[ri].completed = true;
      });
      if (shouldReturnAfterEdit()) {
        await saveGame();
        await restoreAfterEdit();
        return;
      }
      g.phase = "review";
      g.turnIndex = 0;
    } else {
      g.turnIndex = nextTurnIndex(g, g.turnIndex, "bonuses");
    }
  }

  await saveGame();
  renderPlay();
}

async function advanceRound() {
  const g = state.game;
  const resume = state.resumeAfterEdit;

  // Any in-progress edit return (including editing the final round of a finished game).
  if (resume && (resume.phase === "finished" || resume.currentRound !== g.currentRound)) {
    await restoreAfterEdit();
    return;
  }

  state.resumeAfterEdit = null;
  state.browseRound = null;

  if (!shouldContinueVoyage(g)) {
    g.phase = "finished";
    await saveGame();
    state.playTab = "standings";
    renderPlay();
    toast("Voyage complete");
    return;
  }

  const next = g.currentRound + 1;
  ensureRoundSlots(g, next);
  g.currentRound = next;
  g.phase = "bidding";
  g.turnIndex = firstTurnIndexForPhase(g, next, "bidding");
  await saveGame();
  state.playTab = "turn";
  renderPlay();
  if (next > STANDARD_ROUNDS) {
    toast(`Tied at the top — overtime round ${next}`);
  } else {
    toast(`Round ${next} — place your bids`);
  }
}

function bindRoundSwipe(root) {
  if (!root || root.dataset.swipeBound === "1") return;
  root.dataset.swipeBound = "1";
  let startX = 0;
  let startY = 0;
  let tracking = false;

  root.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true }
  );

  root.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      if (dx < 0) shiftHistory(1);
      else shiftHistory(-1);
    },
    { passive: true }
  );
}

function shiftHistory(dir) {
  const g = state.game;
  if (!g || state.playTab !== "turn") return;
  // Don't browse while mid-edit — that caused the 10→3→edited loop.
  if (state.resumeAfterEdit) return;

  const completed = completedRoundNumbers(g);
  if (!completed.length) return;

  let idx;
  if (state.browseRound != null) {
    idx = completed.indexOf(state.browseRound);
    if (idx < 0) idx = completed.length - 1;
  } else if (g.phase === "finished" || g.phase === "review") {
    // First swipe from final/review enters the newest completed round
    if (dir < 0) {
      state.browseRound = completed[completed.length - 1];
      hapticTick();
      renderPlay();
      return;
    }
    // swipe toward "newer" while already at live/final → stay put
    return;
  } else {
    // Live mid-round: first swipe opens last completed
    state.browseRound = completed[completed.length - 1];
    hapticTick();
    renderPlay();
    return;
  }

  const nextIdx = idx + dir;
  if (nextIdx < 0) return;
  if (nextIdx >= completed.length) {
    // Past newest completed → exit history to live or final standings
    exitHistoryBrowse();
    hapticTick();
    return;
  }

  state.browseRound = completed[nextIdx];
  hapticTick();
  renderPlay();
}

/* ---------- helpers ---------- */

function formatPts(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function openSheet(id) {
  $(id).hidden = false;
}

function closeSheets() {
  $$(".sheet").forEach((s) => {
    s.hidden = true;
  });
}

/* ---------- SETTINGS / WAKE LOCK ---------- */

function openSettings() {
  state.settingsReturnView = state.view === "settings" ? "home" : state.view;
  renderSettings();
  setView("settings");
}

function renderSettings() {
  $("#defaultScoringLabel").textContent = scoringLabel(state.settings.defaultScoring);
  $("#settingWarnTricks").checked = !!state.settings.warnTrickMismatch;
  $("#settingWakeLock").checked = !!state.settings.wakeLock;
  $("#settingHaptic").checked = !!state.settings.haptic;
  const build = `Build ${BUILD_HASH}`;
  const homeBuild = $("#homeBuildHash");
  const settingsBuild = $("#settingsBuildLabel");
  if (homeBuild) homeBuild.textContent = build;
  if (settingsBuild) settingsBuild.textContent = build;
}

async function syncWakeLock() {
  const want = state.settings.wakeLock && state.view === "play" && state.game && state.game.phase !== "finished";
  if (!want) {
    await releaseWakeLock();
    return;
  }
  if (!("wakeLock" in navigator)) return;
  if (state.wakeLockSentinel) return;
  try {
    state.wakeLockSentinel = await navigator.wakeLock.request("screen");
    state.wakeLockSentinel.addEventListener("release", () => {
      state.wakeLockSentinel = null;
    });
  } catch {
    /* ignored — unsupported / denied */
  }
}

async function releaseWakeLock() {
  try {
    await state.wakeLockSentinel?.release();
  } catch {
    /* ignore */
  }
  state.wakeLockSentinel = null;
}

/* ---------- boot ---------- */

function bindChrome() {
  $("#newGameBtn").addEventListener("click", startSetup);
  $("#setupBackBtn").addEventListener("click", () => {
    setView("home");
    renderHome();
  });
  $("#addPlayerBtn").addEventListener("click", () => {
    if (state.setupNames.length >= 8) {
      toast("Max 8 pirates");
      return;
    }
    state.setupNames.push("");
    renderSetup();
  });
  $("#startGameBtn").addEventListener("click", startGame);
  $("#playHomeBtn").addEventListener("click", () => {
    setView("home");
    renderHome();
  });
  $("#scorepadToggleBtn").addEventListener("click", () => {
    state.playTab = state.playTab === "pad" ? "turn" : "pad";
    renderPlay();
  });
  $("#playTabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (!tab) return;
    state.playTab = tab.dataset.tab;
    if (tab.dataset.tab !== "turn") state.browseRound = null;
    renderPlay();
  });
  $("#playProgress").addEventListener("click", (e) => {
    const dot = e.target.closest("[data-round-dot]");
    if (!dot || !state.game) return;
    browseOrEditRound(Number(dot.dataset.roundDot));
  });
  $("#rulesBtn").addEventListener("click", () => openSheet("#rulesSheet"));
  $("#settingsRulesBtn").addEventListener("click", () => openSheet("#rulesSheet"));
  $("#openSettingsBtn").addEventListener("click", openSettings);
  $("#settingsBackBtn").addEventListener("click", () => {
    const back = state.settingsReturnView || "home";
    state.settingsReturnView = "home";
    setView(back);
    if (back === "home") renderHome();
    else if (back === "play") renderPlay();
  });
  $("#settingDefaultScoringBtn").addEventListener("click", () => {
    state.settings.defaultScoring = state.settings.defaultScoring === "rascal" ? "classic" : "rascal";
    saveSettings();
    renderSettings();
    toast(`Default: ${scoringLabel(state.settings.defaultScoring)}`);
  });
  $("#settingWarnTricks").addEventListener("change", (e) => {
    state.settings.warnTrickMismatch = !!e.target.checked;
    saveSettings();
  });
  $("#settingWakeLock").addEventListener("change", (e) => {
    state.settings.wakeLock = !!e.target.checked;
    saveSettings();
    syncWakeLock();
  });
  $("#settingHaptic").addEventListener("change", (e) => {
    state.settings.haptic = !!e.target.checked;
    saveSettings();
    if (state.settings.haptic) hapticTick();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncWakeLock();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-sheet]")) closeSheets();
    if (e.target.closest("[data-close-ghost]")) closeGhostSheet();
  });
  $("#ghostAddBtn")?.addEventListener("click", async () => {
    const pending = state.pendingStart;
    if (!pending) return;
    closeGhostSheet();
    await launchGame({ ...pending, withGhost: true });
  });
  $("#ghostProceedBtn")?.addEventListener("click", async () => {
    const pending = state.pendingStart;
    if (!pending) return;
    closeGhostSheet();
    await launchGame({ ...pending, withGhost: false });
  });
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js", { type: "module" });
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "SW_UPDATED") {
        toast("Updated offline cache");
      }
    });
    void reg;
  } catch (err) {
    console.warn("SW register failed", err);
  }
}

bindChrome();
renderSettings();
setView("home");
renderHome();
registerSW();
