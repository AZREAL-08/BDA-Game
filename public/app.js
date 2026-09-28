// HexDominion: Hardcore 1v1 Tactical Arena Client (Clash Royale Elixir + Fog of War + Supply Lines)

const API_BASE = '/api';
const HEX_SIZE = 38;
const BASE_AP_INTERVAL = 2000;   // 2s normal
const DOUBLE_AP_INTERVAL = 1000; // 1s overtime
const MAX_AP = 10;

// Socket.io
const socket = io();

// State
let matchState = null;
let arenaTiles = [];
let myPlayerId = null;
let myUsername = 'Commander';
let myColor = '#3b82f6';
let selectedTile = null;
let soundEnabled = true;
let fogOfWarEnabled = true;
let audioCtx = null;

// Canvas Pan & Zoom
let canvas, ctx;
let camera = { x: 0, y: 0, zoom: 1.0 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };

window.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  bindUI();
  setupAudio();

  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    document.getElementById('joinRoomCodeInput').value = roomParam;
  }

  socket.on('arena:sync', (state) => {
    matchState = state.match;
    arenaTiles = state.tiles;
    updateUI();
    render();
  });

  socket.on('arena:event', ({ actionType, sound }) => {
    if (sound === 'attack') playAttackSound();
    else if (sound === 'claim') playClaimSound();
    else if (sound === 'fortify') playFortifySound();
  });

  requestAnimationFrame(gameLoop);
});

// Audio Synthesizer
function setupAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) audioCtx = new AudioContext();
}

function playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.2) {
  if (!soundEnabled || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

  gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playClaimSound() {
  playTone(523.25, 'triangle', 0.1, 0.25);
  setTimeout(() => playTone(659.25, 'triangle', 0.2, 0.25), 80);
}

function playFortifySound() {
  playTone(440, 'square', 0.08, 0.15);
  setTimeout(() => playTone(880, 'square', 0.2, 0.2), 60);
}

function playAttackSound() {
  playTone(160, 'sawtooth', 0.25, 0.4);
  setTimeout(() => playTone(95, 'triangle', 0.35, 0.5), 50);
}

function playWarningSound() {
  playTone(180, 'sawtooth', 0.2, 0.3);
}

function playVictorySound() {
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 'triangle', 0.3, 0.3), i * 140);
  });
}

function playDefeatSound() {
  const notes = [440, 415.3, 392, 369.99];
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 'sawtooth', 0.35, 0.25), i * 180);
  });
}

// Canvas Initialization
function initCanvas() {
  canvas = document.getElementById('hexCanvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  camera.x = canvas.width / 2;
  camera.y = canvas.height / 2;
}

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  render();
}

function bindUI() {
  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
      camera.x += e.clientX - dragStart.x;
      camera.y += e.clientY - dragStart.y;
      dragStart = { x: e.clientX, y: e.clientY };
      render();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (isDragging) {
      const dist = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
      isDragging = false;
      if (dist < 6) handleHexClick(e);
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    camera.zoom = Math.min(2.5, Math.max(0.5, camera.zoom * factor));
    render();
  }, { passive: false });

  // Fog of War Toggle
  const fogBtn = document.getElementById('btnFogToggle');
  fogBtn.addEventListener('click', () => {
    fogOfWarEnabled = !fogOfWarEnabled;
    fogBtn.classList.toggle('active', fogOfWarEnabled);
    showToast(`Fog of War ${fogOfWarEnabled ? 'ENABLED' : 'DISABLED'}`);
    render();
  });

  // Sound Toggle
  document.getElementById('btnSoundToggle').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    document.getElementById('btnSoundToggle').textContent = soundEnabled ? '🔊' : '🔇';
  });

  // Leave Match
  document.getElementById('btnLeaveMatch').addEventListener('click', () => {
    if (confirm('Leave this 1v1 match?')) {
      document.getElementById('lobbyModal').classList.remove('hidden');
      matchState = null;
      arenaTiles = [];
    }
  });

  // Color preset buttons
  document.querySelectorAll('.color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
      dot.classList.add('active');
      myColor = dot.dataset.color;
    });
  });

  // Lobby Action Handlers
  document.getElementById('btnQuickMatch').addEventListener('click', async () => {
    readLobbyProfile();
    try {
      const res = await fetch(`${API_BASE}/arena/quick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: myUsername, colorHex: myColor }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      enterMatch(data.match, data.tiles);
    } catch (e) {
      alert(`Matchmaking error: ${e.message}`);
    }
  });

  document.getElementById('btnCreatePrivate').addEventListener('click', async () => {
    readLobbyProfile();
    try {
      const res = await fetch(`${API_BASE}/arena/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: myUsername, colorHex: myColor }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      enterMatch(data.match, data.tiles);
    } catch (e) {
      alert(`Failed to create arena: ${e.message}`);
    }
  });

  document.getElementById('btnJoinByCode').addEventListener('click', async () => {
    readLobbyProfile();
    const code = document.getElementById('joinRoomCodeInput').value.trim();
    if (!code) return alert('Please enter a room code');

    try {
      const res = await fetch(`${API_BASE}/arena/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, username: myUsername, colorHex: myColor }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      enterMatch(data.match, data.tiles);
    } catch (e) {
      alert(`Join failed: ${e.message}`);
    }
  });

  document.getElementById('btnCopyCode').addEventListener('click', copyRoomCode);
  document.getElementById('btnCopyPrompt').addEventListener('click', copyRoomCode);

  document.getElementById('cardClaim').addEventListener('click', onCardClaim);
  document.getElementById('cardFortify').addEventListener('click', onCardFortify);
  document.getElementById('cardAttack').addEventListener('click', onCardAttack);

  document.getElementById('btnPlayAgain').addEventListener('click', () => {
    document.getElementById('gameOverModal').classList.add('hidden');
    document.getElementById('btnQuickMatch').click();
  });

  document.getElementById('btnExitLobby').addEventListener('click', () => {
    document.getElementById('gameOverModal').classList.add('hidden');
    document.getElementById('lobbyModal').classList.remove('hidden');
  });
}

function readLobbyProfile() {
  const nameInput = document.getElementById('lobbyUsername').value.trim();
  if (nameInput) myUsername = nameInput;
}

function enterMatch(match, tiles) {
  matchState = match;
  arenaTiles = tiles;

  if (match.player1.username === myUsername) {
    myPlayerId = match.player1.id;
  } else if (match.player2 && match.player2.username === myUsername) {
    myPlayerId = match.player2.id;
  } else {
    myPlayerId = match.player1.id;
  }

  document.getElementById('lobbyModal').classList.add('hidden');
  document.getElementById('roomCodeDisplay').textContent = match.code;
  document.getElementById('promptCodeVal').textContent = match.code;

  socket.emit('arena:join_room', { matchId: match._id });

  camera.x = canvas.width / 2;
  camera.y = canvas.height / 2;
  camera.zoom = 1.0;

  updateUI();
  render();
}

function copyRoomCode() {
  if (!matchState) return;
  const link = `${window.location.origin}${window.location.pathname}?room=${matchState.code}`;
  navigator.clipboard.writeText(link);
  showToast('Copied invite link to clipboard!');
}

function gameLoop(now) {
  updateElixirBar(now);
  updateActionCards();
  requestAnimationFrame(gameLoop);
}

function getMyPlayer() {
  if (!matchState) return null;
  if (matchState.player1.id === myPlayerId) return matchState.player1;
  if (matchState.player2 && matchState.player2.id === myPlayerId) return matchState.player2;
  return matchState.player1;
}

function getFortifyCostForDefense(currentDef) {
  if (currentDef < 4) return 1;
  if (currentDef < 7) return 2;
  return 3;
}

function updateElixirBar(now) {
  const player = getMyPlayer();
  if (!player) return;

  const isDouble = matchState && matchState.is_double_elixir;
  const interval = isDouble ? DOUBLE_AP_INTERVAL : BASE_AP_INTERVAL;

  const lastTick = new Date(player.last_ap_tick).getTime();
  const elapsed = Math.max(0, Date.now() - lastTick);
  const gained = Math.floor(elapsed / interval);

  const currentAP = Math.min(MAX_AP, player.ap_current + gained);
  const fraction = currentAP >= MAX_AP ? 1.0 : (elapsed % interval) / interval;
  const fillPct = Math.min(100, ((currentAP + (currentAP >= MAX_AP ? 0 : fraction)) / MAX_AP) * 100);

  document.getElementById('elixirLiquid').style.width = `${fillPct}%`;
  document.getElementById('elixirCurrVal').textContent = currentAP;

  const rateTag = document.getElementById('elixirRateTag');
  const hud = document.getElementById('clashHud');
  const doubleBanner = document.getElementById('doubleElixirBanner');

  if (isDouble) {
    rateTag.textContent = '🔥 2X ELIXIR (+1 AP / 1s)';
    hud.classList.add('double-elixir');
    doubleBanner.classList.remove('hidden');
  } else {
    rateTag.textContent = '⚡ +1 AP / 2s';
    hud.classList.remove('double-elixir');
    doubleBanner.classList.add('hidden');
  }
}

function updateActionCards() {
  const player = getMyPlayer();
  if (!player || !matchState || matchState.status !== 'PLAYING') {
    disableCard('cardClaim');
    disableCard('cardFortify');
    disableCard('cardAttack');
    return;
  }

  const isDouble = matchState.is_double_elixir;
  const interval = isDouble ? DOUBLE_AP_INTERVAL : BASE_AP_INTERVAL;
  const lastTick = new Date(player.last_ap_tick).getTime();
  const elapsed = Math.max(0, Date.now() - lastTick);
  const currentAP = Math.min(MAX_AP, player.ap_current + Math.floor(elapsed / interval));

  if (!selectedTile) {
    disableCard('cardClaim');
    disableCard('cardFortify');
    disableCard('cardAttack');
    return;
  }

  const isMine = selectedTile.owner_id === myPlayerId;
  const isNeutral = !selectedTile.owner_id;
  const isEnemy = selectedTile.owner_id && !isMine;

  const neighborIds = getNeighborCoordIds(selectedTile);
  const friendlyReady = arenaTiles.some(
    (t) => neighborIds.includes(t.coord_id) && t.owner_id === myPlayerId && !t.is_isolated
  );

  // Claim: neutral with 0 def, adjacent friendly, cost 1 AP
  if (isNeutral && selectedTile.defense_power === 0 && friendlyReady && currentAP >= 1) {
    enableCard('cardClaim');
  } else {
    disableCard('cardClaim');
  }

  // Fortify: mine, not isolated, defense < 10
  if (isMine && !selectedTile.is_isolated && selectedTile.defense_power < 10) {
    const cost = getFortifyCostForDefense(selectedTile.defense_power);
    document.getElementById('cardFortifyCost').textContent = `${cost} AP`;
    document.getElementById('cardFortifyHint').textContent = `Boost to ${selectedTile.defense_power + 1} Def`;

    if (currentAP >= cost) enableCard('cardFortify');
    else disableCard('cardFortify');
  } else {
    disableCard('cardFortify');
    document.getElementById('cardFortifyCost').textContent = '1 AP';
    document.getElementById('cardFortifyHint').textContent = '+1 Defense';
  }

  // Attack: target is enemy OR resistant neutral (>0 def), adjacent friendly ready, cost 2 AP
  const canAttackTarget = (isEnemy || (isNeutral && selectedTile.defense_power > 0));
  if (canAttackTarget && friendlyReady && currentAP >= 2) {
    enableCard('cardAttack');
  } else {
    disableCard('cardAttack');
  }
}

function enableCard(id) {
  document.getElementById(id).classList.remove('disabled');
}
function disableCard(id) {
  document.getElementById(id).classList.add('disabled');
}

// Fog of War Calculation
function getVisibleTileSet() {
  const visible = new Set();
  if (!fogOfWarEnabled || !myPlayerId) {
    arenaTiles.forEach((t) => visible.add(t.coord_id));
    return visible;
  }

  // Any tile owned by player, plus all immediate neighbors (vision distance = 1)
  arenaTiles.forEach((tile) => {
    if (tile.owner_id === myPlayerId) {
      visible.add(tile.coord_id);
      const neighbors = getNeighborCoordIds(tile);
      neighbors.forEach((nId) => visible.add(nId));
    }
  });

  return visible;
}

function updateUI() {
  if (!matchState) return;

  const p1 = matchState.player1;
  const p2 = matchState.player2;

  document.getElementById('p1Name').textContent = p1.username;
  document.getElementById('p1Avatar').textContent = p1.username.substring(0, 2).toUpperCase();
  document.getElementById('p1Avatar').style.borderColor = p1.color_hex;
  document.getElementById('p1TilesBadge').textContent = `${p1.tiles_owned} Tiles`;

  if (p2) {
    document.getElementById('p2Name').textContent = p2.username;
    document.getElementById('p2Avatar').textContent = p2.username.substring(0, 2).toUpperCase();
    document.getElementById('p2Avatar').style.borderColor = p2.color_hex;
    document.getElementById('p2TilesBadge').textContent = `${p2.tiles_owned} Tiles`;
  } else {
    document.getElementById('p2Name').textContent = 'Waiting...';
    document.getElementById('p2Avatar').textContent = '??';
    document.getElementById('p2TilesBadge').textContent = '0 Tiles';
  }

  const total = arenaTiles.length || 37;
  const p1Pct = (p1.tiles_owned / total) * 100;
  const p2Pct = p2 ? (p2.tiles_owned / total) * 100 : 0;
  const neutralPct = Math.max(0, 100 - p1Pct - p2Pct);

  document.getElementById('barP1').style.width = `${p1Pct}%`;
  document.getElementById('barNeutral').style.width = `${neutralPct}%`;
  document.getElementById('barP2').style.width = `${p2Pct}%`;

  const statusBanner = document.getElementById('matchStatusBanner');
  const waitingPrompt = document.getElementById('waitingPrompt');

  if (matchState.status === 'WAITING') {
    statusBanner.textContent = '⏳ WAITING FOR OPPONENT...';
    waitingPrompt.classList.remove('hidden');
  } else if (matchState.status === 'PLAYING') {
    statusBanner.textContent = matchState.is_double_elixir
      ? '🔥 OVERTIME: DOUBLE ELIXIR BRAWL!'
      : '⚔️ IN BATTLE — SEVER ENEMY SUPPLY LINES!';
    waitingPrompt.classList.add('hidden');
  } else if (matchState.status === 'FINISHED') {
    statusBanner.textContent = `🏆 WINNER: ${matchState.winner_username}`;
    showGameOverModal();
  }

  if (selectedTile) {
    const updated = arenaTiles.find((t) => t.coord_id === selectedTile.coord_id);
    if (updated) {
      selectedTile = updated;
      updateTacticalForecast(updated);
    }
  }
}

function showGameOverModal() {
  const modal = document.getElementById('gameOverModal');
  const title = document.getElementById('gameOverTitle');
  const subtitle = document.getElementById('gameOverSubtitle');
  const isWinner = matchState.winner_id === myPlayerId;

  if (isWinner) {
    title.textContent = '🏆 VICTORY ROYALE!';
    title.className = 'victory-text';
    subtitle.textContent = 'You conquered the arena and cut off all enemy supply lines!';
    playVictorySound();
    if (typeof confetti === 'function') {
      confetti({ particleCount: 160, spread: 80, origin: { y: 0.6 } });
    }
  } else {
    title.textContent = '💀 DEFEAT!';
    title.className = 'defeat-text';
    subtitle.textContent = `${matchState.winner_username} dominated your territory.`;
    playDefeatSound();
  }

  const myP = getMyPlayer();
  document.getElementById('sumTilesCaptured').textContent = myP ? myP.tiles_owned : 0;
  modal.classList.remove('hidden');
}

function handleHexClick(e) {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const worldX = (mouseX - camera.x) / camera.zoom;
  const worldY = (mouseY - camera.y) / camera.zoom;

  const cube = pixelToCube(worldX, worldY, HEX_SIZE);
  const coordId = `q:${cube.q},r:${cube.r},s:${cube.s}`;

  const tile = arenaTiles.find((t) => t.coord_id === coordId);
  const visibleSet = getVisibleTileSet();

  if (tile) {
    if (!visibleSet.has(tile.coord_id)) {
      showToast('🌫️ Unscouted territory! Expand adjacent to reveal intel.');
      selectedTile = null;
      document.getElementById('tacticalForecast').classList.add('hidden');
      render();
      return;
    }

    selectedTile = tile;
    updateTacticalForecast(tile);
    render();
  } else {
    selectedTile = null;
    document.getElementById('tacticalForecast').classList.add('hidden');
    render();
  }
}

function updateTacticalForecast(tile) {
  const panel = document.getElementById('tacticalForecast');
  panel.classList.remove('hidden');

  document.getElementById('forecastTileCoord').textContent = tile.coord_id;
  const ownerElem = document.getElementById('forecastTileOwner');

  let ownerName = 'Neutral';
  if (tile.owner_id === matchState.player1.id) ownerName = matchState.player1.username;
  else if (matchState.player2 && tile.owner_id === matchState.player2.id) ownerName = matchState.player2.username;

  ownerElem.textContent = ownerName;

  const body = document.getElementById('forecastBody');
  const isMine = tile.owner_id === myPlayerId;
  const isNeutral = !tile.owner_id;

  let terrainBadge = '';
  if (tile.terrain === 'MOUNTAIN') terrainBadge = '<span class="terrain-badge mountain">⛰️ HIGH GROUND (+3 DEF)</span>';
  else if (tile.terrain === 'CAPITAL') terrainBadge = '<span class="terrain-badge capital">🏰 CITADEL (+3 DEF)</span>';

  let isolatedWarning = '';
  if (tile.is_isolated) {
    isolatedWarning = `<div class="warning-isolated">⚠️ ISOLATED FROM BASE!<br>Supply line severed. Cannot attack or fortify!</div>`;
  }

  if (isMine) {
    const cost = getFortifyCostForDefense(tile.defense_power);
    body.innerHTML = `
      <div>Defense: <strong>${tile.defense_power} / 10</strong> ${terrainBadge}</div>
      <div>Next Fortify Cost: <strong>${cost} AP</strong></div>
      <div style="color:#34d399">Friendly Territory</div>
      ${isolatedWarning}
    `;
  } else if (isNeutral && tile.defense_power === 0) {
    body.innerHTML = `
      <div>Terrain: <strong>${tile.terrain}</strong> ${terrainBadge}</div>
      <div>Defense: <strong>0</strong></div>
      <div style="color:#38bdf8">Unclaimed hex (1 AP)</div>
    `;
  } else {
    // Enemy tile OR resistant neutral garrison
    const neighborIds = getNeighborCoordIds(tile);
    const friendlyAdjacent = arenaTiles.filter(
      (t) => neighborIds.includes(t.coord_id) && t.owner_id === myPlayerId && !t.is_isolated
    );
    const attackPower = friendlyAdjacent.reduce((sum, t) => sum + (t.defense_power || 1), 0);
    
    const terrainBonus = tile.terrain === 'MOUNTAIN' ? 3 : tile.terrain === 'CAPITAL' ? 3 : 0;
    const effectiveDefense = tile.defense_power + terrainBonus;

    const willWin = attackPower > effectiveDefense;
    const excess = Math.max(1, attackPower - effectiveDefense);

    body.innerHTML = `
      <div>Base Defense: <strong>${tile.defense_power}</strong> ${terrainBadge}</div>
      <div>Effective Defense: <strong>${effectiveDefense}</strong></div>
      <div>Friendly Flanking: <strong>${attackPower}</strong> (${friendlyAdjacent.length} ready tiles)</div>
      <div style="margin-top:6px; font-weight:700; color:${willWin ? '#34d399' : '#f87171'}">
        ${willWin 
          ? `⚔️ Victory Likely (+${excess} Def)<br><small style="color:#fca5a5">⚠️ Attackers lose -1 Defense from battle casualties!</small>` 
          : `🛡️ Breach will FAIL!<br><small style="color:#fca5a5">⚠️ Attackers take -1 Recoil Damage!</small>`}
      </div>
      ${isolatedWarning}
    `;
  }
}

function getNeighborCoordIds(tile) {
  const dirs = [
    { q: 1, r: -1, s: 0 },
    { q: 1, r: 0, s: -1 },
    { q: 0, r: 1, s: -1 },
    { q: -1, r: 1, s: 0 },
    { q: -1, r: 0, s: 1 },
    { q: 0, r: -1, s: 1 },
  ];
  return dirs.map((d) => `q:${tile.q + d.q},r:${tile.r + d.r},s:${tile.s + d.s}`);
}

async function onCardClaim() {
  if (!matchState || !selectedTile || !myPlayerId) return;
  try {
    const res = await fetch(`${API_BASE}/arena/${matchState._id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: myPlayerId, coordId: selectedTile.coord_id }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    playClaimSound();
    showToast(`Claimed ${selectedTile.coord_id}!`);
    socket.emit('arena:action_performed', { matchId: matchState._id, actionType: 'CLAIM', sound: 'claim' });
  } catch (e) {
    playWarningSound();
    showToast(e.message);
  }
}

async function onCardFortify() {
  if (!matchState || !selectedTile || !myPlayerId) return;
  try {
    const res = await fetch(`${API_BASE}/arena/${matchState._id}/fortify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: myPlayerId, coordId: selectedTile.coord_id }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    playFortifySound();
    showToast(`Fortified ${selectedTile.coord_id} to ${data.tile.defense_power} Def!`);
    socket.emit('arena:action_performed', { matchId: matchState._id, actionType: 'FORTIFY', sound: 'fortify' });
  } catch (e) {
    playWarningSound();
    showToast(e.message);
  }
}

async function onCardAttack() {
  if (!matchState || !selectedTile || !myPlayerId) return;
  try {
    const res = await fetch(`${API_BASE}/arena/${matchState._id}/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: myPlayerId, targetCoordId: selectedTile.coord_id }),
    });
    const data = await res.json();
    if (!data.success) {
      playTone(140, 'sawtooth', 0.25);
      showToast(`💥 Attack repelled! Units took -1 recoil damage.`);
    } else {
      playAttackSound();
      showToast(`⚔️ Breach Successful! Units suffered -1 casualty.`);
    }

    socket.emit('arena:action_performed', { matchId: matchState._id, actionType: 'ATTACK', sound: 'attack' });
  } catch (e) {
    playWarningSound();
    showToast(e.message);
  }
}

function showToast(msg) {
  const toast = document.getElementById('combatToast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3200);
}

// Math & Rendering
function hexCorner(center, size, i) {
  const angle = (Math.PI / 180) * (60 * i);
  return {
    x: center.x + size * Math.cos(angle),
    y: center.y + size * Math.sin(angle),
  };
}

function cubeToPixel(q, r, size) {
  return {
    x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
    y: size * ((3 / 2) * r),
  };
}

function pixelToCube(px, py, size) {
  const q = ((Math.sqrt(3) / 3) * px - (1 / 3) * py) / size;
  const r = ((2 / 3) * py) / size;
  const s = -q - r;

  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;

  return { q: rq, r: rr, s: rs };
}

function drawHex(center, size, fillColor, strokeColor, strokeWidth = 1.5, isDashed = false) {
  ctx.beginPath();
  if (isDashed) ctx.setLineDash([4, 4]);
  else ctx.setLineDash([]);

  for (let i = 0; i < 6; i++) {
    const c = hexCorner(center, size, i);
    if (i === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  }
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
  ctx.setLineDash([]);
}

function render() {
  if (!ctx || !canvas) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const visibleSet = getVisibleTileSet();
  const now = Date.now();

  arenaTiles.forEach((tile) => {
    const pos = cubeToPixel(tile.q, tile.r, HEX_SIZE);
    const isVisible = visibleSet.has(tile.coord_id);

    // Fog of War Rendering
    if (!isVisible) {
      drawHex(pos, HEX_SIZE - 1.5, '#060911', 'rgba(255, 255, 255, 0.04)', 1);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 12px "JetBrains Mono"';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillText('?', pos.x, pos.y);
      return;
    }

    let fillColor = '#172033';
    let strokeColor = 'rgba(255, 255, 255, 0.12)';
    let strokeWidth = 1.5;
    let isDashed = false;

    if (tile.terrain === 'CAPITAL') {
      fillColor = '#854d0e';
      strokeColor = '#eab308';
    } else if (tile.terrain === 'MOUNTAIN') {
      fillColor = '#0f172a';
      strokeColor = '#475569';
    }

    // Owner Heraldry
    if (tile.owner_id && matchState) {
      if (tile.owner_id === matchState.player1.id) {
        fillColor = matchState.player1.color_hex;
        strokeColor = '#93c5fd';
      } else if (matchState.player2 && tile.owner_id === matchState.player2.id) {
        fillColor = matchState.player2.color_hex;
        strokeColor = '#fca5a5';
      }
    }

    // Isolated Supply Line Warning Border
    if (tile.is_isolated) {
      strokeColor = '#ef4444';
      strokeWidth = 2.5;
      isDashed = true;
    }

    // Selected Outline
    if (selectedTile && selectedTile.coord_id === tile.coord_id) {
      strokeColor = '#38bdf8';
      strokeWidth = 3.5;
      isDashed = false;
    }

    drawHex(pos, HEX_SIZE - 1.5, fillColor, strokeColor, strokeWidth, isDashed);

    // Text & Badges
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const isFatigued = tile.cooldown_until && new Date(tile.cooldown_until).getTime() > now;

    if (tile.is_isolated) {
      ctx.font = 'bold 11px "JetBrains Mono"';
      ctx.fillStyle = '#fee2e2';
      ctx.fillText(`⚠️${tile.defense_power}`, pos.x, pos.y - 4);

      ctx.font = '8px "JetBrains Mono"';
      ctx.fillStyle = '#f87171';
      ctx.fillText('CUT OFF', pos.x, pos.y + 10);
    } else if (isFatigued) {
      ctx.font = 'bold 11px "JetBrains Mono"';
      ctx.fillStyle = '#fef08a';
      ctx.fillText(`⏳${tile.defense_power}`, pos.x, pos.y - 4);

      ctx.font = '8px "JetBrains Mono"';
      ctx.fillStyle = '#facc15';
      ctx.fillText('FATIGUE', pos.x, pos.y + 10);
    } else if (tile.defense_power > 0 || tile.terrain === 'CAPITAL' || tile.terrain === 'MOUNTAIN') {
      ctx.font = 'bold 12px "JetBrains Mono"';
      ctx.fillStyle = '#ffffff';
      const icon = tile.terrain === 'MOUNTAIN' ? '⛰️' : (tile.terrain === 'CAPITAL' ? '★' : '🛡️');
      ctx.fillText(`${icon}${tile.defense_power}`, pos.x, pos.y - 4);

      ctx.font = '9px "JetBrains Mono"';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(`${tile.q},${tile.r}`, pos.x, pos.y + 10);
    } else {
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(`${tile.q},${tile.r}`, pos.x, pos.y);
    }
  });

  ctx.restore();
}
