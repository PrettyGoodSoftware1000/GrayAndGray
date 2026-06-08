/* ===========================================================
   EGG V2
   - Scrollable world: WASD/arrows, hold LEFT-CLICK to drag-pan,
     mouse wheel (or -/=) to zoom
   - Procedural rivers, lakes, huts, villagers, goblins, shrines
   - Sprites from /images (backgrounds keyed out)
   - ESC = pause: top ruler (meters) + settings + Action Log
   - HUD vitals: 3 Zelda-style hearts + 5 stamina dots (2 each)
   - Creature wanders (2 m/s) / runs (8 m/s); greets/eats villagers;
     burns by walking up close first; speaks from CreatureVoice.txt
   - Villagers stroll near their hut; goblins march & charge
   =========================================================== */

const VERSION = "egg-v2.2";          // save-schema version (only bump when world data changes)
const GAME_VERSION = "3.2";          // displayed build version — bump on every update

const PIXELS_PER_METER = 10;
const m2px = (m) => m * PIXELS_PER_METER;

// Speeds & ranges
let WANDER_SPEED_MPS = 2.0;              // creature stroll (stats_and_shit.txt)
let RUN_SPEED_MPS = 8.0;                 // running
const SEEK_SPEED_MPS = 3.2;              // base approach (scaled by run)
let VILLAGER_SPEED_MPS = 1.0;
const VILLAGER_LEASH_PX = m2px(20);      // villagers stay within 20 m of home
const BABY_SCALE = 0.8;                  // baby villager render scale (80% of an adult)
const BABY_GROW_MS = 120000;             // a baby grows into an adult after 2 min
const VILLAGER_CAP = 80;                 // hard population cap (prevents runaway breeding)
const REPRO_FIRST_S = 60, REPRO_EVERY_S = 300;   // first baby at 1 min, then every 5 min
const HUT_CROWD_RADIUS_PX = m2px(200);
const INTERACT_RANGE_PX = m2px(10);
const INTERACT_COOLDOWN_MS = 10000;
const FIREBALL_RANGE_M = 15;             // max allowed throw range
const FIREBALL_RANGE_PX = m2px(FIREBALL_RANGE_M);
const BURN_APPROACH_PX = m2px(11);       // creature walks up to ~11 m, then throws (within range)
const GOBLIN_DETECT_PX = m2px(40);
let GOBLIN_SPEED_MPS = 2.4;
const GOBLIN_CONTACT_PX = 18;
// --- combat / hearts (read from stats_and_shit.txt; these are defaults) ---
let CREATURE_MAX_HEARTS = 3, CREATURE_ATTACK_DMG = 2, CREATURE_ATTACK_MS = 1200;
let VILLAGER_HEARTS = 1;
let GOBLIN_HEARTS = 2, GOBLIN_HIT_DMG = 0.5, GOBLIN_ATTACK_MS = 4000;
let OGRE_HEARTS = 5, OGRE_ATTACK_DMG = 2, OGRE_ATTACK_MS = 2000, OGRE_SPEED_MPS = 3.0, OGRE_AGGRO_PX = m2px(30);
let FIRE_BASE_DMG = 4, FIRE_SPEED = 14;
const ATTACK_RANGE_PX = m2px(5);
const EAT_RANGE_PX = m2px(5), EAT_COOLDOWN_MS = 3000;   // eat crops: within 5 m, 1 heart each, 3 s apart
const GOBLIN_AGGRO_PX = m2px(50), OGRE_CONTACT_PX = 24;
const GOBLINHUT_MIN_VILLAGE_PX = m2px(80);   // "far" on a 300m-wide map
const GOBLIN_CHAIN_RANGE_PX = m2px(50);   // chain a burn-spree to the next target within 50 m
const CROP_SPACING = 25;                  // grid spacing for villager crop fields (2.5 m)
const GUARD_ENEMY_RANGE_PX = m2px(40);
const FIREBALL_COOLDOWN_MS = 2000;
const MIN_HUT_DIST_PX = 50;              // don't build huts on top of huts

// Stamina
const STAMINA_MAX = 10;
const RUN_DRAIN_S = 1, STAMINA_REGEN_S = 3;

const ASH_LIFETIME_MS = 120000, ASH_FADE_MS = 20000;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const rulerCanvas = document.getElementById('ruler');
const rulerCtx = rulerCanvas.getContext('2d');
const actionLog = document.getElementById('action-log');
const chatHistory = document.getElementById('chat-history');
const commandInput = document.getElementById('command-input');
const statusBox = document.getElementById('creature-status');
const controlsHint = document.getElementById('controls-hint');
const pausePanel = document.getElementById('pause-panel');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const regenMapBtn = document.getElementById('regen-map-btn');
const saveFileBtn = document.getElementById('save-file-btn');
const newGameBtn = document.getElementById('new-game-btn');
const loadFileBtn = document.getElementById('load-file-btn');
const logFileBtn = document.getElementById('log-file-btn');
const loadFileInput = document.getElementById('load-file-input');
const gameTitleEl = document.getElementById('game-title');
const keysBtn = document.getElementById('keys-btn');
const keysModal = document.getElementById('keys-modal');
const keysList = document.getElementById('keys-list');
const addKeyBtn = document.getElementById('add-key-btn');
const keysFromFileBtn = document.getElementById('keys-from-file-btn');
const keysFileInput = document.getElementById('keys-file-input');
const keysSaveBtn = document.getElementById('keys-save-btn');
const keysCloseBtn = document.getElementById('keys-close-btn');
const treeModal = document.getElementById('tree-modal');
const treeList = document.getElementById('tree-list');
const treeCloseBtn = document.getElementById('tree-close-btn');
const pauseChatCheckbox = document.getElementById('pause-chat-checkbox');
const heartsEl = document.getElementById('hearts');
const staminaEl = document.getElementById('stamina');
const apiUsageEl = document.getElementById('api-usage');
const spellBarEl = document.getElementById('spell-bar');

const WORLD_W = 3000, WORLD_H = 2200;

let isPaused = false;
let chatPaused = false;
let pauseWhenChatting = (localStorage.getItem('pauseWhenChatting') !== '0');   // default ON
let apiKeys = [];          // up to many Gemini keys; rotated across requests / on rate limits
let keyCallCounts = {};    // session: key string -> number of requests sent with it
let keyIndex = 0;
const MAX_KEY_FIELDS = 5;  // manual "+" fields cap; file upload may add more

let camera = { x: 0, y: 0 };
let zoom = 1;
const MIN_ZOOM = 0.5, MAX_ZOOM = 3, CAMERA_SPEED = 7;
const keys = {};
let controlsHintHidden = false;

// drag-to-pan
let dragging = false, dragLastX = 0, dragLastY = 0, dragMoved = false, dragStartX = 0, dragStartY = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ===========================================================
//  CANVAS / ZOOM / PAN
// ===========================================================
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; clampCamera(); if (isPaused) drawRuler(); }
window.addEventListener('resize', resizeCanvas);

// Zoom, keeping the world point under (ax,ay) fixed. Defaults to screen center.
function setZoom(nz, ax, ay) {
    nz = clamp(nz, MIN_ZOOM, MAX_ZOOM);
    if (ax === undefined) { ax = canvas.width / 2; ay = canvas.height / 2; }
    const wx = camera.x + ax / zoom, wy = camera.y + ay / zoom;
    zoom = nz;
    camera.x = wx - ax / zoom; camera.y = wy - ay / zoom;
    clampCamera(); if (isPaused) drawRuler();
}
canvas.addEventListener('wheel', (e) => {
    if (isPaused) return;                       // no zooming from the pause menu
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom(zoom * f, e.clientX, e.clientY);
}, { passive: false });

let mouseSX = window.innerWidth / 2, mouseSY = window.innerHeight / 2;   // latest mouse screen position
function screenToWorld(sx, sy) { return { x: camera.x + sx / zoom, y: camera.y + sy / zoom }; }
function livingUnderCursor(wx, wy) {
    let best = null, bd = 22;
    for (const v of world.villagers) { const d = Math.hypot(v.x + 8 - wx, v.y + 12 - wy); if (d < bd) { bd = d; best = v; } }
    for (const g of world.goblins) { const d = Math.hypot(g.x - wx, g.y - wy); if (d < bd) { bd = d; best = g; } }
    for (const o of world.ogres) { const d = Math.hypot(o.x - wx, o.y - wy); if (d < bd) { bd = d; best = o; } }
    return best;
}
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) {                                  // right-click: charge the selected spell (fireball)
        if (!isPaused && selectedSpell === 0) { e.preventDefault(); startCharge(); }
        return;
    }
    if (e.button !== 0) return;
    dragging = true; dragMoved = false; dragLastX = e.clientX; dragLastY = e.clientY; dragStartX = e.clientX; dragStartY = e.clientY;
    canvas.style.cursor = 'grabbing'; e.preventDefault();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());   // no browser menu on right-click
window.addEventListener('mousemove', (e) => {
    mouseSX = e.clientX; mouseSY = e.clientY;
    const w = screenToWorld(e.clientX, e.clientY);
    hoveredEntity = livingUnderCursor(w.x, w.y);
    if (!dragging) return;
    if (!dragMoved && Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 5) dragMoved = true;   // distinguish click vs drag
    camera.x -= (e.clientX - dragLastX) / zoom;
    camera.y -= (e.clientY - dragLastY) / zoom;
    dragLastX = e.clientX; dragLastY = e.clientY;
    clampCamera(); if (isPaused) drawRuler();
});
window.addEventListener('mouseup', (e) => {
    if (e.button === 2) { if (charging) releaseCharge(); return; }
    if (e.button !== 0) return;
    const wasDrag = dragMoved;
    if (dragging) { dragging = false; canvas.style.cursor = 'default'; }
    if (!wasDrag && !isPaused && !creature.dead) {          // a click (not a drag) sends the creature there
        const w = screenToWorld(e.clientX, e.clientY);
        creature.goto = { x: w.x, y: w.y }; creature.act = 'goto'; statusBox.innerText = 'Walking over there.';
    }
});

// ===========================================================
//  SPRITES
// ===========================================================
const SPRITE_KEYS = ['tree', 'villager', 'fireball', 'goblin', 'ashes'];
const images = {};
function loadSprite(key) {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { images[key] = img; updateLog(`Loaded sprite: ${key}`); };   // images are already transparent — no processing
    img.onerror = () => console.warn(`No image for "${key}" (images/${key}.png) — using a drawn placeholder.`);
    img.src = `images/${key}.png`;
}
function imgReady(key) { const i = images[key]; return !!i && ((i.width || i.naturalWidth) > 0); }
SPRITE_KEYS.forEach(loadSprite);

// ---- Image variations system ----
// Folders hold numbered variations (Wheat1.png, Wheat2.png, …). We probe upward until a 404,
// collecting every variation found. Each placed object stores a random "vseed" to pick one consistently.
const variations = { wheat: [], well: [], sign: [], cave: [], shrine: [], goblin_hut: [], ogre: [], hut: [] };
function loadVariations(cat, path, prefix, max = 60) {
    variations[cat] = [];
    const prefixes = Array.isArray(prefix) ? prefix : [prefix];
    const pad = (n) => String(n).padStart(2, '0');
    const builders = [];
    for (const pf of prefixes) {
        const cap = pf.charAt(0).toUpperCase() + pf.slice(1), low = pf.charAt(0).toLowerCase() + pf.slice(1);
        builders.push(n => pf + n, n => pf + pad(n), n => cap + n, n => cap + pad(n), n => low + n, n => low + pad(n));
    }
    let builder = null, i = 1, bi = 0;
    const finish = () => { if (variations[cat].length) updateLog(`Loaded ${variations[cat].length} ${cat} variation(s).`); };
    const tryNext = () => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { variations[cat].push(img); if (!builder) builder = builders[bi]; i++; if (i <= max) tryNext(); else finish(); };
        img.onerror = () => {
            if (!builder) { bi++; if (bi < builders.length) { tryNext(); return; } finish(); return; }
            finish();
        };
        img.src = `${path}/${(builder || builders[bi])(i)}.png`;
    };
    tryNext();
}
function loadFixedImage(cat, src) {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { variations[cat] = [img]; updateLog(`Loaded ${cat} image.`); };
    img.onerror = () => console.warn(`No image at ${src}`);
    img.src = src;
}
function variantImg(cat, seed) { const a = variations[cat]; if (!a || !a.length) return null; return a[Math.floor((seed || 0) * a.length) % a.length]; }
function loadAllVariations() {
    loadVariations('wheat', 'images/wheat', 'Wheat');
    loadVariations('well', 'images/well', 'Well');
    loadVariations('sign', 'images/sign', 'Sign');
    loadVariations('cave', 'images/cave', 'Cave');
    loadShrines();
    loadVariations('hut', 'images/villager_huts', 'hut');
    loadVariations('goblin_hut', 'images/goblin_buildings', 'goblin_hut');
    loadVariations('ogre', 'images/ogres', ['ogre', 'orge']);
}
// Shrines: pick a RANDOM png from images/shrines. Loads the known descriptive name(s) plus any numbered ones.
function loadShrines() {
    variations.shrine = [];
    ['ShrineOfAsh'].forEach(name => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => variations.shrine.push(img); img.src = 'images/shrines/' + name + '.png'; });
    let i = 1; const tryNext = () => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { variations.shrine.push(img); i++; if (i <= 40) tryNext(); }; img.onerror = () => { }; img.src = 'images/shrines/Shrine' + i + '.png'; }; tryNext();
}

// Creature image lives in images/creature/ named creature_<type>_<personality>.png.
// We probe combinations; the first that loads sets the sprite AND the creature's voice.
const CREATURE_TYPES = ['lion', 'lizard', 'tiger', 'wolf', 'bear', 'dragon', 'goat', 'owl', 'cat', 'fox'];
const CREATURE_PERSONALITIES = ['adhd', 'snarky', 'nice', 'mean', 'wise', 'grumpy', 'cheerful', 'shy'];
function loadCreatureImage(shuffle) {
    const combos = [];
    for (const t of CREATURE_TYPES) for (const p of CREATURE_PERSONALITIES) combos.push([t, p]);
    if (shuffle) for (let i = combos.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[combos[i], combos[j]] = [combos[j], combos[i]]; }
    let idx = 0;
    const tryNext = () => {
        if (idx >= combos.length) { updateLog('No creature image in images/creature/ — using a placeholder. Voice: ' + activeVoice + '.'); return; }
        const [t, p] = combos[idx++];
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { images.creature = img; activeVoice = (p || 'adhd').toLowerCase() || 'adhd'; updateLog(`Creature: ${t} (${p}). Voice set to "${activeVoice}".`); };
        img.onerror = tryNext;
        img.src = `images/creature/creature_${t}_${p}.png`;
    };
    tryNext();
}
// "change creature" — pick a random available creature image and match the voice to its personality
function changeCreature() {
    activeVoice = 'adhd';                 // default if nothing matches
    narratorSays('The creature takes a new form.');
    loadCreatureImage(true);              // random order -> a different creature each time
}

// ===========================================================
//  HUD VITALS
// ===========================================================
const HEART = [[0, 1, 1, 0, 0, 1, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 0], [0, 0, 1, 1, 1, 1, 0, 0], [0, 0, 0, 1, 1, 0, 0, 0]];
function heartSVG(state) {
    let cells = '';
    for (let y = 0; y < HEART.length; y++) for (let x = 0; x < 8; x++) {
        if (!HEART[y][x]) continue;
        let fill = '#f22e2e'; if (state === 'empty') fill = '#3a1414'; else if (state === 'half' && x >= 4) fill = '#3a1414';
        cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }
    if (state !== 'empty') cells += '<rect x="1" y="1" width="1" height="1" fill="#ffd0d0"/>';
    return `<svg width="26" height="23" viewBox="0 0 8 7">${cells}</svg>`;
}
function renderHearts(hearts, total = 3) { let html = ''; for (let i = 0; i < total; i++) { const state = hearts >= i + 1 ? 'full' : (hearts >= i + 0.5 ? 'half' : 'empty'); html += heartSVG(state); } heartsEl.innerHTML = html; }
// Draw mini pixel-hearts on the canvas above an entity (red = current, black = lost)
function drawMiniHearts(cx, topY, current, max) {
    const cell = 1.4, hw = 8 * cell, gap = 2, totalW = max * hw + (max - 1) * gap;
    let x0 = cx - totalW / 2;
    for (let h = 0; h < max; h++) {
        const state = current >= h + 1 ? 'full' : (current >= h + 0.5 ? 'half' : 'empty');
        const bx = x0 + h * (hw + gap);
        for (let y = 0; y < HEART.length; y++) for (let xx = 0; xx < 8; xx++) {
            if (!HEART[y][xx]) continue;
            ctx.fillStyle = (state === 'empty' || (state === 'half' && xx >= 4)) ? '#1a1a1a' : '#f22e2e';
            ctx.fillRect(bx + xx * cell, topY + y * cell, cell, cell);
        }
    }
}
function renderStamina(s) { let html = ''; for (let i = 0; i < 5; i++) { const cls = s >= i * 2 + 2 ? 'full' : (s === i * 2 + 1 ? 'half' : ''); html += `<div class="stamina-dot ${cls}"></div>`; } staminaEl.innerHTML = html; }

// ===========================================================
//  GRASS
// ===========================================================
let grassPattern = null;
function buildGrassPattern() {
    const tile = document.createElement('canvas'); tile.width = 48; tile.height = 48; const t = tile.getContext('2d');
    t.fillStyle = '#4f8f43'; t.fillRect(0, 0, 48, 48); t.fillStyle = 'rgba(60,120,50,0.5)';
    for (let i = 0; i < 6; i++) t.fillRect(Math.random() * 48, Math.random() * 48, 4, 4);
    for (let i = 0; i < 16; i++) { const x = Math.random() * 48, y = Math.random() * 48; t.strokeStyle = Math.random() < 0.5 ? '#5fa84f' : '#3f7a36'; t.lineWidth = 1; t.beginPath(); t.moveTo(x, y); t.lineTo(x + (Math.random() * 2 - 1), y - 3 - Math.random() * 2); t.stroke(); }
    grassPattern = ctx.createPattern(tile, 'repeat');
}

// ===========================================================
//  WORLD
// ===========================================================
let world = { lakes: [], rivers: [], huts: [], villagers: [], shrines: [], trees: [], crops: [], fireballs: [], goblins: [], goblinGroups: [], ashes: [], ogres: [], goblinHuts: [], goblinTowns: [] };
let creature = {
    x: WORLD_W / 2, y: WORLD_H / 2,
    act: 'free', moveState: 'walking', heading: Math.random() * Math.PI * 2, stateUntil: 0,
    interactCooldown: 0, burnGoal: null, burnCampaign: null, guard: null, resumeGuard: false,
    running: false, stamina: STAMINA_MAX, regenTimer: 0, drainTimer: 0,
    hearts: CREATURE_MAX_HEARTS, maxHearts: CREATURE_MAX_HEARTS, dead: false, attackCd: 0, goto: null,
    spellsUnlocked: ['fireball', 'grow', 'spread_huts']
};

function distToSegment(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy; let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2; t = clamp(t, 0, 1); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
function inLake(x, y, pad = 0) { return world.lakes.some(l => { const nx = (x - l.x) / (l.rx + pad), ny = (y - l.y) / (l.ry + pad); return nx * nx + ny * ny <= 1; }); }
function nearRiver(x, y, pad = 0) { return world.rivers.some(r => { for (let i = 0; i < r.points.length - 1; i++) { const a = r.points[i], b = r.points[i + 1]; if (distToSegment(x, y, a.x, a.y, b.x, b.y) < r.width / 2 + pad) return true; } return false; }); }
function isWater(x, y, pad = 0) { return inLake(x, y, pad) || nearRiver(x, y, pad); }
function findLandSpot(margin = 60, waterPad = 25) { for (let i = 0; i < 80; i++) { const x = margin + Math.random() * (WORLD_W - margin * 2), y = margin + Math.random() * (WORLD_H - margin * 2); if (!isWater(x, y, waterPad)) return { x, y }; } return { x: WORLD_W / 2, y: WORLD_H / 2 }; }
function canPlaceHut(x, y) { if (isWater(x, y, 15)) return false; const cx = x + 25, cy = y + 25; for (const h of world.huts) if (Math.hypot((h.x + 25) - cx, (h.y + 25) - cy) < MIN_HUT_DIST_PX) return false; return true; }
function nearestHutCenter(x, y) { let best = null, bd = Infinity; for (const h of world.huts) { const c = { x: h.x + 25, y: h.y + 25 }; const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } } return best; }

function generateWorld(opts) {
    opts = opts || {};
    const gobTownCount = (opts.goblinTowns != null) ? Math.max(0, opts.goblinTowns | 0) : 2;
    const gobHutsFixed = (opts.gobHuts != null) ? Math.max(1, opts.gobHuts | 0) : null;   // null -> random 3-6
    world = { lakes: [], rivers: [], huts: [], villagers: [], shrines: [], trees: [], crops: [], fireballs: [], goblins: [], goblinGroups: [], ashes: [], villages: [], wells: [], signs: [], caves: [], ogres: [], goblinHuts: [], goblinTowns: [] };
    for (let i = 0; i < 4; i++) world.lakes.push({ x: 200 + Math.random() * (WORLD_W - 400), y: 200 + Math.random() * (WORLD_H - 400), rx: 70 + Math.random() * 120, ry: 55 + Math.random() * 100 });
    for (let r = 0; r < 2; r++) { const points = []; const horizontal = Math.random() < 0.5; let x = horizontal ? 0 : Math.random() * WORLD_W, y = horizontal ? Math.random() * WORLD_H : 0, angle = horizontal ? 0 : Math.PI / 2; while (x >= -50 && x <= WORLD_W + 50 && y >= -50 && y <= WORLD_H + 50) { points.push({ x, y }); angle += (Math.random() - 0.5) * 0.7; x += Math.cos(angle) * 60; y += Math.sin(angle) * 60; if (points.length > 120) break; } world.rivers.push({ points, width: 22 + Math.random() * 14 }); }
    for (let i = 0; i < 55; i++) world.trees.push(findLandSpot(40, 18));
    // hut settlements (no stacking). Each settlement is a "village" with a shared crop field.
    for (let s = 0; s < 3; s++) {
        const center = findLandSpot(140, 60); world.villages.push({ x: center.x, y: center.y });
        const hutsHere = 3 + Math.floor(Math.random() * 4);
        for (let h = 0; h < hutsHere; h++) { for (let a = 0; a < 12; a++) { const hx = center.x + (Math.random() * 160 - 80), hy = center.y + (Math.random() * 160 - 80); if (canPlaceHut(hx, hy)) { world.huts.push({ x: hx, y: hy, vseed: Math.random() }); break; } } }
    }
    // villagers belong to a village, leashed to 20 m of its center; together they tend ONE shared field
    for (let i = 0; i < 18; i++) {
        const vi = world.villages.length ? (i % world.villages.length) : 0;
        const vc = world.villages[vi] || findLandSpot(60, 20);
        let spot = vc; for (let a = 0; a < 12; a++) { const ang = Math.random() * 6.283, r = Math.random() * 120; const p = { x: vc.x + Math.cos(ang) * r, y: vc.y + Math.sin(ang) * r }; if (!isWater(p.x, p.y, 10)) { spot = p; break; } }
        world.villagers.push({ x: spot.x, y: spot.y, home: { x: vc.x, y: vc.y }, village: vi, heading: Math.random() * 6.283, vstate: 'moving', vUntil: 0, hearts: VILLAGER_HEARTS, maxHearts: VILLAGER_HEARTS });
    }
    const shrineCount = 1 + Math.floor(Math.random() * 2);   // 1-2 shrines per map
    for (let i = 0; i < shrineCount; i++) { const s = findLandSpot(150, 60); world.shrines.push({ x: s.x, y: s.y, vseed: Math.random() }); }
    for (let i = 0; i < 6; i++) { const c = findLandSpot(120, 50); world.caves.push({ x: c.x, y: c.y, vseed: Math.random() }); }   // caves at random
    for (const cave of world.caves) world.ogres.push({ x: cave.x + 20, y: cave.y, home: { x: cave.x, y: cave.y }, hearts: OGRE_HEARTS, maxHearts: OGRE_HEARTS, mode: 'idle', heading: Math.random() * 6.283, vstate: 'moving', vUntil: 0, attackCd: 0, vseed: Math.random() });   // 1 ogre per cave
    // existing roaming goblin packs (raiders)
    for (let g = 0; g < 3; g++) { const c = findLandSpot(120, 40); world.goblinGroups.push({ x: c.x, y: c.y, heading: Math.random() * Math.PI * 2, turnTimer: 120 + Math.random() * 240 }); const n = 2 + Math.floor(Math.random() * 2); for (let i = 0; i < n; i++) world.goblins.push(makeGoblin(c.x + (Math.random() * 40 - 20), c.y + (Math.random() * 40 - 20), 'raid', g)); }
    // 2 goblin towns: kept away from villages, but guaranteed to spawn (pick the farthest of many candidates)
    for (let t = 0; t < gobTownCount; t++) {
        let center = null, bestFar = -1;
        for (let a = 0; a < 120; a++) {
            const p = findLandSpot(160, 60);
            const far = world.villages.length ? Math.min(...world.villages.map(v => Math.hypot(v.x - p.x, v.y - p.y))) : 9999;
            if (far >= GOBLINHUT_MIN_VILLAGE_PX) { center = p; break; }
            if (far > bestFar) { bestFar = far; center = p; }
        }
        const ti = world.goblinTowns.length; world.goblinTowns.push({ x: center.x, y: center.y });
        const huts = gobHutsFixed != null ? gobHutsFixed : (3 + Math.floor(Math.random() * 4));
        for (let h = 0; h < huts; h++) {
            for (let a = 0; a < 12; a++) {
                const hx = center.x + (Math.random() * 200 - 100), hy = center.y + (Math.random() * 200 - 100);
                if (!isWater(hx, hy, 20)) { world.goblinHuts.push({ x: hx, y: hy, vseed: Math.random(), town: ti, spawnCd: 120 }); world.goblins.push(makeGoblin(hx + 25, hy + 25, 'home', ti, world.goblinTowns[ti])); break; }
            }
        }
    }
    updateLog("Generated a fresh world: 3 villages, 6 caves+ogres, 2 goblin towns, raiders & shrines.");
}
function makeGoblin(x, y, mode, group, home) {
    return { x, y, mode: mode || 'raid', group: group | 0, home: home || null, ox: Math.random() * 30 - 15, oy: Math.random() * 30 - 15, heading: Math.random() * 6.283, vstate: 'moving', vUntil: 0, hearts: GOBLIN_HEARTS, maxHearts: GOBLIN_HEARTS, attackCd: 0 };
}
function normalizeWorld() {
    ['lakes', 'rivers', 'huts', 'villagers', 'shrines', 'trees', 'crops', 'fireballs', 'goblins', 'goblinGroups', 'ashes', 'villages', 'wells', 'signs', 'caves', 'ogres', 'goblinHuts', 'goblinTowns'].forEach(k => { if (!Array.isArray(world[k])) world[k] = []; });
    world.villagers.forEach(v => {
        if (!v.home) { v.home = nearestHutCenter(v.x, v.y) || { x: v.x, y: v.y }; }
        if (v.vstate === undefined) { v.vstate = 'moving'; v.vUntil = 0; v.heading = Math.random() * 6.283; }
        if (v.hearts === undefined) { v.hearts = VILLAGER_HEARTS; v.maxHearts = VILLAGER_HEARTS; }
        if (v.village === undefined || !world.villages[v.village]) {
            if (!world.villages.length) world.villages.push({ x: v.home.x, y: v.home.y });
            let bi = 0, bd = Infinity; world.villages.forEach((vc, i) => { const d = Math.hypot(vc.x - v.home.x, vc.y - v.home.y); if (d < bd) { bd = d; bi = i; } }); v.village = bi;
        }
    });
    world.goblins.forEach(g => { if (g.hearts === undefined) { g.hearts = GOBLIN_HEARTS; g.maxHearts = GOBLIN_HEARTS; } if (!g.mode) g.mode = 'raid'; if (g.attackCd === undefined) g.attackCd = 0; if (g.vstate === undefined) { g.vstate = 'moving'; g.vUntil = 0; } });
    world.ogres.forEach(o => { if (o.hearts === undefined) { o.hearts = OGRE_HEARTS; o.maxHearts = OGRE_HEARTS; } if (!o.home) o.home = { x: o.x, y: o.y }; if (!o.mode) o.mode = 'idle'; if (o.attackCd === undefined) o.attackCd = 0; if (o.vstate === undefined) { o.vstate = 'moving'; o.vUntil = 0; } if (o.vseed === undefined) o.vseed = Math.random(); });
    world.huts.forEach(o => { if (o.vseed === undefined) o.vseed = Math.random(); });
    world.crops.forEach(c => { if (c.vseed === undefined) c.vseed = Math.random(); });
    world.wells.forEach(o => { if (o.vseed === undefined) o.vseed = Math.random(); });
    world.signs.forEach(o => { if (o.vseed === undefined) o.vseed = Math.random(); });
    world.caves.forEach(o => { if (o.vseed === undefined) o.vseed = Math.random(); });
    world.shrines.forEach(o => { if (o.vseed === undefined) o.vseed = Math.random(); });
    world.goblinHuts.forEach(o => { if (o.vseed === undefined) o.vseed = Math.random(); if (o.spawnCd === undefined) o.spawnCd = 120; });
    if (!world.caves.length) for (let i = 0; i < 6; i++) { const c = findLandSpot(120, 50); world.caves.push({ x: c.x, y: c.y, vseed: Math.random() }); }
    if (!world.ogres.length) for (const cave of world.caves) world.ogres.push({ x: cave.x + 20, y: cave.y, home: { x: cave.x, y: cave.y }, hearts: OGRE_HEARTS, maxHearts: OGRE_HEARTS, mode: 'idle', heading: Math.random() * 6.283, vstate: 'moving', vUntil: 0, attackCd: 0, vseed: Math.random() });
    if (creature.hearts === undefined) { creature.hearts = CREATURE_MAX_HEARTS; creature.maxHearts = CREATURE_MAX_HEARTS; }
}

// ===========================================================
//  FOG OF WAR
// ===========================================================
const FOG_SCALE = 4, VISION_PX = m2px(50);   // 50 m vision radius
let fogCanvas = null, fogCtx = null, fogReveal = false;
function initFog() {
    fogCanvas = document.createElement('canvas');
    fogCanvas.width = Math.ceil(WORLD_W / FOG_SCALE); fogCanvas.height = Math.ceil(WORLD_H / FOG_SCALE);
    fogCtx = fogCanvas.getContext('2d');
    fogCtx.globalCompositeOperation = 'source-over'; fogCtx.fillStyle = '#000';
    fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
}
function eraseFog(wx, wy) {
    if (!fogCtx) return;
    fogCtx.globalCompositeOperation = 'destination-out';
    fogCtx.beginPath(); fogCtx.arc(wx / FOG_SCALE, wy / FOG_SCALE, VISION_PX / FOG_SCALE, 0, Math.PI * 2); fogCtx.fill();
    fogCtx.globalCompositeOperation = 'source-over';
}

// ===========================================================
//  WATER LAYER
// ===========================================================
let waterCanvas = null;
function buildWaterLayer() {
    waterCanvas = document.createElement('canvas'); waterCanvas.width = WORLD_W; waterCanvas.height = WORLD_H; const w = waterCanvas.getContext('2d');
    w.fillStyle = '#3a6ea5'; world.lakes.forEach(l => { w.beginPath(); w.ellipse(l.x, l.y, l.rx, l.ry, 0, 0, Math.PI * 2); w.fill(); });
    world.rivers.forEach(r => { w.strokeStyle = '#3a6ea5'; w.lineWidth = r.width; w.lineJoin = 'round'; w.lineCap = 'round'; w.beginPath(); r.points.forEach((p, i) => i === 0 ? w.moveTo(p.x, p.y) : w.lineTo(p.x, p.y)); w.stroke(); });
    w.globalCompositeOperation = 'source-atop'; w.strokeStyle = 'rgba(130,185,230,0.22)'; w.lineWidth = 1;
    for (let i = 0; i < 1600; i++) { const x = Math.random() * WORLD_W, y = Math.random() * WORLD_H; w.beginPath(); w.moveTo(x, y); w.lineTo(x + 4, y); w.stroke(); }
    w.globalCompositeOperation = 'source-over';
}

// ===========================================================
//  PAUSE / RULER
// ===========================================================
function drawRuler() {
    rulerCanvas.width = window.innerWidth; rulerCanvas.height = 30; const r = rulerCtx; r.clearRect(0, 0, rulerCanvas.width, 30);
    r.fillStyle = 'rgba(0,0,0,0.75)'; r.fillRect(0, 0, rulerCanvas.width, 30); r.strokeStyle = '#0f0'; r.fillStyle = '#0f0'; r.font = '10px monospace'; r.textBaseline = 'top'; r.lineWidth = 1;
    const rightM = (canvas.width / zoom) / PIXELS_PER_METER;          // measured from the LEFT edge (always starts at 0)
    for (let m = 0; m <= rightM; m += 2) { const sx = m * PIXELS_PER_METER * zoom; const major = (m % 10 === 0); r.beginPath(); r.moveTo(sx, 30); r.lineTo(sx, major ? 13 : 22); r.stroke(); if (major) r.fillText(m + 'm', sx + 2, 2); }
}
function renderApiUsage() {
    if (!apiUsageEl) return;
    if (!apiKeys.length) { apiUsageEl.innerHTML = '<p>No API keys set.</p>'; return; }
    let html = '<p>API calls this session:</p>';
    apiKeys.forEach((k, i) => { const tail = k.length > 4 ? k.slice(-4) : k; html += `<p>Key ${i + 1} (…${tail}): ${keyCallCounts[k] || 0}</p>`; });
    apiUsageEl.innerHTML = html;
}
function pauseGame() { isPaused = true; renderApiUsage(); pausePanel.classList.add('open'); rulerCanvas.style.display = 'block'; drawRuler(); }
function resumeGame() { closeKeysModal(); pausePanel.classList.remove('open'); rulerCanvas.style.display = 'none'; isPaused = false; lastTs = null; updateLog("Game resumed."); requestAnimationFrame(draw); }
function togglePause() { isPaused ? resumeGame() : pauseGame(); }
saveSettingsBtn.addEventListener('click', resumeGame);

// ===========================================================
//  STORAGE
// ===========================================================
function saveGame() { if (isPaused) return; localStorage.setItem('creatureGameState', JSON.stringify({ version: VERSION, world, creature, camera, zoom })); }
function loadGame() {
    const saved = localStorage.getItem('creatureGameState'); let ok = false;
    if (saved) { try { const data = JSON.parse(saved); if (data.version === VERSION && data.world && data.world.rivers) { world = data.world; creature = data.creature; if (data.camera) camera = data.camera; if (data.zoom) zoom = data.zoom; normalizeWorld(); updateLog("World state loaded."); ok = true; } } catch (e) { console.warn("Bad save, regenerating.", e); } }
    if (!ok) generateWorld();
    resetCreatureRuntime();
}
// Reset transient/runtime creature fields (preserves stamina/hearts/position if already set)
function resetCreatureRuntime() {
    creature.act = 'free'; creature.burnGoal = null; creature.burnCampaign = null; creature.attackCampaign = null; creature.eatCampaign = null; creature.guard = null; creature.resumeGuard = false; creature.goto = null;
    creature.running = false; creature.regenTimer = 0; creature.drainTimer = 0; creature.attackCd = 0; creature.dead = false;
    creature.maxHearts = CREATURE_MAX_HEARTS; creature.hearts = CREATURE_MAX_HEARTS;   // full health on (re)start
    if (creature.stamina === undefined) creature.stamina = STAMINA_MAX;
    if (creature.moveState === undefined) creature.moveState = 'walking';
    if (creature.heading === undefined) creature.heading = Math.random() * Math.PI * 2;
    creature.interactCooldown = 0; creature.stateUntil = Date.now() + 4000;
    creature.ncUntil = 0; creature.lastVillagerBurn = 0;
}

// ===========================================================
//  VOICE
// ===========================================================
let voiceStyles = {}; let activeVoice = 'adhd';   // default until a creature's personality is loaded
let voiceResponses = {};          // { styleName: { action: cannedResponseText } }
let cannedCommands = {};          // { normalizedText: actionHeader }  (from canned.txt)
function parseVoiceStyles(text) {
    const styles = {}; const re = /\[([^\]]+)\]\s*\{([\s\S]*?)\}/g; let m;
    while ((m = re.exec(text))) {
        const header = m[1].trim();
        if (/responses?\s*$/i.test(header)) continue;          // response blocks handled separately
        const [namePart, ...descParts] = header.split('|'); const name = namePart.trim().toLowerCase(); const description = descParts.join('|').trim();
        const examples = m[2].split(/\r?\n/).map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim()).filter(l => l.length > 0);
        if (name) styles[name] = { description, examples };
    }
    return styles;
}
function parseVoiceResponses(text) {
    const out = {}; const re = /\[([^\]]+)\]\s*\{([\s\S]*?)\}/g; let m;
    while ((m = re.exec(text))) {
        const header = m[1].trim();
        if (!/responses?\s*$/i.test(header)) continue;
        const style = header.replace(/responses?\s*$/i, '').replace(/[|.]/g, ' ').trim().toLowerCase();
        if (!style) continue;
        const map = out[style] || {};
        m[2].split(/\r?\n/).forEach(line => { const mm = line.match(/^\s*([a-z_]+)\s*[:=]\s*(.+?)\s*$/i); if (mm) map[mm[1].toLowerCase()] = mm[2]; });
        out[style] = map;
    }
    return out;
}
function cannedResponse(style, action) {
    const m = voiceResponses[(style || '').toLowerCase()] || {};
    const dflt = voiceResponses['default'] || {};
    return m[action] || dflt[action] || null;
}
async function loadCreatureVoice() {
    try {
        const res = await fetch('CreatureVoice.txt', { cache: 'no-store' }); if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        voiceStyles = parseVoiceStyles(text); voiceResponses = parseVoiceResponses(text);
        const names = Object.keys(voiceStyles);
        if (!names.length) { updateLog("CreatureVoice.txt had no [style]{...} blocks."); return; }
        if (!voiceStyles[activeVoice]) activeVoice = names[0];
        const rc = Object.keys(voiceResponses).length;
        updateLog(`Creature voices: ${names.join(', ')}. Active: "${activeVoice}".` + (rc ? ` Canned responses for: ${Object.keys(voiceResponses).join(', ')}.` : ''));
    } catch (e) { updateLog(`Couldn't read CreatureVoice.txt (${e.message}); using a default voice.`); }
}
// canned.txt: headers in [brackets] are action categories; lines under them are exact command phrases.
async function loadCanned() {
    try {
        const res = await fetch('canned.txt', { cache: 'no-store' }); if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text(); cannedCommands = {}; let cur = null;
        text.split(/\r?\n/).forEach(line => {
            const l = line.trim(); if (!l || l.startsWith('#') || l.startsWith('//')) return;
            const h = l.match(/^\[(.+?)\]$/); if (h) { cur = h[1].trim().toLowerCase(); return; }
            if (cur) cannedCommands[normalizeCmd(l)] = cur;
        });
        updateLog(`Loaded ${Object.keys(cannedCommands).length} canned commands (no API needed for these).`);
    } catch (e) { updateLog(`No canned.txt (${e.message}) — every command will use the API.`); }
}
function buildPersona() { let base = `You are the brain of EGG, a giant bipedal fire-throwing tiger in a god-game. A human gives you divine voice commands; you respond out loud and may act on the world.`; const style = voiceStyles[activeVoice]; if (style && style.examples.length) { base += `\n\nYour personality/voice is "${activeVoice}"`; if (style.description) base += `: ${style.description}`; base += `.\nExamples of how you talk. Imitate the tone/attitude/word choice; do NOT copy verbatim:\n` + style.examples.map(e => `- ${e}`).join('\n') + `\n\nAlways speak in this voice.`; } else base += `\n\nSpeak with a little personality.`; return base; }
function trySwitchVoice(cmd) { const m = cmd.match(/^\s*be\s+(?:an?\s+|more\s+)?([a-zA-Z]+)\s*[.!]?\s*$/i); if (!m) return false; const name = m[1].toLowerCase(); if (voiceStyles[name]) { activeVoice = name; narratorSays(`Now speaking in "${name}" style.`); updateLog(`Voice switched to "${name}".`); return true; } return false; }

// ===========================================================
//  INPUT
// ===========================================================
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
function typingInInput() { const ae = document.activeElement; return !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'); }
window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); togglePause(); return; }
    if (typingInInput()) return;
    if (k === 'enter') { e.preventDefault(); commandInput.focus(); return; }
    if (k === '=' || k === '+') { if (!isPaused) { e.preventDefault(); setZoom(zoom * 1.12); } return; }
    if (k === '-' || k === '_') { if (!isPaused) { e.preventDefault(); setZoom(zoom / 1.12); } return; }
    if (k === ' ') { if (!isPaused && selectedSpell === 0 && !charging) { e.preventDefault(); startCharge(); } return; }   // hold space to charge fireball
    if (k === 'f') { fogReveal = !fogReveal; return; }                     // F toggles full-map reveal
    if (k === 't') { toggleTree(); return; }                              // T: Tree of Knowledge
    if (/^[0-9]$/.test(k)) { selectSpell(k === '0' ? 9 : (parseInt(k, 10) - 1)); return; }   // 1..9,0 select spell slots
    if (MOVE_KEYS.includes(k)) { keys[k] = true; if (k.startsWith('arrow')) e.preventDefault(); if (!controlsHintHidden) { controlsHint.style.display = 'none'; controlsHintHidden = true; } }
});
window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (k === ' ') { if (charging) releaseCharge(); return; } keys[k] = false; });
commandInput.addEventListener('focus', () => { for (const kk in keys) keys[kk] = false; if (pauseWhenChatting) chatPaused = true; });
commandInput.addEventListener('blur', () => { chatPaused = false; });
commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();   // stopPropagation: don't let the window handler re-focus us
        const cmd = commandInput.value.trim();
        if (cmd) { playerSays(cmd); commandInput.value = ''; processCommand(cmd); }
        commandInput.blur();                        // hand control back -> arrows/WASD scroll instantly
    }
});

function handleControl(cmd) {
    if (trySwitchVoice(cmd)) return true;
    const nm = cmd.match(/^\s*(?:your name is|you are called|name yourself|i name you|i'?ll call you)\s+(.+?)\s*[.!]?\s*$/i);
    if (nm) { creature.name = nm[1].trim().slice(0, 40); narratorSays('The creature is now called ' + creature.name + '.'); return true; }
    if (/\b(change|swap|new|switch)\s+(the\s+)?creature\b/i.test(cmd)) { changeCreature(); return true; }
    if (/\b(slow down|don'?t rush|stop running|ease up|take it easy|chill out|walk normally|quit running)\b/i.test(cmd)) { stopRunning(); narratorSays('The creature eases back to a walk.'); return true; }
    if (/^\s*(stop|cancel|halt|cease|enough|abort|never\s?mind|quit it|knock it off|stop it)\s*[.!]?\s*$/i.test(cmd)) { cancelAll(); narratorSays('The creature stops what it was doing.'); return true; }
    return false;
}

function clampCamera() { const vw = canvas.width / zoom, vh = canvas.height / zoom; camera.x = clamp(camera.x, 0, Math.max(0, WORLD_W - vw)); camera.y = clamp(camera.y, 0, Math.max(0, WORLD_H - vh)); }
function updateCamera() { if (isPaused) return; if (keys['w'] || keys['arrowup']) camera.y -= CAMERA_SPEED; if (keys['s'] || keys['arrowdown']) camera.y += CAMERA_SPEED; if (keys['a'] || keys['arrowleft']) camera.x -= CAMERA_SPEED; if (keys['d'] || keys['arrowright']) camera.x += CAMERA_SPEED; clampCamera(); }

// ===========================================================
//  STAMINA / RUN
// ===========================================================
let lastStamina = -1;
function updateStamina(dt) {
    creature.regenTimer += dt;
    while (creature.regenTimer >= STAMINA_REGEN_S) { creature.stamina = Math.min(STAMINA_MAX, creature.stamina + 1); creature.regenTimer -= STAMINA_REGEN_S; }
    if (creature.running) {
        creature.drainTimer += dt;
        while (creature.drainTimer >= RUN_DRAIN_S) { creature.stamina = Math.max(0, creature.stamina - 1); creature.drainTimer -= RUN_DRAIN_S; }
        if (creature.stamina <= 0) { creature.running = false; creature.drainTimer = 0; statusBox.innerText = 'Out of breath!'; }
    }
    if (creature.stamina !== lastStamina) { lastStamina = creature.stamina; renderStamina(creature.stamina); }
}
function startRunning() { if (creature.stamina <= 0) { statusBox.innerText = 'Too tired to run.'; narratorSays('The creature is too winded to run.'); return; } creature.running = true; statusBox.innerText = 'Running!'; }
function stopRunning() { creature.running = false; }
function runMult() { return creature.running ? (RUN_SPEED_MPS / WANDER_SPEED_MPS) : 1; }   // wander 2 -> run 8
function cancelAll() { creature.act = 'free'; creature.burnGoal = null; creature.burnCampaign = null; creature.attackCampaign = null; creature.eatCampaign = null; creature.guard = null; creature.resumeGuard = false; creature.running = false; creature.goto = null; statusBox.innerText = 'Exploring.'; }

// ===========================================================
//  WORLD UPDATES
// ===========================================================
function updateVillagers(dt, now) {
    const sp = VILLAGER_SPEED_MPS * PIXELS_PER_METER * dt;
    for (const v of world.villagers) {
        if (!v.home) v.home = { x: v.x, y: v.y };
        if (v.baby && now - (v.bornAt || now) > BABY_GROW_MS) v.baby = false;   // grow up
        if (v.vstate === undefined) { v.vstate = 'moving'; v.vUntil = now + (1000 + Math.random() * 2000); v.heading = Math.random() * 6.283; }
        if (v.vstate === 'stopped') {
            if (now >= v.vUntil) {
                v.vstate = 'moving'; v.vUntil = now + (1000 + Math.random() * 2000);   // move 1-3 s
                const dh = Math.hypot(v.x - v.home.x, v.y - v.home.y);
                v.heading = dh > VILLAGER_LEASH_PX * 0.75
                    ? Math.atan2(v.home.y - v.y, v.home.x - v.x) + (Math.random() - 0.5)   // steer home when near the leash
                    : Math.random() * 6.283;
            }
        } else { // moving
            if (now >= v.vUntil) { v.vstate = 'stopped'; v.vUntil = now + (1000 + Math.random() * 2000); }  // stop 1-3 s
            else {
                const nx = v.x + Math.cos(v.heading) * sp, ny = v.y + Math.sin(v.heading) * sp;
                const out = Math.hypot(nx - v.home.x, ny - v.home.y) > VILLAGER_LEASH_PX;
                if (out || isWater(nx, ny, 8) || nx < 10 || nx > WORLD_W - 10 || ny < 10 || ny > WORLD_H - 10) {
                    v.vstate = 'stopped'; v.vUntil = now + (800 + Math.random() * 1500); v.heading = Math.atan2(v.home.y - v.y, v.home.x - v.x);
                } else { v.x = nx; v.y = ny; }
            }
        }
        if (Math.random() < 0.00022) {           // 5x slower than before; add next crop to the shared field
            const center = (world.villages && world.villages[v.village]) || v.home;
            const cell = nextCropCell(center);
            if (cell) world.crops.push({ x: cell.x, y: cell.y, vseed: Math.random() });
        }
    }
}

const WALK_STATUS = ["Exploring.", "Exploring the map.", "Off to see what's over there.", "Roaming."];
function pickWalkStatus() { return WALK_STATUS[Math.floor(Math.random() * WALK_STATUS.length)]; }
function enterStopped(now) { creature.moveState = 'stopped'; creature.stateUntil = now + (1000 + Math.random() * 2000); creature.heading = Math.random() * Math.PI * 2; statusBox.innerText = "Pausing to look around."; }

// Villager reproduction: per 2 villagers in a 100 m area, a baby is born (first at 1 min, then every 5 min)
let reproTimer = 0, reproNext = REPRO_FIRST_S;
function spawnBabyNear(vi, vc) {
    if (world.villagers.length >= VILLAGER_CAP) return;
    let spot = vc; for (let a = 0; a < 10; a++) { const ang = Math.random() * 6.283, r = Math.random() * 120; const p = { x: vc.x + Math.cos(ang) * r, y: vc.y + Math.sin(ang) * r }; if (!isWater(p.x, p.y, 10)) { spot = p; break; } }
    world.villagers.push({ x: spot.x, y: spot.y, home: { x: vc.x, y: vc.y }, village: vi, heading: Math.random() * 6.283, vstate: 'moving', vUntil: 0, baby: true, bornAt: Date.now() });
}
function updateReproduction(dt) {
    if (!world.villages || !world.villages.length) return;
    reproTimer += dt; if (reproTimer < reproNext) return;
    reproTimer = 0; reproNext = REPRO_EVERY_S;
    let born = 0;
    for (let vi = 0; vi < world.villages.length; vi++) {
        const vc = world.villages[vi];
        const pop = world.villagers.filter(v => Math.hypot(v.x - vc.x, v.y - vc.y) <= CITY_RADIUS_PX).length;
        const babies = Math.floor(pop / 2);
        for (let b = 0; b < babies; b++) { spawnBabyNear(vi, vc); born++; }
    }
    if (born) updateLog(born + " baby villager(s) born.");
}
// Crowding: when a 200 m area has > 4 villagers per hut, add one hut each minute
let hutGrowTimer = 0;
function updateHutGrowth(dt) {
    if (!world.villages || !world.villages.length) return;
    hutGrowTimer += dt; if (hutGrowTimer < 60) return; hutGrowTimer = 0;
    for (let vi = 0; vi < world.villages.length; vi++) {
        const vc = world.villages[vi];
        const villagers = world.villagers.filter(v => Math.hypot(v.x - vc.x, v.y - vc.y) <= HUT_CROWD_RADIUS_PX).length;
        const huts = world.huts.filter(h => Math.hypot((h.x + 25) - vc.x, (h.y + 25) - vc.y) <= HUT_CROWD_RADIUS_PX).length;
        if (huts > 0 && villagers / huts > 4) {
            for (let a = 0; a < 20; a++) { const hx = vc.x + (Math.random() * 220 - 110), hy = vc.y + (Math.random() * 220 - 110); if (canPlaceHut(hx, hy)) { world.huts.push({ x: hx, y: hy, vseed: Math.random() }); updateLog("Overcrowding — a new hut was built."); break; } }
        }
    }
}

// ---- Not Commanded State: the creature's default idle behavior ----
function pickNotCommanded(now) {
    const r = Math.random();
    if (world.villagers.length && now - (creature.lastVillagerBurn || 0) > 60000 && r < 0.2) {   // burn a villager, <=1/min
        creature.lastVillagerBurn = now; creature.ncUntil = now + 8000; performBurn('villager'); return;
    }
    if (r < 0.8) {                                                                                 // explore for 10-40 s
        creature.ncUntil = now + (10 + Math.random() * 30) * 1000;
        creature.moveState = 'walking'; creature.stateUntil = now + (3000 + Math.random() * 9000); statusBox.innerText = pickWalkStatus();
    } else {                                                                                       // rest for 10-120 s
        creature.ncUntil = now + (10 + Math.random() * 110) * 1000;
        creature.moveState = 'stopped'; creature.stateUntil = creature.ncUntil; statusBox.innerText = 'Resting.';
    }
}
function updateCreature(dt, now) {
    if (creature.dead) return;
    creatureAutoAttack(now);                                            // attacking ALWAYS takes precedence
    if (creature.act === 'busy') return;
    if (creature.act === 'seeking') { seekStep(dt); return; }
    if (creature.act === 'burning') { updateBurnCampaign(dt, now); return; }
    if (creature.act === 'attacking') { updateAttackCampaign(dt, now); return; }
    if (creature.act === 'eating') { updateEatCampaign(dt, now); return; }
    if (creature.act === 'guarding') { updateGuard(dt, now); return; }
    if (creature.act === 'goto') { updateGoto(dt); return; }
    // --- Not Commanded State (default) ---
    if (!creature.ncUntil || now >= creature.ncUntil) { pickNotCommanded(now); return; }
    if (now > creature.interactCooldown) { const v = nearestIn(world.villagers, creature.x + 30, creature.y + 33, INTERACT_RANGE_PX); if (v) { startVillagerInteraction(v.obj, now); return; } }
    if (creature.moveState === 'stopped') { if (now >= creature.stateUntil) { creature.moveState = 'walking'; creature.stateUntil = now + (3000 + Math.random() * 9000); statusBox.innerText = pickWalkStatus(); } return; }
    if (now >= creature.stateUntil) { enterStopped(now); return; }
    const sp = WANDER_SPEED_MPS * PIXELS_PER_METER * dt * runMult();
    const nx = creature.x + Math.cos(creature.heading) * sp, ny = creature.y + Math.sin(creature.heading) * sp;
    if (nx < 0 || nx > WORLD_W - 60 || ny < 0 || ny > WORLD_H - 66 || isWater(nx + 30, ny + 60, 12)) { enterStopped(now); return; }
    creature.x = nx; creature.y = ny;
}

function fireballHitsObject(fx, fy) {
    const near = (arr, rad, off) => { for (const o of arr) { const ox = o.x + (off || 0), oy = o.y + (off || 0); if (Math.hypot(ox - fx, oy - fy) < rad) return true; } return false; };
    if (near(world.goblins, 12) || near(world.ogres, 18)) return true;
    if (near(world.villagers, 10)) return true;
    if (near(world.trees, 16)) return true;
    if (near(world.huts, 28, 25) || near(world.goblinHuts, 28, 25)) return true;
    if (near(world.caves, 26) || near(world.wells, 22) || near(world.signs, 14) || near(world.shrines, 20) || near(world.crops, 10)) return true;
    return false;
}
function updateProjectiles() {
    for (let i = world.fireballs.length - 1; i >= 0; i--) {
        const f = world.fireballs[i]; const dx = f.targetX - f.x, dy = f.targetY - f.y, dist = Math.hypot(dx, dy); const sp = f.speed || 6;
        if (f.charged && fireballHitsObject(f.x, f.y)) { explodeFireball(f.x, f.y, f.power); world.fireballs.splice(i, 1); continue; }   // explode on contact
        if (dist < sp) { if (f.charged) explodeFireball(f.targetX, f.targetY, f.power); world.fireballs.splice(i, 1); }
        else { f.x += (dx / dist) * sp; f.y += (dy / dist) * sp; }
    }
}
function updateAshes() { const now = Date.now(); for (let i = world.ashes.length - 1; i >= 0; i--) if (now - world.ashes[i].born > ASH_LIFETIME_MS) world.ashes.splice(i, 1); }
function maybeSpawnShrine() { if (world.shrines.length >= 8) return; if (Math.random() < 0.0006) { world.shrines.push(findLandSpot(80, 40)); updateLog("A shrine has appeared."); } }

const CITY_HUT_COUNT = 7, CITY_RADIUS_PX = m2px(100);
function maybeSpawnWell() {
    if (world.huts.length < CITY_HUT_COUNT) return;
    for (const h of world.huts) {
        let sx = 0, sy = 0, n = 0;
        for (const o of world.huts) { if (Math.hypot(o.x - h.x, o.y - h.y) <= CITY_RADIUS_PX) { sx += o.x + 25; sy += o.y + 25; n++; } }
        if (n >= CITY_HUT_COUNT) {
            const cx = sx / n, cy = sy / n;
            if (world.wells.some(w => Math.hypot(w.x - cx, w.y - cy) < CITY_RADIUS_PX)) return;   // already has a city well
            world.wells.push({ x: cx, y: cy, vseed: Math.random(), cityCenter: true });
            const ang = Math.random() * Math.PI * 2, d = 40 + Math.random() * 25;
            world.signs.push({ x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d, vseed: Math.random() });
            updateLog("A city has formed — a well (city center) and a sign appeared.");
            return;
        }
    }
}

function nearestIn(arr, fx, fy, maxPx) { let best = null, bd = maxPx; for (const o of arr) { const d = Math.hypot(o.x - fx, o.y - fy); if (d < bd) { bd = d; best = { obj: o, dist: d }; } } return best; }
function stepToward(o, tx, ty, speed) { const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy) || 1; o.x += (dx / d) * speed; o.y += (dy / d) * speed; }
function stepCreatureToward(tx, ty, sp) { const cx = creature.x + 30, cy = creature.y + 33, dx = tx - cx, dy = ty - cy, d = Math.hypot(dx, dy) || 1; creature.x = clamp(creature.x + (dx / d) * sp, 0, WORLD_W - 60); creature.y = clamp(creature.y + (dy / d) * sp, 0, WORLD_H - 66); }

// ---- Health / combat ----
function entityCenter(o, arr) { if (arr === world.huts || arr === world.goblinHuts) return { x: o.x + 25, y: o.y + 25 }; return { x: o.x, y: o.y }; }
function damageEntity(o, arr, dmg) {
    if (o.hearts === undefined) { o.hearts = 1; o.maxHearts = 1; }
    o.hearts -= dmg;
    if (o.hearts <= 0) { const i = arr.indexOf(o); if (i >= 0) { const c = entityCenter(o, arr); arr.splice(i, 1); world.ashes.push(makeAshes(c.x, c.y)); } return true; }
    return false;
}
function damageCreature(dmg) {
    if (creature.dead) return;
    creature.hearts = Math.max(0, creature.hearts - dmg);
    renderHearts(creature.hearts, creature.maxHearts || CREATURE_MAX_HEARTS);
    if (creature.hearts <= 0) creatureDies();
}
function creatureDies() {
    creature.dead = true; creature.act = 'free'; creature.burnCampaign = null; creature.attackCampaign = null; creature.guard = null; creature.goto = null; creature.running = false;
    statusBox.innerText = '💀 The creature has died.';
    narratorSays('The creature has fallen. (Use New Game or Regenerate to begin again.)');
}
function nearestEnemy(fx, fy, maxPx) {
    let best = null, bd = maxPx;
    for (const g of world.goblins) { const d = Math.hypot(g.x - fx, g.y - fy); if (d < bd) { bd = d; best = { obj: g, arr: world.goblins, dist: d }; } }
    for (const o of world.ogres) { const d = Math.hypot(o.x - fx, o.y - fy); if (d < bd) { bd = d; best = { obj: o, arr: world.ogres, dist: d }; } }
    return best;
}
// Creature auto-attacks any enemy within 5 m (runs regardless of current action)
let lastAttackNarrationAt = 0;
function enemyName(arr) { return arr === world.ogres ? 'ogre' : arr === world.goblins ? 'goblin' : arr === world.villagers ? 'villager' : 'enemy'; }
function narrateAttack(arr, now) { if (now - lastAttackNarrationAt >= 15000) { lastAttackNarrationAt = now; narratorSays('The creature attacks the ' + enemyName(arr) + '.'); } }
function creatureAutoAttack(now) {
    if (creature.dead) return;
    if (now < (creature.attackCd || 0)) return;
    const e = nearestEnemy(creature.x + 30, creature.y + 33, ATTACK_RANGE_PX);
    if (e) { damageEntity(e.obj, e.arr, CREATURE_ATTACK_DMG); creature.attackCd = now + CREATURE_ATTACK_MS; statusBox.innerText = 'Strikes an enemy!'; narrateAttack(e.arr, now); }
}

// ---- Attack command (melee version of burn) ----
function nearestEnemyOfType(type, x, y, maxPx) {
    let best = null, bd = maxPx;
    const scan = (arr) => { for (const o of arr) { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = { obj: o, arr, dist: d }; } } };
    if (type === 'goblin') scan(world.goblins);
    else if (type === 'ogre') scan(world.ogres);
    else { scan(world.goblins); scan(world.ogres); }
    return best;
}
function startAttackCampaign(type, now) {
    type = (type === 'ogre' || type === 'ogres') ? 'ogre' : (type === 'goblin' || type === 'goblins') ? 'goblin' : 'any';
    const first = nearestEnemyOfType(type, creature.x + 30, creature.y + 33, Infinity);
    if (!first) { statusBox.innerText = 'No enemies to attack.'; creature.act = 'free'; return; }
    creature.attackCampaign = { type, cur: null, arr: null, lastPos: null, nextHit: 0 };
    creature.act = 'attacking'; statusBox.innerText = 'On the warpath...';
}
function endAttackCampaign() { creature.attackCampaign = null; creature.act = 'free'; statusBox.innerText = 'Exploring.'; }
function updateAttackCampaign(dt, now) {
    const camp = creature.attackCampaign; if (!camp) { creature.act = 'free'; return; }
    if (!camp.cur || !camp.arr || camp.arr.indexOf(camp.cur) < 0) {
        const ref = camp.lastPos || { x: creature.x + 30, y: creature.y + 33 };
        const maxR = camp.lastPos ? GOBLIN_CHAIN_RANGE_PX : Infinity;
        const next = nearestEnemyOfType(camp.type, ref.x, ref.y, maxR);
        if (!next) { endAttackCampaign(); return; }
        camp.cur = next.obj; camp.arr = next.arr;
    }
    const o = camp.cur, d = Math.hypot(o.x - (creature.x + 30), o.y - (creature.y + 33));
    if (d > ATTACK_RANGE_PX) { stepCreatureToward(o.x, o.y, SEEK_SPEED_MPS * PIXELS_PER_METER * dt * runMult()); statusBox.innerText = 'Charging an enemy...'; }
    else if (now >= camp.nextHit) { statusBox.innerText = 'Attacking!'; narrateAttack(camp.arr, now); const dead = damageEntity(o, camp.arr, CREATURE_ATTACK_DMG); if (dead) { camp.lastPos = { x: o.x, y: o.y }; camp.cur = null; camp.arr = null; } camp.nextHit = now + CREATURE_ATTACK_MS; }
}

// ---- Eat crops: walk to a crop (within 5 m), eat it (heal 1 heart), wait 3 s, repeat ----
function nearestCrop(x, y) { let best = null, bd = Infinity; for (const c of world.crops) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = { obj: c, dist: d }; } } return best; }
function startEatCampaign(now) {
    if (!world.crops.length) { statusBox.innerText = 'No crops to eat.'; creature.act = 'free'; return; }
    creature.eatCampaign = { cur: null, nextBite: 0 };
    creature.act = 'eating'; statusBox.innerText = 'Off to eat some crops.';
}
function endEatCampaign() { creature.eatCampaign = null; creature.act = 'free'; statusBox.innerText = 'Exploring.'; }
function updateEatCampaign(dt, now) {
    const camp = creature.eatCampaign; if (!camp) { creature.act = 'free'; return; }
    if ((creature.hearts || 0) >= (creature.maxHearts || CREATURE_MAX_HEARTS)) { narratorSays('The creature is full.'); endEatCampaign(); return; }   // no point eating when full
    if (!camp.cur || world.crops.indexOf(camp.cur) < 0) {
        const next = nearestCrop(creature.x + 30, creature.y + 33);
        if (!next) { endEatCampaign(); return; }
        camp.cur = next.obj;
    }
    const o = camp.cur, d = Math.hypot(o.x - (creature.x + 30), o.y - (creature.y + 33));
    if (d > EAT_RANGE_PX) { stepCreatureToward(o.x, o.y, WANDER_SPEED_MPS * PIXELS_PER_METER * dt * runMult()); statusBox.innerText = 'Heading to a crop...'; }
    else if (now >= camp.nextBite) {
        const i = world.crops.indexOf(o); if (i >= 0) world.crops.splice(i, 1);                 // remove the eaten wheat
        creature.hearts = Math.min(creature.maxHearts || CREATURE_MAX_HEARTS, (creature.hearts || 0) + 1);   // +1 heart
        renderHearts(creature.hearts, creature.maxHearts || CREATURE_MAX_HEARTS);
        narratorSays('The creature eats some wheat. (+1 heart)');
        camp.cur = null; camp.nextBite = now + EAT_COOLDOWN_MS;                                  // 3 s between bites
        statusBox.innerText = 'Munching...';
    }
}

// ---- Left-click: send the creature to a point ----
function updateGoto(dt) {
    const g = creature.goto; if (!g) { creature.act = 'free'; return; }
    const d = Math.hypot(g.x - (creature.x + 30), g.y - (creature.y + 33));
    if (d < 24) { creature.goto = null; creature.act = 'free'; statusBox.innerText = 'Exploring.'; return; }
    stepCreatureToward(g.x, g.y, WANDER_SPEED_MPS * PIXELS_PER_METER * dt * runMult());
    statusBox.innerText = 'Walking over there.';
}

// ---- Ogres: idle near cave; charge & attack the creature when provoked ----
function leashWander(o, dt, now, leashPx, speedMps) {
    const sp = speedMps * PIXELS_PER_METER * dt;
    if (o.vstate === 'stopped') { if (now >= o.vUntil) { o.vstate = 'moving'; o.vUntil = now + (1000 + Math.random() * 2000); const dh = Math.hypot(o.x - o.home.x, o.y - o.home.y); o.heading = dh > leashPx * 0.75 ? Math.atan2(o.home.y - o.y, o.home.x - o.x) : Math.random() * 6.283; } return; }
    if (now >= o.vUntil) { o.vstate = 'stopped'; o.vUntil = now + (1000 + Math.random() * 2000); return; }
    const nx = o.x + Math.cos(o.heading) * sp, ny = o.y + Math.sin(o.heading) * sp;
    if (Math.hypot(nx - o.home.x, ny - o.home.y) > leashPx || isWater(nx, ny, 8)) { o.vstate = 'stopped'; o.vUntil = now + 800; o.heading = Math.atan2(o.home.y - o.y, o.home.x - o.x); } else { o.x = nx; o.y = ny; }
}
function updateOgres(dt, now) {
    const cx = creature.x + 30, cy = creature.y + 33;
    for (const o of world.ogres) {
        const dToCreature = Math.hypot(o.x - cx, o.y - cy);
        if (!creature.dead && (o.mode === 'charging' || dToCreature <= OGRE_AGGRO_PX || o.hearts < o.maxHearts)) {
            o.mode = 'charging';
            if (dToCreature > OGRE_CONTACT_PX) stepToward(o, cx, cy, m2px(OGRE_SPEED_MPS) * dt);
            else if (now >= o.attackCd) { damageCreature(OGRE_ATTACK_DMG); o.attackCd = now + OGRE_ATTACK_MS; }
        } else { leashWander(o, dt, now, m2px(20), 1.0); }
    }
}

// ---- Goblin huts: spawn home goblins, periodically send raiding parties ----
let goblinHutTimer = 0, raidTimer = 0, raidNext = 60, raidSize = 3;   // raids grow by 1 each time
function updateGoblinHuts(dt) {
    if (!world.goblinHuts.length) return;
    goblinHutTimer += dt;
    if (goblinHutTimer >= 120) {                                  // every 2 min, each hut spawns a home goblin
        goblinHutTimer = 0;
        for (const gh of world.goblinHuts) { if (world.goblins.length >= 120) break; world.goblins.push(makeGoblin(gh.x + 25 + (Math.random() * 30 - 15), gh.y + 25 + (Math.random() * 30 - 15), 'home', gh.town, world.goblinTowns[gh.town])); }
        updateLog("Goblin huts spawned new goblins.");
    }
    raidTimer += dt;
    if (raidTimer >= raidNext) {                                  // every 1-2 min, send a raiding party (grows each time)
        raidTimer = 0; raidNext = 60 + Math.random() * 60;
        let sentAny = false;
        for (let ti = 0; ti < world.goblinTowns.length; ti++) {
            const homies = world.goblins.filter(g => g.mode === 'home' && g.group === ti);
            const n = Math.min(homies.length, raidSize);
            for (let i = 0; i < n; i++) { homies[i].mode = 'raid'; homies[i].home = null; }
            if (n) sentAny = true;
        }
        if (sentAny) { updateLog("A goblin raiding party of " + raidSize + " set out!"); raidSize++; }   // +1 next time
    }
}

function updateGoblins(dt) {
    const base = GOBLIN_SPEED_MPS * PIXELS_PER_METER * dt, charge = base * 2;
    world.goblinGroups.forEach(g => {
        if (g.heading === undefined) g.heading = Math.random() * Math.PI * 2;
        if (g.turnTimer === undefined || g.turnTimer <= 0) { g.heading += (Math.random() - 0.5) * 0.6; g.turnTimer = 120 + Math.random() * 240; }
        g.turnTimer--;
        const nx = g.x + Math.cos(g.heading) * base, ny = g.y + Math.sin(g.heading) * base;
        if (nx < 40 || nx > WORLD_W - 40 || ny < 40 || ny > WORLD_H - 40 || isWater(nx, ny, 10)) g.heading += Math.PI * (0.6 + Math.random() * 0.5); else { g.x = nx; g.y = ny; }
        g.x = clamp(g.x, 40, WORLD_W - 40); g.y = clamp(g.y, 40, WORLD_H - 40);
    });
    const cx = creature.x + 30, cy = creature.y + 33, now = Date.now();
    for (const gob of world.goblins) {
        const dCre = Math.hypot(gob.x - cx, gob.y - cy);
        if (!creature.dead && dCre <= GOBLIN_AGGRO_PX) {                 // within 50 m: always charge & attack the creature
            if (dCre > GOBLIN_CONTACT_PX) stepToward(gob, cx, cy, charge);
            else if (now >= (gob.attackCd || 0)) { if (Math.random() < 0.5) damageCreature(GOBLIN_HIT_DMG); gob.attackCd = now + GOBLIN_ATTACK_MS; }
        } else if (gob.mode === 'home' && gob.home) {                    // home goblins idle near their huts
            leashWander(gob, dt, now, m2px(20), GOBLIN_SPEED_MPS * 0.6);
        } else {                                                          // raiders: hunt villagers/huts, else march
            const v = nearestIn(world.villagers, gob.x, gob.y, GOBLIN_DETECT_PX);
            const h = v ? null : nearestIn(world.huts, gob.x, gob.y, GOBLIN_DETECT_PX);
            if (v) { stepToward(gob, v.obj.x, v.obj.y, charge); if (v.dist < GOBLIN_CONTACT_PX) damageEntity(v.obj, world.villagers, 1); }
            else if (h) { stepToward(gob, h.obj.x + 25, h.obj.y + 25, charge); if (Math.hypot(gob.x - (h.obj.x + 25), gob.y - (h.obj.y + 25)) < GOBLIN_CONTACT_PX) { const i = world.huts.indexOf(h.obj); if (i >= 0) { world.huts.splice(i, 1); world.ashes.push(makeAshes(h.obj.x + 25, h.obj.y + 25)); } } }
            else { const a = world.goblinGroups[gob.group] || { x: gob.x, y: gob.y }; stepToward(gob, a.x + (gob.ox || 0), a.y + (gob.oy || 0), base); }
        }
        gob.x = clamp(gob.x, 6, WORLD_W - 6); gob.y = clamp(gob.y, 6, WORLD_H - 6);
    }
    // Separation: keep goblins from standing on top of one another
    const MIN_SEP = 16, gs = world.goblins;
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
        const a = gs[i], b = gs[j]; let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d === 0) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d = Math.hypot(dx, dy) || 1; }
        if (d < MIN_SEP) {
            const push = (MIN_SEP - d) / 2, ux = dx / d, uy = dy / d;
            a.x = clamp(a.x - ux * push, 6, WORLD_W - 6); a.y = clamp(a.y - uy * push, 6, WORLD_H - 6);
            b.x = clamp(b.x + ux * push, 6, WORLD_W - 6); b.y = clamp(b.y + uy * push, 6, WORLD_H - 6);
        }
    }
}

// ===========================================================
//  ACTIONS
// ===========================================================
function makeAshes(x, y) { const specks = []; for (let k = 0; k < 6; k++) specks.push({ dx: Math.random() * 18 - 9, dy: Math.random() * 8 - 4 }); return { x, y, born: Date.now(), specks }; }
function normalizeTarget(t) { if (!t) return 'any'; t = String(t).toLowerCase(); const map = { trees: 'tree', villagers: 'villager', huts: 'hut', house: 'hut', home: 'hut', crops: 'crop', goblins: 'goblin', ogres: 'ogre', something: 'any', anything: 'any', nearest: 'any' }; return map[t] || t; }
function findNearestBurnable(targetType) { const pools = { tree: world.trees, villager: world.villagers, hut: world.huts, crop: world.crops, goblin: world.goblins, ogre: world.ogres }; const entries = pools[targetType] ? [[targetType, pools[targetType]]] : Object.entries(pools); const cx = creature.x + 30, cy = creature.y + 33; let best = null, bd = Infinity; for (const [type, arr] of entries) for (const o of arr) { const d = Math.hypot(o.x - cx, o.y - cy); if (d < bd) { bd = d; best = { type, arr, obj: o }; } } return best; }
function spawnFireballAt(o, arr) {
    world.fireballs.push({ x: creature.x + 30, y: creature.y + 33, targetX: o.x, targetY: o.y });
    const living = (arr === world.villagers || arr === world.goblins || arr === world.ogres);
    setTimeout(() => {
        if (arr.indexOf(o) < 0) return;
        if (living) damageEntity(o, arr, FIRE_BASE_DMG);                 // respects hearts (ogres take 2 hits)
        else { const i = arr.indexOf(o); const rem = arr.splice(i, 1)[0]; world.ashes.push(makeAshes(rem.x, rem.y)); }
    }, 800);
}

// Burn: ALWAYS walk up close, then throw from within range.
function performBurn(targetType) {
    targetType = normalizeTarget(targetType);
    const target = findNearestBurnable(targetType);
    if (!target) { statusBox.innerText = `Nothing to burn.`; return; }
    creature.burnGoal = target; creature.act = 'seeking'; statusBox.innerText = "Walking up to burn...";
}
function seekStep(dt) {
    const g = creature.burnGoal;
    if (!g || g.arr.indexOf(g.obj) < 0) { creature.burnGoal = null; creature.act = 'free'; statusBox.innerText = "Exploring."; return; }
    const d = Math.hypot(g.obj.x - (creature.x + 30), g.obj.y - (creature.y + 33));
    if (d <= BURN_APPROACH_PX) { creature.burnGoal = null; creature.act = 'busy'; statusBox.innerText = "Casting Fireball!"; spawnFireballAt(g.obj, g.arr); setTimeout(() => { creature.act = 'free'; statusBox.innerText = "Exploring."; }, FIREBALL_COOLDOWN_MS); return; }
    stepCreatureToward(g.obj.x, g.obj.y, SEEK_SPEED_MPS * PIXELS_PER_METER * dt * runMult());
}
function castGrow() { if (!world.trees.length) return; creature.act = 'busy'; statusBox.innerText = "Growing nature!"; world.trees.push({ x: world.trees[0].x + (Math.random() * 40 - 20), y: world.trees[0].y + (Math.random() * 40 - 20) }); setTimeout(() => { creature.act = 'free'; statusBox.innerText = "Exploring."; }, 2000); }
function castSpreadHuts() { creature.act = 'busy'; statusBox.innerText = "Spreading huts!"; if (world.huts.length) { for (let a = 0; a < 16; a++) { const base = world.huts[Math.floor(Math.random() * world.huts.length)]; const hx = base.x + (Math.random() * 160 - 80), hy = base.y + (Math.random() * 160 - 80); if (canPlaceHut(hx, hy)) { world.huts.push({ x: hx, y: hy, vseed: Math.random() }); break; } } } setTimeout(() => { creature.act = 'free'; statusBox.innerText = "Exploring."; }, 2000); }

// Goblin burn chain
// Shared village crop field: a rectangular grid south of the village center, filled row by row.
// All villagers of a village target the SAME field, so they collectively fill neat rows/columns.
const FIELD_COLS = 10, FIELD_ROWS = 6;   // ~half the old 14x9 field
function cellBlocked(x, y) {
    if (isWater(x, y, 6)) return true;
    for (const h of world.huts) if (Math.hypot((h.x + 25) - x, (h.y + 25) - y) < 32) return true;
    for (const t of world.trees) if (Math.hypot((t.x + 17) - x, (t.y + 22) - y) < 22) return true;
    for (const w of world.wells) if (Math.hypot(w.x - x, w.y - y) < 26) return true;
    for (const s of world.signs) if (Math.hypot(s.x - x, s.y - y) < 18) return true;
    for (const c of world.caves) if (Math.hypot(c.x - x, c.y - y) < 30) return true;
    for (const sh of world.shrines) if (Math.hypot(sh.x - x, sh.y - y) < 24) return true;
    return false;
}
function nextCropCell(center) {
    if (!center) return null;
    const S = CROP_SPACING;
    const startX = center.x - ((FIELD_COLS - 1) / 2) * S;   // centered horizontally on the village
    const startY = center.y + 55;                            // field begins just south of the village
    for (let r = 0; r < FIELD_ROWS; r++) for (let c = 0; c < FIELD_COLS; c++) {
        const x = startX + c * S, y = startY + r * S;
        let taken = false; for (const cr of world.crops) if (Math.abs(cr.x - x) < S * 0.5 && Math.abs(cr.y - y) < S * 0.5) { taken = true; break; }
        if (taken) continue;
        if (cellBlocked(x, y)) continue;                     // don't plant over huts, trees, wells, etc.
        return { x, y };
    }
    return null;   // field full
}

// Burn-spree campaign: chain-burn a bunch of one target type (or "any")
function burnablePools() { return { tree: world.trees, villager: world.villagers, hut: world.huts, crop: world.crops, goblin: world.goblins, ogre: world.ogres }; }
function nearestBurnable(type, x, y, maxPx) {
    const pools = burnablePools();
    const entries = (type && type !== 'any' && pools[type]) ? [[type, pools[type]]] : Object.entries(pools);
    let best = null, bd = maxPx;
    for (const [t, arr] of entries) for (const o of arr) { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = { type: t, arr, obj: o, dist: d }; } }
    return best;
}
function startBurnCampaign(type, now, resumeGuard) {
    type = normalizeTarget(type);
    const first = nearestBurnable(type, creature.x + 30, creature.y + 33, Infinity);
    if (!first) { statusBox.innerText = 'Nothing to burn.'; if (resumeGuard && creature.guard) creature.act = 'guarding'; else creature.act = 'free'; return; }
    creature.burnCampaign = { type, currentTarget: null, currentArr: null, lastTargetPos: null, nextThrowReady: 0 };
    creature.resumeGuard = !!resumeGuard; creature.act = 'burning';
    statusBox.innerText = type === 'goblin' ? 'Hunting goblins...' : 'On a burning spree...';
}
function endBurnCampaign() { creature.burnCampaign = null; if (creature.resumeGuard && creature.guard) { creature.act = 'guarding'; statusBox.innerText = 'Guarding the village.'; } else { creature.act = 'free'; creature.resumeGuard = false; statusBox.innerText = 'Exploring.'; } }
function updateBurnCampaign(dt, now) {
    const camp = creature.burnCampaign; if (!camp) { creature.act = 'free'; return; }
    if (!camp.currentTarget || !camp.currentArr || camp.currentArr.indexOf(camp.currentTarget) < 0) {
        const ref = camp.lastTargetPos || { x: creature.x + 30, y: creature.y + 33 };
        const maxR = camp.lastTargetPos ? GOBLIN_CHAIN_RANGE_PX : Infinity;   // first target anywhere, then chain within 50 m
        const next = nearestBurnable(camp.type, ref.x, ref.y, maxR);
        if (!next) { endBurnCampaign(); return; }
        camp.currentTarget = next.obj; camp.currentArr = next.arr;
    }
    const o = camp.currentTarget, d = Math.hypot(o.x - (creature.x + 30), o.y - (creature.y + 33));
    if (d > BURN_APPROACH_PX) { stepCreatureToward(o.x, o.y, SEEK_SPEED_MPS * PIXELS_PER_METER * dt * runMult()); statusBox.innerText = camp.type === 'goblin' ? 'Hunting goblins...' : 'Hunting a target...'; }
    else if (now >= camp.nextThrowReady) { statusBox.innerText = 'Burning!'; spawnFireballAt(o, camp.currentArr); camp.lastTargetPos = { x: o.x, y: o.y }; camp.currentTarget = null; camp.currentArr = null; camp.nextThrowReady = now + FIREBALL_COOLDOWN_MS; }
    else statusBox.innerText = 'Reloading...';
}

// Guard the village
function startGuard(now) {
    if (!world.huts.length) { statusBox.innerText = 'No village to guard.'; narratorSays('There is no village to guard.'); creature.act = 'free'; return; }
    const best = nearestHutCenter(creature.x + 30, creature.y + 33);
    creature.guard = { anchor: best, heading: Math.random() * Math.PI * 2, patrolUntil: 0 };
    creature.act = 'guarding'; statusBox.innerText = 'Heading to the village.';
}
function updateGuard(dt, now) {
    const g = creature.guard; if (!g) { creature.act = 'free'; return; }
    const enemy = nearestIn(world.goblins, creature.x + 30, creature.y + 33, GUARD_ENEMY_RANGE_PX);
    if (enemy) { startBurnCampaign('goblin', now, true); return; }
    const d = Math.hypot(g.anchor.x - (creature.x + 30), g.anchor.y - (creature.y + 33));
    if (d > m2px(8)) { stepCreatureToward(g.anchor.x, g.anchor.y, WANDER_SPEED_MPS * PIXELS_PER_METER * dt * runMult()); statusBox.innerText = 'Heading to the village.'; }
    else {
        if (now >= g.patrolUntil) { g.heading = Math.random() * Math.PI * 2; g.patrolUntil = now + (1000 + Math.random() * 2000); statusBox.innerText = 'Guarding the village.'; }
        const sp = WANDER_SPEED_MPS * 0.1 * PIXELS_PER_METER * dt * runMult();
        const nx = creature.x + Math.cos(g.heading) * sp, ny = creature.y + Math.sin(g.heading) * sp;
        if (Math.hypot((nx + 30) - g.anchor.x, (ny + 33) - g.anchor.y) < m2px(12) && !isWater(nx + 30, ny + 60, 12)) { creature.x = nx; creature.y = ny; } else g.heading += Math.PI;
    }
}

// ---- Shared Gemini call: rotates keys, thinking OFF, JSON output, robust parsing ----
let apiInFlight = 0;
async function callGemini(taskText, maxTokens = 800) {
    if (!apiKeys.length) throw new Error('no API key — click "Keys" in the pause menu (ESC)');
    const body = {
        systemInstruction: { parts: [{ text: buildPersona() }] },
        contents: [{ role: "user", parts: [{ text: taskText }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: maxTokens, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } }
    };
    apiInFlight++;
    try {
        let lastErr = null;
        for (let attempt = 0; attempt < apiKeys.length; attempt++) {       // try each key once
            const key = apiKeys[keyIndex % apiKeys.length];
            keyCallCounts[key] = (keyCallCounts[key] || 0) + 1;            // track usage per key (this session)
            keyIndex = (keyIndex + 1) % apiKeys.length;                     // round-robin for next call/retry
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
            const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            if (!res.ok) {
                let detail = ""; try { detail = (await res.json())?.error?.message || ""; } catch (e) { }
                if (res.status === 429 || res.status === 403 || (res.status === 400 && /api[_ ]?key/i.test(detail))) {
                    lastErr = new Error(res.status === 429 ? "rate limited (429)" : "key rejected (" + res.status + ")");
                    continue;                                               // bad/limited key -> try the next one
                }
                throw new Error(`HTTP ${res.status}${detail ? " — " + detail.slice(0, 120) : ""}`);
            }
            const data = await res.json();
            if (data.promptFeedback && data.promptFeedback.blockReason) throw new Error("blocked: " + data.promptFeedback.blockReason);
            const cand = data.candidates && data.candidates[0];
            const parts = (cand && cand.content && cand.content.parts) || [];
            const txt = parts.map(p => p.text || "").join("").trim();
            if (!txt) throw new Error("empty reply" + (cand && cand.finishReason ? " (" + cand.finishReason + ")" : ""));
            return txt.replace(/```json|```/g, "").trim();
        }
        throw new Error((lastErr ? lastErr.message : "all keys failed") + " — all " + apiKeys.length + " key(s) exhausted");
    } finally { apiInFlight--; }
}

// Villager interaction
function finishInteraction() { creature.act = 'free'; creature.interactCooldown = Date.now() + INTERACT_COOLDOWN_MS; statusBox.innerText = "Exploring."; }
function startVillagerInteraction(v) { creature.act = 'busy'; statusBox.innerText = "Bothering a villager."; doVillagerInteraction(v); }
// Fully scripted — villagers never touch the Gemini API. Output is narration (the creature DID something).
function doVillagerInteraction(v) {
    const lines = {
        speak: ['The creature leans down and mutters something to a villager.', 'The creature rumbles a few words at a tiny villager.'],
        eat: ['The creature scoops up a villager and eats them. Crunch.', 'The creature swallows a villager whole.'],
        hug: ['The creature wraps a villager in a giant, slightly crushing hug.', 'The creature gives a villager an enormous hug.'],
        slap: ['The creature slaps a villager flat. Rude.', 'The creature bats a villager over with one paw.'],
        fart: ['The creature turns and farts on a villager.', 'The creature unleashes a thunderous fart on a villager.']
    };
    const acts = Object.keys(lines);
    const a = acts[Math.floor(Math.random() * acts.length)];
    const pool = lines[a]; narratorSays(pool[Math.floor(Math.random() * pool.length)]);
    if (a === 'eat') { const i = world.villagers.indexOf(v); if (i >= 0) world.villagers.splice(i, 1); }
    finishInteraction();
}

// ===========================================================
//  DRAW
// ===========================================================
function drawTree(t) { if (imgReady('tree')) { ctx.drawImage(images.tree, t.x, t.y, 35, 45); return; } ctx.fillStyle = '#6b4226'; ctx.fillRect(t.x + 14, t.y + 28, 7, 17); ctx.fillStyle = '#2e6b2e'; ctx.beginPath(); ctx.moveTo(t.x + 17, t.y); ctx.lineTo(t.x + 34, t.y + 32); ctx.lineTo(t.x, t.y + 32); ctx.closePath(); ctx.fill(); }
function drawHut(h) { const img = variantImg('hut', h.vseed); if (img) { ctx.drawImage(img, h.x, h.y, 50, 50); return; } ctx.fillStyle = '#caa472'; ctx.fillRect(h.x + 6, h.y + 22, 38, 28); ctx.fillStyle = '#8a3b2a'; ctx.beginPath(); ctx.moveTo(h.x + 25, h.y); ctx.lineTo(h.x + 50, h.y + 24); ctx.lineTo(h.x, h.y + 24); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#5a3a22'; ctx.fillRect(h.x + 20, h.y + 34, 11, 16); }
function drawVillager(v) { const sc = v.baby ? BABY_SCALE : 1, w = 16 * sc, h = 24 * sc; if (imgReady('villager')) { ctx.drawImage(images.villager, v.x, v.y, w, h); return; } ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(v.x + w / 2, v.y + 5 * sc, 5 * sc, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#3b6fb0'; ctx.fillRect(v.x + 3 * sc, v.y + 10 * sc, 10 * sc, 14 * sc); }
function drawWheat(c) { const img = variantImg('wheat', c.vseed); if (img) { ctx.drawImage(img, c.x - 12, c.y - 12, 24, 24); return; } ctx.strokeStyle = '#d8b13a'; ctx.lineWidth = 2; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(c.x + i * 5, c.y + 8); ctx.lineTo(c.x + i * 5, c.y - 6); ctx.stroke(); } }
function drawShrine(s) { const img = variantImg('shrine', s.vseed); if (img) ctx.drawImage(img, s.x - 6, s.y - 12, 44, 50); /* no yellow placeholder */ }
function drawWell(w) { const img = variantImg('well', w.vseed); if (img) { ctx.drawImage(img, w.x - 22, w.y - 26, 44, 48); return; } ctx.fillStyle = '#777'; ctx.beginPath(); ctx.arc(w.x, w.y, 16, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#2b5b86'; ctx.beginPath(); ctx.arc(w.x, w.y, 9, 0, Math.PI * 2); ctx.fill(); }
function drawSign(s) { const img = variantImg('sign', s.vseed); if (img) { ctx.drawImage(img, s.x - 14, s.y - 24, 28, 30); return; } ctx.fillStyle = '#6b4226'; ctx.fillRect(s.x - 2, s.y - 8, 4, 16); ctx.fillStyle = '#caa472'; ctx.fillRect(s.x - 12, s.y - 22, 24, 14); }
function drawCave(c) { const img = variantImg('cave', c.vseed); if (img) { ctx.drawImage(img, c.x - 28, c.y - 30, 56, 56); return; } ctx.fillStyle = '#5a5560'; ctx.beginPath(); ctx.arc(c.x, c.y, 26, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#15131a'; ctx.beginPath(); ctx.arc(c.x, c.y, 14, Math.PI, 0); ctx.fill(); }
function drawGoblin(g) { if (imgReady('goblin')) { ctx.drawImage(images.goblin, g.x - 8, g.y - 11, 16, 22); return; } ctx.fillStyle = '#5a7d3a'; ctx.beginPath(); ctx.arc(g.x, g.y - 4, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#3f5a28'; ctx.fillRect(g.x - 4, g.y, 8, 10); }
function drawOgre(o) { const img = variantImg('ogre', o.vseed); if (img) { ctx.drawImage(img, o.x - 22, o.y - 30, 48, 54); return; } ctx.fillStyle = '#6b6f4a'; ctx.beginPath(); ctx.arc(o.x, o.y - 8, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#4d5136'; ctx.fillRect(o.x - 9, o.y, 18, 22); }
function drawGoblinHut(h) { const img = variantImg('goblin_hut', h.vseed); if (img) { ctx.drawImage(img, h.x, h.y, 50, 50); return; } ctx.fillStyle = '#3a4a2a'; ctx.fillRect(h.x + 6, h.y + 22, 38, 28); ctx.fillStyle = '#26331c'; ctx.beginPath(); ctx.moveTo(h.x + 25, h.y); ctx.lineTo(h.x + 50, h.y + 24); ctx.lineTo(h.x, h.y + 24); ctx.closePath(); ctx.fill(); }
let hoveredEntity = null, hoveredMax = 1;
function drawFireball(f) { if (imgReady('fireball')) { ctx.drawImage(images.fireball, f.x - 12, f.y - 12, 25, 25); return; } const g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, 13); g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ff8c1a'); g.addColorStop(1, 'rgba(200,40,0,0.1)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 13, 0, Math.PI * 2); ctx.fill(); }
function drawAshes(a) { const age = Date.now() - a.born; const alpha = age > (ASH_LIFETIME_MS - ASH_FADE_MS) ? Math.max(0, (ASH_LIFETIME_MS - age) / ASH_FADE_MS) : 1; ctx.globalAlpha = alpha; if (imgReady('ashes')) ctx.drawImage(images.ashes, a.x - 12, a.y - 8, 26, 18); else { ctx.fillStyle = '#3b3b3b'; ctx.beginPath(); ctx.ellipse(a.x, a.y, 12, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#666'; (a.specks || []).forEach(s => ctx.fillRect(a.x + s.dx, a.y + s.dy, 2, 2)); } ctx.globalAlpha = 1; }
function drawCreature() { if (creature.dead) ctx.globalAlpha = 0.35; if (imgReady('creature')) ctx.drawImage(images.creature, creature.x, creature.y, 60, 66); else { ctx.fillStyle = '#e8902a'; ctx.fillRect(creature.x, creature.y, 60, 66); } ctx.globalAlpha = 1; }
function visible(x, y, pad = 80) { const vw = canvas.width / zoom, vh = canvas.height / zoom; return x > camera.x - pad && x < camera.x + vw + pad && y > camera.y - pad && y < camera.y + vh + pad; }

let lastTs = null;
function renderScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.scale(zoom, zoom); ctx.translate(-camera.x, -camera.y);
    const vw = canvas.width / zoom, vh = canvas.height / zoom;
    ctx.fillStyle = grassPattern || '#4f8f43'; ctx.fillRect(camera.x, camera.y, vw, vh);
    ctx.strokeStyle = '#2c5a26'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
    if (waterCanvas) { const sw = Math.min(vw, WORLD_W - camera.x), sh = Math.min(vh, WORLD_H - camera.y); if (sw > 0 && sh > 0) ctx.drawImage(waterCanvas, camera.x, camera.y, sw, sh, camera.x, camera.y, sw, sh); }
    world.caves.forEach(c => { if (visible(c.x, c.y)) drawCave(c); });
    world.goblinHuts.forEach(h => { if (visible(h.x, h.y)) drawGoblinHut(h); });
    world.ashes.forEach(a => { if (visible(a.x, a.y)) drawAshes(a); });
    world.shrines.forEach(s => { if (visible(s.x, s.y)) drawShrine(s); });
    world.crops.forEach(c => { if (visible(c.x, c.y)) drawWheat(c); });
    world.huts.forEach(h => { if (visible(h.x, h.y)) drawHut(h); });
    world.wells.forEach(w => { if (visible(w.x, w.y)) drawWell(w); });
    world.signs.forEach(s => { if (visible(s.x, s.y)) drawSign(s); });
    world.trees.forEach(t => { if (visible(t.x, t.y)) drawTree(t); });
    world.villagers.forEach(v => { if (visible(v.x, v.y)) drawVillager(v); });
    world.ogres.forEach(o => { if (visible(o.x, o.y)) drawOgre(o); });
    world.goblins.forEach(g => { if (visible(g.x, g.y)) drawGoblin(g); });
    world.fireballs.forEach(f => drawFireball(f));
    drawCreature();
    if (hoveredEntity && hoveredEntity.hearts !== undefined) drawMiniHearts(hoveredEntity.x, hoveredEntity.y - 28, hoveredEntity.hearts, hoveredEntity.maxHearts || hoveredMax);
    if (!creature.dead) eraseFog(creature.x + 30, creature.y + 33);        // uncover around the creature (permanent)
    if (!fogReveal && fogCanvas) ctx.drawImage(fogCanvas, 0, 0, fogCanvas.width, fogCanvas.height, 0, 0, WORLD_W, WORLD_H);
    ctx.restore();
}
function draw(ts) {
    if (isPaused) return;
    if (lastTs == null) lastTs = ts || 0;
    let dt = ((ts || 0) - lastTs) / 1000; lastTs = ts || 0; if (dt > 0.05 || dt < 0) dt = 0.05;
    const now = Date.now();

    updateCamera();
    renderScene();

    if (!chatPaused) {                                  // "pause when chatting": freeze the sim, keep rendering
        updateVillagers(dt, now);
        updateReproduction(dt);
        updateHutGrowth(dt);
        updateCreature(dt, now);
        updateProjectiles();
        updateGoblins(dt);
        updateOgres(dt, now);
        updateGoblinHuts(dt);
        updateAshes();
        updateStamina(dt);
        if ((frameCount = (frameCount + 1) % 60) === 0) maybeSpawnWell();   // check for new cities ~1x/sec
    }
    updateCharge();
    requestAnimationFrame(draw);
}
let frameCount = 0;

// ===========================================================
//  GEMINI (commands)
// ===========================================================
async function sendCommandToGemini(userMessage, key) {
    if (!apiKeys.length) { narratorSays('No API key set — open the pause menu (ESC) and click "Keys" to add one.'); return; }
    key = key || normalizeCmd(userMessage);
    statusBox.innerText = "Thinking..."; updateLog(`Command -> brain: "${userMessage}"`);
    const worldSummary = { trees: world.trees.length, huts: world.huts.length, villagers: world.villagers.length, crops: world.crops.length, goblins: world.goblins.length, shrines: world.shrines.length };
    const taskPrompt =
`The player just said: "${userMessage}".

World summary (counts): ${JSON.stringify(worldSummary)}

You are a fire-throwing tiger. Choose ONE action:
- "burn": walk right up to the nearest matching thing and fireball it ONCE. Set "target": "tree","villager","hut","crop","goblin","any". Maps: "burn a <thing>","burn that <thing>","throw a fireball","torch it","incinerate <thing>".
- "burn_many": go on a burning spree — fireball a bunch of the SAME kind of thing one after another. Set "target" to the kind. Maps: "burn some <things>","burn the <things>","burn a bunch of <things>","clear the <things>","kill the <things>","burn goblins","burn some goblins". For a general rampage use target "any".
- "run": move at double speed (uses stamina). Maps: "run","hurry","go faster","move faster","sprint","pick up the pace".
- "stop_running": stop running but keep doing the rest. Maps: "slow down","don't rush","ease up","walk".
- "guard": go to the nearest village and patrol it, auto-attacking goblins that come near. Maps: "guard the village","defend the village","protect the town".
- "attack": walk up to the nearest enemy and melee it. Set "target": "goblin","ogre","any". Maps: "attack a goblin","fight the ogre","kill that goblin".
- "attack_many": go melee a bunch of enemies one after another. Set "target". Maps: "attack some goblins","attack the goblins","fight the ogres","kill the goblins".
- "eat_crops": graze nearby wheat to heal (1 heart each). Maps: "eat crops","eat some wheat","graze","go eat".
- "stop": cancel whatever the creature is doing. Maps: "stop","cancel","halt","that's enough","nevermind".
- "grow": grow more nature.   - "spread_huts": add a hut.   - "speak": only talk.   - "idle": do nothing.

Your "speech" MUST be in your established voice/personality.

Respond ONLY with raw JSON (no fences):
{"action":"burn|burn_many|attack|attack_many|eat_crops|run|stop_running|guard|stop|grow|spread_huts|speak|idle","target":"tree|villager|hut|crop|goblin|ogre|any|null","speech":"in-character line","shortStatusText":"1-6 words"}`;
    try {
        const d = JSON.parse(await callGemini(taskPrompt));
        refineAction(d, userMessage);                    // make "burn/attack some X" deterministic
        if (d.speech) creatureSays(d.speech, true);
        executeAction(d.action, d.target);
        if (d.shortStatusText && d.action !== 'stop') statusBox.innerText = d.shortStatusText;
        // Remember this exact command. After 3 API translations it becomes a "rerun command".
        const prev = rerunMemory[key] || { count: 0 };
        rerunMemory[key] = { action: d.action, target: d.target || null, speech: d.speech || '', count: (prev.count || 0) + 1, lastUsed: Date.now() };
        saveRerunMemory();
        logAiCommand(userMessage, d.action, activeVoice, d.speech || '');   // record non-canned input for later curation
    } catch (error) {
        console.error("API Error:", error);
        updateLog("Gemini error: " + error.message);
        narratorSays("Can't reach the creature's brain right now — " + error.message);
        if (statusBox.innerText === "Thinking...") statusBox.innerText = "Exploring.";
    }
}

// Run a parsed action (shared by fresh API replies and cached rerun commands)
function executeAction(action, target) {
    switch (action) {
        case "burn": performBurn(target); break;
        case "burn_many": startBurnCampaign(target || 'any', Date.now(), false); break;
        case "burn_goblins": startBurnCampaign('goblin', Date.now(), false); break;  // legacy alias
        case "attack": case "attack_many": startAttackCampaign(target || 'any', Date.now()); break;
        case "eat_crops": case "eat": startEatCampaign(Date.now()); break;
        case "run": startRunning(); break;
        case "stop_running": stopRunning(); break;
        case "guard": startGuard(Date.now()); break;
        case "stop": cancelAll(); break;
        case "grow": castGrow(); break;
        case "spread_huts": castSpreadHuts(); break;
    }
}

// ---- Rerun command memory (durable: localStorage) ----
let rerunMemory = {};
function loadRerunMemory() { try { rerunMemory = JSON.parse(localStorage.getItem('rerunCommands') || '{}') || {}; } catch (e) { rerunMemory = {}; } }
function saveRerunMemory() { try { localStorage.setItem('rerunCommands', JSON.stringify(rerunMemory)); } catch (e) { } }
function normalizeCmd(s) { return s.trim().toLowerCase().replace(/\s+/g, ' '); }

// Deterministic burn parsing so the LLM's single/multi choice can't get "burn some huts" wrong.
function burnIntent(text) {
    const t = (text || '').toLowerCase();
    if (!/\b(burn|torch|incinerate|set\s+(?:fire|aflame)|light\b.*\bon fire|blow up|firebomb)\b/.test(t)) return null;
    const many = /\b(some|several|a few|a bunch of|bunch|all|every|everything|lots of|loads of|many|the\s+\w+s\b)\b/.test(t)
        || /\b(trees|huts|houses|homes|villagers|peasants|people|crops|goblins|ogres)\b/.test(t);
    let type = null;
    if (/\btrees?\b/.test(t)) type = 'tree';
    else if (/\b(huts?|houses?|homes?)\b/.test(t)) type = 'hut';
    else if (/\b(villagers?|peasants?|people|humans?)\b/.test(t)) type = 'villager';
    else if (/\bcrops?\b/.test(t)) type = 'crop';
    else if (/\bgoblins?\b/.test(t)) type = 'goblin';
    else if (/\bogres?\b/.test(t)) type = 'ogre';
    return { many, type };
}
function applyBurnIntent(d, text) {
    const bi = burnIntent(text);
    if (!bi) return d;
    d.action = bi.many ? 'burn_many' : 'burn';
    if (bi.type) d.target = bi.type;
    else if (!d.target) d.target = 'any';
    return d;
}
// Deterministic attack parsing (melee version of burn).
function attackIntent(text) {
    const t = (text || '').toLowerCase();
    if (!/\b(attack|fight|kill|smash|maul|claw|bash|slay|beat up|punch)\b/.test(t)) return null;
    const many = /\b(some|several|a few|a bunch of|bunch|all|every|lots of|many|the\s+\w+s\b|goblins|ogres)\b/.test(t);
    let type = null;
    if (/\bogres?\b/.test(t)) type = 'ogre';
    else if (/\bgoblins?\b/.test(t)) type = 'goblin';
    else if (/\bogres?\b/.test(t)) type = 'ogre';
    return { many, type };
}
function applyAttackIntent(d, text) { const ai = attackIntent(text); if (!ai) return false; d.action = ai.many ? 'attack_many' : 'attack'; d.target = ai.type || 'any'; return true; }
function refineAction(d, text) { if (applyAttackIntent(d, text)) return d; applyBurnIntent(d, text); return d; }

// ---- AI command log: every NON-canned input + the personality + AI response, grouped by action ----
let aiCommandLog = {};
function loadAiLog() { try { aiCommandLog = JSON.parse(localStorage.getItem('aiCommandLog') || '{}') || {}; } catch (e) { aiCommandLog = {}; } }
function saveAiLog() { try { localStorage.setItem('aiCommandLog', JSON.stringify(aiCommandLog)); } catch (e) { } }
function logAiCommand(input, action, voice, response) {
    const k = action || 'idle'; if (!aiCommandLog[k]) aiCommandLog[k] = [];
    const norm = normalizeCmd(input);
    const existing = aiCommandLog[k].find(e => normalizeCmd(e.input) === norm && e.voice === voice);
    if (existing) { existing.count = (existing.count || 1) + 1; existing.response = response; }
    else aiCommandLog[k].push({ input, voice, response, count: 1 });
    saveAiLog();
}

// Run a canned command (exact match from canned.txt) — NO API CALL
function runCanned(cmd, headerAction) {
    const d = { action: headerAction, target: null };
    refineAction(d, cmd);                             // burn/attack lines derive precise action+target from their text
    const action = d.action, target = d.target;
    const resp = cannedResponse(activeVoice, action); // personality's canned line for this action, if any
    if (resp) creatureSays(resp);                     // canned speech: red, NO star (no API)
    else narratorSays("The creature obeys.");         // fallback when CreatureVoice.txt has none
    executeAction(action, target);
}

// Entry point for every typed command
function processCommand(cmd) {
    if (handleControl(cmd)) return;                     // voice / stop / slow-down: instant, client-side
    const key = normalizeCmd(cmd);
    if (cannedCommands[key]) { runCanned(cmd, cannedCommands[key]); return; }   // canned.txt exact match -> NO API
    const mem = rerunMemory[key];
    if (mem && mem.count >= 3 && mem.action) {           // repeated non-canned command -> skip the API too
        narratorSays("The creature obeys.");
        const act = { action: mem.action, target: mem.target };
        refineAction(act, cmd);
        executeAction(act.action, act.target);
        mem.count++; mem.lastUsed = Date.now(); saveRerunMemory();
        return;
    }
    sendCommandToGemini(cmd, key);                       // not canned, not cached -> API (and gets logged)
}

// ===========================================================
//  UI WRITERS
// ===========================================================
function updateLog(message) { actionLog.innerHTML += `<p>&gt; ${message}</p>`; actionLog.scrollTop = actionLog.scrollHeight; }
function playerSays(message) { chatHistory.innerHTML += `<p style="color: yellow;">You: ${escapeHtml(message)}</p>`; chatHistory.scrollTop = chatHistory.scrollHeight; }
function creatureSays(message, fromApi) { const star = fromApi ? '<span title="Gemini API call" style="color:#ffd54a;">\u2605</span> ' : ''; chatHistory.innerHTML += `<p style="color:#ff5555;">${star}Creature: ${escapeHtml(message)}</p>`; chatHistory.scrollTop = chatHistory.scrollHeight; }
function narratorSays(message) { chatHistory.innerHTML += `<p style="color:#5b8dff;">Narrator: ${escapeHtml(message)}</p>`; chatHistory.scrollTop = chatHistory.scrollHeight; }
function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ===========================================================
//  MAP REGEN / FILE SAVE
// ===========================================================
function regenerateMap(opts) {
    generateWorld(opts);
    buildWaterLayer();
    initFog();
    raidSize = 3;
    creature.x = WORLD_W / 2; creature.y = WORLD_H / 2;
    resetCreatureRuntime();
    camera.x = creature.x - (canvas.width / zoom) / 2; camera.y = creature.y - (canvas.height / zoom) / 2; clampCamera();
    renderHearts(creature.hearts, creature.maxHearts || CREATURE_MAX_HEARTS); renderStamina(creature.stamina); lastStamina = creature.stamina;
    saveGame(); updateLog("Map regenerated — a fresh world.");
    renderScene(); if (isPaused) drawRuler();
}
function downloadSave() {
    const state = { version: VERSION, savedAt: new Date().toISOString(), world, creature, camera, zoom, rerunCommands: rerunMemory };
    const lines = [];
    lines.push("=== EGG V2 SAVE ===");
    lines.push("Build: v" + GAME_VERSION);
    lines.push("Saved: " + state.savedAt);
    lines.push("Active voice: " + activeVoice);
    lines.push("");
    lines.push("--- Rerun commands (command -> creature's response) ---");
    const keys = Object.keys(rerunMemory);
    if (!keys.length) lines.push("(none yet — repeat a command 3 times to make one)");
    else keys.forEach(k => { const m = rerunMemory[k]; lines.push(`"${k}"  [used ${m.count}x | action: ${m.action}${m.target ? '/' + m.target : ''}]`); lines.push(`     -> ${m.speech || 'The creature obeys.'}`); });
    lines.push("");
    lines.push("--- Full game state (JSON, keep this line to reload later) ---");
    lines.push(JSON.stringify(state));
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `egg-save-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    updateLog("Game saved to a downloadable text file.");
}
regenMapBtn.addEventListener('click', regenerateMap);
saveFileBtn.addEventListener('click', downloadSave);

// Download the AI command log: non-canned inputs grouped by the action the AI chose,
// each with the creature's personality and the AI's response — ready to curate into canned.txt / CreatureVoice.txt
function downloadCommandLog() {
    const lines = [];
    lines.push("=== EGG — AI command log ===");
    lines.push("Inputs that were NOT canned commands (these used the Gemini API).");
    lines.push("Headers below are the action categories — copy commands into canned.txt,");
    lines.push("and copy the responses into CreatureVoice.txt under each personality.");
    lines.push("Generated: " + new Date().toISOString());
    lines.push("");
    const keys = Object.keys(aiCommandLog);
    if (!keys.length) lines.push("(nothing logged yet — every command so far was canned or client-side)");
    else keys.forEach(action => {
        lines.push("[" + action + "]");
        aiCommandLog[action].forEach(e => {
            lines.push(`  "${e.input}"  (${e.voice}${e.count > 1 ? ' x' + e.count : ''})`);
            lines.push(`     -> ${e.response || '(no speech)'}`);
        });
        lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `egg-command-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    updateLog("Command log downloaded.");
}
logFileBtn.addEventListener('click', downloadCommandLog);

// Import a save file (portable across browsers / machines)
function importSave(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const text = String(reader.result || "");
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            let data = null;
            for (let k = lines.length - 1; k >= 0; k--) {            // JSON blob is the final line; scan up just in case
                const ln = lines[k];
                if (ln.startsWith('{') && ln.endsWith('}')) { try { const d = JSON.parse(ln); if (d && d.world) { data = d; break; } } catch (e) { } }
            }
            if (!data) throw new Error("no save data found in this file");
            if (!data.world.rivers) throw new Error("file doesn't contain a valid world");
            world = data.world;
            if (data.creature) creature = data.creature;
            if (data.camera) camera = data.camera;
            if (typeof data.zoom === 'number') zoom = data.zoom;
            if (data.rerunCommands && typeof data.rerunCommands === 'object') { rerunMemory = data.rerunCommands; saveRerunMemory(); }
            normalizeWorld();
            resetCreatureRuntime();
            buildWaterLayer();
            renderHearts(creature.hearts); renderStamina(creature.stamina); lastStamina = creature.stamina;
            clampCamera();
            localStorage.setItem('creatureGameState', JSON.stringify({ version: VERSION, world, creature, camera, zoom }));
            updateLog("Save imported" + (data.savedAt ? " (from " + data.savedAt + ")" : "") + ".");
            narratorSays("A saved world settles into place.");
            renderScene(); if (isPaused) drawRuler();
        } catch (e) { console.error(e); updateLog("Import failed: " + e.message); alert("Could not import save: " + e.message); }
    };
    reader.onerror = () => { updateLog("Import failed: couldn't read the file."); };
    reader.readAsText(file);
}
loadFileBtn.addEventListener('click', () => loadFileInput.click());
loadFileInput.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) importSave(f); loadFileInput.value = ''; });

// New game: wipe this browser's saved world + rerun commands (keeps the API key)
function newGame() {
    if (!confirm("Start a NEW GAME?\n\nThis wipes the saved world and your rerun commands from THIS browser. Your API key is kept. (Use \"Save Game to File\" first if you want a backup.)")) return;
    let gv = parseInt(prompt("How many goblin villages? (0-6)", "2"), 10); if (isNaN(gv)) gv = 2; gv = Math.max(0, Math.min(6, gv));
    let gh = parseInt(prompt("How many huts per goblin village? (1-12)", "4"), 10); if (isNaN(gh)) gh = 4; gh = Math.max(1, Math.min(12, gh));
    localStorage.removeItem('creatureGameState');
    localStorage.removeItem('rerunCommands');
    localStorage.removeItem('aiCommandLog');
    rerunMemory = {}; aiCommandLog = {};
    creature.hearts = CREATURE_MAX_HEARTS; creature.name = null;
    chatHistory.innerHTML = ''; actionLog.innerHTML = '';
    regenerateMap({ goblinTowns: gv, gobHuts: gh });
    updateLog("New game — " + gv + " goblin village(s), " + gh + " huts each.");
    narratorSays("A brand-new world begins.");
    if (isPaused) resumeGame();      // unpause so the new map is shown and live
}
newGameBtn.addEventListener('click', newGame);

// ===========================================================
//  API KEYS
// ===========================================================
function loadApiKeys() {
    try { apiKeys = JSON.parse(localStorage.getItem('geminiApiKeys') || '[]') || []; } catch (e) { apiKeys = []; }
    if (!Array.isArray(apiKeys)) apiKeys = [];
    const legacy = localStorage.getItem('gemini_api_key');            // migrate the old single-key storage
    if (legacy && !apiKeys.includes(legacy)) { apiKeys.unshift(legacy); localStorage.setItem('geminiApiKeys', JSON.stringify(apiKeys)); }
    keyIndex = 0;
    if (apiKeys.length) updateLog(apiKeys.length + " API key(s) loaded.");
    else updateLog('No API keys yet — open the pause menu (ESC) and click "Keys".');
}
function currentKeyFieldValues() { return Array.from(keysList.querySelectorAll('.key-input')).map(i => i.value); }
function updateAddKeyBtn() { addKeyBtn.disabled = keysList.querySelectorAll('.key-input').length >= MAX_KEY_FIELDS; }
function renderKeysList(values) {
    keysList.innerHTML = '';
    if (!values || !values.length) values = [''];
    values.forEach((v, idx) => {
        const row = document.createElement('div'); row.className = 'key-row';
        const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'key-input'; inp.value = v; inp.placeholder = 'AIza… (key ' + (idx + 1) + ')'; inp.spellcheck = false; inp.autocomplete = 'off';
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'key-remove'; rm.textContent = '×'; rm.title = 'remove this key';
        rm.addEventListener('click', () => { const vals = currentKeyFieldValues(); vals.splice(idx, 1); renderKeysList(vals); });
        row.appendChild(inp); row.appendChild(rm); keysList.appendChild(row);
    });
    updateAddKeyBtn();
}
function openKeysModal() { renderKeysList(apiKeys.length ? apiKeys.slice() : ['']); keysModal.classList.add('open'); }
function closeKeysModal() { keysModal.classList.remove('open'); }
function saveKeys() {
    const vals = currentKeyFieldValues().map(s => s.trim()).filter(Boolean);
    apiKeys = [...new Set(vals)];
    localStorage.setItem('geminiApiKeys', JSON.stringify(apiKeys));
    keyIndex = 0;
    updateLog("Saved " + apiKeys.length + " API key(s).");
    closeKeysModal();
}
function keysFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        const keys = String(reader.result || "").split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#') && !s.startsWith('//'));
        if (!keys.length) { alert("No keys found in that file. Put one key per line."); return; }
        const merged = [...new Set([...currentKeyFieldValues().map(s => s.trim()).filter(Boolean), ...keys])];
        renderKeysList(merged);
        updateLog("Loaded " + keys.length + " key(s) from file — review, then click Save Keys.");
    };
    reader.onerror = () => updateLog("Couldn't read that key file.");
    reader.readAsText(file);
}
keysBtn.addEventListener('click', openKeysModal);
keysCloseBtn.addEventListener('click', closeKeysModal);
keysSaveBtn.addEventListener('click', saveKeys);
addKeyBtn.addEventListener('click', () => { const vals = currentKeyFieldValues(); if (vals.length < MAX_KEY_FIELDS) { vals.push(''); renderKeysList(vals); } });
keysFromFileBtn.addEventListener('click', () => keysFileInput.click());
keysFileInput.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) keysFromFile(f); keysFileInput.value = ''; });
keysModal.addEventListener('click', (e) => { if (e.target === keysModal) closeKeysModal(); });   // click backdrop to close

// ===========================================================
//  SPELLS  (spell bar + chargeable fireball)
// ===========================================================
const SPELL_COUNT = 10;
const SPELL_ICONS = ['🔥', '', '', '', '', '', '', '', '', ''];   // only fireball for now
let selectedSpell = 0;
let charging = false, chargeStart = 0, chargePower = 0;
const FIRE_CHARGE_MS = 2500, FIRE_MAX_DIST_PX = m2px(100), FIRE_MAX_RADIUS_PX = m2px(25);

function buildSpellBar() {
    spellBarEl.innerHTML = '';
    for (let i = 0; i < SPELL_COUNT; i++) {
        const slot = document.createElement('div'); slot.className = 'spell-slot' + (i === selectedSpell ? ' selected' : '');
        const num = document.createElement('div'); num.className = 'num'; num.textContent = (i === 9 ? 0 : i + 1);
        const icon = document.createElement('div'); icon.className = 'icon'; icon.textContent = SPELL_ICONS[i] || '';
        const charge = document.createElement('div'); charge.className = 'charge'; charge.appendChild(document.createElement('i'));
        slot.appendChild(num); slot.appendChild(icon); slot.appendChild(charge);
        slot.addEventListener('click', () => selectSpell(i));
        spellBarEl.appendChild(slot);
    }
}
function selectSpell(i) {
    if (i < 0 || i >= SPELL_COUNT) return;
    selectedSpell = i;
    Array.from(spellBarEl.children).forEach((el, idx) => el.classList.toggle('selected', idx === selectedSpell));
    if (charging && i !== 0) cancelCharge();
}
function chargeEl() { return spellBarEl.children[0] && spellBarEl.children[0].querySelector('.charge'); }
function startCharge() { charging = true; chargeStart = performance.now(); const c = chargeEl(); if (c) c.classList.add('active'); }
function cancelCharge() { charging = false; const c = chargeEl(); if (c) { c.classList.remove('active'); c.querySelector('i').style.width = '0%'; } }
function updateCharge() { if (!charging) return; chargePower = Math.min(1, (performance.now() - chargeStart) / FIRE_CHARGE_MS); const c = chargeEl(); if (c) c.querySelector('i').style.width = (chargePower * 100) + '%'; }
function releaseCharge() { if (!charging) return; const power = Math.max(0.05, chargePower); cancelCharge(); castFireball(power); chargePower = 0; }
function castFireball(power) {
    const cx = creature.x + 30, cy = creature.y + 33;
    const wx = camera.x + mouseSX / zoom, wy = camera.y + mouseSY / zoom;   // mouse in world space sets the vector
    let dx = wx - cx, dy = wy - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const dist = power * FIRE_MAX_DIST_PX;
    world.fireballs.push({ x: cx, y: cy, targetX: cx + dx * dist, targetY: cy + dy * dist, charged: true, power, speed: FIRE_SPEED });
    statusBox.innerText = 'Hurls a fireball!';
}
function explodeFireball(x, y, power) {
    showExplosionGif(x, y, power);
    const radius = power * FIRE_MAX_RADIUS_PX;
    const dmg = power * FIRE_BASE_DMG;                                  // 4 hearts at full charge, 2 at 50%
    // living things take heart damage
    for (const arr of [world.villagers, world.goblins, world.ogres]) for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i]; if (Math.hypot(o.x - x, o.y - y) <= radius) damageEntity(o, arr, dmg);
    }
    // non-living objects are destroyed to ash
    for (const arr of [world.trees, world.huts, world.crops, world.wells, world.signs, world.shrines, world.goblinHuts]) for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i]; const c = entityCenter(o, arr); if (Math.hypot(c.x - x, c.y - y) <= radius) { arr.splice(i, 1); world.ashes.push(makeAshes(c.x, c.y)); }
    }
    // caves survive
}
function showExplosionGif(worldX, worldY, power) {
    const diaWorld = power * FIRE_MAX_RADIUS_PX * 2;
    const img = document.createElement('img');
    img.src = 'images/fireball_explode.gif?' + Date.now();   // cache-bust so the gif animates from the start each time
    img.style.position = 'fixed'; img.style.pointerEvents = 'none'; img.style.zIndex = '50';
    const sx = (worldX - camera.x) * zoom, sy = (worldY - camera.y) * zoom, size = diaWorld * zoom;
    img.style.left = (sx - size / 2) + 'px'; img.style.top = (sy - size / 2) + 'px';
    img.style.width = size + 'px'; img.style.height = size + 'px';
    document.body.appendChild(img);
    setTimeout(() => img.remove(), 1100);
}

// ===========================================================
//  TREE OF KNOWLEDGE  (T)
// ===========================================================
const TREE_COMMANDS = [
    ['Your name is ___', 'name the creature'],
    ['Be ___', 'switch personality/voice (e.g. "be snarky")'],
    ['Burn ___', 'fireball one thing (tree, hut, villager, crop, goblin, ogre)'],
    ['Burn some ___', 'burn a bunch of one kind in a row'],
    ['Attack ___', 'walk up and melee an enemy (goblin, ogre)'],
    ['Attack some ___', 'go melee a bunch of enemies'],
    ['Guard the village', 'patrol the nearest village, fighting goblins'],
    ['Run / Stop running', 'sprint (uses stamina) / slow back down'],
    ['Grow', 'grow more trees'],
    ['Spread huts', 'add a hut to a village'],
    ['Change creature', 'become a random new creature'],
    ['Stop', 'cancel the current action'],
    ['Left-click', 'send the creature to that spot'],
    ['Right-click / Space (hold)', 'charge & throw the fireball spell'],
    ['1–0 keys', 'select a spell slot'],
    ['F (hold)', 'reveal the whole map'],
    ['T', 'open/close this Tree of Knowledge'],
];
function buildTree() {
    treeList.innerHTML = TREE_COMMANDS.map(([c, e]) => `<div><span class="cmd">${c}</span> — <span class="ex">${e}</span></div>`).join('');
}
function toggleTree() { if (!treeList.innerHTML) buildTree(); treeModal.classList.toggle('open'); }
treeCloseBtn.addEventListener('click', () => treeModal.classList.remove('open'));
treeModal.addEventListener('click', (e) => { if (e.target === treeModal) treeModal.classList.remove('open'); });

// pause-when-chatting checkbox
if (pauseChatCheckbox) {
    pauseChatCheckbox.checked = pauseWhenChatting;
    pauseChatCheckbox.addEventListener('change', () => { pauseWhenChatting = pauseChatCheckbox.checked; localStorage.setItem('pauseWhenChatting', pauseWhenChatting ? '1' : '0'); });
}

// ===========================================================
//  STATS FILE (stats_and_shit.txt)
// ===========================================================
// Sectioned key=value file. We map its values onto the mutable combat vars + per-entity hearts.
async function loadStats() {
    let parsed = {};
    try {
        const res = await fetch('stats_and_shit.txt', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text(); let cur = null;
        text.split(/\r?\n/).forEach(line => {
            const l = line.trim(); if (!l || l.startsWith('#') || l.startsWith('//')) return;
            const h = l.match(/^\[(.+?)\]$/); if (h) { cur = h[1].trim().toLowerCase(); parsed[cur] = {}; return; }
            const m = l.match(/^([a-z_ ]+?)\s*[:=]\s*([-\d.]+)/i); if (m && cur) parsed[cur][m[1].trim().toLowerCase().replace(/\s+/g, '_')] = parseFloat(m[2]);
        });
        updateLog('Loaded combat stats from stats_and_shit.txt.');
    } catch (e) { updateLog('No stats_and_shit.txt (' + e.message + ') — using built-in defaults.'); }
    const g = (sec, key, def) => (parsed[sec] && parsed[sec][key] !== undefined) ? parsed[sec][key] : def;
    // attack_speed is seconds between attacks
    CREATURE_MAX_HEARTS = g('creature', 'hearts', CREATURE_MAX_HEARTS);
    CREATURE_ATTACK_DMG = g('creature', 'attack_damage', CREATURE_ATTACK_DMG);
    CREATURE_ATTACK_MS = g('creature', 'attack_speed', CREATURE_ATTACK_MS / 1000) * 1000;
    WANDER_SPEED_MPS = g('creature', 'move_speed', WANDER_SPEED_MPS);
    RUN_SPEED_MPS = g('creature', 'run_speed', RUN_SPEED_MPS);
    VILLAGER_HEARTS = g('villager', 'hearts', VILLAGER_HEARTS);
    VILLAGER_SPEED_MPS = g('villager', 'move_speed', VILLAGER_SPEED_MPS);
    GOBLIN_HEARTS = g('goblin', 'hearts', GOBLIN_HEARTS);
    GOBLIN_HIT_DMG = g('goblin', 'attack_damage', GOBLIN_HIT_DMG);
    GOBLIN_ATTACK_MS = g('goblin', 'attack_speed', GOBLIN_ATTACK_MS / 1000) * 1000;
    GOBLIN_SPEED_MPS = g('goblin', 'move_speed', GOBLIN_SPEED_MPS);
    OGRE_HEARTS = g('ogre', 'hearts', OGRE_HEARTS);
    OGRE_ATTACK_DMG = g('ogre', 'attack_damage', OGRE_ATTACK_DMG);
    OGRE_ATTACK_MS = g('ogre', 'attack_speed', OGRE_ATTACK_MS / 1000) * 1000;
    OGRE_SPEED_MPS = g('ogre', 'move_speed', OGRE_SPEED_MPS);
    OGRE_AGGRO_PX = m2px(g('ogre', 'aggro_range', OGRE_AGGRO_PX / PIXELS_PER_METER));
    FIRE_SPEED = g('fireball', 'speed', FIRE_SPEED);
    FIRE_BASE_DMG = g('fireball', 'damage', FIRE_BASE_DMG);
}

// ===========================================================
//  INIT
// ===========================================================
(async function init() {
    if (gameTitleEl) gameTitleEl.textContent = '🥚 Egg v' + GAME_VERSION;
    resizeCanvas();
    buildGrassPattern();
    loadRerunMemory();
    loadAiLog();
    loadApiKeys();
    await loadStats();          // load combat values BEFORE the world is generated
    loadGame();
    buildWaterLayer();
    initFog();
    loadCreatureVoice();
    loadCanned();
    loadAllVariations();
    loadCreatureImage();
    buildSpellBar();
    renderHearts(creature.hearts, creature.maxHearts || CREATURE_MAX_HEARTS);
    renderStamina(creature.stamina);
    canvas.style.cursor = 'default';
    camera.x = creature.x - (canvas.width / zoom) / 2;
    camera.y = creature.y - (canvas.height / zoom) / 2;
    clampCamera();
    setInterval(saveGame, 10000);
    requestAnimationFrame(draw);
})();
