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

const VERSION = "egg-v2.2";

const PIXELS_PER_METER = 10;
const m2px = (m) => m * PIXELS_PER_METER;

// Speeds & ranges
const WANDER_SPEED_MPS = 2.0;            // creature stroll
const RUN_SPEED_MPS = 8.0;               // running
const SEEK_SPEED_MPS = 3.2;              // base approach (scaled by run)
const VILLAGER_SPEED_MPS = 1.0;
const VILLAGER_LEASH_PX = m2px(20);      // villagers stay within 20 m of home
const INTERACT_RANGE_PX = m2px(10);
const INTERACT_COOLDOWN_MS = 10000;
const FIREBALL_RANGE_M = 15;             // max allowed throw range
const FIREBALL_RANGE_PX = m2px(FIREBALL_RANGE_M);
const BURN_APPROACH_PX = m2px(11);       // creature walks up to ~11 m, then throws (within range)
const GOBLIN_DETECT_PX = m2px(40);
const GOBLIN_SPEED_MPS = 2.4;
const GOBLIN_CONTACT_PX = 18;
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
const apiKeyInput = document.getElementById('api-key-input');
const heartsEl = document.getElementById('hearts');
const staminaEl = document.getElementById('stamina');

const WORLD_W = 3000, WORLD_H = 2200;

let isPaused = false;
let GEMINI_API_KEY = "";

let camera = { x: 0, y: 0 };
let zoom = 1;
const MIN_ZOOM = 0.5, MAX_ZOOM = 3, CAMERA_SPEED = 7;
const keys = {};
let controlsHintHidden = false;

// drag-to-pan
let dragging = false, dragLastX = 0, dragLastY = 0;

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
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom(zoom * f, e.clientX, e.clientY);
}, { passive: false });

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true; dragLastX = e.clientX; dragLastY = e.clientY;
    canvas.style.cursor = 'grabbing'; e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    camera.x -= (e.clientX - dragLastX) / zoom;
    camera.y -= (e.clientY - dragLastY) / zoom;
    dragLastX = e.clientX; dragLastY = e.clientY;
    clampCamera(); if (isPaused) drawRuler();
});
window.addEventListener('mouseup', () => { if (dragging) { dragging = false; canvas.style.cursor = 'grab'; } });

// ===========================================================
//  SPRITES
// ===========================================================
const SPRITE_KEYS = ['creature', 'tree', 'hut', 'villager', 'crop', 'shrine', 'fireball', 'goblin', 'ashes'];
const images = {};
function loadSprite(key) {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { images[key] = removeBackground(img) || img; updateLog(`Loaded sprite: ${key}`); };
    img.onerror = () => console.warn(`No image for "${key}" (images/${key}.png) — using a drawn placeholder.`);
    img.src = `images/${key}.png`;
}
function removeBackground(img) {
    try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
        const d = cx.getImageData(0, 0, w, h); const px = d.data;
        if (px[3] === 0) return img;
        const br = px[0], bg = px[1], bb = px[2], tol = 42;
        const visited = new Uint8Array(w * h), stack = [];
        const match = (i) => { const o = i * 4; return px[o + 3] > 10 && Math.abs(px[o] - br) <= tol && Math.abs(px[o + 1] - bg) <= tol && Math.abs(px[o + 2] - bb) <= tol; };
        for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + w - 1); }
        while (stack.length) { const i = stack.pop(); if (i < 0 || i >= w * h || visited[i]) continue; visited[i] = 1; if (!match(i)) continue; px[i * 4 + 3] = 0; const x = i % w, y = (i / w) | 0; if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1); if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w); }
        cx.putImageData(d, 0, 0); return c;
    } catch (e) { console.warn('Background removal skipped.', e); return img; }
}
function imgReady(key) { const i = images[key]; return !!i && ((i.width || i.naturalWidth) > 0); }
SPRITE_KEYS.forEach(loadSprite);

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
function renderHearts(full, total = 3) { let html = ''; for (let i = 0; i < total; i++) html += heartSVG(i < full ? 'full' : 'empty'); heartsEl.innerHTML = html; }
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
let world = { lakes: [], rivers: [], huts: [], villagers: [], shrines: [], trees: [], crops: [], fireballs: [], goblins: [], goblinGroups: [], ashes: [] };
let creature = {
    x: WORLD_W / 2, y: WORLD_H / 2,
    act: 'free', moveState: 'walking', heading: Math.random() * Math.PI * 2, stateUntil: 0,
    interactCooldown: 0, burnGoal: null, burnCampaign: null, guard: null, resumeGuard: false,
    running: false, stamina: STAMINA_MAX, regenTimer: 0, drainTimer: 0, hearts: 3,
    spellsUnlocked: ['fireball', 'grow', 'spread_huts']
};

function distToSegment(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy; let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2; t = clamp(t, 0, 1); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
function inLake(x, y, pad = 0) { return world.lakes.some(l => { const nx = (x - l.x) / (l.rx + pad), ny = (y - l.y) / (l.ry + pad); return nx * nx + ny * ny <= 1; }); }
function nearRiver(x, y, pad = 0) { return world.rivers.some(r => { for (let i = 0; i < r.points.length - 1; i++) { const a = r.points[i], b = r.points[i + 1]; if (distToSegment(x, y, a.x, a.y, b.x, b.y) < r.width / 2 + pad) return true; } return false; }); }
function isWater(x, y, pad = 0) { return inLake(x, y, pad) || nearRiver(x, y, pad); }
function findLandSpot(margin = 60, waterPad = 25) { for (let i = 0; i < 80; i++) { const x = margin + Math.random() * (WORLD_W - margin * 2), y = margin + Math.random() * (WORLD_H - margin * 2); if (!isWater(x, y, waterPad)) return { x, y }; } return { x: WORLD_W / 2, y: WORLD_H / 2 }; }
function canPlaceHut(x, y) { if (isWater(x, y, 15)) return false; const cx = x + 25, cy = y + 25; for (const h of world.huts) if (Math.hypot((h.x + 25) - cx, (h.y + 25) - cy) < MIN_HUT_DIST_PX) return false; return true; }
function nearestHutCenter(x, y) { let best = null, bd = Infinity; for (const h of world.huts) { const c = { x: h.x + 25, y: h.y + 25 }; const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } } return best; }

function generateWorld() {
    world = { lakes: [], rivers: [], huts: [], villagers: [], shrines: [], trees: [], crops: [], fireballs: [], goblins: [], goblinGroups: [], ashes: [], villages: [] };
    for (let i = 0; i < 4; i++) world.lakes.push({ x: 200 + Math.random() * (WORLD_W - 400), y: 200 + Math.random() * (WORLD_H - 400), rx: 70 + Math.random() * 120, ry: 55 + Math.random() * 100 });
    for (let r = 0; r < 2; r++) { const points = []; const horizontal = Math.random() < 0.5; let x = horizontal ? 0 : Math.random() * WORLD_W, y = horizontal ? Math.random() * WORLD_H : 0, angle = horizontal ? 0 : Math.PI / 2; while (x >= -50 && x <= WORLD_W + 50 && y >= -50 && y <= WORLD_H + 50) { points.push({ x, y }); angle += (Math.random() - 0.5) * 0.7; x += Math.cos(angle) * 60; y += Math.sin(angle) * 60; if (points.length > 120) break; } world.rivers.push({ points, width: 22 + Math.random() * 14 }); }
    for (let i = 0; i < 55; i++) world.trees.push(findLandSpot(40, 18));
    // hut settlements (no stacking). Each settlement is a "village" with a shared crop field.
    for (let s = 0; s < 3; s++) {
        const center = findLandSpot(140, 60); world.villages.push({ x: center.x, y: center.y });
        const hutsHere = 3 + Math.floor(Math.random() * 4);
        for (let h = 0; h < hutsHere; h++) { for (let a = 0; a < 12; a++) { const hx = center.x + (Math.random() * 160 - 80), hy = center.y + (Math.random() * 160 - 80); if (canPlaceHut(hx, hy)) { world.huts.push({ x: hx, y: hy }); break; } } }
    }
    // villagers belong to a village, leashed to 20 m of its center; together they tend ONE shared field
    for (let i = 0; i < 18; i++) {
        const vi = world.villages.length ? (i % world.villages.length) : 0;
        const vc = world.villages[vi] || findLandSpot(60, 20);
        let spot = vc; for (let a = 0; a < 12; a++) { const ang = Math.random() * 6.283, r = Math.random() * 120; const p = { x: vc.x + Math.cos(ang) * r, y: vc.y + Math.sin(ang) * r }; if (!isWater(p.x, p.y, 10)) { spot = p; break; } }
        world.villagers.push({ x: spot.x, y: spot.y, home: { x: vc.x, y: vc.y }, village: vi, heading: Math.random() * 6.283, vstate: 'moving', vUntil: 0 });
    }
    world.shrines.push(findLandSpot(150, 60));
    for (let g = 0; g < 3; g++) { const c = findLandSpot(120, 40); world.goblinGroups.push({ x: c.x, y: c.y, heading: Math.random() * Math.PI * 2, turnTimer: 120 + Math.random() * 240 }); const n = 2 + Math.floor(Math.random() * 2); for (let i = 0; i < n; i++) world.goblins.push({ x: c.x + (Math.random() * 40 - 20), y: c.y + (Math.random() * 40 - 20), group: g, ox: Math.random() * 30 - 15, oy: Math.random() * 30 - 15 }); }
    updateLog("Generated a fresh world: rivers, lakes, huts, villagers & goblin packs.");
}
function normalizeWorld() {
    ['lakes', 'rivers', 'huts', 'villagers', 'shrines', 'trees', 'crops', 'fireballs', 'goblins', 'goblinGroups', 'ashes', 'villages'].forEach(k => { if (!Array.isArray(world[k])) world[k] = []; });
    world.villagers.forEach(v => {
        if (!v.home) { v.home = nearestHutCenter(v.x, v.y) || { x: v.x, y: v.y }; }
        if (v.vstate === undefined) { v.vstate = 'moving'; v.vUntil = 0; v.heading = Math.random() * 6.283; }
        if (v.village === undefined || !world.villages[v.village]) {            // attach to nearest village (or make one from home)
            if (!world.villages.length) world.villages.push({ x: v.home.x, y: v.home.y });
            let bi = 0, bd = Infinity; world.villages.forEach((vc, i) => { const d = Math.hypot(vc.x - v.home.x, vc.y - v.home.y); if (d < bd) { bd = d; bi = i; } }); v.village = bi;
        }
    });
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
    const leftM = camera.x / PIXELS_PER_METER, rightM = (camera.x + canvas.width / zoom) / PIXELS_PER_METER;
    for (let m = Math.ceil(leftM / 2) * 2; m <= rightM; m += 2) { const sx = (m * PIXELS_PER_METER - camera.x) * zoom; const major = (m % 10 === 0); r.beginPath(); r.moveTo(sx, 30); r.lineTo(sx, major ? 13 : 22); r.stroke(); if (major) r.fillText(m + 'm', sx + 2, 2); }
}
function pauseGame() { isPaused = true; apiKeyInput.value = GEMINI_API_KEY; pausePanel.classList.add('open'); rulerCanvas.style.display = 'block'; drawRuler(); }
function resumeGame() { GEMINI_API_KEY = apiKeyInput.value.trim(); localStorage.setItem('gemini_api_key', GEMINI_API_KEY); pausePanel.classList.remove('open'); rulerCanvas.style.display = 'none'; isPaused = false; lastTs = null; updateLog("Game resumed."); requestAnimationFrame(draw); }
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
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) GEMINI_API_KEY = savedKey; else updateLog("No Gemini API Key yet. Press ESC to open settings and add one.");
}
// Reset transient/runtime creature fields (preserves stamina/hearts/position if already set)
function resetCreatureRuntime() {
    creature.act = 'free'; creature.burnGoal = null; creature.burnCampaign = null; creature.guard = null; creature.resumeGuard = false;
    creature.running = false; creature.regenTimer = 0; creature.drainTimer = 0;
    if (creature.stamina === undefined) creature.stamina = STAMINA_MAX;
    if (creature.hearts === undefined) creature.hearts = 3;
    if (creature.moveState === undefined) creature.moveState = 'walking';
    if (creature.heading === undefined) creature.heading = Math.random() * Math.PI * 2;
    creature.interactCooldown = 0; creature.stateUntil = Date.now() + 4000;
}

// ===========================================================
//  VOICE
// ===========================================================
let voiceStyles = {}; let activeVoice = 'snarky';
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
function typingInInput() { return document.activeElement === commandInput || document.activeElement === apiKeyInput; }
window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); togglePause(); return; }
    if (typingInInput()) return;
    if (k === 'enter') { e.preventDefault(); commandInput.focus(); return; }
    if (k === '=' || k === '+') { e.preventDefault(); setZoom(zoom * 1.12); return; }
    if (k === '-' || k === '_') { e.preventDefault(); setZoom(zoom / 1.12); return; }
    if (MOVE_KEYS.includes(k)) { keys[k] = true; if (k.startsWith('arrow')) e.preventDefault(); if (!controlsHintHidden) { controlsHint.style.display = 'none'; controlsHintHidden = true; } }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
commandInput.addEventListener('focus', () => { for (const kk in keys) keys[kk] = false; });
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
function cancelAll() { creature.act = 'free'; creature.burnGoal = null; creature.burnCampaign = null; creature.guard = null; creature.resumeGuard = false; creature.running = false; statusBox.innerText = 'Wandering aimlessly.'; }

// ===========================================================
//  WORLD UPDATES
// ===========================================================
function updateVillagers(dt, now) {
    const sp = VILLAGER_SPEED_MPS * PIXELS_PER_METER * dt;
    for (const v of world.villagers) {
        if (!v.home) v.home = { x: v.x, y: v.y };
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
        if (Math.random() < 0.0011) {            // slowly add the next crop to the village's shared field
            const center = (world.villages && world.villages[v.village]) || v.home;
            const cell = nextCropCell(center);
            if (cell) world.crops.push({ x: cell.x, y: cell.y });
        }
    }
}

const WALK_STATUS = ["Wandering aimlessly.", "Exploring the map.", "Off to see what's over there.", "Roaming."];
function pickWalkStatus() { return WALK_STATUS[Math.floor(Math.random() * WALK_STATUS.length)]; }
function enterStopped(now) { creature.moveState = 'stopped'; creature.stateUntil = now + (1000 + Math.random() * 2000); creature.heading = Math.random() * Math.PI * 2; statusBox.innerText = "Pausing to look around."; }

function updateCreature(dt, now) {
    if (creature.act === 'busy') return;
    if (creature.act === 'seeking') { seekStep(dt); return; }
    if (creature.act === 'burning') { updateBurnCampaign(dt, now); return; }
    if (creature.act === 'guarding') { updateGuard(dt, now); return; }
    if (now > creature.interactCooldown) { const v = nearestIn(world.villagers, creature.x + 30, creature.y + 33, INTERACT_RANGE_PX); if (v) { startVillagerInteraction(v.obj, now); return; } }
    if (creature.moveState === 'stopped') { if (now >= creature.stateUntil) { creature.moveState = 'walking'; creature.stateUntil = now + (3000 + Math.random() * 12000); statusBox.innerText = pickWalkStatus(); } return; }
    if (now >= creature.stateUntil) { enterStopped(now); return; }
    const sp = WANDER_SPEED_MPS * PIXELS_PER_METER * dt * runMult();
    const nx = creature.x + Math.cos(creature.heading) * sp, ny = creature.y + Math.sin(creature.heading) * sp;
    if (nx < 0 || nx > WORLD_W - 60 || ny < 0 || ny > WORLD_H - 66 || isWater(nx + 30, ny + 60, 12)) { enterStopped(now); return; }
    creature.x = nx; creature.y = ny;
}

function updateProjectiles() { for (let i = world.fireballs.length - 1; i >= 0; i--) { const f = world.fireballs[i]; const dx = f.targetX - f.x, dy = f.targetY - f.y, dist = Math.hypot(dx, dy); if (dist < 5) world.fireballs.splice(i, 1); else { f.x += (dx / dist) * 6; f.y += (dy / dist) * 6; } } }
function updateAshes() { const now = Date.now(); for (let i = world.ashes.length - 1; i >= 0; i--) if (now - world.ashes[i].born > ASH_LIFETIME_MS) world.ashes.splice(i, 1); }
function maybeSpawnShrine() { if (world.shrines.length >= 8) return; if (Math.random() < 0.0006) { world.shrines.push(findLandSpot(80, 40)); updateLog("A shrine has appeared."); } }

function nearestIn(arr, fx, fy, maxPx) { let best = null, bd = maxPx; for (const o of arr) { const d = Math.hypot(o.x - fx, o.y - fy); if (d < bd) { bd = d; best = { obj: o, dist: d }; } } return best; }
function stepToward(o, tx, ty, speed) { const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy) || 1; o.x += (dx / d) * speed; o.y += (dy / d) * speed; }
function stepCreatureToward(tx, ty, sp) { const cx = creature.x + 30, cy = creature.y + 33, dx = tx - cx, dy = ty - cy, d = Math.hypot(dx, dy) || 1; creature.x = clamp(creature.x + (dx / d) * sp, 0, WORLD_W - 60); creature.y = clamp(creature.y + (dy / d) * sp, 0, WORLD_H - 66); }

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
    for (const gob of world.goblins) {
        const v = nearestIn(world.villagers, gob.x, gob.y, GOBLIN_DETECT_PX);
        const h = v ? null : nearestIn(world.huts, gob.x, gob.y, GOBLIN_DETECT_PX);
        if (v) { stepToward(gob, v.obj.x, v.obj.y, charge); if (v.dist < GOBLIN_CONTACT_PX) { const i = world.villagers.indexOf(v.obj); if (i >= 0) world.villagers.splice(i, 1); } }
        else if (h) { stepToward(gob, h.obj.x + 25, h.obj.y + 25, charge); if (Math.hypot(gob.x - (h.obj.x + 25), gob.y - (h.obj.y + 25)) < GOBLIN_CONTACT_PX) { const i = world.huts.indexOf(h.obj); if (i >= 0) { world.huts.splice(i, 1); world.ashes.push(makeAshes(h.obj.x + 25, h.obj.y + 25)); } } }
        else { const a = world.goblinGroups[gob.group] || { x: gob.x, y: gob.y }; stepToward(gob, a.x + (gob.ox || 0), a.y + (gob.oy || 0), base); }
        gob.x = clamp(gob.x, 6, WORLD_W - 6); gob.y = clamp(gob.y, 6, WORLD_H - 6);
    }
}

// ===========================================================
//  ACTIONS
// ===========================================================
function makeAshes(x, y) { const specks = []; for (let k = 0; k < 6; k++) specks.push({ dx: Math.random() * 18 - 9, dy: Math.random() * 8 - 4 }); return { x, y, born: Date.now(), specks }; }
function normalizeTarget(t) { if (!t) return 'any'; t = String(t).toLowerCase(); const map = { trees: 'tree', villagers: 'villager', huts: 'hut', house: 'hut', home: 'hut', crops: 'crop', goblins: 'goblin', something: 'any', anything: 'any', nearest: 'any' }; return map[t] || t; }
function findNearestBurnable(targetType) { const pools = { tree: world.trees, villager: world.villagers, hut: world.huts, crop: world.crops, goblin: world.goblins }; const entries = pools[targetType] ? [[targetType, pools[targetType]]] : Object.entries(pools); const cx = creature.x + 30, cy = creature.y + 33; let best = null, bd = Infinity; for (const [type, arr] of entries) for (const o of arr) { const d = Math.hypot(o.x - cx, o.y - cy); if (d < bd) { bd = d; best = { type, arr, obj: o }; } } return best; }
function spawnFireballAt(o, arr) { world.fireballs.push({ x: creature.x + 30, y: creature.y + 33, targetX: o.x, targetY: o.y }); setTimeout(() => { const i = arr.indexOf(o); if (i >= 0) { const rem = arr.splice(i, 1)[0]; world.ashes.push(makeAshes(rem.x, rem.y)); } }, 800); }

// Burn: ALWAYS walk up close, then throw from within range.
function performBurn(targetType) {
    targetType = normalizeTarget(targetType);
    const target = findNearestBurnable(targetType);
    if (!target) { statusBox.innerText = `Nothing to burn.`; return; }
    creature.burnGoal = target; creature.act = 'seeking'; statusBox.innerText = "Walking up to burn...";
}
function seekStep(dt) {
    const g = creature.burnGoal;
    if (!g || g.arr.indexOf(g.obj) < 0) { creature.burnGoal = null; creature.act = 'free'; statusBox.innerText = "Wandering aimlessly."; return; }
    const d = Math.hypot(g.obj.x - (creature.x + 30), g.obj.y - (creature.y + 33));
    if (d <= BURN_APPROACH_PX) { creature.burnGoal = null; creature.act = 'busy'; statusBox.innerText = "Casting Fireball!"; spawnFireballAt(g.obj, g.arr); setTimeout(() => { creature.act = 'free'; statusBox.innerText = "Wandering aimlessly."; }, FIREBALL_COOLDOWN_MS); return; }
    stepCreatureToward(g.obj.x, g.obj.y, SEEK_SPEED_MPS * PIXELS_PER_METER * dt * runMult());
}
function castGrow() { if (!world.trees.length) return; creature.act = 'busy'; statusBox.innerText = "Growing nature!"; world.trees.push({ x: world.trees[0].x + (Math.random() * 40 - 20), y: world.trees[0].y + (Math.random() * 40 - 20) }); setTimeout(() => { creature.act = 'free'; statusBox.innerText = "Wandering aimlessly."; }, 2000); }
function castSpreadHuts() { creature.act = 'busy'; statusBox.innerText = "Spreading huts!"; if (world.huts.length) { for (let a = 0; a < 16; a++) { const base = world.huts[Math.floor(Math.random() * world.huts.length)]; const hx = base.x + (Math.random() * 160 - 80), hy = base.y + (Math.random() * 160 - 80); if (canPlaceHut(hx, hy)) { world.huts.push({ x: hx, y: hy }); break; } } } setTimeout(() => { creature.act = 'free'; statusBox.innerText = "Wandering aimlessly."; }, 2000); }

// Goblin burn chain
// Shared village crop field: a rectangular grid south of the village center, filled row by row.
// All villagers of a village target the SAME field, so they collectively fill neat rows/columns.
const FIELD_COLS = 14, FIELD_ROWS = 9;
function nextCropCell(center) {
    if (!center) return null;
    const S = CROP_SPACING;
    const startX = center.x - ((FIELD_COLS - 1) / 2) * S;   // centered horizontally on the village
    const startY = center.y + 55;                            // field begins just south of the village
    for (let r = 0; r < FIELD_ROWS; r++) for (let c = 0; c < FIELD_COLS; c++) {
        const x = startX + c * S, y = startY + r * S;
        if (isWater(x, y, 6)) continue;
        let taken = false; for (const cr of world.crops) if (Math.abs(cr.x - x) < S * 0.5 && Math.abs(cr.y - y) < S * 0.5) { taken = true; break; }
        if (taken) continue;
        let onHut = false; for (const h of world.huts) if (Math.abs((h.x + 25) - x) < 30 && Math.abs((h.y + 25) - y) < 30) { onHut = true; break; }
        if (onHut) continue;
        return { x, y };
    }
    return null;   // field full
}

// Burn-spree campaign: chain-burn a bunch of one target type (or "any")
function burnablePools() { return { tree: world.trees, villager: world.villagers, hut: world.huts, crop: world.crops, goblin: world.goblins }; }
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
function endBurnCampaign() { creature.burnCampaign = null; if (creature.resumeGuard && creature.guard) { creature.act = 'guarding'; statusBox.innerText = 'Guarding the village.'; } else { creature.act = 'free'; creature.resumeGuard = false; statusBox.innerText = 'Wandering aimlessly.'; } }
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

// ---- Shared Gemini call: thinking OFF, JSON output, robust parsing ----
let apiInFlight = 0;
async function callGemini(taskText, maxTokens = 800) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const body = {
        systemInstruction: { parts: [{ text: buildPersona() }] },
        contents: [{ role: "user", parts: [{ text: taskText }] }],
        generationConfig: {
            temperature: 0.9,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 }   // no thinking -> fast, and never an empty MAX_TOKENS reply
        }
    };
    apiInFlight++;
    try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) {
            let detail = ""; try { detail = (await res.json())?.error?.message || ""; } catch (e) { }
            if (res.status === 429) throw new Error("rate limited (429) — too many requests, wait a moment");
            if (res.status === 400 && /api[_ ]?key/i.test(detail)) throw new Error("bad API key (400) — re-enter it via ESC");
            throw new Error(`HTTP ${res.status}${detail ? " — " + detail.slice(0, 120) : ""}`);
        }
        const data = await res.json();
        if (data.promptFeedback && data.promptFeedback.blockReason) throw new Error("blocked: " + data.promptFeedback.blockReason);
        const cand = data.candidates && data.candidates[0];
        const parts = (cand && cand.content && cand.content.parts) || [];
        const txt = parts.map(p => p.text || "").join("").trim();
        if (!txt) throw new Error("empty reply" + (cand && cand.finishReason ? " (" + cand.finishReason + ")" : ""));
        return txt.replace(/```json|```/g, "").trim();
    } finally { apiInFlight--; }
}

// Villager interaction
function finishInteraction() { creature.act = 'free'; creature.interactCooldown = Date.now() + INTERACT_COOLDOWN_MS; statusBox.innerText = "Wandering aimlessly."; }
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
function drawHut(h) { if (imgReady('hut')) { ctx.drawImage(images.hut, h.x, h.y, 50, 50); return; } ctx.fillStyle = '#caa472'; ctx.fillRect(h.x + 6, h.y + 22, 38, 28); ctx.fillStyle = '#8a3b2a'; ctx.beginPath(); ctx.moveTo(h.x + 25, h.y); ctx.lineTo(h.x + 50, h.y + 24); ctx.lineTo(h.x, h.y + 24); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#5a3a22'; ctx.fillRect(h.x + 20, h.y + 34, 11, 16); }
function drawVillager(v) { if (imgReady('villager')) { ctx.drawImage(images.villager, v.x, v.y, 16, 24); return; } ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(v.x + 8, v.y + 5, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#3b6fb0'; ctx.fillRect(v.x + 3, v.y + 10, 10, 14); }
function drawCrop(c) { if (imgReady('crop')) { ctx.drawImage(images.crop, c.x, c.y, 20, 20); return; } ctx.strokeStyle = '#d8b13a'; ctx.lineWidth = 2; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(c.x + 10 + i * 5, c.y + 18); ctx.lineTo(c.x + 10 + i * 5, c.y + 6); ctx.stroke(); } }
function drawShrine(s) { if (imgReady('shrine')) { ctx.drawImage(images.shrine, s.x - 4, s.y - 8, 38, 44); return; } ctx.fillStyle = '#FFD700'; ctx.fillRect(s.x, s.y, 30, 30); }
function drawGoblin(g) { if (imgReady('goblin')) { ctx.drawImage(images.goblin, g.x - 8, g.y - 11, 16, 22); return; } ctx.fillStyle = '#5a7d3a'; ctx.beginPath(); ctx.arc(g.x, g.y - 4, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#3f5a28'; ctx.fillRect(g.x - 4, g.y, 8, 10); }
function drawFireball(f) { if (imgReady('fireball')) { ctx.drawImage(images.fireball, f.x - 12, f.y - 12, 25, 25); return; } const g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, 13); g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ff8c1a'); g.addColorStop(1, 'rgba(200,40,0,0.1)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 13, 0, Math.PI * 2); ctx.fill(); }
function drawAshes(a) { const age = Date.now() - a.born; const alpha = age > (ASH_LIFETIME_MS - ASH_FADE_MS) ? Math.max(0, (ASH_LIFETIME_MS - age) / ASH_FADE_MS) : 1; ctx.globalAlpha = alpha; if (imgReady('ashes')) ctx.drawImage(images.ashes, a.x - 12, a.y - 8, 26, 18); else { ctx.fillStyle = '#3b3b3b'; ctx.beginPath(); ctx.ellipse(a.x, a.y, 12, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#666'; (a.specks || []).forEach(s => ctx.fillRect(a.x + s.dx, a.y + s.dy, 2, 2)); } ctx.globalAlpha = 1; }
function drawCreature() { if (imgReady('creature')) ctx.drawImage(images.creature, creature.x, creature.y, 60, 66); else { ctx.fillStyle = '#e8902a'; ctx.fillRect(creature.x, creature.y, 60, 66); } }
function visible(x, y, pad = 80) { const vw = canvas.width / zoom, vh = canvas.height / zoom; return x > camera.x - pad && x < camera.x + vw + pad && y > camera.y - pad && y < camera.y + vh + pad; }

let lastTs = null;
function renderScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.scale(zoom, zoom); ctx.translate(-camera.x, -camera.y);
    const vw = canvas.width / zoom, vh = canvas.height / zoom;
    ctx.fillStyle = grassPattern || '#4f8f43'; ctx.fillRect(camera.x, camera.y, vw, vh);
    ctx.strokeStyle = '#2c5a26'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
    if (waterCanvas) { const sw = Math.min(vw, WORLD_W - camera.x), sh = Math.min(vh, WORLD_H - camera.y); if (sw > 0 && sh > 0) ctx.drawImage(waterCanvas, camera.x, camera.y, sw, sh, camera.x, camera.y, sw, sh); }
    world.ashes.forEach(a => { if (visible(a.x, a.y)) drawAshes(a); });
    world.shrines.forEach(s => { if (visible(s.x, s.y)) drawShrine(s); });
    world.huts.forEach(h => { if (visible(h.x, h.y)) drawHut(h); });
    world.trees.forEach(t => { if (visible(t.x, t.y)) drawTree(t); });
    world.crops.forEach(c => { if (visible(c.x, c.y)) drawCrop(c); });
    world.villagers.forEach(v => { if (visible(v.x, v.y)) drawVillager(v); });
    world.goblins.forEach(g => { if (visible(g.x, g.y)) drawGoblin(g); });
    world.fireballs.forEach(f => drawFireball(f));
    drawCreature();
    ctx.restore();
}
function draw(ts) {
    if (isPaused) return;
    if (lastTs == null) lastTs = ts || 0;
    let dt = ((ts || 0) - lastTs) / 1000; lastTs = ts || 0; if (dt > 0.05 || dt < 0) dt = 0.05;
    const now = Date.now();

    updateCamera();
    renderScene();

    updateVillagers(dt, now);
    updateCreature(dt, now);
    updateProjectiles();
    updateGoblins(dt);
    updateAshes();
    updateStamina(dt);
    maybeSpawnShrine();
    requestAnimationFrame(draw);
}

// ===========================================================
//  GEMINI (commands)
// ===========================================================
async function sendCommandToGemini(userMessage, key) {
    if (!GEMINI_API_KEY) { narratorSays("No API key yet — press ESC to open settings and add your Gemini key."); return; }
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
- "stop": cancel whatever the creature is doing. Maps: "stop","cancel","halt","that's enough","nevermind".
- "grow": grow more nature.   - "spread_huts": add a hut.   - "speak": only talk.   - "idle": do nothing.

Your "speech" MUST be in your established voice/personality.

Respond ONLY with raw JSON (no fences):
{"action":"burn|burn_many|run|stop_running|guard|stop|grow|spread_huts|speak|idle","target":"tree|villager|hut|crop|goblin|any|null","speech":"in-character line","shortStatusText":"1-6 words"}`;
    try {
        const d = JSON.parse(await callGemini(taskPrompt));
        applyBurnIntent(d, userMessage);                 // make "burn some X" deterministic
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
        if (statusBox.innerText === "Thinking...") statusBox.innerText = "Wandering aimlessly.";
    }
}

// Run a parsed action (shared by fresh API replies and cached rerun commands)
function executeAction(action, target) {
    switch (action) {
        case "burn": performBurn(target); break;
        case "burn_many": startBurnCampaign(target || 'any', Date.now(), false); break;
        case "burn_goblins": startBurnCampaign('goblin', Date.now(), false); break;  // legacy alias
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
        || /\b(trees|huts|houses|homes|villagers|peasants|people|crops|goblins)\b/.test(t);
    let type = null;
    if (/\btrees?\b/.test(t)) type = 'tree';
    else if (/\b(huts?|houses?|homes?)\b/.test(t)) type = 'hut';
    else if (/\b(villagers?|peasants?|people|humans?)\b/.test(t)) type = 'villager';
    else if (/\bcrops?\b/.test(t)) type = 'crop';
    else if (/\bgoblins?\b/.test(t)) type = 'goblin';
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
    let action = headerAction, target = null;
    const bi = burnIntent(cmd);                       // burn lines derive precise action/target from their text
    if (bi) { action = bi.many ? 'burn_many' : 'burn'; target = bi.type || 'any'; }
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
        applyBurnIntent(act, cmd);
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
function regenerateMap() {
    generateWorld();
    buildWaterLayer();
    creature.x = WORLD_W / 2; creature.y = WORLD_H / 2;
    creature.act = 'free'; creature.burnGoal = null; creature.burnCampaign = null; creature.guard = null; creature.resumeGuard = false; creature.running = false;
    creature.stamina = STAMINA_MAX; creature.moveState = 'walking'; creature.heading = Math.random() * Math.PI * 2; creature.stateUntil = Date.now() + 4000; creature.interactCooldown = 0;
    camera.x = creature.x - (canvas.width / zoom) / 2; camera.y = creature.y - (canvas.height / zoom) / 2; clampCamera();
    renderStamina(creature.stamina); lastStamina = creature.stamina;
    saveGame(); updateLog("Map regenerated — a fresh world.");
    renderScene(); if (isPaused) drawRuler();
}
function downloadSave() {
    const state = { version: VERSION, savedAt: new Date().toISOString(), world, creature, camera, zoom, rerunCommands: rerunMemory };
    const lines = [];
    lines.push("=== EGG V2 SAVE ===");
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
    localStorage.removeItem('creatureGameState');
    localStorage.removeItem('rerunCommands');
    localStorage.removeItem('aiCommandLog');
    rerunMemory = {}; aiCommandLog = {};
    creature.hearts = 3;
    chatHistory.innerHTML = ''; actionLog.innerHTML = '';
    regenerateMap();                 // fresh world + creature reset + saves
    renderHearts(creature.hearts);
    updateLog("New game — browser save cleared.");
    narratorSays("A brand-new world begins.");
}
newGameBtn.addEventListener('click', newGame);

// ===========================================================
//  INIT
// ===========================================================
resizeCanvas();
buildGrassPattern();
loadRerunMemory();
loadAiLog();
loadGame();
buildWaterLayer();
loadCreatureVoice();
loadCanned();
renderHearts(creature.hearts);
renderStamina(creature.stamina);
canvas.style.cursor = 'grab';
camera.x = creature.x - (canvas.width / zoom) / 2;
camera.y = creature.y - (canvas.height / zoom) / 2;
clampCamera();
setInterval(saveGame, 10000);
requestAnimationFrame(draw);
