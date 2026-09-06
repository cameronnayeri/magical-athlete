// ============================================================
//  Shared utilities — loaded on every page
// ============================================================

const LOCAL_MODE = !SUPABASE_URL || !SUPABASE_ANON_KEY || /your-project/i.test(SUPABASE_URL);

// Where "who am I in this lobby" is remembered. In local test mode we use
// sessionStorage so every browser tab can be a different player.
const IDENT = LOCAL_MODE ? sessionStorage : localStorage;

const DEFAULT_SETTINGS = {
  official: true,       // include the official 30 racers
  experimental: false,  // include the experimental racers
  custom: false,        // include CUSTOM_CARDS from cards.js
  races: 4,             // races per tournament
  draftEvery: 2,        // hold a draft before race 1, 3, 5…
  picksPerDraft: 2,     // racers each player drafts per draft
  poolExtra: 2,         // extra cards on the table beyond players × picks
  board: 'classic',     // which board (see js/boards.js)
  experimentalBoards: false, // show the experimental boards in the picker
  randomBoost: true,    // random ⏩ forward / ⏪ back squares each race
  randomChutes: false,  // random ladders and chutes each race
  randomStars: false,   // random ⭐ point and 🍌 trip squares each race
  points: '3,1 | 4,2 | 4,2 | 5,3', // points for 1st, 2nd… per race, races separated by "|" (last one repeats)
  retire: true,         // a racer sits out after it has raced once
  finishersToEnd: 2,    // race is "over" once this many cross the line
  maxPlayers: 6,
  cardSource: 'deck',   // 'deck' = draft from the card sets, 'create' = players make the cards
  cardsPerPlayer: 2,    // in 'create' mode, racers each player invents per draft
};

// ── ID / Code generation ─────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
function generateCode() {
  return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}
function generateId() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

// ── Misc helpers ─────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function rotate(arr, n) {
  if (!arr.length) return [];
  const k = ((n % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const PLAYER_COLORS = [
  { name: 'Magenta', hex: '#ff2e88' },
  { name: 'Cyan',    hex: '#00b4d8' },
  { name: 'Sun',     hex: '#ffb703' },
  { name: 'Mint',    hex: '#06d6a0' },
  { name: 'Orange',  hex: '#ff7b2e' },
  { name: 'Violet',  hex: '#8338ec' },
  { name: 'Lime',    hex: '#a3d900' },
  { name: 'Ink',     hex: '#2b2d42' },
];

// ── Notifications ────────────────────────────────────────────
let _notifTimer;
function showNotif(msg, type = 'info') {
  const el = $('notification');
  if (!el) return;
  el.textContent = msg;
  el.className = `show notif--${type}`;
  clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => el.className = '', 3200);
}

// ── Apply state edits locally (mirrors ma_apply in setup.sql) ─
function applyOps(state, ops) {
  for (const op of ops) {
    const path = op.path;
    let node = state;
    for (let i = 0; i < path.length - 1; i++) {
      if (node[path[i]] === undefined || node[path[i]] === null) node[path[i]] = {};
      node = node[path[i]];
    }
    const key = path[path.length - 1];
    if ('append' in op) {
      if (!Array.isArray(node[key])) node[key] = [];
      node[key].push(op.append);
    } else if (op.delete) {
      delete node[key];
    } else {
      node[key] = op.value === undefined ? null : op.value;
    }
  }
  if (Array.isArray(state.log) && state.log.length > 150) state.log = state.log.slice(-150);
  return state;
}

// ============================================================
//  Store — one interface, two backends (Supabase or local)
// ============================================================

function makeSupabaseStore() {
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return {
    kind: 'supabase',
    async getLobby(code) {
      const { data } = await sb.from('ma_lobbies').select('*').eq('code', code).maybeSingle();
      return data || null;
    },
    async createLobby(row) {
      const { error } = await sb.from('ma_lobbies').insert(row);
      if (error) throw error;
    },
    async updateLobby(code, fields) {
      const { error } = await sb.from('ma_lobbies').update(fields).eq('code', code);
      if (error) throw error;
    },
    async getPlayers(code) {
      const { data } = await sb.from('ma_players').select('*').eq('lobby_code', code).order('seat_order');
      return data || [];
    },
    async insertPlayer(row) {
      const { error } = await sb.from('ma_players').insert(row);
      if (error) throw error;
    },
    async updatePlayer(id, fields) {
      const { error } = await sb.from('ma_players').update(fields).eq('id', id);
      if (error) throw error;
    },
    async deletePlayer(id) {
      await sb.from('ma_players').delete().eq('id', id);
    },
    async apply(code, ops) {
      const { error } = await sb.rpc('ma_apply', { p_code: code, p_ops: ops });
      if (error) throw error;
    },
    onLobby(code, cb) {
      sb.channel(`ma-${code}-lobby`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ma_lobbies', filter: `code=eq.${code}` },
          async ({ new: row }) => {
            if (row && row.game_state !== undefined) cb(row);
            else cb(await this.getLobby(code));
          })
        .subscribe();
    },
    onPlayers(code, cb) {
      sb.channel(`ma-${code}-players`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ma_players', filter: `lobby_code=eq.${code}` },
          async () => cb(await this.getPlayers(code)))
        .subscribe();
    },

    // Board drawings — one row per stroke
    async getStrokes(code) {
      const { data } = await sb.from('ma_strokes').select('*').eq('lobby_code', code).order('created_at');
      return data || [];
    },
    async addStroke(code, s) {
      const { error } = await sb.from('ma_strokes').insert({ ...s, lobby_code: code });
      if (error) throw error;
    },
    async clearStrokes(code, playerId) {
      let q = sb.from('ma_strokes').delete().eq('lobby_code', code);
      if (playerId) q = q.eq('player_id', playerId);
      await q;
    },
    onStrokes(code, cb) {
      sb.channel(`ma-${code}-strokes`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ma_strokes', filter: `lobby_code=eq.${code}` },
          ({ new: row }) => { if (row) cb({ type: 'insert', row }); })
        .subscribe();
    },

    // Player-made cards
    async getCards(code) {
      const { data } = await sb.from('ma_cards').select('*').eq('lobby_code', code).order('created_at');
      return data || [];
    },
    async saveCard(code, card) {
      const { error } = await sb.from('ma_cards').upsert({ ...card, lobby_code: code });
      if (error) throw error;
    },
    async deleteCard(id) { await sb.from('ma_cards').delete().eq('id', id); },
    async clearCards(code) { await sb.from('ma_cards').delete().eq('lobby_code', code); },
    onCards(code, cb) {
      sb.channel(`ma-${code}-cards`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ma_cards', filter: `lobby_code=eq.${code}` },
          async () => cb(await this.getCards(code)))
        .subscribe();
    },
  };
}

// Local mode: everything lives in this browser's localStorage.
// Other tabs in the same browser see updates instantly.
function makeLocalStore() {
  const KEY = 'ma_local_db';
  const bc  = ('BroadcastChannel' in window) ? new BroadcastChannel('ma-local') : null;
  const lobbySubs = [], playerSubs = [], strokeSubs = [], cardSubs = [];
  const EMPTY = () => ({ lobbies: {}, players: {}, strokes: {}, cards: {} });

  function readDB() {
    try { return { ...EMPTY(), ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
    catch { return EMPTY(); }
  }
  function writeDB(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
    bc?.postMessage('changed');
    notify();
  }
  function notify() {
    const db = readDB();
    lobbySubs.forEach(({ code, cb }) => { if (db.lobbies[code]) cb(clone(db.lobbies[code])); });
    playerSubs.forEach(({ code, cb }) => cb(playersOf(db, code)));
    strokeSubs.forEach(({ code, cb }) => cb({ type: 'reset', rows: rowsOf(db.strokes, code) }));
    cardSubs.forEach(({ code, cb }) => cb(rowsOf(db.cards, code)));
  }
  function playersOf(db, code) {
    return Object.values(db.players).filter(p => p.lobby_code === code)
      .sort((a, b) => a.seat_order - b.seat_order).map(clone);
  }
  function rowsOf(table, code) {
    return Object.values(table).filter(r => r.lobby_code === code)
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).map(clone);
  }
  window.addEventListener('storage', e => { if (e.key === KEY) notify(); });
  bc?.addEventListener('message', notify);

  return {
    kind: 'local',
    async getStrokes(code) { return rowsOf(readDB().strokes, code); },
    async addStroke(code, s) { const db = readDB(); db.strokes[s.id] = { ...s, lobby_code: code, created_at: new Date().toISOString() }; writeDB(db); },
    async clearStrokes(code, playerId) {
      const db = readDB();
      Object.values(db.strokes).forEach(s => { if (s.lobby_code === code && (!playerId || s.player_id === playerId)) delete db.strokes[s.id]; });
      writeDB(db);
    },
    onStrokes(code, cb) { strokeSubs.push({ code, cb }); },
    async getCards(code) { return rowsOf(readDB().cards, code); },
    async saveCard(code, card) { const db = readDB(); db.cards[card.id] = { created_at: new Date().toISOString(), ...db.cards[card.id], ...card, lobby_code: code }; writeDB(db); },
    async deleteCard(id) { const db = readDB(); delete db.cards[id]; writeDB(db); },
    async clearCards(code) { const db = readDB(); Object.values(db.cards).forEach(c => { if (c.lobby_code === code) delete db.cards[c.id]; }); writeDB(db); },
    onCards(code, cb) { cardSubs.push({ code, cb }); },
    async getLobby(code) { const db = readDB(); return db.lobbies[code] ? clone(db.lobbies[code]) : null; },
    async createLobby(row) { const db = readDB(); db.lobbies[row.code] = { ...row, updated_at: new Date().toISOString() }; writeDB(db); },
    async updateLobby(code, fields) {
      const db = readDB(); if (!db.lobbies[code]) return;
      db.lobbies[code] = { ...db.lobbies[code], ...fields, updated_at: new Date().toISOString() }; writeDB(db);
    },
    async getPlayers(code) { return playersOf(readDB(), code); },
    async insertPlayer(row) { const db = readDB(); db.players[row.id] = row; writeDB(db); },
    async updatePlayer(id, fields) { const db = readDB(); if (db.players[id]) db.players[id] = { ...db.players[id], ...fields }; writeDB(db); },
    async deletePlayer(id) { const db = readDB(); delete db.players[id]; writeDB(db); },
    async apply(code, ops) {
      const db = readDB(); const l = db.lobbies[code]; if (!l) return;
      l.game_state = applyOps(l.game_state || {}, ops); l.updated_at = new Date().toISOString(); writeDB(db);
    },
    onLobby(code, cb) { lobbySubs.push({ code, cb }); },
    onPlayers(code, cb) { playerSubs.push({ code, cb }); },
  };
}

let _store = null;
function getStore() {
  if (!_store) _store = LOCAL_MODE ? makeLocalStore() : makeSupabaseStore();
  return _store;
}
