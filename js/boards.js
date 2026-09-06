// ============================================================
//  MAGICAL ATHLETE — Boards (tile maps)
//
//  A board is an orthogonal path on a tile grid, like a room in
//  Pulp. `corners` lists the turning points in tile coordinates;
//  every tile walked between them is a space, in order. The first
//  tile is START and the last is GOAL, so length = tiles − 2.
//
//  specials: { spaceNumber: { type, to } }
//    ladder  — landing here climbs to space `to`
//    chute   — landing here slides down to space `to`
//    point   — landing here scores 1 point
//    trip    — landing here makes you miss your next turn
//
//  Consecutive corners must share an x or a y (90° turns only).
//  Leave a one-tile gap between parallel runs so numbers stay legible.
// ============================================================

const GRID = 16;
const TILE = 56;   // a space is a 56px tile

const BOARDS = [
  {
    id: 'classic', name: 'Classic Track', emoji: '🏟️', experimental: false,
    blurb: 'The plain old race. No tricks, just dice and bad decisions.',
    corners: [[0,6],[9,6],[9,3],[1,3],[1,0],[9,0]],
    specials: {},
  },
  {
    id: 'chutes', name: 'Chutes & Ladders Stadium', emoji: '🪜', experimental: true,
    blurb: 'Ladders send you up the track. Chutes send you back down. Cry about it.',
    corners: [[0,9],[8,9],[8,6],[0,6],[0,3],[8,3],[8,0],[4,0]],
    specials: { 3: { type: 'ladder', to: 11 }, 8: { type: 'chute', to: 1 }, 14: { type: 'ladder', to: 25 }, 20: { type: 'chute', to: 13 }, 27: { type: 'ladder', to: 33 }, 31: { type: 'chute', to: 22 } },
  },
  {
    id: 'treasure', name: 'Treasure Trail', emoji: '⭐', experimental: true,
    blurb: 'Star squares are worth a point each. Winning is nice, but so is loot.',
    corners: [[0,8],[8,8],[8,0],[0,0],[0,5],[5,5],[5,3]],
    specials: { 4: { type: 'point' }, 9: { type: 'point' }, 15: { type: 'point' }, 21: { type: 'point' }, 27: { type: 'point' } },
  },
  {
    id: 'banana', name: 'Banana Boulevard', emoji: '🍌', experimental: true,
    blurb: 'Land on a banana peel and you miss your next turn. Watch your step.',
    corners: [[0,5],[0,0],[4,0],[4,5],[8,5],[8,0],[12,0],[12,5],[13,5]],
    specials: { 6: { type: 'trip' }, 12: { type: 'trip' }, 19: { type: 'trip' }, 25: { type: 'trip' }, 30: { type: 'trip' } },
  },
  {
    id: 'chaos', name: 'Chaos Circuit', emoji: '🌪️', experimental: true,
    blurb: 'Ladders, chutes, stars and peels on one long, unreasonable track.',
    corners: [[0,9],[8,9],[8,6],[0,6],[0,3],[8,3],[8,0],[0,0]],
    specials: { 4: { type: 'ladder', to: 14 }, 7: { type: 'point' }, 10: { type: 'chute', to: 2 }, 12: { type: 'trip' }, 19: { type: 'ladder', to: 30 }, 22: { type: 'point' }, 26: { type: 'chute', to: 17 }, 28: { type: 'trip' }, 33: { type: 'point' }, 36: { type: 'chute', to: 29 }, 38: { type: 'trip' } },
  },
];

// Walk the corners into a list of tiles and derive each board's length
function boardTiles(def) {
  const tiles = [];
  const c = def.corners;
  for (let i = 0; i < c.length; i++) {
    const [x, y] = c[i];
    if (i === 0) { tiles.push([x, y]); continue; }
    const [px, py] = c[i - 1];
    const dx = Math.sign(x - px), dy = Math.sign(y - py);
    if (dx && dy) throw new Error(`Board ${def.id}: corner ${i} is diagonal`);
    let cx = px, cy = py;
    while (cx !== x || cy !== y) { cx += dx; cy += dy; tiles.push([cx, cy]); }
  }
  return tiles;
}
BOARDS.forEach(b => { b.tiles = boardTiles(b); b.length = b.tiles.length - 2; });

const SPECIAL_INFO = {
  forward: { emoji: '⚡', label: 'Boost square', color: '#00b4d8' },
  back:    { emoji: '🌬️', label: 'Setback square', color: '#ff7b2e' },
  ladder:  { emoji: '🪜', label: 'Ladder', color: '#06d6a0' },
  chute:   { emoji: '🛝', label: 'Chute',  color: '#e63946' },
  point:   { emoji: '⭐', label: 'Point square', color: '#ffb703' },
  trip:    { emoji: '🍌', label: 'Trip square', color: '#ffe066' },
};

function BOARD(id) { return BOARDS.find(b => b.id === id) || BOARDS[0]; }

// Sprinkle random squares onto a board for one race. Returns { space: special }.
//   boost  → ⚡ forward 2–4 / 🌬️ back 1–3
//   chutes → random ladders (up 3–8) and chutes (down 3–8)
//   stars  → ⭐ point squares and 🍌 trip squares
//   count  → total number of random squares (spread evenly across the enabled kinds)
function randomSquares(def, opts = {}) {
  const L = def.length;
  const out = {};
  const kinds = [opts.boost && 'boost', opts.chutes && 'chutes', opts.stars && 'stars'].filter(Boolean);
  const count = Math.max(0, Math.min(40, opts.count ?? Math.max(2, Math.round(L / 8)) * kinds.length));
  if (!kinds.length || !count) return out;
  const taken = new Set(Object.keys(def.specials || {}).map(Number));
  const free = [];
  for (let i = 3; i <= L - 2; i++) if (!taken.has(i)) free.push(i);   // keep the first and last couple of spaces clean
  const rnd = n => Math.floor(Math.random() * n);
  const pick = () => free.length ? free.splice(rnd(free.length), 1)[0] : null;
  const reserve = i => { const k = free.indexOf(i); if (k >= 0) free.splice(k, 1); };

  for (let k = 0; k < count; k++) {
    const kind = kinds[k % kinds.length];
    const i = pick(); if (i == null) break;
    if (kind === 'boost') {
      out[i] = Math.random() < 0.5 ? { type: 'forward', n: 2 + rnd(3) } : { type: 'back', n: 1 + rnd(3) };
    } else if (kind === 'chutes') {
      const up = Math.random() < 0.5;
      const to = Math.max(1, Math.min(L, up ? i + 3 + rnd(6) : i - 3 - rnd(6)));
      if (to === i || taken.has(to) || out[to]) { k--; if (!free.length) break; continue; }
      out[i] = { type: up ? 'ladder' : 'chute', to };
      reserve(to);
    } else {
      out[i] = Math.random() < 0.5 ? { type: 'point' } : { type: 'trip' };
    }
  }
  return out;
}

function describeSpecial(i, sp) {
  switch (sp.type) {
    case 'forward': return `${i}: Boost — jump forward ${sp.n}`;
    case 'back':    return `${i}: Setback — go back ${sp.n}`;
    case 'ladder':  return `${i}: Ladder up to ${sp.to}`;
    case 'chute':   return `${i}: Chute down to ${sp.to}`;
    case 'point':   return `${i}: Point square (+1 point)`;
    case 'trip':    return `${i}: Trip square (miss a turn)`;
  }
  return `${i}`;
}

// Tile centers in pixels, plus the board's pixel size (one-tile margin all round)
const _layoutCache = {};
function layoutBoard(def) {
  if (_layoutCache[def.id]) return _layoutCache[def.id];
  const xs = def.tiles.map(t => t[0]), ys = def.tiles.map(t => t[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const cols = Math.max(...xs) - minX + 1, rows = Math.max(...ys) - minY + 1;
  const M = 24;   // margin around the tiles
  const points = def.tiles.map(([x, y]) => ({ x: M + (x - minX) * TILE + TILE / 2, y: M + (y - minY) * TILE + TILE / 2 }));
  const W = cols * TILE + M * 2, H = rows * TILE + M * 2;
  return (_layoutCache[def.id] = { points, W, H, r: TILE / 2 });
}

// Build the whole board as an SVG string (no pieces — those go in #pieces-layer).
// Tiles are chunky blocks seen slightly from above: a shadow, a thick white side, and an illustrated top.
const DEPTH = 10;   // how tall a tile's side looks
function boardSVG(def, opts = {}) {
  const { points, W, H, r } = layoutBoard(def);
  const goal = def.length + 1;
  const specials = opts.specials || def.specials || {};
  // A preview (lobby) copy must not reuse the live board's ids, or pawns end up drawn into the hidden preview
  const sfx = opts.preview ? '-preview' : '';
  const inner = TILE - 4;               // top face, inset so the white side shows all round
  const rx = 8;
  let s = `<svg class="board-svg${opts.cls ? ' ' + opts.cls : ''}" id="${opts.id || 'board-svg'}" width="${W}" height="${H + DEPTH}" viewBox="0 0 ${W} ${H + DEPTH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="clip14${sfx}"><circle r="14"/></clipPath><clipPath id="clip11${sfx}"><circle r="11"/></clipPath>
    </defs>`;

  // Draw back-to-front so nearer tiles overlap the sides of the ones behind them
  const order = points.map((p, i) => i).sort((a, b) => points[a].y - points[b].y || points[a].x - points[b].x);

  const wave = (x, y) => `<path class="wave" d="M${x} ${y} q3 -3 6 0 t6 0"/>`;
  order.forEach(i => {
    const p = points[i];
    const isStart = i === 0, isGoal = i === goal;
    const sp = specials[i];
    const x = p.x - r + 2, y = p.y - r + 2;   // top face origin
    const topCls = isStart ? 'tile-top tile-top--start' : isGoal ? 'tile-top tile-top--goal' : sp ? 'tile-top tile-top--special' : (i % 2 ? 'tile-top tile-top--alt' : 'tile-top');
    s += `<g data-space="${i}" class="space${isStart || isGoal ? ' space--end' : ''}">`;
    s += `<rect class="tile-shadow" x="${x - 1}" y="${y + DEPTH + 2}" width="${inner + 2}" height="${inner}" rx="${rx}"/>`;
    s += `<rect class="tile-side" x="${x}" y="${y + DEPTH}" width="${inner}" height="${inner}" rx="${rx}"/>`;
    s += `<rect class="tile-side tile-side--front" x="${x}" y="${y + DEPTH / 2}" width="${inner}" height="${inner}" rx="${rx}"/>`;
    s += `<rect class="${topCls}" x="${x}" y="${y}" width="${inner}" height="${inner}" rx="${rx}"/>`;
    if (isStart || isGoal) {
      s += `<text class="tile-label" x="${p.x}" y="${p.y + 5}" text-anchor="middle">${isStart ? 'GO' : 'END'}</text>`;
      if (isGoal) s += `<text class="tile-glyph" x="${x + inner - 12}" y="${y + 12}" text-anchor="middle" dominant-baseline="central" font-size="12">🏁</text>`;
    } else {
      if (!sp) { s += wave(x + 8 + (i % 3) * 5, y + 30 - (i % 2) * 6); if (i % 2) s += wave(x + 20, y + 18); }
      else s += `<path class="sandline" d="M${x + 4} ${y + inner - 14} q10 -6 20 0 t16 -2"/>`;
      s += `<rect class="tile-num-bg" x="${x + 4}" y="${y + 4}" width="20" height="14" rx="4"/><text class="tile-num" x="${x + 14}" y="${y + 14.5}" text-anchor="middle">${i}</text>`;
      if (sp) {
        const info = SPECIAL_INFO[sp.type] || { emoji: '❔' };
        s += `<title>${describeSpecial(i, sp)}</title>`;
        let jump = null;
        if (sp.type === 'ladder') jump = `↑${sp.to}`;
        else if (sp.type === 'chute') jump = `↓${sp.to}`;
        else if (sp.type === 'forward') jump = `+${sp.n}`;
        else if (sp.type === 'back') jump = `−${sp.n}`;
        if (jump) {
          const w = 8 + jump.length * 7;
          s += `<rect class="tile-jump-bg" x="${x + inner - w - 3}" y="${y + inner - 19}" width="${w}" height="15" rx="4"/><text class="tile-jump" x="${x + inner - 3 - w / 2}" y="${y + inner - 8}" text-anchor="middle">${jump}</text>`;
          s += `<text class="tile-glyph" x="${x + inner - 11}" y="${y + 11}" text-anchor="middle" dominant-baseline="central" font-size="12">${info.emoji}</text>`;
        } else {
          s += `<text class="tile-glyph" x="${x + inner - 12}" y="${y + inner - 12}" text-anchor="middle" dominant-baseline="central" font-size="16">${info.emoji}</text>`;
        }
      }
    }
    s += '</g>';
  });

  if (!opts.preview) s += '<g id="pieces-layer"></g><g id="draw-layer" class="draw-layer"></g>';
  s += '</svg>';
  return s;
}
