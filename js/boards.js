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

const GRID = 16;   // the pixel grid everything sits on
const TILE = 48;   // a space is a 3×3 grid tile

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
  const points = def.tiles.map(([x, y]) => ({ x: TILE + (x - minX) * TILE + TILE / 2, y: TILE + (y - minY) * TILE + TILE / 2 }));
  const W = (cols + 2) * TILE, H = (rows + 2) * TILE;
  return (_layoutCache[def.id] = { points, W, H, r: TILE / 2 });
}

// Build the whole board as an SVG string (no pieces — those go in #pieces-layer)
function boardSVG(def, opts = {}) {
  const { points, W, H, r } = layoutBoard(def);
  const goal = def.length + 1;
  const specials = opts.specials || def.specials || {};
  // A preview (lobby) copy must not reuse the live board's ids, or pawns end up drawn into the hidden preview
  const sfx = opts.preview ? '-preview' : '';
  let s = `<svg class="board-svg${opts.cls ? ' ' + opts.cls : ''}" id="${opts.id || 'board-svg'}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <defs>
      <clipPath id="clip16${sfx}"><circle r="16"/></clipPath><clipPath id="clip12${sfx}"><circle r="12"/></clipPath>
      <pattern id="grid${sfx}" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse"><path d="M${GRID} 0H0V${GRID}" fill="none" stroke="#2c2c2c" stroke-width="1"/></pattern>
    </defs>
    <rect class="board-bg" x="0" y="0" width="${W}" height="${H}"/>
    <rect class="board-grid" x="0" y="0" width="${W}" height="${H}" fill="url(#grid${sfx})"/>`;

  // chute / ladder connectors: right-angled, drawn under the tiles
  Object.entries(specials).forEach(([from, sp]) => {
    if (sp.type !== 'ladder' && sp.type !== 'chute') return;
    const a = points[+from], b = points[sp.to];
    if (!a || !b) return;
    const d = `M${a.x} ${a.y} H${b.x} V${b.y}`;
    if (sp.type === 'ladder') s += `<path class="ladder" d="${d}"/>`;
    else s += `<path class="chute" d="${d}"/>`;
  });

  // tiles
  points.forEach((p, i) => {
    const isStart = i === 0, isGoal = i === goal;
    const sp = specials[i];
    const x = p.x - r, y = p.y - r;
    if (isStart || isGoal) {
      s += `<g data-space="${i}" class="space space--end"><rect class="cell ${isStart ? 'cell--start' : 'cell--goal'}" x="${x}" y="${y}" width="${TILE}" height="${TILE}"/>`;
      s += `<text class="cell-label" x="${p.x}" y="${p.y + 6}" text-anchor="middle">${isStart ? 'GO' : 'END'}</text></g>`;
      return;
    }
    const cls = sp ? `cell cell--${sp.type}` : 'cell';
    s += `<g data-space="${i}" class="space"><rect class="${cls}" x="${x}" y="${y}" width="${TILE}" height="${TILE}"/>`;
    s += `<text class="cell-num" x="${x + 4}" y="${y + 14}">${i}</text>`;
    if (sp) {
      const info = SPECIAL_INFO[sp.type] || { emoji: '❔' };
      s += `<title>${describeSpecial(i, sp)}</title><text class="cell-special" x="${x + TILE - 10}" y="${y + 11}" text-anchor="middle" dominant-baseline="central" font-size="14">${info.emoji}</text>`;
      if (sp.type === 'forward' || sp.type === 'back') {
        s += `<text class="cell-badge" x="${x + TILE - 4}" y="${y + TILE - 4}" text-anchor="end">${sp.type === 'forward' ? '+' : '-'}${sp.n}</text>`;
      }
    }
    s += '</g>';
  });

  if (!opts.preview) s += '<g id="pieces-layer"></g><g id="draw-layer" class="draw-layer"></g>';
  s += '</svg>';
  return s;
}
