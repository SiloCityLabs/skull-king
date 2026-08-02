"use strict";

import { GameDB } from "./db.js";
import {
  TOTAL_ROUNDS,
  createGame,
  cardsInRound,
  recomputePlayerTotals,
  leaderboard,
  totalTricksWon,
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
  settingsReturnView: "home",
  settings: loadSettings(),
  wakeLockSentinel: null,
  hapticAudio: null,
  /** Cached Vibration API usability; null until first probe. */
  vibrateOk: null,
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
  return Math.min(Math.max(1, game.currentRound), TOTAL_ROUNDS) - 1;
}

function playerRound(player, roundIndex) {
  return player.rounds[roundIndex];
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
  state.game = g;
  state.playTab = "turn";
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

  wrap.querySelectorAll("input[data-player-i]").forEach((input) => {
    input.addEventListener("input", () => {
      state.setupNames[+input.dataset.playerI] = input.value;
    });
  });
  wrap.querySelectorAll("[data-remove-i]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = +btn.dataset.removeI;
      if (state.setupNames.length <= 2) return;
      state.setupNames.splice(i, 1);
      renderSetup();
    });
  });
}

function startSetup() {
  state.setupNames = ["", "", ""];
  $("#scoringModeSelect").value = state.settings.defaultScoring === "rascal" ? "rascal" : "classic";
  setView("setup");
  renderSetup();
}

async function startGame() {
  // Prefer live input values (handles programmatic fills / IME).
  const fromDom = $$("#playersSetup input[data-player-i]").map((el) => el.value.trim());
  const names = (fromDom.length ? fromDom : state.setupNames).map((n) => n.trim()).filter(Boolean);
  if (names.length < 2) {
    toast("Need at least 2 pirates");
    return;
  }
  if (names.length > 8) {
    toast("Max 8 pirates");
    return;
  }
  const scoringMode = $("#scoringModeSelect").value;
  state.game = createGame({ players: names, scoringMode });
  await saveGame();
  state.playTab = "turn";
  setView("play");
  renderPlay();
  toast("Round 1 — place your bids");
}

/* ---------- PLAY ---------- */

function renderPlay() {
  const g = state.game;
  if (!g) return;

  $("#playTitle").textContent =
    g.phase === "finished" ? "Final" : `Round ${g.currentRound} · ${cardsInRound(g.currentRound)} cards`;
  $("#playPhase").textContent = phaseLabel(g.phase);

  const prog = $("#playProgress");
  prog.innerHTML = Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
    const n = i + 1;
    let cls = "dot";
    if (n < g.currentRound || g.phase === "finished") cls += " done";
    else if (n === g.currentRound) cls += " current";
    return `<span class="${cls}" title="Round ${n}"></span>`;
  }).join("");

  $$("#playTabs .tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === state.playTab);
  });

  const body = $("#playBody");
  if (state.playTab === "pad") {
    body.innerHTML = renderScorepad(g);
  } else if (state.playTab === "standings") {
    body.innerHTML = renderStandings(g);
  } else {
    body.innerHTML = renderTurn(g);
    bindTurnControls(body);
  }
  syncWakeLock();
}

function renderStandings(g) {
  const board = leaderboard(g);
  return `
    <div class="standings">
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
      ${
        g.phase === "finished"
          ? `<p class="crown">☠ ${escapeHtml(board[0]?.name || "Nobody")} rules the seas</p>`
          : ""
      }
    </div>
  `;
}

function renderScorepad(g) {
  const mode = g.scoringMode;
  const players = g.players.map((p) => ({
    ...p,
    scored: recomputePlayerTotals(p.rounds, mode),
  }));

  const head = players
    .map((p) => `<th scope="col"><span>${escapeHtml(p.name)}</span></th>`)
    .join("");

  const rows = Array.from({ length: TOTAL_ROUNDS }, (_, ri) => {
    const cells = players
      .map((p) => {
        const r = p.scored[ri];
        const bid = r.bid == null ? "—" : r.bid;
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
            <div class="cell ${ri + 1 === g.currentRound && g.phase !== "finished" ? "cell-current" : ""} ${r.completed ? "cell-done" : ""}">
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
        <th scope="row" class="round-label">
          <span class="rn">${ri + 1}</span>
          <span class="cards">${ri + 1}</span>
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
      <p class="legend muted">bid/won · bid pts · bonus · round pts · running</p>
    </div>
  `;
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
    return `
      <div class="turn-card">
        <p class="turn-who"><span class="eyebrow">Tricks won</span> ${escapeHtml(player.name)}</p>
        <p class="hint">Bid was <strong>${round.bid ?? "—"}</strong> · ${wonTotal} / ${cards} tricks claimed</p>
        <div class="stepper" data-stepper="won">
          <button type="button" class="stepper-btn" data-delta="-1" aria-label="Decrease">−</button>
          <div class="stepper-value" id="stepValue">${round.won ?? 0}</div>
          <button type="button" class="stepper-btn" data-delta="1" aria-label="Increase">+</button>
        </div>
        <div class="quick-row">
          ${[0, 1, 2, 3, 4, 5]
            .filter((n) => n <= cards)
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
      <p class="hint">Bid ${round.bid}/${round.won} · enter raw bonus (scaled if bid misses)</p>
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

function renderReview(g, ri) {
  const mode = g.scoringMode;
  const rows = g.players
    .map((p) => {
      const scored = recomputePlayerTotals(
        p.rounds.map((r, i) => (i === ri ? { ...r, completed: true } : r)),
        mode
      )[ri];
      return `
        <li class="review-row">
          <span class="name">${escapeHtml(p.name)}</span>
          <span class="bid-result">${scored.bid}/${scored.won}</span>
          <span class="pts">${formatPts(scored.roundPoints)}</span>
          <span class="run">${formatPts(scored.runningTotal)}</span>
        </li>`;
    })
    .join("");

  const isLast = g.currentRound >= TOTAL_ROUNDS;
  return `
    <div class="turn-card review">
      <p class="turn-who"><span class="eyebrow">Review</span> Round ${g.currentRound}</p>
      <ul class="review-list">${rows}</ul>
      <div class="turn-actions">
        <button type="button" class="btn btn-primary btn-block" id="advanceRoundBtn">
          ${isLast ? "Finish voyage" : `Deal round ${g.currentRound + 1}`}
        </button>
        <button type="button" class="btn btn-secondary btn-block" id="editRoundBtn">Edit this round</button>
      </div>
    </div>
  `;
}

function renderRosterBids(g, ri) {
  return g.players
    .map((p, i) => {
      const r = p.rounds[ri];
      const active = g.phase === "bidding" && i === g.turnIndex;
      const val = r.bid == null ? "…" : String(r.bid);
      return `<span class="roster-chip ${active ? "active" : ""} ${r.bid != null ? "set" : ""}">${escapeHtml(p.name)} <em>${val}</em></span>`;
    })
    .join("");
}

function renderRosterTricks(g, ri) {
  return g.players
    .map((p, i) => {
      const r = p.rounds[ri];
      const active = i === g.turnIndex;
      const val = r.won == null ? `bid ${r.bid}` : `${r.won}/${r.bid}`;
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

  $("#confirmTurnBtn", root)?.addEventListener("click", async () => {
    hapticConfirm();
    await confirmTurn(value);
  });
  $("#advanceRoundBtn", root)?.addEventListener("click", async () => {
    hapticConfirm();
    await advanceRound();
  });
  $("#editRoundBtn", root)?.addEventListener("click", async () => {
    hapticTick();
    g.phase = "bidding";
    g.turnIndex = 0;
    // keep existing bids/wons for editing
    await saveGame();
    renderPlay();
  });
}

async function confirmTurn(value) {
  const g = state.game;
  const ri = currentRoundIndex(g);
  const player = g.players[g.turnIndex];
  const round = player.rounds[ri];
  const cards = cardsInRound(g.currentRound);

  if (g.phase === "bidding") {
    round.bid = Math.min(cards, Math.max(0, value));
    g.turnIndex += 1;
    if (g.turnIndex >= g.players.length) {
      g.phase = "tricks";
      g.turnIndex = 0;
      toast("Tricks phase — tally wins");
    }
  } else if (g.phase === "tricks") {
    round.won = Math.min(cards, Math.max(0, value));
    g.turnIndex += 1;
    if (g.turnIndex >= g.players.length) {
      const claimed = totalTricksWon(g, ri);
      if (claimed !== cards && state.settings.warnTrickMismatch) {
        toast(`Tricks claimed (${claimed}) ≠ ${cards} dealt — adjust if needed`);
      }
      g.phase = "bonuses";
      g.turnIndex = 0;
      toast("Bonuses — then review");
    }
  } else if (g.phase === "bonuses") {
    round.bonus = Math.max(0, value);
    g.turnIndex += 1;
    if (g.turnIndex >= g.players.length) {
      g.players.forEach((p) => {
        p.rounds[ri].completed = true;
      });
      g.phase = "review";
      g.turnIndex = 0;
    }
  }

  await saveGame();
  renderPlay();
}

async function advanceRound() {
  const g = state.game;
  if (g.currentRound >= TOTAL_ROUNDS) {
    g.phase = "finished";
    await saveGame();
    state.playTab = "standings";
    renderPlay();
    toast("Voyage complete");
    return;
  }
  g.currentRound += 1;
  g.phase = "bidding";
  g.turnIndex = 0;
  await saveGame();
  renderPlay();
  toast(`Round ${g.currentRound} — place your bids`);
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
    renderPlay();
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
