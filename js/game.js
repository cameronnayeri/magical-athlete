// ============================================================
//  Game page — lobby, create-a-racer, draft, lineup, race, results.
//  Everything shared lives in one "game_state" object that every
//  player edits with small, atomic ops (see ma_apply in setup.sql).
//  Board drawings and player-made cards live in their own tables.
// ============================================================

const store     = getStore();
// A rejoin link can carry the seat: game.html?code=ABCD&pid=…
{
  const q = new URLSearchParams(location.search);
  if (q.get('code') && q.get('pid')) { IDENT.setItem('ma_lobbyCode', q.get('code').toUpperCase()); IDENT.setItem('ma_playerId', q.get('pid')); }
  if (location.search) history.replaceState(null, '', location.pathname);
}
const lobbyCode = IDENT.getItem('ma_lobbyCode');
const myId      = IDENT.getItem('ma_playerId');

let lobby = null, players = [], state = {}, me = null;
let strokes = [], madeCards = [];
let selectedPiece = null;
let builtBoardKey = null;
let pawnChoice = 'art';
const EMOJI_CHOICES = ['🦄','🐉','🦖','🐙','🦊','🐸','🐼','🦁','🐯','🐨','🐷','🐮','🐔','🦆','🦉','🦇','🐝','🦋','🐌','🐢','🦀','🐟','🐬','🐳','🦈','🐊','🦎','🐍','🦂','🕷️','🤖','👽','👾','🤠','🧟','🧛','🧙','🧚','🧜','🧞','👻','💀','🎃','🤡','👑','🎩','🕶️','🔥','⚡','❄️','🌈','⭐','🌙','☄️','🍕','🍔','🌮','🍩','🎸','🥁','🚗','🚲','🛸','🚁','⚽','🏀','🎯','🎲','💣','🗿','🧸','🎈'];
let drag = null;
let suppressClick = false;
let seenRollAt = 0, animatedRollAt = 0, seenDrawEpoch = undefined;
let modalCardId = null;
let galleryTab = 'all';
let settingsTimer = null;
let renderedResultsKey = null;
let leaving = false;

// drawing on the board
let drawMode = false, drawColor = null, drawWidth = 4, hideDrawings = false, liveStroke = null, liveEl = null;
const DRAW_COLORS = ['#1d1b2e', '#e63946', '#00b4d8', '#06d6a0', '#ffb703', '#ff2e88', '#ffffff'];

// create-a-racer sketch pad
let sketch = null, editingCardId = null;
const SKETCH_COLORS = ['#1d1b2e', '#e63946', '#ff7b2e', '#ffb703', '#06d6a0', '#00b4d8', '#8338ec', '#ff2e88', '#8a5a2b', '#ffffff'];

// ── Little accessors ─────────────────────────────────────────
function S()  { return { ...DEFAULT_SETTINGS, ...(lobby?.settings || {}) }; }           // lobby settings
function RS(st = state) { return { ...S(), ...(st.settings || {}) }; }                  // settings frozen at start
function isHost() { return !!me?.is_host; }
function gp() { return state.players || []; }
function playerById(pid) { return gp().find(p => p.id === pid) || players.find(p => p.id === pid) || null; }
function pName(pid) { return playerById(pid)?.name || '?'; }
function pColor(pid) { return playerById(pid)?.color || '#999'; }
function myName() { return me?.name || 'Someone'; }
function isOnline(pid) { const p = players.find(x => x.id === pid); return !!p && (Date.now() - new Date(p.last_seen).getTime()) < 65000; }
function boardDef() { return BOARD(lobby?.status === 'waiting' ? S().board : (state.board || S().board)); }
function trackLen() { return boardDef().length; }
// The board's built-in squares plus this race's random ones
function effectiveSpecials() { return { ...(boardDef().specials || {}), ...(state.squares || {}) }; }
function randomSquareNote(s) {
  const on = [s.randomBoost && '⏩ boost & setback', s.randomChutes && '🪜 chutes & ladders', s.randomStars && '⭐ stars & peels'].filter(Boolean);
  return on.length && s.squareCount > 0 ? `Random each race: ${s.squareCount} squares of ${on.join(', ')}.` : '';
}
function GOAL() { return trackLen() + 1; }
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ma_theme', t); } catch {}
  $('theme-btn').textContent = t === 'dark' ? '☀️ Light' : '🌙 Dark';
}
function applyLook(l) {
  document.documentElement.dataset.look = l;
  try { localStorage.setItem('ma_look2', l); } catch {}
  $('look-btn').textContent = l === 'minimal' ? 'Bold look' : 'Minimal look';
}
// "3,1 | 4,2 | 4,2 | 5,3" → the points row for the given race (the last row repeats for extra races)
function pointsTable(st = state, race = st.race || 1) {
  const rows = String(RS(st).points).split('|').map(r => r.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))).filter(r => r.length);
  if (!rows.length) return [];
  return rows[Math.min(race, rows.length) - 1];
}
function spaceName(s) { return s === 0 ? 'Start' : s >= GOAL() ? 'the Goal' : `space ${s}`; }
function enabledCardIds(s) {
  const ids = [];
  if (s.official)     ids.push(...OFFICIAL_CARDS.map(c => c.id));
  if (s.experimental) ids.push(...EXPERIMENTAL_CARDS.map(c => c.id));
  if (s.custom)       ids.push(...CUSTOM_CARDS.map(c => c.id));
  return ids;
}
function bestSpace(pid) {
  return Math.max(0, ...Object.values(state.pieces || {}).filter(p => p.pid === pid).map(p => p.space));
}
function phaseLabel() {
  if (lobby?.status === 'waiting') return 'Lobby';
  return { create: 'Creating racers', draft: 'Draft', lineup: 'Lineup', race: `Race ${state.race}`, results: 'Results', gameover: 'Finished' }[state.phase] || '…';
}
function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th'); }
function isMuted(pid) { return !!state.muted?.[pid]; }

function registerMadeCards() {
  Object.keys(RUNTIME_CARDS).forEach(k => delete RUNTIME_CARDS[k]);
  madeCards.forEach((c, i) => {
    RUNTIME_CARDS[c.id] = {
      id: c.id, name: c.name, tag: c.tag || '', text: c.text, emoji: c.emoji || '🎨', art: c.art || null, pawn: c.pawn || 'art',
      set: 'made', number: i + 1, color: pColor(c.player_id), by: c.player_id, round: c.round,
    };
  });
}

// ── Transactions: build a list of ops against a copy of state ─
function txn(base = state) {
  const t = { st: clone(base), ops: [] };
  t.op  = (o) => { t.ops.push(o); applyOps(t.st, [o]); };
  t.log = (text, type = 'info') => t.op({ path: ['log'], append: { text, type, at: Date.now() } });
  return t;
}
async function commit(t) {
  if (!t.ops.length) return;
  applyOps(state, t.ops);      // optimistic — feels instant
  renderAll();
  try { await store.apply(lobbyCode, t.ops); }
  catch (err) { console.error(err); showNotif('Could not sync that — check your connection', 'error'); }
}

// ── Boot ─────────────────────────────────────────────────────
async function init() {
  if (!lobbyCode || !myId) { window.location.href = 'index.html'; return; }
  $('code-chip').textContent = lobbyCode;
  if (LOCAL_MODE) $('local-chip').hidden = false;
  applyTheme(document.documentElement.dataset.theme || 'light');
  applyLook(document.documentElement.dataset.look || 'minimal');

  [lobby, players, strokes, madeCards] = await Promise.all([
    store.getLobby(lobbyCode), store.getPlayers(lobbyCode), store.getStrokes(lobbyCode), store.getCards(lobbyCode),
  ]);
  if (!lobby) { alert('That lobby no longer exists.'); IDENT.removeItem('ma_lobbyCode'); window.location.href = 'index.html'; return; }
  me = players.find(p => p.id === myId);
  if (!me) { alert('You are not in this lobby.'); IDENT.removeItem('ma_playerId'); window.location.href = 'index.html'; return; }

  state = lobby.game_state || {};
  seenRollAt = animatedRollAt = state.lastRoll?.at || 0;
  seenDrawEpoch = state.drawEpoch;
  registerMadeCards();

  wireUI();
  buildColorRow();
  buildGalleryTabs();
  buildDrawBar();
  initSketch();

  store.onLobby(lobbyCode, row => {
    if (!row) return;
    lobby = row; state = row.game_state || {};
    onRemoteChange();
    renderAll();
  });
  store.onPlayers(lobbyCode, list => {
    players = list;
    const stillMe = players.find(p => p.id === myId);
    if (!stillMe && !leaving) {
      leaving = true;
      alert('You were removed from this game.');
      IDENT.removeItem('ma_playerId'); IDENT.removeItem('ma_lobbyCode');
      window.location.href = 'index.html';
      return;
    }
    me = stillMe || me;
    registerMadeCards();   // colors may have changed
    renderAll();
  });
  store.onStrokes(lobbyCode, ev => {
    if (ev.type === 'reset') strokes = ev.rows;
    else if (ev.type === 'insert' && !strokes.some(s => s.id === ev.row.id)) strokes.push(ev.row);
    renderDrawings();
  });
  store.onCards(lobbyCode, rows => { madeCards = rows; registerMadeCards(); renderAll(); });

  renderAll();
  setInterval(() => store.updatePlayer(myId, { last_seen: new Date().toISOString() }).catch(() => {}), 20000);
  setInterval(() => { if (lobby?.status === 'waiting') renderLobby(); else renderRacers(); }, 30000); // refresh online dots
}

function onRemoteChange() {
  const lr = state.lastRoll;
  if (lr && lr.at > seenRollAt) {
    seenRollAt = lr.at;
    if (lr.pid !== myId) showNotif(`🎲 ${pName(lr.pid)} rolled ${lr.values.join(' + ')}${lr.values.length > 1 ? ' = ' + lr.values.reduce((a, b) => a + b, 0) : ''}`, 'roll');
  }
  if (state.drawEpoch !== seenDrawEpoch) {
    seenDrawEpoch = state.drawEpoch;
    store.getStrokes(lobbyCode).then(rows => { strokes = rows; renderDrawings(); });
  }
  if (selectedPiece && !(state.pieces || {})[selectedPiece]) selectedPiece = null;
  if (modalCardId) openCardModal(modalCardId);   // refresh available actions
}

// ── UI wiring ────────────────────────────────────────────────
function wireUI() {
  $('leave-btn').onclick = leaveLobby;
  $('code-chip').onclick = copyInvite;
  $('invite-btn').onclick = copyInvite;
  $('shuffle-btn').onclick = shuffleSeats;
  $('gallery-btn').onclick = () => { buildGalleryTabs(); renderGallery(); $('modal-gallery').hidden = false; };
  $('gallery-close').onclick = () => $('modal-gallery').hidden = true;
  $('gallery-search').oninput = renderGallery;
  $('help-btn').onclick = () => $('modal-help').hidden = false;
  $('help-close').onclick = () => $('modal-help').hidden = true;
  $('start-btn').onclick = startGame;
  $('roll-btn').onclick = () => roll(1);
  $('roll2-btn').onclick = () => roll(2);
  $('next-turn-btn').onclick = nextTurn;
  $('draw-btn').onclick = drawCard;
  $('mv-back').onclick = () => nudge(-1);
  $('mv-fwd').onclick = () => nudge(1);
  $('mv-roll').onclick = () => { const v = state.lastRoll?.values?.reduce((a, b) => a + b, 0); if (v) nudge(v); };
  $('mv-start').onclick = () => { if (selectedPiece) movePiece(selectedPiece, 0); };
  $('undo-btn').onclick = undoMove;
  $('end-race-btn').onclick = endRace;
  $('continue-btn').onclick = continueGame;
  $('again-btn').onclick = backToLobby;
  $('chat-form').onsubmit = sendChat;
  $('c-save').onclick = saveMadeCard;
  $('c-cancel').onclick = resetCardForm;
  $('create-start-btn').onclick = startCreatedDraft;
  $('theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('look-btn').onclick = () => applyLook(document.documentElement.dataset.look === 'minimal' ? 'bold' : 'minimal');
  buildEmojiPicker();
  $('pawn-art').onclick = () => setPawnChoice('art');
  $('pawn-emoji').onclick = () => setPawnChoice('emoji');

  // Settings form (host only)
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    const el = $('s-' + key);
    if (!el) return;
    el.addEventListener('change', () => { clearTimeout(settingsTimer); settingsTimer = setTimeout(saveSettings, 250); });
  });
  $('s-squareCount').addEventListener('input', () => { $('squareCount-val').textContent = $('s-squareCount').value; });
  if (CUSTOM_CARDS.length) $('row-custom').hidden = false;

  // Lobby player list buttons
  $('player-list').addEventListener('click', e => {
    const b = e.target.closest('[data-seat]'); if (b) return moveSeat(b.dataset.seat, parseInt(b.dataset.dir, 10));
    const k = e.target.closest('[data-kick]'); if (k) return kickPlayer(k.dataset.kick);
  });
  // Racer list: mute buttons
  $('racer-list').addEventListener('click', e => {
    const m = e.target.closest('[data-mute]'); if (m) { e.stopPropagation(); toggleMute(m.dataset.mute); }
  });
  // Create grid: edit / delete own cards
  $('create-cards').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]'); if (ed) return editMadeCard(ed.dataset.edit);
    const del = e.target.closest('[data-del]'); if (del) return deleteMadeCard(del.dataset.del);
  });

  // Any card face anywhere opens the card modal (unless a button inside it was clicked)
  document.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    const face = e.target.closest('[data-card]');
    if (!face || face.closest('#modal-card')) return;
    openCardModal(face.dataset.card);
  });
  // Click outside a modal panel closes it (card / gallery / help only)
  ['modal-card', 'modal-gallery', 'modal-help'].forEach(id => {
    $(id).addEventListener('click', e => { if (e.target.id === id) { $(id).hidden = true; if (id === 'modal-card') modalCardId = null; } });
  });
  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (e.key === 'Escape') { closeCardModal(); $('modal-gallery').hidden = true; $('modal-help').hidden = true; if (drawMode) toggleDraw(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (lobby?.status !== 'playing') return;
    const k = e.key.toLowerCase();
    if (k === 'r') roll(1);
    else if (k === 'n') nextTurn();
    else if (k === 'u') undoMove();
    else if (k === 'd') toggleDraw();
  });
}

// ============================================================
//  RENDER
// ============================================================
function renderAll() {
  if (!lobby) return;
  const waiting = lobby.status === 'waiting';
  $('view-lobby').hidden = !waiting;
  $('view-game').hidden = waiting;
  renderTopbar();
  if (waiting) renderLobby(); else renderGame();
  renderOverlays();
}

function renderTopbar() {
  $('phase-chip').textContent = phaseLabel();
  const chips = $('score-chips');
  if (lobby.status === 'waiting' || !gp().length) { chips.innerHTML = ''; return; }
  chips.innerHTML = gp().map(p => `
    <span class="score-chip" title="${escapeHtml(p.name)}">
      <span class="score-chip__ball" style="background:${p.color}"></span>
      <span>${escapeHtml(p.name.split(' ')[0])}</span>
      <span class="score-chip__pts">${state.scores?.[p.id] ?? 0}</span>
    </span>`).join('');
}

// ── Lobby ────────────────────────────────────────────────────
function buildColorRow() {
  const row = $('color-row');
  row.innerHTML = '';
  PLAYER_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'swatch'; sw.style.background = c.hex; sw.title = c.name; sw.dataset.color = c.hex;
    sw.onclick = () => store.updatePlayer(myId, { color: c.hex });
    row.appendChild(sw);
  });
}

function renderLobby() {
  const s = S();
  const sorted = [...players].sort((a, b) => a.seat_order - b.seat_order);
  const host = isHost();
  let html = sorted.map((p, i) => `
    <div class="player-slot">
      <span class="online-dot${isOnline(p.id) ? ' online-dot--on' : ''}" title="${isOnline(p.id) ? 'online' : 'away'}"></span>
      <div class="player-slot__ball" style="background:${p.color}"></div>
      <div class="player-slot__name">${i + 1}. ${escapeHtml(p.name)}</div>
      ${p.is_host ? '<span class="tag tag--host">Host</span>' : ''}
      ${p.id === myId ? '<span class="tag tag--you">You</span>' : ''}
      <div class="slot-btns">
        <button class="icon-btn" data-seat="${p.id}" data-dir="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="icon-btn" data-seat="${p.id}" data-dir="1" title="Move down" ${i === sorted.length - 1 ? 'disabled' : ''}>▼</button>
        ${host && p.id !== myId ? `<button class="icon-btn icon-btn--danger" data-kick="${p.id}" title="Remove player">✕</button>` : ''}
      </div>
    </div>`).join('');
  for (let i = players.length; i < s.maxPlayers; i++) html += `<div class="player-slot player-slot--empty"><div class="player-slot__name">Waiting for a player…</div></div>`;
  $('player-list').innerHTML = html;
  $('player-count').textContent = `${players.length} / ${s.maxPlayers}`;
  document.querySelectorAll('.swatch').forEach(sw => sw.classList.toggle('active', sw.dataset.color === me?.color));

  $('settings-form').hidden = !host;
  $('settings-summary').hidden = host;
  const create = s.cardSource === 'create';
  const bd = BOARD(s.board);
  if (host) {
    rebuildBoardOptions(s);
    if (!settingsFormFocused()) fillSettingsForm(s);
    $('row-cardsPerPlayer').hidden = !create;
    ['row-official', 'row-experimental', 'row-custom', 'row-poolExtra'].forEach(id => $(id).classList.toggle('setting-row--off', create));
  } else {
    $('settings-summary').innerHTML = [
      ['Board', `${bd.emoji} ${bd.name} (${bd.length} spaces)`],
      ['Random squares', randomSquareNote(s).replace('Random each race: ', '').replace(/\.$/, '') || 'none'],
      ['Racers come from', create ? `players (${s.cardsPerPlayer} each per draft)` : 'the deck'],
      ['Card sets', create ? '—' : ([s.official && 'Official', s.experimental && '⚗️ Experimental', s.custom && 'Custom'].filter(Boolean).join(' + ') || 'none')],
      ['Races', s.races], ['Draft every', `${s.draftEvery} race(s)`], ['Picks per draft', s.picksPerDraft],
      ['Extra cards', create ? '—' : s.poolExtra], ['Racers retire', s.retire ? 'Yes' : 'No'],
      ['Points', s.points], ['Finishers to end', s.finishersToEnd],
    ].map(([k, v]) => `<div>${k}: <b>${escapeHtml(String(v))}</b></div>`).join('') + '<p class="hint mt-8">Only the host can change settings.</p>';
  }
  renderBoardPreview(bd);

  const deckSize = enabledCardIds(s).length;
  const need = players.length * s.picksPerDraft + s.poolExtra;
  $('deck-size').textContent = create
    ? `Everyone will invent ${s.cardsPerPlayer} racer(s) before each draft — ${players.length * s.cardsPerPlayer} cards on the table.`
    : `${deckSize} cards in the deck` + (deckSize < need ? ` — not enough for a full draft (${need} needed). Turn on more sets.` : '');

  const canStart = players.length >= 1 && (create || deckSize > 0);
  $('start-btn').hidden = !host;
  $('start-btn').disabled = !canStart;
  $('waiting-msg').textContent = host
    ? (players.length < 2 ? 'Waiting for friends… (you can start solo to test)' : `${players.length} players ready`)
    : 'Waiting for the host to start…';
}

function settingsFormFocused() { return !!document.activeElement?.closest?.('#settings-form'); }
function fillSettingsForm(s) {
  Object.entries(s).forEach(([k, v]) => {
    const el = $('s-' + k); if (!el) return;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  $('squareCount-val').textContent = $('s-squareCount').value;
}
function readSettingsForm() {
  const out = {};
  Object.entries(DEFAULT_SETTINGS).forEach(([k, def]) => {
    const el = $('s-' + k); if (!el) { out[k] = def; return; }
    if (el.type === 'checkbox') out[k] = el.checked;
    else if (el.tagName === 'SELECT') out[k] = el.value;
    else if (el.type === 'number' || el.type === 'range') { const n = parseInt(el.value, 10); out[k] = isNaN(n) ? def : Math.max(+el.min || 0, Math.min(+el.max || 999, n)); }
    else out[k] = el.value.trim() || def;
  });
  if (!BOARDS.some(b => b.id === out.board)) out.board = 'classic';
  return out;
}
function rebuildBoardOptions(s) {
  const sel = $('s-board');
  const list = BOARDS.filter(b => !b.experimental || s.experimentalBoards);
  const key = list.map(b => b.id).join(',');
  if (sel.dataset.built !== key) {
    sel.innerHTML = list.map(b => `<option value="${b.id}">${b.emoji} ${b.name}</option>`).join('');
    sel.dataset.built = key;
  }
}
function legendHTML(specials) {
  const notes = { forward: 'jump ahead', back: 'fall back', ladder: 'climb up', chute: 'slide down', point: '+1 point', trip: 'miss a turn' };
  const order = ['forward', 'back', 'ladder', 'chute', 'point', 'trip'];
  const types = [...new Set(Object.values(specials || {}).map(x => x.type))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return types.filter(tp => SPECIAL_INFO[tp]).map(tp => `<span class="chip">${SPECIAL_INFO[tp].emoji} ${SPECIAL_INFO[tp].label} — ${notes[tp]}</span>`).join('');
}
function renderBoardPreview(def) {
  const box = $('board-preview');
  if (box.dataset.id !== def.id) { box.innerHTML = boardSVG(def, { id: 'board-preview-svg' }); box.dataset.id = def.id; }
  $('board-blurb').textContent = `${def.emoji} ${def.name} · ${def.length} spaces. ${def.blurb} ${randomSquareNote(S())}`;
  $('board-legend-lobby').innerHTML = legendHTML(def.specials);
}
async function saveSettings() {
  if (!isHost()) return;
  const settings = readSettingsForm();
  lobby.settings = settings;
  renderLobby();
  try { await store.updateLobby(lobbyCode, { settings }); }
  catch { showNotif('Could not save settings', 'error'); }
}

async function moveSeat(pid, dir) {
  const order = [...players].sort((a, b) => a.seat_order - b.seat_order).map(p => p.id);
  const i = order.indexOf(pid), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  await Promise.all(order.map((id, k) => store.updatePlayer(id, { seat_order: k })));
}
async function shuffleSeats() {
  const order = shuffle(players.map(p => p.id));
  await Promise.all(order.map((id, k) => store.updatePlayer(id, { seat_order: k })));
  showNotif('Order shuffled', 'success');
}
async function kickPlayer(pid) {
  if (!isHost() || pid === myId) return;
  if (!confirm(`Remove ${pName(pid)} from the game?`)) return;
  await store.deletePlayer(pid);
}
async function copyInvite() {
  const url = new URL('index.html', location.href);
  url.searchParams.set('code', lobbyCode);
  try { await navigator.clipboard.writeText(url.href); showNotif(LOCAL_MODE ? 'Link copied (local mode: only works in this browser)' : 'Invite link copied!', 'success'); }
  catch { prompt('Copy this invite link:', url.href); }
}

// ── Game view ────────────────────────────────────────────────
function renderGame() {
  ensureBoard();
  renderPieces();
  renderDrawings();
  renderDrawBar();
  renderTurnBox();
  renderRacers();
  renderLog();
  renderStrip();
  const racing = state.phase === 'race';
  $('board').classList.toggle('board-dim', !racing);
  $('host-race-controls').hidden = !(isHost() && racing);
  const fo = state.finishOrder || [];
  $('end-race-btn').classList.toggle('btn--pulse', fo.length >= RS().finishersToEnd);
  $('board-hint').textContent = drawMode
    ? 'Draw mode: scribble on the board. Hit Draw again (or Esc) to go back to moving pawns.'
    : racing
      ? (selectedPiece ? 'Now click a space to move it (or drag the pawn there).' : 'Click or drag any pawn to move it. Nothing is enforced — read the cards and play it out.')
      : '';
}

// Board geometry — spaces sit wherever the board's path puts them (see js/boards.js)
function cellXY(i) {
  const { points } = layoutBoard(boardDef());
  const p = points[Math.max(0, Math.min(points.length - 1, i))];
  return { x: p.x, y: p.y };
}
function boardKey() { return boardDef().id + '|' + JSON.stringify(state.squares || {}); }
function ensureBoard() { if (builtBoardKey !== boardKey()) buildBoard(); }
function buildBoard() {
  const def = boardDef();
  const specials = effectiveSpecials();
  $('board').innerHTML = boardSVG(def, { cls: drawMode ? 'drawing' : '', specials });
  $('board-legend').innerHTML = legendHTML(specials);
  builtBoardKey = boardKey();

  const svg = $('board-svg');
  svg.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }
    if (drawMode) return;
    const g = e.target.closest('[data-space]');
    if (g && selectedPiece && state.phase === 'race') movePiece(selectedPiece, parseInt(g.dataset.space, 10));
  });
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
}

function renderPieces() {
  const layer = $('pieces-layer');
  if (!layer || drag) return;
  const bySpace = {};
  Object.entries(state.pieces || {}).forEach(([id, p]) => { (bySpace[p.space] ||= []).push({ id, ...p }); });
  let s = '';
  Object.entries(bySpace).forEach(([space, list]) => {
    const { x: cx, y: cy } = cellXY(+space);
    const n = list.length;
    list.forEach((p, k) => {
      let ox = 0, oy = 0;
      if (n > 1) { const ang = (k / n) * Math.PI * 2 - Math.PI / 2; const r = n === 2 ? 12 : 15; ox = Math.cos(ang) * r; oy = Math.sin(ang) * r; }
      const card = CARD(p.cardId), R = n > 2 ? 13 : 18;
      const face = (card.art && card.pawn !== 'emoji')
        ? `<image class="piece__art" href="${card.art}" x="${-R}" y="${-R}" width="${2 * R}" height="${2 * R}" clip-path="url(#clip${R})" preserveAspectRatio="xMidYMid slice"/><circle class="piece__ball" r="${R}" fill="none"/>`
        : `<text class="piece__emoji" style="font-size:${R > 14 ? 19 : 14}px">${card.emoji}</text>`;
      s += `<g class="piece${p.id === selectedPiece ? ' piece--selected' : ''}" data-piece="${p.id}" transform="translate(${cx + ox},${cy + oy})">
        <circle class="piece__ball" r="${R}" fill="${pColor(p.pid)}"/>${face}
        ${card.pawns > 1 ? `<text class="piece__tag" y="${R + 9}">${p.n + 1}</text>` : ''}
      </g>`;
    });
  });
  layer.innerHTML = s;
}

function svgPoint(e) {
  const svg = $('board-svg'); const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function onPointerDown(e) {
  if (drawMode) {
    if (isMuted(myId)) return showNotif('The host muted your drawing', 'error');
    e.preventDefault();
    const p = svgPoint(e);
    liveStroke = { id: generateId(), player_id: myId, color: drawColor || me.color, width: drawWidth, points: [[Math.round(p.x), Math.round(p.y)]] };
    liveEl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    setStrokeAttrs(liveEl, liveStroke);
    $('draw-layer').appendChild(liveEl);
    try { $('board-svg').setPointerCapture(e.pointerId); } catch {}
    return;
  }
  if (state.phase !== 'race') return;
  const g = e.target.closest('[data-piece]');
  if (!g) return;
  e.preventDefault();
  drag = { id: g.dataset.piece, el: g, startX: e.clientX, startY: e.clientY, moved: false };
  try { $('board-svg').setPointerCapture(e.pointerId); } catch {}
}
function onPointerMove(e) {
  if (liveStroke) {
    const p = svgPoint(e);
    const last = liveStroke.points[liveStroke.points.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) < 3) return;
    liveStroke.points.push([Math.round(p.x), Math.round(p.y)]);
    liveEl.setAttribute('points', pointsAttr(liveStroke));
    return;
  }
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
  drag.moved = true;
  drag.el.classList.add('piece--dragging');
  drag.el.style.pointerEvents = 'none';
  const p = svgPoint(e);
  drag.el.setAttribute('transform', `translate(${p.x},${p.y})`);
}
function onPointerUp(e) {
  if (liveStroke) {
    const s = liveStroke; liveStroke = null; liveEl = null;
    suppressClick = true;
    if (s.points.length === 1) s.points.push([s.points[0][0] + 1, s.points[0][1]]);
    strokes.push(s);
    renderDrawings();
    store.addStroke(lobbyCode, s).catch(err => { console.error(err); showNotif('Could not save that stroke', 'error'); });
    return;
  }
  if (!drag) return;
  const d = drag; drag = null;
  // Hit-test while the dragged pawn still ignores the pointer, so we find the cell under it
  const target = d.moved ? document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-space]') : null;
  d.el.style.pointerEvents = '';
  d.el.classList.remove('piece--dragging');
  if (d.moved) {
    suppressClick = true;
    selectedPiece = d.id;
    if (target) movePiece(d.id, parseInt(target.dataset.space, 10));
    else renderGame();
  } else {
    selectedPiece = selectedPiece === d.id ? null : d.id;
    renderGame();
  }
}

// ── Board drawings ───────────────────────────────────────────
function pointsAttr(s) { return s.points.map(p => p.join(',')).join(' '); }
function setStrokeAttrs(el, s) {
  el.setAttribute('points', pointsAttr(s));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', s.color);
  el.setAttribute('stroke-width', s.width);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('opacity', '0.92');
}
function renderDrawings() {
  const layer = $('draw-layer'); if (!layer) return;
  layer.innerHTML = '';
  if (hideDrawings) return;
  strokes.filter(s => !isMuted(s.player_id) && Array.isArray(s.points)).forEach(s => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    setStrokeAttrs(el, s);
    layer.appendChild(el);
  });
}
function buildDrawBar() {
  const row = $('draw-colors');
  row.innerHTML = '';
  const colors = [me.color, ...DRAW_COLORS.filter(c => c !== me.color)];
  drawColor = me.color;
  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'draw-swatch' + (c === drawColor ? ' active' : ''); sw.style.background = c; sw.dataset.color = c;
    sw.onclick = () => { drawColor = c; row.querySelectorAll('.draw-swatch').forEach(x => x.classList.toggle('active', x.dataset.color === c)); if (!drawMode) toggleDraw(); };
    row.appendChild(sw);
  });
  $('draw-toggle').onclick = toggleDraw;
  $('draw-size').onclick = () => { drawWidth = drawWidth === 4 ? 9 : 4; $('draw-size').textContent = drawWidth === 4 ? 'Thin' : 'Thick'; };
  $('draw-hide').onclick = () => { hideDrawings = !hideDrawings; $('draw-hide').textContent = hideDrawings ? '👁 Show drawings' : '👁 Hide drawings'; renderDrawings(); };
  $('draw-clear-mine').onclick = () => clearStrokes(myId);
  $('draw-clear-all').onclick = () => { if (confirm('Erase everyone\'s drawings?')) clearStrokes(null); };
}
function toggleDraw() {
  if (!drawMode && isMuted(myId)) return showNotif('The host muted your drawing', 'error');
  drawMode = !drawMode;
  $('draw-toggle').classList.toggle('active', drawMode);
  $('board-svg')?.classList.toggle('drawing', drawMode);
  renderGame();
}
function renderDrawBar() {
  const muted = isMuted(myId);
  $('draw-toggle').disabled = muted;
  $('draw-toggle').textContent = muted ? '🔇 Muted' : (drawMode ? '✏️ Drawing…' : '✏️ Draw');
  if (muted && drawMode) { drawMode = false; $('draw-toggle').classList.remove('active'); $('board-svg')?.classList.remove('drawing'); }
  $('draw-clear-all').hidden = !isHost();
}
async function clearStrokes(pid) {
  strokes = strokes.filter(s => pid && s.player_id !== pid);
  renderDrawings();
  try {
    await store.clearStrokes(lobbyCode, pid || undefined);
    const t = txn(); t.op({ path: ['drawEpoch'], value: Date.now() }); seenDrawEpoch = t.st.drawEpoch;
    await commit(t);
  } catch (err) { console.error(err); showNotif('Could not clear drawings', 'error'); }
}
async function toggleMute(pid) {
  if (!isHost()) return;
  const now = !isMuted(pid);
  const t = txn();
  t.op({ path: ['muted', pid], value: now });
  t.log(now ? `🔇 ${pName(pid)} can no longer draw on the board` : `🔊 ${pName(pid)} can draw again`, 'warn');
  await commit(t);
}

// ── Turn box / racers / log ──────────────────────────────────
function renderTurnBox() {
  const order = state.raceOrder || [];
  const cur = state.phase === 'race' ? order[state.turn?.index || 0] : null;
  $('turn-sub').textContent = state.phase === 'race' ? `Race ${state.race} of ${RS().races} · Turn ${state.turn?.number || 1}` : phaseLabel();
  $('turn-who').textContent = cur ? `${pName(cur)}${cur === myId ? ' (you)' : ''}` : '—';
  $('turn-who').style.color = cur ? pColor(cur) : '';

  const lr = state.lastRoll;
  const dice = $('dice-row');
  if (!lr) dice.innerHTML = '<div class="die die--empty">?</div>';
  else {
    const anim = lr.at !== animatedRollAt;
    animatedRollAt = lr.at;
    dice.innerHTML = lr.values.map(v => `<div class="die${anim ? ' die--rolling' : ''}">${v}</div>`).join('');
  }
  $('roll-meta').textContent = lr ? `${pName(lr.pid)} rolled${lr.values.length > 1 ? ' a total of ' + lr.values.reduce((a, b) => a + b, 0) : ''}` : 'Nobody has rolled yet';

  const pc = selectedPiece ? state.pieces?.[selectedPiece] : null;
  $('selected-label').innerHTML = pc
    ? `Selected: <b>${CARD(pc.cardId).emoji} ${escapeHtml(CARD(pc.cardId).name)}</b> <span class="hint">(${escapeHtml(pName(pc.pid))})</span> on ${spaceName(pc.space)}`
    : 'Click a pawn to select it';
  const racing = state.phase === 'race';
  ['roll-btn', 'roll2-btn', 'next-turn-btn', 'draw-btn'].forEach(id => $(id).disabled = !racing);
  ['mv-back', 'mv-fwd', 'mv-start'].forEach(id => $(id).disabled = !racing || !pc);
  $('mv-roll').disabled = !racing || !pc || !lr;
  $('undo-btn').disabled = !racing || !state.undo;
}

function renderRacers() {
  const list = $('racer-list'); if (!list || lobby.status === 'waiting') return;
  const order = state.phase === 'race' && state.raceOrder?.length ? state.raceOrder : gp().map(p => p.id);
  const cur = state.phase === 'race' ? state.raceOrder?.[state.turn?.index || 0] : null;
  const fo = state.finishOrder || [];
  list.innerHTML = order.map(pid => {
    const runner = state.runners?.[pid];
    const card = runner ? CARD(runner) : null;
    const place = fo.indexOf(pid);
    const pieces = Object.values(state.pieces || {}).filter(p => p.pid === pid);
    const pos = place >= 0 ? `🏁 ${ordinal(place + 1)}` : pieces.length ? pieces.map(p => p.space === 0 ? 'Start' : p.space).join(' / ') : '';
    const stable = (state.stables?.[pid] || []).filter(c => c !== runner);
    const retired = state.retired?.[pid] || [];
    const chips = [...stable.map(c => `<span class="mini-chip" data-card="${c}">${CARD(c).emoji} ${escapeHtml(CARD(c).name)}</span>`),
                   ...retired.map(c => `<span class="mini-chip mini-chip--retired" data-card="${c}">${CARD(c).emoji} ${escapeHtml(CARD(c).name)}</span>`)].join('');
    const muteBtn = isHost() && pid !== myId ? `<button class="icon-btn${isMuted(pid) ? ' icon-btn--on' : ''}" data-mute="${pid}" title="${isMuted(pid) ? 'Allow drawing' : 'Mute drawing'}">${isMuted(pid) ? '🔇' : '🔊'}</button>` : (isMuted(pid) ? '<span title="muted from drawing">🔇</span>' : '');
    return `<div class="racer-row${pid === cur ? ' racer-row--current' : ''}${place >= 0 ? ' racer-row--done' : ''}" ${card ? `data-card="${card.id}"` : ''}>
      <div class="racer-row__ball" style="background:${pColor(pid)}">${card ? card.emoji : ''}</div>
      <div class="racer-row__body">
        <div class="racer-row__name"><span class="online-dot${isOnline(pid) ? ' online-dot--on' : ''}" style="display:inline-block;vertical-align:middle;margin-right:4px"></span>${escapeHtml(pName(pid))}${pid === myId ? ' <span class="hint">(you)</span>' : ''}</div>
        <div class="racer-row__sub">${card ? escapeHtml(card.name) + ' — ' + escapeHtml(card.text) : 'No racer on the track'}</div>
        ${chips ? `<div class="stable-chips">${chips}</div>` : ''}
      </div>
      <div class="racer-row__pos">${pos}<div class="hint">${state.scores?.[pid] ?? 0} pts</div>${state.skips?.[pid] ? '<div class="hint" title="Landed on a trip square">🍌 misses a turn</div>' : ''}${muteBtn}</div>
    </div>`;
  }).join('');
}

// Every racer on the track (or everyone's stable between races), card text and all
function renderStrip() {
  const el = $('racer-strip');
  const racing = state.phase === 'race';
  const order = racing && state.raceOrder?.length ? state.raceOrder : gp().map(p => p.id);
  const cur = racing ? state.raceOrder?.[state.turn?.index || 0] : null;
  el.innerHTML = order.map(pid => {
    const runner = state.runners?.[pid];
    const cards = runner ? [runner] : (state.stables?.[pid] || []);
    return cards.map(cid => `<div class="strip-item${pid === cur ? ' strip-item--current' : ''}">
      <div class="strip-item__who" style="background:${pColor(pid)}">${escapeHtml(pName(pid))}${state.skips?.[pid] ? ' 🍌' : ''}${(state.finishOrder || []).includes(pid) ? ' 🏁' : ''}</div>
      ${cardHTML(CARD(cid), { mini: true })}</div>`).join('');
  }).join('');
  el.hidden = !el.innerHTML;
}

function renderLog() {
  const entries = [...(state.log || [])].reverse().slice(0, 80);
  $('log').innerHTML = entries.map(e => `<div class="log__entry log__entry--${e.type || 'info'}">${escapeHtml(e.text)}</div>`).join('') || '<div class="hint">Nothing yet.</div>';
}

async function sendChat(e) {
  e.preventDefault();
  const v = $('chat-input').value.trim();
  if (!v || lobby.status !== 'playing') return;
  $('chat-input').value = '';
  const t = txn(); t.log(`💬 ${myName()}: ${v}`, 'chat');
  await commit(t);
}

// ── Overlays ─────────────────────────────────────────────────
function renderOverlays() {
  const ph = lobby.status === 'waiting' ? null : state.phase;
  $('overlay-create').hidden   = ph !== 'create';
  $('overlay-draft').hidden    = ph !== 'draft';
  $('overlay-lineup').hidden   = ph !== 'lineup';
  $('overlay-results').hidden  = ph !== 'results';
  $('overlay-gameover').hidden = ph !== 'gameover';
  if (ph === 'create')   renderCreate();
  if (ph === 'draft')    renderDraft();
  if (ph === 'lineup')   renderLineup();
  if (ph === 'results')  renderResults();
  if (ph === 'gameover') renderFinal();
  if (ph !== 'results')  renderedResultsKey = null;
  if (ph !== 'create' && editingCardId) resetCardForm();
}

function canPickNow() {
  const d = state.draft; if (!d || state.phase !== 'draft') return false;
  const cur = d.order[d.pickIndex];
  return cur === myId || isHost();
}

function renderDraft() {
  const d = state.draft; if (!d) return;
  const cur = d.order[d.pickIndex];
  $('draft-title').textContent = `Draft · before race ${state.race}`;
  $('draft-deck-info').textContent = RS().cardSource === 'create' ? 'Player-made racers' : `${(state.deck || []).length} cards left in the deck`;
  $('pick-order').innerHTML = d.order.map((pid, i) =>
    `<span class="pick-order__item${i < d.pickIndex ? ' pick-order__item--done' : i === d.pickIndex ? ' pick-order__item--now' : ''}" style="border-color:${pColor(pid)}">${i + 1}. ${escapeHtml(pName(pid))}</span>`).join('');
  $('now-picking').innerHTML = cur
    ? `<span style="color:${pColor(cur)}">${escapeHtml(pName(cur))}</span> is picking${cur === myId ? ' — that\'s you! Click a card to read it, then Draft it.' : (isHost() ? ' <span class="hint">(as host you can pick for them)</span>' : '…')}`
    : 'Draft complete';
  const pickme = canPickNow();
  $('draft-pool').innerHTML = d.pool.map(cid => cardHTML(CARD(cid), { pickme })).join('');
  $('draft-stables').innerHTML = gp().map(p => {
    const cards = state.stables?.[p.id] || [];
    return `<div class="status-row"><span class="status-row__ball" style="background:${p.color}"></span><span class="status-row__name">${escapeHtml(p.name)}</span>
      <span class="stable-chips">${cards.map(c => `<span class="mini-chip" data-card="${c}">${CARD(c).emoji} ${escapeHtml(CARD(c).name)}</span>`).join('') || '<span class="hint">no racers yet</span>'}</span></div>`;
  }).join('');
}

function renderLineup() {
  const lu = state.lineup || {};
  $('lineup-title').textContent = `Race ${state.race} · who's racing?`;
  $('lineup-status').innerHTML = gp().map(p => {
    const v = lu[p.id];
    const status = v === 'none' ? 'sitting out (no racers)' : v ? `✓ ${CARD(v).emoji} ${escapeHtml(CARD(v).name)}` : 'choosing…';
    const first = (state.stables?.[p.id] || [])[0];
    const hostBtn = (v === null && isHost() && p.id !== myId && first) ? `<button class="btn btn--sm" onclick="chooseRunner('${p.id}', '${first}')">Pick for them</button>` : '';
    return `<div class="status-row"><span class="status-row__ball" style="background:${p.color}"></span><span class="status-row__name">${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span><span>${status}</span>${hostBtn}</div>`;
  }).join('');
  const mine = state.stables?.[myId] || [];
  if (lu[myId] === null) {
    $('lineup-hint').textContent = 'Pick which of your racers runs this race. Click a card to read it, then choose.';
    $('lineup-cards').innerHTML = mine.map(cid => cardHTML(CARD(cid), { pickme: true })).join('');
  } else {
    $('lineup-hint').textContent = 'Waiting for everyone else to choose…';
    $('lineup-cards').innerHTML = '';
  }
}

function renderResults() {
  const r = state.results; if (!r) return;
  const key = JSON.stringify(r) + isHost();
  if (key === renderedResultsKey) return;   // don't wipe the host's edits on unrelated updates
  renderedResultsKey = key;
  $('results-title').textContent = `Race ${state.race} results`;
  $('results-list').innerHTML = r.placements.map((pid, i) => {
    const card = CARD(state.runners?.[pid]);
    const finished = i < (r.finished ?? r.placements.length);
    return `<div class="result-row result-row--${i + 1}">
      <div class="result-row__place">${finished ? ordinal(i + 1) : '—'}</div>
      <div class="result-row__name" style="color:${pColor(pid)}">${escapeHtml(pName(pid))} <span class="hint">${card.emoji} ${escapeHtml(card.name)}${finished ? '' : ' · did not finish'}</span></div>
      <div class="result-row__pts">${isHost() ? `<input class="pts-input" type="number" data-pid="${pid}" value="${r.points[pid] || 0}"> pts` : `+${r.points[pid] || 0} pts`}</div>
    </div>`;
  }).join('');
  $('results-hint').textContent = isHost() ? 'Adjust points if a card says so, then continue.' : 'Waiting for the host to continue…';
  $('continue-btn').hidden = !isHost();
}

function renderFinal() {
  const sorted = [...gp()].sort((a, b) => (state.scores[b.id] || 0) - (state.scores[a.id] || 0));
  $('final-list').innerHTML = sorted.map((p, i) => `
    <div class="result-row result-row--${i + 1}">
      <div class="result-row__place">${ordinal(i + 1)}</div>
      <div class="result-row__name" style="color:${p.color}">${escapeHtml(p.name)}</div>
      <div class="result-row__pts">${state.scores[p.id] || 0} pts</div>
    </div>`).join('');
  $('again-btn').hidden = !isHost();
}

// ── Create-a-racer phase ─────────────────────────────────────
function createRound() { return state.createRound || state.race || 1; }
function cardsThisRound() { return madeCards.filter(c => c.round === createRound()); }

function initSketch() {
  const canvas = $('c-canvas');
  const ctx = canvas.getContext('2d');
  sketch = { canvas, ctx, color: SKETCH_COLORS[0], size: 5, drawing: false, dirty: false };
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  const tools = $('sketch-tools');
  SKETCH_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'draw-swatch' + (c === sketch.color ? ' active' : ''); sw.style.background = c; sw.dataset.color = c;
    sw.title = c === '#ffffff' ? 'Eraser' : '';
    sw.onclick = () => { sketch.color = c; tools.querySelectorAll('.draw-swatch').forEach(x => x.classList.toggle('active', x.dataset.color === c)); };
    tools.appendChild(sw);
  });
  const sizeBtn = document.createElement('button');
  sizeBtn.className = 'btn btn--sm'; sizeBtn.type = 'button'; sizeBtn.textContent = 'Pen: M';
  sizeBtn.onclick = () => { sketch.size = sketch.size === 5 ? 12 : sketch.size === 12 ? 2 : 5; sizeBtn.textContent = 'Pen: ' + (sketch.size === 2 ? 'S' : sketch.size === 5 ? 'M' : 'L'); };
  tools.appendChild(sizeBtn);
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn--sm btn--ghost'; clearBtn.type = 'button'; clearBtn.textContent = 'Clear';
  clearBtn.onclick = clearSketch;
  tools.appendChild(clearBtn);

  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    const p = pos(e); sketch.drawing = true; sketch.dirty = true;
    ctx.strokeStyle = sketch.color; ctx.lineWidth = sketch.size;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y); ctx.stroke();
  });
  canvas.addEventListener('pointermove', e => { if (!sketch.drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
  const stop = () => { sketch.drawing = false; };
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
}
function clearSketch() { const { ctx, canvas } = sketch; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); sketch.dirty = false; }
function buildEmojiPicker() {
  const box = $('emoji-picker');
  box.innerHTML = EMOJI_CHOICES.map(e => `<button type="button" data-emoji="${e}" title="${e}">${e}</button>`).join('');
  box.onclick = e => { const b = e.target.closest('[data-emoji]'); if (!b) return; $('c-emoji').value = b.dataset.emoji; syncEmojiPicker(); };
  $('c-emoji').addEventListener('input', syncEmojiPicker);
}
function syncEmojiPicker() {
  const v = $('c-emoji').value.trim();
  $('emoji-picker').querySelectorAll('[data-emoji]').forEach(b => b.classList.toggle('active', b.dataset.emoji === v));
}
function setPawnChoice(v) {
  pawnChoice = v;
  $('pawn-art').classList.toggle('active', v === 'art');
  $('pawn-emoji').classList.toggle('active', v === 'emoji');
}
function resetCardForm() {
  editingCardId = null;
  ['c-name', 'c-tag', 'c-text', 'c-emoji'].forEach(id => $(id).value = '');
  syncEmojiPicker();
  setPawnChoice('art');
  clearSketch();
  $('create-form-title').textContent = 'New racer';
  $('c-save').textContent = 'Save racer';
  $('c-cancel').hidden = true;
  renderCreate();
}
function editMadeCard(id) {
  const c = madeCards.find(x => x.id === id); if (!c || c.player_id !== myId) return;
  editingCardId = id;
  $('c-name').value = c.name; $('c-tag').value = c.tag || ''; $('c-text').value = c.text; $('c-emoji').value = c.emoji === '🎨' ? '' : (c.emoji || '');
  syncEmojiPicker();
  setPawnChoice(c.pawn || 'art');
  clearSketch();
  if (c.art) { const img = new Image(); img.onload = () => { sketch.ctx.drawImage(img, 0, 0); sketch.dirty = true; }; img.src = c.art; }
  $('create-form-title').textContent = `Editing ${c.name}`;
  $('c-save').textContent = 'Save changes';
  $('c-cancel').hidden = false;
  $('c-name').focus();
}
async function saveMadeCard() {
  if (state.phase !== 'create') return;
  const name = $('c-name').value.trim(), tag = $('c-tag').value.trim(), text = $('c-text').value.trim();
  const emoji = $('c-emoji').value.trim() || '🎨';
  if (!name) return showNotif('Give your racer a name', 'error');
  if (!text) return showNotif('Write what the racer does', 'error');
  const quota = RS().cardsPerPlayer;
  const mine = cardsThisRound().filter(c => c.player_id === myId);
  if (!editingCardId && mine.length >= quota) return showNotif(`You've already made ${quota} racer(s)`, 'error');
  const card = {
    id: editingCardId || 'made_' + generateId().slice(0, 8), player_id: myId, name, tag, text, emoji,
    art: sketch.dirty ? sketch.canvas.toDataURL('image/png') : null, pawn: pawnChoice, round: createRound(),
  };
  $('c-save').disabled = true;
  try {
    await store.saveCard(lobbyCode, card);
    madeCards = [...madeCards.filter(c => c.id !== card.id), { ...card, lobby_code: lobbyCode }];
    registerMadeCards();
    showNotif(editingCardId ? 'Saved!' : `${name} joins the roster!`, 'success');
    resetCardForm();
  } catch (err) { console.error(err); showNotif('Could not save the card', 'error'); }
  $('c-save').disabled = false;
}
async function deleteMadeCard(id) {
  const c = madeCards.find(x => x.id === id);
  if (!c || (c.player_id !== myId && !isHost()) || state.phase !== 'create') return;
  if (!confirm(`Delete ${c.name}?`)) return;
  madeCards = madeCards.filter(x => x.id !== id);
  registerMadeCards();
  if (editingCardId === id) resetCardForm(); else renderCreate();
  await store.deleteCard(id).catch(() => showNotif('Could not delete', 'error'));
}
function renderCreate() {
  if (state.phase !== 'create') return;
  const rs = RS(), quota = rs.cardsPerPlayer, cards = cardsThisRound();
  const total = gp().length * quota;
  $('create-title').textContent = `Create your racers · before race ${state.race}`;
  $('create-progress').textContent = `${cards.length} / ${total} racers made`;
  $('create-status').innerHTML = gp().map(p => {
    const n = cards.filter(c => c.player_id === p.id).length;
    return `<div class="status-row"><span class="status-row__ball" style="background:${p.color}"></span><span class="status-row__name">${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span><span>${n >= quota ? '✓ ' : ''}${n} / ${quota}</span></div>`;
  }).join('');
  const mine = cards.filter(c => c.player_id === myId).length;
  $('c-save').disabled = !editingCardId && mine >= quota;
  const done = cards.length >= total;
  $('create-start-btn').hidden = !isHost();
  $('create-start-btn').classList.toggle('btn--pulse', done);
  $('create-wait').textContent = isHost() ? (done ? 'Everyone is done!' : 'You can start early — anyone still missing cards drafts from what exists.') : (done ? 'Waiting for the host to start the draft…' : (mine >= quota ? 'Waiting for the others…' : `Make ${quota - mine} more racer(s).`));
  $('create-cards').innerHTML = cards.map(c => {
    const own = c.player_id === myId;
    const tools = own ? `<div class="card-wrap__own"><button class="btn btn--sm" data-edit="${c.id}">✎ Edit</button><button class="btn btn--sm btn--ghost" data-del="${c.id}">Delete</button></div>` : '';
    return `<div class="card-wrap">${cardHTML(CARD(c.id))}${tools}</div>`;
  }).join('') || '<p class="hint">No racers yet — be the first!</p>';
}
async function startCreatedDraft() {
  if (!isHost() || state.phase !== 'create') return;
  const cards = cardsThisRound();
  if (!cards.length) return showNotif('Nobody has made a racer yet', 'error');
  const rs = RS(), total = gp().length * rs.cardsPerPlayer;
  if (cards.length < total && !confirm(`Only ${cards.length} of ${total} racers are made. Start the draft anyway?`)) return;
  const pool = shuffle(cards.map(c => c.id));
  const ids = gp().map(p => p.id);
  const picks = Math.max(1, Math.min(rs.picksPerDraft, Math.floor(pool.length / ids.length)));
  const baseOrder = rotate(ids, state.race - 1);
  const order = [];
  for (let k = 0; k < picks; k++) order.push(...(k % 2 ? [...baseOrder].reverse() : baseOrder));
  const t = txn();
  t.op({ path: ['draft'], value: { pool, order, pickIndex: 0 } });
  t.op({ path: ['lineup'], value: {} });
  t.op({ path: ['phase'], value: 'draft' });
  t.log(`Draft before race ${state.race}: ${pool.length} player-made racers on the table. ${pName(order[0])} picks first.`, 'system');
  await commit(t);
}

// ── Cards ────────────────────────────────────────────────────
function cardHTML(c, o = {}) {
  const cls = ['card-face'];
  if (o.mini) cls.push('card-face--mini');
  if (o.static) cls.push('card-face--static');
  if (o.pickme) cls.push('card-face--pickme');
  const setLabel = c.set === 'experimental' ? '⚗️ experimental' : c.set === 'made' ? `made by ${escapeHtml(pName(c.by))}` : c.set;
  return `<div class="${cls.join(' ')}" style="--card-color:${c.color}" data-card="${c.id}">
    <div class="card-face__head">
      <div class="card-face__emoji">${c.emoji}</div>
      <div><div class="card-face__name">${escapeHtml(c.name)}</div><div class="card-face__tag">${escapeHtml(c.tag || '')}</div></div>
    </div>
    ${c.art ? `<div class="card-face__art"><img src="${c.art}" alt=""></div>` : ''}
    <div class="card-face__body">${escapeHtml(c.text)}</div>
    <div class="card-face__foot"><span>${setLabel}</span><span>#${c.number}${c.pawns > 1 ? ' · 2 pawns' : ''}</span></div>
  </div>`;
}

function openCardModal(cardId) {
  modalCardId = cardId;
  const c = CARD(cardId);
  $('modal-card-body').innerHTML = cardHTML(c, { static: true });
  const act = $('modal-card-actions');
  act.innerHTML = '';
  const add = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; act.appendChild(b); };
  if (state.phase === 'draft' && canPickNow() && state.draft.pool.includes(cardId)) {
    const cur = state.draft.order[state.draft.pickIndex];
    add(cur === myId ? 'Draft this racer' : `Draft for ${pName(cur)}`, 'btn--primary', () => pickCard(cardId));
  }
  if (state.phase === 'lineup' && state.lineup?.[myId] === null && (state.stables?.[myId] || []).includes(cardId)) {
    add('Race with this one', 'btn--primary', () => chooseRunner(myId, cardId));
  }
  add('Close', 'btn--ghost', closeCardModal);
  $('modal-card').hidden = false;
}
function closeCardModal() { modalCardId = null; $('modal-card').hidden = true; }

function buildGalleryTabs() {
  const tabs = [['all', 'All'], ['official', 'Official'], ['experimental', '⚗️ Experimental']];
  if (CUSTOM_CARDS.length) tabs.push(['custom', 'Custom']);
  if (madeCards.length) tabs.push(['made', '🎨 Player-made']);
  tabs.push(['undrafted', 'Undrafted this race']);
  if (!tabs.some(t => t[0] === galleryTab)) galleryTab = 'all';
  $('gallery-tabs').innerHTML = tabs.map(([k, l]) => `<button class="btn btn--sm${k === galleryTab ? ' active' : ''}" data-tab="${k}">${l}</button>`).join('');
  $('gallery-tabs').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { galleryTab = b.dataset.tab; buildGalleryTabs(); renderGallery(); });
}
function renderGallery() {
  const q = $('gallery-search').value.trim().toLowerCase();
  let cards = galleryTab === 'undrafted' ? (state.undrafted || []).map(CARD)
            : galleryTab === 'made' ? Object.values(RUNTIME_CARDS)
            : Object.values(CARD_INDEX).filter(c => galleryTab === 'all' || c.set === galleryTab);
  if (galleryTab === 'all') cards = [...cards, ...Object.values(RUNTIME_CARDS)];
  if (q) cards = cards.filter(c => (c.name + ' ' + c.text + ' ' + (c.tag || '')).toLowerCase().includes(q));
  $('gallery-grid').innerHTML = cards.map(c => cardHTML(c, { mini: true })).join('') || '<p class="hint">Nothing here.</p>';
}

// ============================================================
//  ACTIONS
// ============================================================

// ── Start tournament (host) ──────────────────────────────────
async function startGame() {
  if (!isHost()) return;
  const s = S();
  const ids = enabledCardIds(s);
  if (s.cardSource !== 'create' && !ids.length) return showNotif('Turn on at least one card set', 'error');
  const btn = $('start-btn'); btn.disabled = true;

  const sorted = [...players].sort((a, b) => a.seat_order - b.seat_order);
  const snap = sorted.map((p, i) => ({ id: p.id, name: p.name, color: p.color, seat: i }));
  const base = {
    phase: 'draft', race: 1, players: snap, scores: {}, stables: {}, retired: {}, muted: {},
    deck: shuffle(ids), discard: [], drawn: [], undrafted: [], draft: null, lineup: {}, runners: {}, pieces: {},
    finishOrder: [], raceOrder: [], turn: { index: 0, number: 1 }, lastRoll: null, undo: null, log: [], results: null,
    createRound: null, drawEpoch: Date.now(), board: BOARD(s.board).id, trackLength: BOARD(s.board).length, skips: {}, squares: {},
    settings: {
      races: s.races, draftEvery: s.draftEvery, picksPerDraft: s.picksPerDraft, poolExtra: s.poolExtra, points: s.points,
      retire: s.retire, finishersToEnd: s.finishersToEnd, cardSource: s.cardSource, cardsPerPlayer: s.cardsPerPlayer,
      randomBoost: s.randomBoost, randomChutes: s.randomChutes, randomStars: s.randomStars, squareCount: s.squareCount,
    },
  };
  snap.forEach(p => { base.scores[p.id] = 0; base.stables[p.id] = []; base.retired[p.id] = []; });

  const t = txn(base);
  t.log(`Tournament started: ${snap.length} player(s), ${s.races} race(s)${s.cardSource === 'create' ? ', player-made racers' : `, ${ids.length} cards in the deck`}`, 'system');
  setupDraft(t);
  try {
    await Promise.all([store.clearCards(lobbyCode), store.clearStrokes(lobbyCode)]);
    madeCards = []; strokes = []; registerMadeCards();
    await store.updateLobby(lobbyCode, { status: 'playing', game_state: t.st });
  } catch (err) { console.error(err); showNotif('Could not start the game', 'error'); btn.disabled = false; }
}

// ── Draft ────────────────────────────────────────────────────
function setupDraft(t) {
  const st = t.st, rs = RS(st);
  if (rs.cardSource === 'create') {
    t.op({ path: ['draft'], value: null });
    t.op({ path: ['lineup'], value: {} });
    t.op({ path: ['createRound'], value: st.race });
    t.op({ path: ['phase'], value: 'create' });
    t.log(`Before race ${st.race}: everyone invents ${rs.cardsPerPlayer} racer(s)!`, 'system');
    return;
  }
  const ids = st.players.map(p => p.id);
  const need = ids.length * rs.picksPerDraft + rs.poolExtra;
  let deck = [...st.deck], discard = [...st.discard];
  const pool = [];
  while (pool.length < need) {
    if (!deck.length) { if (!discard.length) break; deck = shuffle(discard); discard = []; }
    pool.push(deck.shift());
  }
  const baseOrder = rotate(ids, st.race - 1);
  const order = [];
  for (let k = 0; k < rs.picksPerDraft; k++) order.push(...(k % 2 ? [...baseOrder].reverse() : baseOrder));
  t.op({ path: ['deck'], value: deck });
  t.op({ path: ['discard'], value: discard });
  t.op({ path: ['draft'], value: { pool, order, pickIndex: 0 } });
  t.op({ path: ['lineup'], value: {} });
  t.op({ path: ['phase'], value: 'draft' });
  t.log(`Draft before race ${st.race}: ${pool.length} racers on the table. ${pName(order[0])} picks first.`, 'system');
  if (pool.length < need) t.log(`Not enough cards for a full draft — only ${pool.length} available.`, 'warn');
}

async function pickCard(cardId) {
  const d = state.draft;
  if (!d || state.phase !== 'draft') return;
  const pid = d.order[d.pickIndex];
  if (!pid) return;
  if (pid !== myId && !isHost()) return showNotif("It's not your pick", 'error');
  if (!d.pool.includes(cardId)) return showNotif('That card is gone', 'error');
  const t = txn();
  t.op({ path: ['draft', 'pool'], value: d.pool.filter(c => c !== cardId) });
  t.op({ path: ['stables', pid], append: cardId });
  t.op({ path: ['draft', 'pickIndex'], value: d.pickIndex + 1 });
  t.log(`${pName(pid)} drafted ${CARD(cardId).emoji} ${CARD(cardId).name}`, 'draft');
  if (d.pickIndex + 1 >= d.order.length) finishDraft(t);
  closeCardModal();
  await commit(t);
}

function finishDraft(t) {
  const st = t.st;
  const left = st.draft?.pool || [];
  t.op({ path: ['discard'], value: [...(st.discard || []), ...left] });
  t.op({ path: ['undrafted'], value: left });
  t.op({ path: ['draft'], value: null });
  t.log('Draft complete', 'system');
  enterLineup(t);
}

// ── Lineup ───────────────────────────────────────────────────
function enterLineup(t) {
  const st = t.st, lineup = {};
  st.players.forEach(p => {
    const av = st.stables[p.id] || [];
    lineup[p.id] = av.length === 1 ? av[0] : av.length === 0 ? 'none' : null;
  });
  t.op({ path: ['lineup'], value: lineup });
  if (Object.values(lineup).every(v => v !== null)) startRace(t);
  else t.op({ path: ['phase'], value: 'lineup' });
}

async function chooseRunner(pid, cardId) {
  if (state.phase !== 'lineup' || !cardId || cardId === 'undefined') return;
  if (pid !== myId && !isHost()) return;
  if (!(state.stables?.[pid] || []).includes(cardId)) return;
  const t = txn();
  t.op({ path: ['lineup', pid], value: cardId });
  t.log(`${pName(pid)} sends ${CARD(cardId).emoji} ${CARD(cardId).name} to the starting line`, 'draft');
  if (Object.values(t.st.lineup).every(v => v !== null)) startRace(t);
  closeCardModal();
  await commit(t);
}

// ── Race ─────────────────────────────────────────────────────
function startRace(t) {
  const st = t.st;
  const runners = {}, pieces = {};
  st.players.forEach(p => { const c = st.lineup[p.id]; if (c && c !== 'none') runners[p.id] = c; });
  Object.entries(runners).forEach(([pid, cid]) => {
    const n = CARD(cid).pawns || 1;
    for (let k = 0; k < n; k++) pieces[`${pid}_${k}`] = { pid, cardId: cid, n: k, space: 0 };
  });
  const order = rotate(st.players.map(p => p.id), st.race - 1).filter(pid => runners[pid]);
  t.op({ path: ['runners'], value: runners });
  t.op({ path: ['pieces'], value: pieces });
  t.op({ path: ['finishOrder'], value: [] });
  t.op({ path: ['raceOrder'], value: order });
  t.op({ path: ['turn'], value: { index: 0, number: 1 } });
  t.op({ path: ['lastRoll'], value: null });
  t.op({ path: ['undo'], value: null });
  t.op({ path: ['skips'], value: {} });
  const rs = RS(st);
  const squares = randomSquares(BOARD(st.board), { boost: rs.randomBoost, chutes: rs.randomChutes, stars: rs.randomStars, count: rs.squareCount });
  t.op({ path: ['squares'], value: squares });
  t.op({ path: ['results'], value: null });
  t.op({ path: ['phase'], value: 'race' });
  const sqList = Object.entries(squares).sort((a, b) => a[0] - b[0]).map(([i, sp]) => describeSpecial(i, sp).replace(/^\d+: /, `${i} `));
  if (sqList.length) t.log(`Random squares this race — ${sqList.join(' · ')}`, 'board');
  t.log(`🏁 Race ${st.race}! ${order.map(pid => `${pName(pid)} runs ${CARD(runners[pid]).emoji} ${CARD(runners[pid]).name}`).join(' · ')}`, 'system');
  if (order.length) t.log(`${pName(order[0])} goes first`, 'system');
}

async function roll(count) {
  if (state.phase !== 'race') return;
  const values = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6));
  const t = txn();
  t.op({ path: ['lastRoll'], value: { pid: myId, values, at: Date.now() } });
  t.log(`🎲 ${myName()} rolled ${values.length > 1 ? values.join(' + ') + ' = ' + values.reduce((a, b) => a + b, 0) : values[0]}`, 'roll');
  await commit(t);
}

async function nextTurn() {
  if (state.phase !== 'race') return;
  const order = state.raceOrder || []; if (!order.length) return;
  const cur = state.turn?.index || 0;
  const fo = state.finishOrder || [];
  const skips = { ...(state.skips || {}) };
  const t = txn();
  let next = -1;
  for (let k = 1; k <= order.length * 2; k++) {
    const j = (cur + k) % order.length, pid = order[j];
    if (fo.includes(pid)) continue;
    if (skips[pid]) {   // tripped on a banana peel: this turn is skipped
      skips[pid] = false;
      t.op({ path: ['skips', pid], value: false });
      t.log(`🍌 ${pName(pid)} misses this turn`, 'board');
      continue;
    }
    next = j; break;
  }
  if (next < 0) return showNotif('Everyone has finished — the host can end the race', 'info');
  const number = (state.turn?.number || 1) + (next <= cur ? 1 : 0);
  t.op({ path: ['turn'], value: { index: next, number } });
  t.log(`➜ ${pName(order[next])}'s turn`, 'info');
  await commit(t);
}

function nudge(delta) {
  const pc = selectedPiece ? state.pieces?.[selectedPiece] : null;
  if (pc) movePiece(selectedPiece, pc.space + delta);
}

async function movePiece(id, to) {
  const pc = state.pieces?.[id];
  if (!pc || state.phase !== 'race') return;
  to = Math.max(0, Math.min(GOAL(), to));
  if (to === pc.space) { renderGame(); return; }
  const t = txn();
  t.op({ path: ['undo'], value: { pieces: clone(state.pieces), finishOrder: clone(state.finishOrder || []), scores: clone(state.scores || {}), skips: clone(state.skips || {}) } });
  t.op({ path: ['pieces', id, 'space'], value: to });
  const card = CARD(pc.cardId);
  const label = `${card.emoji} ${card.name}${pc.pid !== myId ? ` (${pName(pc.pid)})` : ''}`;
  const from = pc.space;
  let fo = [...(state.finishOrder || [])];
  if (to === GOAL() && !fo.includes(pc.pid)) {
    fo.push(pc.pid);
    t.op({ path: ['finishOrder'], value: fo });
    t.log(`🏁 ${label} crosses the finish line in ${ordinal(fo.length)} place!`, 'system');
  } else if (from === GOAL() && to !== GOAL()) {
    const stillIn = Object.values(t.st.pieces).some(p => p.pid === pc.pid && p.space === GOAL());
    if (!stillIn) { fo = fo.filter(x => x !== pc.pid); t.op({ path: ['finishOrder'], value: fo }); }
    t.log(`${myName()} moved ${label} back off the goal to ${spaceName(to)}`, 'move');
  } else {
    const d = to - from;
    t.log(`${myName()} moved ${label} ${d > 0 ? 'forward' : 'back'} ${Math.abs(d)} to ${spaceName(to)}`, 'move');
  }
  // Board squares apply themselves when a pawn lands on them
  const sp = effectiveSpecials()[to];
  if (sp && to !== GOAL()) {
    if (sp.type === 'forward' || sp.type === 'back') {
      const dest = sp.type === 'forward' ? Math.min(trackLen(), to + sp.n) : Math.max(1, to - sp.n);
      t.op({ path: ['pieces', id, 'space'], value: dest });
      t.log(sp.type === 'forward'
        ? `⏩ ${label} hits a boost square: forward ${sp.n} to ${spaceName(dest)}!`
        : `⏪ ${label} hits a setback square: back ${sp.n} to ${spaceName(dest)}.`, 'board');
    } else if (sp.type === 'ladder' || sp.type === 'chute') {
      t.op({ path: ['pieces', id, 'space'], value: sp.to });
      t.log(sp.type === 'ladder'
        ? `🪜 ${label} climbs a ladder from ${to} up to ${sp.to}!`
        : `🛝 ${label} hits a chute and slides from ${to} down to ${sp.to}!`, 'board');
    } else if (sp.type === 'point') {
      t.op({ path: ['scores', pc.pid], value: (t.st.scores?.[pc.pid] || 0) + 1 });
      t.log(`⭐ ${label} lands on a point square: +1 point for ${pName(pc.pid)}`, 'board');
    } else if (sp.type === 'trip') {
      t.op({ path: ['skips', pc.pid], value: true });
      t.log(`🍌 ${label} slips on space ${to} — ${pName(pc.pid)} misses their next turn`, 'board');
    }
  }
  await commit(t);
}

async function undoMove() {
  const u = state.undo; if (!u || state.phase !== 'race') return;
  const t = txn();
  t.op({ path: ['pieces'], value: u.pieces });
  t.op({ path: ['finishOrder'], value: u.finishOrder });
  if (u.scores) t.op({ path: ['scores'], value: u.scores });
  if (u.skips) t.op({ path: ['skips'], value: u.skips });
  t.op({ path: ['undo'], value: null });
  t.log(`↶ ${myName()} undid the last move`, 'warn');
  await commit(t);
}

async function drawCard() {
  if (state.phase !== 'race') return;
  let deck = [...(state.deck || [])], discard = [...(state.discard || [])];
  if (!deck.length) { if (!discard.length) return showNotif('The deck is empty', 'error'); deck = shuffle(discard); discard = []; }
  const id = deck.shift();
  const t = txn();
  t.op({ path: ['deck'], value: deck });
  t.op({ path: ['discard'], value: [...discard, id] });
  t.op({ path: ['drawn'], append: id });
  t.log(`${myName()} drew ${CARD(id).emoji} ${CARD(id).name} from the deck`, 'draft');
  await commit(t);
  openCardModal(id);
}

// ── End of race / tournament (host) ──────────────────────────
async function endRace() {
  if (!isHost() || state.phase !== 'race') return;
  const fo = state.finishOrder || [];
  const rs = RS();
  if (fo.length < rs.finishersToEnd && !confirm(`Only ${fo.length} racer(s) have finished. End the race anyway?`)) return;
  const rest = (state.raceOrder || []).filter(pid => !fo.includes(pid)).sort((a, b) => bestSpace(b) - bestSpace(a));
  const placements = [...fo, ...rest];
  const table = pointsTable();
  const points = {};
  placements.forEach((pid, i) => points[pid] = table[i] || 0);
  const t = txn();
  t.op({ path: ['results'], value: { placements, points, finished: fo.length } });
  t.op({ path: ['phase'], value: 'results' });
  t.log(`Race ${state.race} is over`, 'system');
  if (drawMode) toggleDraw();
  await commit(t);
}

async function continueGame() {
  if (!isHost() || state.phase !== 'results') return;
  const r = state.results; if (!r) return;
  const rs = RS();
  const pts = { ...r.points };
  document.querySelectorAll('.pts-input').forEach(inp => { pts[inp.dataset.pid] = parseInt(inp.value, 10) || 0; });

  const t = txn();
  Object.entries(pts).forEach(([pid, p]) => t.op({ path: ['scores', pid], value: (state.scores?.[pid] || 0) + p }));
  if (rs.retire) Object.entries(state.runners || {}).forEach(([pid, cid]) => {
    t.op({ path: ['stables', pid], value: (state.stables?.[pid] || []).filter(c => c !== cid) });
    t.op({ path: ['retired', pid], append: cid });
  });
  t.op({ path: ['runners'], value: {} });
  t.op({ path: ['pieces'], value: {} });
  t.op({ path: ['results'], value: null });
  t.op({ path: ['finishOrder'], value: [] });
  t.op({ path: ['undo'], value: null });
  t.log(`Points: ${r.placements.map((pid, i) => `${ordinal(i + 1)} ${pName(pid)} +${pts[pid] || 0}`).join(' · ')}`, 'system');

  if (state.race >= rs.races) {
    t.op({ path: ['phase'], value: 'gameover' });
    const sorted = [...t.st.players].sort((a, b) => (t.st.scores[b.id] || 0) - (t.st.scores[a.id] || 0));
    t.log(`🏆 Tournament over! ${pName(sorted[0].id)} wins with ${t.st.scores[sorted[0].id] || 0} points.`, 'system');
  } else {
    const race = state.race + 1;
    t.op({ path: ['race'], value: race });
    const needDraft = ((race - 1) % rs.draftEvery === 0) || t.st.players.some(p => !(t.st.stables[p.id] || []).length);
    if (needDraft) setupDraft(t); else enterLineup(t);
  }
  selectedPiece = null;
  await commit(t);
}

async function backToLobby() {
  if (!isHost()) return;
  try { await store.updateLobby(lobbyCode, { status: 'waiting', game_state: {} }); }
  catch { showNotif('Could not reset the lobby', 'error'); }
}

// ── Leave ────────────────────────────────────────────────────
async function leaveLobby() {
  if (!confirm('Leave this game?')) return;
  leaving = true;
  try {
    if (isHost()) {
      const next = players.filter(p => p.id !== myId).sort((a, b) => a.seat_order - b.seat_order)[0];
      if (next) { await store.updatePlayer(next.id, { is_host: true }); await store.updateLobby(lobbyCode, { host_player_id: next.id }); }
    }
    await store.deletePlayer(myId);
  } catch (err) { console.error(err); }
  IDENT.removeItem('ma_playerId');
  IDENT.removeItem('ma_lobbyCode');
  window.location.href = 'index.html';
}

init();
