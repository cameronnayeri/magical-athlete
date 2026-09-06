// ============================================================
//  MAGICAL ATHLETE — Boards
//
//  A board is a winding path drawn through "waypoints" on a
//  1000 × 680 canvas. Spaces are placed evenly along the curve.
//
//  specials: { spaceNumber: { type, to } }
//    ladder  — landing here climbs to space `to`
//    chute   — landing here slides down to space `to`
//    point   — landing here scores 1 point
//    trip    — landing here makes you miss your next turn
//
//  To add a board: copy one, change the id/name/waypoints.
//  Keep parallel stretches of path ~120px apart so spaces don't overlap.
// ============================================================

const BOARDS = [
  {
    id: 'classic', name: 'Classic Track', emoji: '🏟️', experimental: false, length: 30,
    blurb: 'The plain old race. No tricks, just dice and bad decisions.',
    theme: { bg: '#e3f5e8', decor: ['🌳', '🌲', '🌼', '⛺', '📣', '🌷'] },
    waypoints: [[70,600],[300,610],[520,570],[640,470],[580,360],[420,330],[240,330],[120,250],[190,140],[400,105],[620,115],[820,150],[940,260],[910,430],[800,560],[690,625]],
    specials: {},
  },
  {
    id: 'chutes', name: 'Chutes & Ladders Stadium', emoji: '🪜', experimental: true, length: 36,
    blurb: 'Ladders send you up the track. Chutes send you back down. Cry about it.',
    theme: { bg: '#e8ecff', decor: ['🎪', '🎈', '🎠', '🎡', '🍿'] },
    waypoints: [[60,110],[300,90],[560,110],[800,90],[940,170],[900,290],[700,300],[450,290],[200,300],[90,380],[150,480],[400,500],[650,490],[900,500],[930,600],[780,640],[500,640],[200,640],[60,620]],
    specials: { 3: { type: 'ladder', to: 11 }, 8: { type: 'chute', to: 1 }, 14: { type: 'ladder', to: 25 }, 20: { type: 'chute', to: 13 }, 27: { type: 'ladder', to: 33 }, 31: { type: 'chute', to: 22 } },
  },
  {
    id: 'treasure', name: 'Treasure Trail', emoji: '⭐', experimental: true, length: 32,
    blurb: 'Star squares are worth a point each. Winning is nice, but so is loot.',
    theme: { bg: '#fff1cf', decor: ['💎', '🌴', '🏝️', '🦜', '⚓', '🗿'] },
    waypoints: [[60,620],[300,640],[600,640],[880,600],[950,400],[900,150],[650,60],[350,60],[120,150],[110,380],[300,500],[560,520],[760,430],[720,250],[500,190],[330,260],[390,400]],
    specials: { 4: { type: 'point' }, 9: { type: 'point' }, 15: { type: 'point' }, 21: { type: 'point' }, 27: { type: 'point' } },
  },
  {
    id: 'banana', name: 'Banana Boulevard', emoji: '🍌', experimental: true, length: 32,
    blurb: 'Land on a banana peel and you miss your next turn. Watch your step.',
    theme: { bg: '#fff8d6', decor: ['🍌', '🐒', '🌴', '🥥', '🦍'] },
    waypoints: [[60,560],[200,620],[400,600],[520,480],[430,360],[250,330],[120,220],[220,110],[450,80],[700,90],[900,140],[940,320],[820,450],[640,470],[600,600],[760,640],[930,620]],
    specials: { 6: { type: 'trip' }, 12: { type: 'trip' }, 19: { type: 'trip' }, 25: { type: 'trip' }, 30: { type: 'trip' } },
  },
  {
    id: 'chaos', name: 'Chaos Circuit', emoji: '🌪️', experimental: true, length: 40,
    blurb: 'Ladders, chutes, stars and peels on one long, unreasonable track.',
    theme: { bg: '#f3e4ff', decor: ['🌪️', '⚡', '🔥', '🌋', '☄️', '👁️'] },
    waypoints: [[50,80],[350,60],[650,80],[930,110],[950,220],[700,230],[400,220],[120,240],[70,340],[300,360],[600,350],[900,370],[940,480],[700,500],[400,490],[100,500],[80,600],[350,640],[650,630],[940,640]],
    specials: { 4: { type: 'ladder', to: 14 }, 7: { type: 'point' }, 10: { type: 'chute', to: 2 }, 12: { type: 'trip' }, 19: { type: 'ladder', to: 30 }, 22: { type: 'point' }, 26: { type: 'chute', to: 17 }, 28: { type: 'trip' }, 33: { type: 'point' }, 36: { type: 'chute', to: 29 }, 38: { type: 'trip' } },
  },
];

const BOARD_W = 1000, BOARD_H = 680;
const SPECIAL_INFO = {
  forward: { emoji: '⏩', label: 'Boost square', color: '#00b4d8' },
  back:    { emoji: '⏪', label: 'Setback square', color: '#ff7b2e' },
  ladder:  { emoji: '🪜', label: 'Ladder', color: '#06d6a0' },
  chute:   { emoji: '🛝', label: 'Chute',  color: '#e63946' },
  point:   { emoji: '⭐', label: 'Point square', color: '#ffb703' },
  trip:    { emoji: '🍌', label: 'Trip square', color: '#ffe066' },
};

function BOARD(id) { return BOARDS.find(b => b.id === id) || BOARDS[0]; }

// Sprinkle random squares onto a board for one race. Returns { space: special }.
//   boost  → ⏩ forward 2–4 / ⏪ back 1–3
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

// Catmull-Rom spline through the waypoints → dense polyline
function splinePoints(wp, perSeg = 30) {
  const pts = [];
  const P = i => wp[Math.max(0, Math.min(wp.length - 1, i))];
  for (let i = 0; i < wp.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      pts.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  pts.push([...wp[wp.length - 1]]);
  return pts;
}

// Place `count` spaces evenly along the curve
const _layoutCache = {};
function layoutBoard(def) {
  if (_layoutCache[def.id]) return _layoutCache[def.id];
  const dense = splinePoints(def.waypoints);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = cum[cum.length - 1];
  const count = def.length + 2;
  const spacing = total / (count - 1);
  const points = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = Math.min(total, k * spacing);
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = (target - cum[j]) / seg;
    points.push({ x: dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t, y: dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t });
  }
  const r = Math.max(16, Math.min(24, spacing * 0.36));
  return (_layoutCache[def.id] = { points, dense, spacing, r });
}

// Deterministic "random" so decorations stay put between renders
function seeded(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

// Build the whole board as an SVG string (no pieces — those go in #pieces-layer)
function boardSVG(def, opts = {}) {
  const { points, dense, r } = layoutBoard(def);
  const goal = def.length + 1;
  const specials = opts.specials || def.specials || {};
  const road = dense.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const rnd = seeded(def.id);
  let s = `<svg class="board-svg${opts.cls ? ' ' + opts.cls : ''}" id="${opts.id || 'board-svg'}" viewBox="0 0 ${BOARD_W} ${BOARD_H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="checker" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill="#1d1b2e"/><rect x="7" y="7" width="7" height="7" fill="#1d1b2e"/></pattern>
      <clipPath id="clip18"><circle r="18"/></clipPath><clipPath id="clip13"><circle r="13"/></clipPath>
      <marker id="arrow-chute" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${SPECIAL_INFO.chute.color}"/></marker>
    </defs>
    <rect class="board-bg" x="0" y="0" width="${BOARD_W}" height="${BOARD_H}" rx="28" fill="${def.theme.bg}"/>`;

  // decorations, kept away from the path
  const decor = def.theme.decor || [];
  let placed = 0, tries = 0;
  while (placed < 14 && tries < 400 && decor.length) {
    tries++;
    const x = 30 + rnd() * (BOARD_W - 60), y = 30 + rnd() * (BOARD_H - 60);
    if (points.some(p => Math.hypot(p.x - x, p.y - y) < r + 46)) continue;
    const em = decor[Math.floor(rnd() * decor.length)];
    const size = 22 + rnd() * 16;
    s += `<text class="board-decor" x="${x.toFixed(0)}" y="${y.toFixed(0)}" font-size="${size.toFixed(0)}" text-anchor="middle" dominant-baseline="central" opacity="0.8">${em}</text>`;
    placed++;
  }

  // the road
  s += `<polyline class="road-edge" points="${road}" fill="none" stroke-width="${r * 2 + 16}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<polyline class="road" points="${road}" fill="none" stroke-width="${r * 2 + 10}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<polyline class="road-dash" points="${road}" fill="none" stroke-width="2" stroke-dasharray="10 12" stroke-linecap="round" stroke-linejoin="round"/>`;

  // chute / ladder connections (drawn under the spaces)
  Object.entries(specials).forEach(([from, sp]) => {
    if (sp.type !== 'ladder' && sp.type !== 'chute') return;
    const a = points[+from], b = points[sp.to];
    if (!a || !b) return;
    if (sp.type === 'ladder') {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len * 6, ny = dx / len * 6;
      s += `<g class="ladder"><line x1="${a.x + nx}" y1="${a.y + ny}" x2="${b.x + nx}" y2="${b.y + ny}"/><line x1="${a.x - nx}" y1="${a.y - ny}" x2="${b.x - nx}" y2="${b.y - ny}"/>`;
      for (let d = 18; d < len - 12; d += 16) {
        const px = a.x + dx / len * d, py = a.y + dy / len * d;
        s += `<line x1="${px + nx}" y1="${py + ny}" x2="${px - nx}" y2="${py - ny}"/>`;
      }
      s += '</g>';
    } else {
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.25, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.25;
      s += `<path class="chute" d="M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}" marker-end="url(#arrow-chute)"/>`;
    }
  });

  // spaces
  points.forEach((p, i) => {
    const isStart = i === 0, isGoal = i === goal;
    const sp = specials[i];
    if (isStart || isGoal) {
      const w = r * 2.6, h = r * 2.1;
      s += `<g data-space="${i}" class="space space--end"><rect class="cell ${isStart ? 'cell--start' : 'cell--goal'}" x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" rx="12"/>`;
      if (isGoal) s += `<rect x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" rx="12" fill="url(#checker)" opacity="0.18" pointer-events="none"/>`;
      s += `<text class="cell-label" x="${p.x}" y="${p.y + h / 2 - 6}" text-anchor="middle">${isStart ? 'START' : 'GOAL'}</text></g>`;
      return;
    }
    const cls = sp ? `cell cell--${sp.type}` : (i % 2 ? 'cell cell--alt' : 'cell');
    s += `<g data-space="${i}" class="space"><circle class="${cls}" cx="${p.x}" cy="${p.y}" r="${r}"/>`;
    if (sp) {
      const info = SPECIAL_INFO[sp.type] || { emoji: '❔' };
      s += `<title>${describeSpecial(i, sp)}</title><text class="cell-special" x="${p.x}" y="${p.y - r - 4}" text-anchor="middle" font-size="18">${info.emoji}</text>`;
      if (sp.type === 'forward' || sp.type === 'back') {
        s += `<text class="cell-badge" x="${p.x}" y="${p.y + r + 13}" text-anchor="middle" font-size="13">${sp.type === 'forward' ? '+' : '−'}${sp.n}</text>`;
      }
    }
    s += `<text class="cell-num" x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(r * 0.8)}">${i}</text></g>`;
  });

  s += '<g id="pieces-layer"></g><g id="draw-layer" class="draw-layer"></g></svg>';
  return s;
}
