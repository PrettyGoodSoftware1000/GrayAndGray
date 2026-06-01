/* ===========================================================
   EGG V2
   - Scrollable world (WASD/arrows) + zoom (-/=)
   - Procedural rivers, lakes, huts, villagers, goblins, shrines
   - Sprites from /images (backgrounds keyed out)
   - ESC = pause: top ruler (meters) + settings + Action Log
   - HUD vitals: 3 Zelda-style hearts + 5 stamina dots (2 each)
   - Creature walks/stops/turns; greets/eats nearby villagers;
     speaks in a personality from CreatureVoice.txt ("be <style>")
   - Burn / burn goblins (chain) / run / guard the village / stop
   =========================================================== */

const VERSION = "egg-v2";

const PIXELS_PER_METER = 10;
const m2px = (m) => m * PIXELS_PER_METER;

// Speeds & ranges
const WALK_SPEED_MPS = 1.98;            // 33% of the old wander speed
const SEEK_SPEED_MPS = 3.2;
const INTERACT_RANGE_PX = m2px(10);
const INTERACT_COOLDOWN_MS = 10000;
const FIREBALL_RANGE_PX = m2px(15);
const GOBLIN_DETECT_PX = m2px(40);
const GOBLIN_SPEED_MPS = 2.4;
const GOBLIN_CONTACT_PX = 18;
const GOBLIN_CHAIN_RANGE_PX = m2px(50);  // chain to a goblin within 50 m of the last target
const GUARD_ENEMY_RANGE_PX = m2px(40);
const FIREBALL_COOLDOWN_MS = 2000;

// Stamina
const STAMINA_MAX = 10;
const RUN_DRAIN_S = 1;                    // -1 stamina / second running
const STAMINA_REGEN_S = 3;                // +1 stamina / 3 seconds

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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ===========================================================
//  CANVAS / ZOOM
// ===========================================================
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; clampCamera(); if (isPaused) drawRuler(); }
window.addEventListener('resize', resizeCanvas);
function setZoom(nz) {
    nz = clamp(nz, MIN_ZOOM, MAX_ZOOM);
    const cxw = camera.x + (canvas.width / 2) / zoom, cyw = camera.y + (canvas.height / 2) / zoom;
    zoom = nz; camera.x = cxw - (canvas.width / 2) / zoom; camera.y = cyw - (canvas.height / 2) / zoom;
    clampCamera(); if (isPaused) drawRuler();
}

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
//  HUD VITALS  (Zelda-style hearts + stamina dots)
// ===========================================================
const HEART = [
    [0, 1, 1, 0, 0, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0]
];
function heartSVG(state) { // 'full' | 'half' | 'empty'
    let cells = '';
    for (let y = 0; y < HEART.length; y++) for (let x = 0; x < 8; x++) {
        if (!HEART[y][x]) continue;
        let fill = '#f22e2e';
        if (state === 'empty') fill = '#3a1414';
        else if (state === 'half' && x >= 4) fill = '#3a1414';
        cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }
    if (state !== 'empty') cells += '<rect x="1" y="1" width="1" height="1" fill="#ffd0d0"/>'; // glint
    return `<svg width="26" height="23" viewBox="0 0 8 7">${cells}</svg>`;
}
function renderHearts(full, total = 3) {
    let html = ''; for (let i = 0; i < total; i++) html += heartSVG(i < full ? 'full' : 'empty'); heartsEl.innerHTML = html;
}
function renderStamina(s) {
    let html = '';
    for (let i = 0; i < 5; i++) { const cls = s >= i * 2 + 2 ? 'full' : (s === i * 2 + 1 ? 'half' : ''); html += `<div class="stamina-dot ${cls}"></div>`; }
    staminaEl.innerHTML = html;
}

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
    interactCooldown: 0, burnGoal: null, goblinCampaign: null, guard: null, resumeGuard: false,
    running: false, stamina: STAMINA_MAX, regenTimer: 0, drainTimer: 0, hearts: 3,
    spellsUnlocked: ['fireball', 'grow', 'spread_huts']
};

function distToSegment(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy; let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2; t = clamp(t, 0, 1); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
function inLake(x, y, pad = 0) { return world.lakes.some(l => { const nx = (x - l.x) / (l.rx + pad), ny = (y - l.y) / (l.ry + pad); return nx * nx + ny * ny <= 1; }); }
function nearRiver(x, y, pad = 0) { return world.rivers.some(r => { for (let i = 0; i < r.points.length - 1; i++) { const a = r.points[i], b = r.points[i + 1]; if (distToSegment(x, y, a.x, a.y, b.x, b.y) < r.width / 2 + pad) return true; } return false; }); }
function isWater(x, y, pad = 0) { return inLake(x, y, pad) || nearRiver(x, y, pad); }
function findLandSpot(margin = 60, waterPad = 25) { for (let i = 0; i < 80; i++) { const x = margin + Math.random() * (WORLD_W - margin * 2), y = margin + Math.random() * (WORLD_H - margin * 2); if (!isWater(x, y, waterPad)) return { x, y }; } return { x: WORLD_W / 2, y: WORLD_H / 2 }; }
function generateWorld() {
    world = { lakes: [], rivers: [], huts: [], villagers: [], shrines: [], trees: [], crops: [], fireballs: [], goblins: [], goblinGroups: [], ashes: [] };
    for (let i = 0; i < 4; i++) world.lakes.push({ x: 200 + Math.random() * (WORLD_W - 400), y: 200 + Math.random() * (WORLD_H - 400), rx: 70 + Math.random() * 120, ry: 55 + Math.random() * 100 });
    for (let r = 0; r < 2; r++) { const points = []; const horizontal = Math.random() < 0.5; let x = horizontal ? 0 : Math.random() * WORLD_W, y = horizontal ? Math.random() * WORLD_H : 0, angle = horizontal ? 0 : Math.PI / 2; while (x >= -50 && x <= WORLD_W + 50 && y >= -50 && y <= WORLD_H + 50) { points.push({ x, y }); angle += (Math.random() - 0.5) * 0.7; x += Math.cos(angle) * 60; y += Math.sin(angle) * 60; if (points.length > 120) break; } world.rivers.push({ points, width: 22 + Math.random() * 14 }); }
    for (let i = 0; i < 55; i++) world.trees.push(findLandSpot(40, 18));
    for (let s = 0; s < 3; s++) { const center = findLandSpot(120, 60); const hutsHere = 3 + Math.floor(Math.random() * 4); for (let h = 0; h < hutsHere; h++) { const hx = center.x + (Math.random() * 160 - 80), hy = center.y + (Math.random() * 160 - 80); if (!isWater(hx, hy, 20)) world.huts.push({ x: hx, y: hy }); } for (let c = 0; c < 4; c++) { const cx = center.x + (Math.random() * 200 - 100), cy = center.y + (Math.random() * 200 - 100); if (!isWater(cx, cy, 15)) world.crops.push({ x: cx, y: cy }); } }
    for (let i = 0; i < 18; i++) world.villagers.push(findLandSpot(60, 20));
    world.shrines.push(findLandSpot(150, 60));
    for (let g = 0; g < 3; g++) { const c = findLandSpot(120, 40); world.goblinGroups.push({ x: c.x, y: c.y, heading: Math.random() * Math.PI * 2, turnTimer: 120 + Math.random() * 240 }); const n = 2 + Math.floor(Math.random() * 2); for (let i = 0; i < n; i++) world.goblins.push({ x: c.x + (Math.random() * 40 - 20), y: c.y + (Math.random() * 40 - 20), group: g, ox: Math.random() * 30 - 15, oy: Math.random() * 30 - 15 }); }
    updateLog("Generated a fresh world: rivers, lakes, huts, villagers & goblin packs.");
}
function normalizeWorld() { ['lakes', 'rivers', 'huts', 'villagers', 'shrines', 'trees', 'crops', 'fireballs', 'goblins', 'goblinGroups', 'ashes'].forEach(k => { if (!Array.isArray(world[k])) world[k] = []; }); }

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
    // transient / defaulted creature fields
    creature.act = 'free'; creature.burnGoal = null; creature.goblinCampaign = null; creature.guard = null; creature.resumeGuard = false;
    creature.running = false; creature.regenTimer = 0; creature.drainTimer = 0;
    if (creature.stamina === undefined) creature.stamina = STAMINA_MAX;
    if (creature.hearts === undefined) creature.hearts = 3;
    if (creature.moveState === undefined) creature.moveState = 'walking';
    if (creature.heading === undefined) creature.heading = Math.random() * Math.PI * 2;
    creature.interactCooldown = 0; creature.stateUntil = Date.now() + 4000;
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) GEMINI_API_KEY = savedKey; else updateLog("No Gemini API Key yet. Press ESC to open settings and add one.");
}

// ===========================================================
//  VOICE
// ===========================================================
let voiceStyles = {}; let activeVoice = 'snarky';
function parseVoiceStyles(text) { const styles = {}; const re = /\[([^\]]+)\]\s*\{([\s\S]*?)\}/g; let m; while ((m = re.exec(text))) { const header = m[1].trim(); const [namePart, ...descParts] = header.split('|'); const name = namePart.trim().toLowerCase(); const description = descParts.join('|').trim(); const examples = m[2].split(/\r?\n/).map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim()).filter(l => l.length > 0); if (name) styles[name] = { description, examples }; } return styles; }
async function loadCreatureVoice() { try { const res = await fetch('CreatureVoice.txt', { cache: 'no-store' }); if (!res.ok) throw new Error('HTTP ' + res.status); voiceStyles = parseVoiceStyles(await res.text()); const names = Object.keys(voiceStyles); if (!names.length) { updateLog("CreatureVoice.txt had no [style]{...} blocks."); return; } if (!voiceStyles[activeVoice]) activeVoice = names[0]; updateLog(`Creature voices: ${names.join(', ')}. Active: "${activeVoice}". (Type "be <style>".)`); } catch (e) { updateLog(`Couldn't read CreatureVoice.txt (${e.message}); using a default voice.`); } }
function buildPersona() { let base = `You are the brain of EGG, a giant bipedal fire-throwing tiger in a god-game. A human gives you divine voice commands; you respond out loud and may act on the world.`; const style = voiceStyles[activeVoice]; if (style && style.examples.length) { base += `\n\nYour personality/voice is "${activeVoice}"`; if (style.description) base += `: ${style.description}`; base += `.\nExamples of how you talk. Imitate the tone/attitude/word choice; do NOT copy verbatim:\n` + style.examples.map(e => `- ${e}`).join('\n') + `\n\nAlways speak in this voice.`; } else base += `\n\nSpeak with a little personality.`; return base; }
function trySwitchVoice(cmd) { const m = cmd.match(/^\s*be\s+(?:an?\s+|more\s+)?([a-zA-Z]+)\s*[.!]?\s*$/i); if (!m) return false; const name = m[1].toLowerCase(); if (voiceStyles[name]) { activeVoice = name; creatureSays(`(Now speaking in "${name}" style.)`); updateLog(`Voice switched to "${name}".`); return true; } return false; }

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
    if (k === '=' || k === '+') { e.preventDefault(); setZoom(zoom * 1.1); return; }
    if (k === '-' || k === '_') { e.preventDefault(); setZoom(zoom / 1.1); return; }
    if (MOVE_KEYS.includes(k)) { keys[k] = true; if (k.startsWith('arrow')) e.preventDefault(); if (!controlsHintHidden) { controlsHint.style.display = 'none'; controlsHintHidden = true; } }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
commandInput.addEventListener('focus', () => { for (const kk in keys) keys[kk] = false; });
commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = commandInput.value.trim();
        if (cmd) { playerSays(cmd); commandInput.value = ''; if (!handleControl(cmd)) sendCommandToGemini(cmd); }
        commandInput.blur();
    }
});

// Instant, no-API controls (voice switch, stop, slow down)
function handleControl(cmd) {
    if (trySwitchVoice(cmd)) return true;
    if (/\b(slow down|don'?t rush|stop running|ease up|take it easy|chill out|walk normally|quit running)\b/i.test(cmd)) { stopRunning(); creatureSays('(eases back to a walk.)'); return true; }
    if (/^\s*(stop|cancel|halt|cease|enough|abort|never\s?mind|quit it|knock it off|stop it)\s*[.!]?\s*$/i.test(cmd)) { cancelAll(); creatureSays('(stops what it was doing.)'); return true; }
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
function startRunning() { if (creature.stamina <= 0) { statusBox.innerText = 'Too tired to run.'; creatureSays('(too winded to run.)'); return; } creature.running = true; statusBox.innerText = 'Running!'; }
function stopRunning() { creature.running = false; }
function runMult() { return creature.running ? 2 : 1; }

function cancelAll() { creature.act = 'free'; creature.burnGoal = null; creature.goblinCampaign = null; creature.guard = null; creature.resumeGuard = false; creature.running = false; statusBox.innerText = 'Wandering aimlessly.'; }

// ===========================================================
//  WORLD UPDATES
// ===========================================================
function updateVillagers() {
    world.villagers.forEach(v => {
        const nx = v.x + (Math.random() - 0.5) * 1.5, ny = v.y + (Math.random() - 0.5) * 1.5;
        if (!isWater(nx, ny, 10)) { v.x = clamp(nx, 10, WORLD_W - 10); v.y = clamp(ny, 10, WORLD_H - 10); }
        if (Math.random() < 0.0008) { if (Math.random() < 0.5 && !isWater(v.x + 10, v.y + 10, 10)) world.crops.push({ x: v.x + 10, y: v.y + 10 }); else if (!isWater(v.x + 20, v.y + 20, 15)) world.huts.push({ x: v.x + 20, y: v.y + 20 }); }
    });
}
const WALK_STATUS = ["Wandering aimlessly.", "Exploring the map.", "Off to see what's over there.", "Roaming."];
function pickWalkStatus() { return WALK_STATUS[Math.floor(Math.random() * WALK_STATUS.length)]; }
function enterStopped(now) { creature.moveState = 'stopped'; creature.stateUntil = now + (1000 + Math.random() * 2000); creature.heading = Math.random() * Math.PI * 2; statusBox.innerText = "Pausing to look around."; }

function updateCreature(dt, now) {
    if (creature.act === 'busy') return;
    if (creature.act === 'seeking') { seekStep(dt); return; }
    if (creature.act === 'burning_goblins') { updateBurningGoblins(dt, now); return; }
    if (creature.act === 'guarding') { updateGuard(dt, now); return; }
    // free roam
    if (now > creature.interactCooldown) { const v = nearestIn(world.villagers, creature.x + 30, creature.y + 33, INTERACT_RANGE_PX); if (v) { startVillagerInteraction(v.obj, now); return; } }
    if (creature.moveState === 'stopped') { if (now >= creature.stateUntil) { creature.moveState = 'walking'; creature.stateUntil = now + (3000 + Math.random() * 12000); statusBox.innerText = pickWalkStatus(); } return; }
    if (now >= creature.stateUntil) { enterStopped(now); return; }
    const sp = WALK_SPEED_MPS * PIXELS_PER_METER * dt * runMult();
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
function throwFireballAt(target) { creature.act = 'busy'; statusBox.innerText = "Casting Fireball!"; spawnFireballAt(target.obj, target.arr); setTimeout(() => { creature.act = 'free'; statusBox.innerText = "Wandering aimlessly."; }, FIREBALL_COOLDOWN_MS); }
function performBurn(targetType) {
    targetType = normalizeTarget(targetType);
    const target = findNearestBurnable(targetType);
    if (!target) { statusBox.innerText = `Nothing to burn.`; return; }
    const d = Math.hypot(target.obj.x - (creature.x + 30), target.obj.y - (creature.y + 33));
    if (d <= FIREBALL_RANGE_PX) throwFireballAt(target);
    else { creature.burnGoal = target; creature.act = 'seeking'; statusBox.innerText = "Closing in to burn..."; }
}
function seekStep(dt) {
    const g = creature.burnGoal;
    if (!g || g.arr.indexOf(g.obj) < 0) { creature.burnGoal = null; creature.act = 'free'; statusBox.innerText = "Wandering aimlessly."; return; }
    const d = Math.hypot(g.obj.x - (creature.x + 30), g.obj.y - (creature.y + 33));
    if (d <= FIREBALL_RANGE_PX) { creature.burnGoal = null; throwFireballAt(g); return; }
    stepCreatureToward(g.obj.x, g.obj.y, SEEK_SPEED_MPS * PIXELS_PER_METER * dt * runMult());
}
function castGrow() { if (!world.trees.length) return; creature.act = 'busy'; statusBox.innerText = "Growing nature!"; world.trees.push({ x: world.trees[0].x + (Math.random() * 40 - 20), y: world.trees[0].y + (Math.random() * 40 - 20) }); setTimeout(() => { creature.act = 'free'; statusBox.innerText = "Wandering aimlessly."; }, 2000); }
function castSpreadHuts() { if (!world.huts.length) return; creature.act = 'busy'; statusBox.innerText = "Spreading huts!"; world.huts.push({ x: world.huts[0].x + 50, y: world.huts[0].y + (Math.random() * 20 - 10) }); setTimeout(() => { creature.act = 'free'; statusBox.innerText = "Wandering aimlessly."; }, 2000); }

// ---- Goblin burn chain ("burn some goblins") ----
function startGoblinCampaign(now, resumeGuard) {
    if (!world.goblins.length) { statusBox.innerText = 'No goblins to burn.'; if (resumeGuard && creature.guard) creature.act = 'guarding'; else creature.act = 'free'; return; }
    creature.goblinCampaign = { currentTarget: null, lastTargetPos: null, nextThrowReady: 0 };
    creature.resumeGuard = !!resumeGuard; creature.act = 'burning_goblins'; statusBox.innerText = 'Hunting goblins...';
}
function endGoblinCampaign() {
    creature.goblinCampaign = null;
    if (creature.resumeGuard && creature.guard) { creature.act = 'guarding'; statusBox.innerText = 'Guarding the village.'; }
    else { creature.act = 'free'; creature.resumeGuard = false; statusBox.innerText = 'Wandering aimlessly.'; }
}
function updateBurningGoblins(dt, now) {
    const camp = creature.goblinCampaign; if (!camp) { creature.act = 'free'; return; }
    if (!camp.currentTarget || world.goblins.indexOf(camp.currentTarget) < 0) {
        let next = camp.lastTargetPos
            ? nearestIn(world.goblins, camp.lastTargetPos.x, camp.lastTargetPos.y, GOBLIN_CHAIN_RANGE_PX)
            : nearestIn(world.goblins, creature.x + 30, creature.y + 33, Infinity);
        if (!next) { endGoblinCampaign(); return; }
        camp.currentTarget = next.obj;
    }
    const o = camp.currentTarget;
    const d = Math.hypot(o.x - (creature.x + 30), o.y - (creature.y + 33));
    if (d > FIREBALL_RANGE_PX) { stepCreatureToward(o.x, o.y, SEEK_SPEED_MPS * PIXELS_PER_METER * dt * runMult()); statusBox.innerText = 'Hunting goblins...'; }
    else if (now >= camp.nextThrowReady) { statusBox.innerText = 'Burning goblins!'; spawnFireballAt(o, world.goblins); camp.lastTargetPos = { x: o.x, y: o.y }; camp.currentTarget = null; camp.nextThrowReady = now + FIREBALL_COOLDOWN_MS; }
    else statusBox.innerText = 'Reloading...';
}

// ---- Guard the village ----
function startGuard(now) {
    if (!world.huts.length) { statusBox.innerText = 'No village to guard.'; creatureSays('(no village to guard.)'); creature.act = 'free'; return; }
    const cx = creature.x + 30, cy = creature.y + 33; let best = null, bd = Infinity;
    for (const h of world.huts) { const c = { x: h.x + 25, y: h.y + 25 }; const d = Math.hypot(c.x - cx, c.y - cy); if (d < bd) { bd = d; best = c; } }
    creature.guard = { anchor: best, heading: Math.random() * Math.PI * 2, patrolUntil: 0 };
    creature.act = 'guarding'; statusBox.innerText = 'Heading to the village.';
}
function updateGuard(dt, now) {
    const g = creature.guard; if (!g) { creature.act = 'free'; return; }
    const enemy = nearestIn(world.goblins, creature.x + 30, creature.y + 33, GUARD_ENEMY_RANGE_PX);
    if (enemy) { startGoblinCampaign(now, true); return; }
    const cx = creature.x + 30, cy = creature.y + 33, d = Math.hypot(g.anchor.x - cx, g.anchor.y - cy);
    if (d > m2px(8)) { stepCreatureToward(g.anchor.x, g.anchor.y, WALK_SPEED_MPS * PIXELS_PER_METER * dt * runMult()); statusBox.innerText = 'Heading to the village.'; }
    else {
        if (now >= g.patrolUntil) { g.heading = Math.random() * Math.PI * 2; g.patrolUntil = now + (1000 + Math.random() * 2000); statusBox.innerText = 'Guarding the village.'; }
        const sp = WALK_SPEED_MPS * 0.1 * PIXELS_PER_METER * dt * runMult();   // patrol at 10%
        const nx = creature.x + Math.cos(g.heading) * sp, ny = creature.y + Math.sin(g.heading) * sp;
        if (Math.hypot((nx + 30) - g.anchor.x, (ny + 33) - g.anchor.y) < m2px(12) && !isWater(nx + 30, ny + 60, 12)) { creature.x = nx; creature.y = ny; } else g.heading += Math.PI;
    }
}

// ---- Villager interaction ----
function finishInteraction() { creature.act = 'free'; creature.interactCooldown = Date.now() + INTERACT_COOLDOWN_MS; statusBox.innerText = "Wandering aimlessly."; }
function startVillagerInteraction(v) { creature.act = 'busy'; statusBox.innerText = "Approaching a villager."; sendVillagerInteraction(v); }
async function sendVillagerInteraction(v) {
    const apply = (a) => { if (a === 'eat') { const i = world.villagers.indexOf(v); if (i >= 0) world.villagers.splice(i, 1); } };
    if (!GEMINI_API_KEY) { const acts = ['speak', 'eat', 'hug', 'slap', 'fart']; const a = acts[Math.floor(Math.random() * acts.length)]; const lines = { speak: '(leans down and mutters to a villager.)', eat: '(scoops up a villager and eats them. Crunch.)', hug: '(wraps a villager in a giant hug.)', slap: '(slaps a villager. Rude.)', fart: '(turns and farts on a villager.)' }; creatureSays(lines[a]); apply(a); finishInteraction(); return; }
    statusBox.innerText = "Greeting a villager...";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const task = `You wandered right up to a villager. Choose EXACTLY ONE action: "speak","eat","hug","slap","fart". Then narrate what happens in ONE short line, in your voice. Respond ONLY with raw JSON: {"action":"speak|eat|hug|slap|fart","speech":"..."}`;
    try { const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: buildPersona() }] }, contents: [{ parts: [{ text: task }] }] }) }); const data = await res.json(); let txt = data.candidates[0].content.parts[0].text.trim().replace(/```json|```/g, ""); const d = JSON.parse(txt); if (d.speech) creatureSays(d.speech); apply((d.action || '').toLowerCase()); } catch (err) { console.error(err); creatureSays("(does something to a villager.)"); }
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
function draw(ts) {
    if (isPaused) return;
    if (lastTs == null) lastTs = ts || 0;
    let dt = ((ts || 0) - lastTs) / 1000; lastTs = ts || 0; if (dt > 0.05 || dt < 0) dt = 0.05;
    const now = Date.now();

    updateCamera();
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

    updateVillagers();
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
async function sendCommandToGemini(userMessage) {
    if (!GEMINI_API_KEY) { creatureSays("(No API key yet — press ESC to open settings and add your Gemini key.)"); return; }
    statusBox.innerText = "Thinking..."; updateLog(`Sending command to brain: "${userMessage}"`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const worldSummary = { trees: world.trees.length, huts: world.huts.length, villagers: world.villagers.length, crops: world.crops.length, goblins: world.goblins.length, shrines: world.shrines.length };
    const taskPrompt =
`The player just said: "${userMessage}".

World summary (counts): ${JSON.stringify(worldSummary)}

You are a fire-throwing tiger. Choose ONE action:
- "burn": fireball the nearest matching thing (you auto-walk within 15m first). Set "target": "tree","villager","hut","crop","goblin","any". Maps: "burn a <thing>","throw a fireball","torch it","blow something up","incinerate <thing>".
- "burn_goblins": hunt and fireball goblins one after another. Maps: "burn goblins","burn some goblins","kill the goblins","clear the goblins","torch the goblins".
- "run": move at double speed (uses stamina). Maps: "run","hurry","go faster","move faster","pick up the pace","sprint".
- "stop_running": stop running but keep doing the rest. Maps: "slow down","don't rush","ease up","walk".
- "guard": go to the nearest village and patrol it, auto-attacking goblins that come near. Maps: "guard the village","defend the village","protect the town".
- "stop": cancel whatever the creature is currently doing. Maps: "stop","cancel","halt","that's enough","nevermind".
- "grow": grow more nature.   - "spread_huts": add a hut.   - "speak": only talk.   - "idle": do nothing.

Your "speech" MUST be in your established voice/personality.

Respond ONLY with raw JSON (no fences):
{"action":"burn|burn_goblins|run|stop_running|guard|stop|grow|spread_huts|speak|idle","target":"tree|villager|hut|crop|goblin|any|null","speech":"in-character line","shortStatusText":"1-6 words"}`;
    try {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: buildPersona() }] }, contents: [{ parts: [{ text: taskPrompt }] }] }) });
        const data = await response.json(); let txt = data.candidates[0].content.parts[0].text.trim().replace(/```json|```/g, ""); const d = JSON.parse(txt);
        if (d.speech) creatureSays(d.speech);
        switch (d.action) {
            case "burn": performBurn(d.target); break;
            case "burn_goblins": startGoblinCampaign(Date.now(), false); break;
            case "run": startRunning(); break;
            case "stop_running": stopRunning(); break;
            case "guard": startGuard(Date.now()); break;
            case "stop": cancelAll(); break;
            case "grow": castGrow(); break;
            case "spread_huts": castSpreadHuts(); break;
        }
        if (d.shortStatusText && d.action !== 'stop') statusBox.innerText = d.shortStatusText;
    } catch (error) { console.error("API Error:", error); updateLog("Error connecting to Gemini API. Check the console / API key."); }
}

// ===========================================================
//  UI WRITERS
// ===========================================================
function updateLog(message) { actionLog.innerHTML += `<p>&gt; ${message}</p>`; actionLog.scrollTop = actionLog.scrollHeight; }
function playerSays(message) { chatHistory.innerHTML += `<p style="color: yellow;">You: ${escapeHtml(message)}</p>`; chatHistory.scrollTop = chatHistory.scrollHeight; }
function creatureSays(message) { chatHistory.innerHTML += `<p style="color:#7fdfff;">Creature: ${escapeHtml(message)}</p>`; chatHistory.scrollTop = chatHistory.scrollHeight; }
function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ===========================================================
//  INIT
// ===========================================================
resizeCanvas();
buildGrassPattern();
loadGame();
buildWaterLayer();
loadCreatureVoice();
renderHearts(creature.hearts);
renderStamina(creature.stamina);
camera.x = creature.x - (canvas.width / zoom) / 2;
camera.y = creature.y - (canvas.height / zoom) / 2;
clampCamera();
setInterval(saveGame, 10000);
requestAnimationFrame(draw);
