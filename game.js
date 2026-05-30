/* ===========================================================
   EGG v1
   - Large scrollable world (WASD / arrow keys)
   - Procedural rivers, lakes, huts, villagers, goblins
   - Grass texture, sprites from /images (backgrounds keyed out)
   - ESC = pause: shows a top ruler (in "meters") + settings + Action Log
   - Creature wanders directionally, speaks back in a personality
     loaded from CreatureVoice.txt; switch with "be <style>"
   - "burn"/"throw a fireball"/etc -> fireball -> ashes (fade @ 2 min)
   - Goblins roam in packs; kill nearby villagers, burn nearby huts
   =========================================================== */

const VERSION = "egg-v1.2";

// ---- Game scale: our made-up distance unit ----
const PIXELS_PER_METER = 10;        // 10 px = 1 "meter"  (world = 300m x 220m)
const m2px = (m) => m * PIXELS_PER_METER;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const rulerCanvas = document.getElementById('ruler');
const rulerCtx = rulerCanvas.getContext('2d');
const actionLog = document.getElementById('action-log');
const chatHistory = document.getElementById('chat-history');
const commandInput = document.getElementById('command-input');
const statusBox = document.getElementById('creature-status');
const controlsHint = document.getElementById('controls-hint');

// Pause / settings DOM
const pausePanel = document.getElementById('pause-panel');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const apiKeyInput = document.getElementById('api-key-input');

// --- WORLD DIMENSIONS ---
const WORLD_W = 3000;
const WORLD_H = 2200;

// --- Goblin tuning (in meters) ---
const GOBLIN_DETECT_M = 15;                 // how close before goblins attack
const GOBLIN_DETECT_PX = m2px(GOBLIN_DETECT_M);
const GOBLIN_CONTACT_PX = 18;               // close enough to kill/burn
const GOBLIN_CHASE_SPEED = 1.6;

// --- Ashes ---
const ASH_LIFETIME_MS = 120000;             // 2 minutes
const ASH_FADE_MS = 20000;                  // fade over the final 20s

// Global State
let isPaused = false;
let GEMINI_API_KEY = "";

// Camera
let camera = { x: 0, y: 0 };
const CAMERA_SPEED = 7;
const keys = {};
let controlsHintHidden = false;

// ===========================================================
//  CANVAS SIZING
// ===========================================================
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    clampCamera();
    if (isPaused) drawRuler();
}
window.addEventListener('resize', resizeCanvas);

// ===========================================================
//  SPRITES  (images/<name>.png, with background keyed out)
// ===========================================================
const SPRITE_KEYS = ['creature', 'tree', 'hut', 'villager', 'crop', 'shrine', 'fireball', 'goblin', 'ashes'];
const images = {};

function loadSprite(key) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { images[key] = removeBackground(img) || img; updateLog(`Loaded sprite: ${key}`); };
    img.onerror = () => console.warn(`No image for "${key}" (images/${key}.png) — using a drawn placeholder.`);
    img.src = `images/${key}.png`;
}

// Flood-fill the solid background out from the edges so no box shows.
// Already-transparent PNGs are left as-is; tainted canvas falls back safely.
function removeBackground(img) {
    try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0);
        const d = cx.getImageData(0, 0, w, h);
        const px = d.data;
        if (px[3] === 0) return img; // already transparent bg
        const br = px[0], bg = px[1], bb = px[2], tol = 42;
        const visited = new Uint8Array(w * h), stack = [];
        const match = (i) => { const o = i * 4; return px[o + 3] > 10 && Math.abs(px[o] - br) <= tol && Math.abs(px[o + 1] - bg) <= tol && Math.abs(px[o + 2] - bb) <= tol; };
        for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + w - 1); }
        while (stack.length) {
            const i = stack.pop();
            if (i < 0 || i >= w * h || visited[i]) continue;
            visited[i] = 1;
            if (!match(i)) continue;
            px[i * 4 + 3] = 0;
            const x = i % w, y = (i / w) | 0;
            if (x > 0) stack.push(i - 1);
            if (x < w - 1) stack.push(i + 1);
            if (y > 0) stack.push(i - w);
            if (y < h - 1) stack.push(i + w);
        }
        cx.putImageData(d, 0, 0);
        return c;
    } catch (e) {
        console.warn('Background removal skipped (canvas read blocked).', e);
        return img;
    }
}
function imgReady(key) { const i = images[key]; return !!i && ((i.width || i.naturalWidth) > 0); }
SPRITE_KEYS.forEach(loadSprite);

// ===========================================================
//  GRASS TEXTURE
// ===========================================================
let grassPattern = null;
function buildGrassPattern() {
    const tile = document.createElement('canvas');
    tile.width = 48; tile.height = 48;
    const t = tile.getContext('2d');
    t.fillStyle = '#4f8f43'; t.fillRect(0, 0, 48, 48);
    t.fillStyle = 'rgba(60,120,50,0.5)';
    for (let i = 0; i < 6; i++) t.fillRect(Math.random() * 48, Math.random() * 48, 4, 4);
    for (let i = 0; i < 16; i++) {
        const x = Math.random() * 48, y = Math.random() * 48;
        t.strokeStyle = Math.random() < 0.5 ? '#5fa84f' : '#3f7a36';
        t.lineWidth = 1; t.beginPath(); t.moveTo(x, y); t.lineTo(x + (Math.random() * 2 - 1), y - 3 - Math.random() * 2); t.stroke();
    }
    grassPattern = ctx.createPattern(tile, 'repeat');
}

// ===========================================================
//  WORLD STATE
// ===========================================================
let world = {
    lakes: [], rivers: [], huts: [], villagers: [],
    shrines: [], trees: [], crops: [], fireballs: [],
    goblins: [], goblinGroups: [], ashes: []
};

let creature = {
    x: WORLD_W / 2, y: WORLD_H / 2,
    state: "idle",
    heading: Math.random() * Math.PI * 2,   // directional wandering
    wanderTimer: 0,
    spellsUnlocked: ['fireball', 'grow', 'spread_huts']
};

// ---- Geometry helpers ----
function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function inLake(x, y, pad = 0) {
    return world.lakes.some(l => { const nx = (x - l.x) / (l.rx + pad), ny = (y - l.y) / (l.ry + pad); return nx * nx + ny * ny <= 1; });
}
function nearRiver(x, y, pad = 0) {
    return world.rivers.some(r => {
        for (let i = 0; i < r.points.length - 1; i++) {
            const a = r.points[i], b = r.points[i + 1];
            if (distToSegment(x, y, a.x, a.y, b.x, b.y) < r.width / 2 + pad) return true;
        }
        return false;
    });
}
function isWater(x, y, pad = 0) { return inLake(x, y, pad) || nearRiver(x, y, pad); }
function findLandSpot(margin = 60, waterPad = 25) {
    for (let i = 0; i < 80; i++) {
        const x = margin + Math.random() * (WORLD_W - margin * 2);
        const y = margin + Math.random() * (WORLD_H - margin * 2);
        if (!isWater(x, y, waterPad)) return { x, y };
    }
    return { x: WORLD_W / 2, y: WORLD_H / 2 };
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---- Procedural generation ----
function generateWorld() {
    world = { lakes: [], rivers: [], huts: [], villagers: [], shrines: [], trees: [], crops: [], fireballs: [], goblins: [], goblinGroups: [], ashes: [] };

    for (let i = 0; i < 4; i++) world.lakes.push({ x: 200 + Math.random() * (WORLD_W - 400), y: 200 + Math.random() * (WORLD_H - 400), rx: 70 + Math.random() * 120, ry: 55 + Math.random() * 100 });

    for (let r = 0; r < 2; r++) {
        const points = [];
        const horizontal = Math.random() < 0.5;
        let x = horizontal ? 0 : Math.random() * WORLD_W;
        let y = horizontal ? Math.random() * WORLD_H : 0;
        let angle = horizontal ? 0 : Math.PI / 2;
        while (x >= -50 && x <= WORLD_W + 50 && y >= -50 && y <= WORLD_H + 50) {
            points.push({ x, y });
            angle += (Math.random() - 0.5) * 0.7;
            x += Math.cos(angle) * 60; y += Math.sin(angle) * 60;
            if (points.length > 120) break;
        }
        world.rivers.push({ points, width: 22 + Math.random() * 14 });
    }

    for (let i = 0; i < 55; i++) world.trees.push(findLandSpot(40, 18));

    for (let s = 0; s < 3; s++) {
        const center = findLandSpot(120, 60);
        const hutsHere = 3 + Math.floor(Math.random() * 4);
        for (let h = 0; h < hutsHere; h++) {
            const hx = center.x + (Math.random() * 160 - 80), hy = center.y + (Math.random() * 160 - 80);
            if (!isWater(hx, hy, 20)) world.huts.push({ x: hx, y: hy });
        }
        for (let c = 0; c < 4; c++) {
            const cx = center.x + (Math.random() * 200 - 100), cy = center.y + (Math.random() * 200 - 100);
            if (!isWater(cx, cy, 15)) world.crops.push({ x: cx, y: cy });
        }
    }

    for (let i = 0; i < 18; i++) world.villagers.push(findLandSpot(60, 20));

    // A couple of starter shrines; more appear over time.
    world.shrines.push(findLandSpot(150, 60));

    // Goblin packs of 2-3 wandering around a drifting anchor.
    for (let g = 0; g < 3; g++) {
        const c = findLandSpot(120, 40);
        world.goblinGroups.push({ x: c.x, y: c.y });
        const n = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < n; i++)
            world.goblins.push({ x: c.x + (Math.random() * 40 - 20), y: c.y + (Math.random() * 40 - 20), group: g, ox: Math.random() * 30 - 15, oy: Math.random() * 30 - 15 });
    }

    updateLog("Generated a fresh world: rivers, lakes, huts, villagers & goblin packs.");
}

function normalizeWorld() {
    ['lakes', 'rivers', 'huts', 'villagers', 'shrines', 'trees', 'crops', 'fireballs', 'goblins', 'goblinGroups', 'ashes']
        .forEach(k => { if (!Array.isArray(world[k])) world[k] = []; });
}

// ===========================================================
//  WATER LAYER (single flat union -> no doubled borders)
// ===========================================================
let waterCanvas = null;
function buildWaterLayer() {
    waterCanvas = document.createElement('canvas');
    waterCanvas.width = WORLD_W; waterCanvas.height = WORLD_H;
    const w = waterCanvas.getContext('2d');
    w.fillStyle = '#3a6ea5';
    world.lakes.forEach(l => { w.beginPath(); w.ellipse(l.x, l.y, l.rx, l.ry, 0, 0, Math.PI * 2); w.fill(); });
    world.rivers.forEach(r => {
        w.strokeStyle = '#3a6ea5'; w.lineWidth = r.width; w.lineJoin = 'round'; w.lineCap = 'round';
        w.beginPath(); r.points.forEach((p, i) => i === 0 ? w.moveTo(p.x, p.y) : w.lineTo(p.x, p.y)); w.stroke();
    });
    w.globalCompositeOperation = 'source-atop';
    w.strokeStyle = 'rgba(130,185,230,0.22)'; w.lineWidth = 1;
    for (let i = 0; i < 1600; i++) { const x = Math.random() * WORLD_W, y = Math.random() * WORLD_H; w.beginPath(); w.moveTo(x, y); w.lineTo(x + 4, y); w.stroke(); }
    w.globalCompositeOperation = 'source-over';
}

// ===========================================================
//  PAUSE / SETTINGS / RULER
// ===========================================================
function drawRuler() {
    rulerCanvas.width = window.innerWidth;
    rulerCanvas.height = 30;
    const r = rulerCtx;
    r.clearRect(0, 0, rulerCanvas.width, 30);
    r.fillStyle = 'rgba(0,0,0,0.75)'; r.fillRect(0, 0, rulerCanvas.width, 30);
    r.strokeStyle = '#0f0'; r.fillStyle = '#0f0'; r.font = '10px monospace'; r.textBaseline = 'top'; r.lineWidth = 1;
    const leftM = camera.x / PIXELS_PER_METER;
    const rightM = (camera.x + rulerCanvas.width) / PIXELS_PER_METER;
    for (let m = Math.ceil(leftM / 2) * 2; m <= rightM; m += 2) {
        const sx = m * PIXELS_PER_METER - camera.x;
        const major = (m % 10 === 0);
        r.beginPath(); r.moveTo(sx, 30); r.lineTo(sx, major ? 13 : 22); r.stroke();
        if (major) r.fillText(m + 'm', sx + 2, 2);
    }
}
function pauseGame() {
    isPaused = true;
    apiKeyInput.value = GEMINI_API_KEY;
    pausePanel.classList.add('open');
    rulerCanvas.style.display = 'block';
    drawRuler();
}
function resumeGame() {
    GEMINI_API_KEY = apiKeyInput.value.trim();
    localStorage.setItem('gemini_api_key', GEMINI_API_KEY);
    pausePanel.classList.remove('open');
    rulerCanvas.style.display = 'none';
    isPaused = false;
    updateLog("Game resumed.");
    requestAnimationFrame(draw);
}
function togglePause() { isPaused ? resumeGame() : pauseGame(); }
saveSettingsBtn.addEventListener('click', resumeGame);

// ===========================================================
//  LOCAL STORAGE
// ===========================================================
function saveGame() {
    if (isPaused) return;
    localStorage.setItem('creatureGameState', JSON.stringify({ version: VERSION, world, creature, camera }));
}
function loadGame() {
    const saved = localStorage.getItem('creatureGameState');
    let ok = false;
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if (data.version === VERSION && data.world && data.world.rivers) {
                world = data.world; creature = data.creature;
                if (data.camera) camera = data.camera;
                normalizeWorld();
                if (creature.heading === undefined) creature.heading = Math.random() * Math.PI * 2;
                updateLog("World state loaded."); ok = true;
            }
        } catch (e) { console.warn("Bad save, regenerating.", e); }
    }
    if (!ok) generateWorld();
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) GEMINI_API_KEY = savedKey;
    else updateLog("No Gemini API Key yet. Press ESC to open settings and add one.");
}

// ===========================================================
//  CREATURE VOICE (CreatureVoice.txt)
// ===========================================================
let voiceStyles = {};
let activeVoice = 'snarky';

function parseVoiceStyles(text) {
    const styles = {};
    const re = /\[([^\]]+)\]\s*\{([\s\S]*?)\}/g;
    let m;
    while ((m = re.exec(text))) {
        const header = m[1].trim();
        const [namePart, ...descParts] = header.split('|');
        const name = namePart.trim().toLowerCase();
        const description = descParts.join('|').trim();
        const examples = m[2].split(/\r?\n/).map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim()).filter(l => l.length > 0);
        if (name) styles[name] = { description, examples };
    }
    return styles;
}
async function loadCreatureVoice() {
    try {
        const res = await fetch('CreatureVoice.txt', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        voiceStyles = parseVoiceStyles(await res.text());
        const names = Object.keys(voiceStyles);
        if (!names.length) { updateLog("CreatureVoice.txt found but had no [style]{...} blocks."); return; }
        if (!voiceStyles[activeVoice]) activeVoice = names[0];
        updateLog(`Creature voices loaded: ${names.join(', ')}. Active: "${activeVoice}". (Type "be <style>" to switch.)`);
    } catch (e) {
        updateLog(`Couldn't read CreatureVoice.txt (${e.message}); using a default voice.`);
    }
}
function buildPersona() {
    let base = `You are the brain of EGG, a giant bipedal fire-throwing tiger in a god-game. A human gives you divine voice commands; you respond out loud and may act on the world.`;
    const style = voiceStyles[activeVoice];
    if (style && style.examples.length) {
        base += `\n\nYour personality/voice is "${activeVoice}"`;
        if (style.description) base += `: ${style.description}`;
        base += `.\nBelow are examples of how you talk. Imitate the tone, attitude, rhythm and word choice. Capture the STYLE — do not copy these lines verbatim:\n`
              + style.examples.map(e => `- ${e}`).join('\n')
              + `\n\nAlways speak to the player in this voice.`;
    } else { base += `\n\nSpeak with a little personality.`; }
    return base;
}
// "be snarky" / "be nice" -> switch voice locally (no API call)
function trySwitchVoice(cmd) {
    const m = cmd.match(/^\s*be\s+(?:an?\s+|more\s+)?([a-zA-Z]+)\s*[.!]?\s*$/i);
    if (!m) return false;
    const name = m[1].toLowerCase();
    if (voiceStyles[name]) {
        activeVoice = name;
        creatureSays(`(Now speaking in "${name}" style.)`);
        updateLog(`Voice switched to "${name}".`);
        return true;
    }
    return false; // unknown style -> let the AI handle it as a normal command
}

// ===========================================================
//  INPUT
// ===========================================================
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
function typingInInput() { return document.activeElement === commandInput || document.activeElement === apiKeyInput; }

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); togglePause(); return; }
    if (typingInInput()) return;
    if (MOVE_KEYS.includes(k)) {
        keys[k] = true;
        if (k.startsWith('arrow')) e.preventDefault();
        if (!controlsHintHidden) { controlsHint.style.display = 'none'; controlsHintHidden = true; }
    }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function clampCamera() {
    camera.x = clamp(camera.x, 0, Math.max(0, WORLD_W - canvas.width));
    camera.y = clamp(camera.y, 0, Math.max(0, WORLD_H - canvas.height));
}
function updateCamera() {
    if (isPaused) return;
    if (keys['w'] || keys['arrowup']) camera.y -= CAMERA_SPEED;
    if (keys['s'] || keys['arrowdown']) camera.y += CAMERA_SPEED;
    if (keys['a'] || keys['arrowleft']) camera.x -= CAMERA_SPEED;
    if (keys['d'] || keys['arrowright']) camera.x += CAMERA_SPEED;
    clampCamera();
}

// ===========================================================
//  WORLD UPDATES
// ===========================================================
function updateVillagers() {
    world.villagers.forEach(v => {
        const nx = v.x + (Math.random() - 0.5) * 1.5, ny = v.y + (Math.random() - 0.5) * 1.5;
        if (!isWater(nx, ny, 10)) { v.x = clamp(nx, 10, WORLD_W - 10); v.y = clamp(ny, 10, WORLD_H - 10); }
        if (Math.random() < 0.0008) {
            if (Math.random() < 0.5 && !isWater(v.x + 10, v.y + 10, 10)) world.crops.push({ x: v.x + 10, y: v.y + 10 });
            else if (!isWater(v.x + 20, v.y + 20, 15)) world.huts.push({ x: v.x + 20, y: v.y + 20 });
        }
    });
}

// Directional wander: pick a heading, hold it a while, then change.
function updateCreature() {
    if (creature.state !== "idle") return;
    if (creature.wanderTimer <= 0) {
        creature.heading = Math.random() * Math.PI * 2;
        creature.wanderTimer = 120 + Math.floor(Math.random() * 240); // ~2-6s at 60fps
        if (Math.random() < 0.5) {
            const b = ["Wandering aimlessly.", "Exploring the map.", "Off to see what's over there.", "Roaming."];
            statusBox.innerText = b[Math.floor(Math.random() * b.length)];
        }
    }
    const speed = 1.0;
    let nx = creature.x + Math.cos(creature.heading) * speed;
    let ny = creature.y + Math.sin(creature.heading) * speed;
    // Turn away from world edges or water instead of walking into them.
    if (nx < 0 || nx > WORLD_W - 60 || ny < 0 || ny > WORLD_H - 66 || isWater(nx + 30, ny + 60, 12)) {
        creature.heading += Math.PI * (0.5 + Math.random() * 0.5);
        creature.wanderTimer = 40;
    } else {
        creature.x = nx; creature.y = ny;
    }
    creature.wanderTimer--;
}

function updateProjectiles() {
    for (let i = world.fireballs.length - 1; i >= 0; i--) {
        const f = world.fireballs[i];
        const dx = f.targetX - f.x, dy = f.targetY - f.y, dist = Math.hypot(dx, dy);
        if (dist < 5) world.fireballs.splice(i, 1);
        else { f.x += (dx / dist) * 6; f.y += (dy / dist) * 6; }
    }
}

function updateAshes() {
    const now = Date.now();
    for (let i = world.ashes.length - 1; i >= 0; i--)
        if (now - world.ashes[i].born > ASH_LIFETIME_MS) world.ashes.splice(i, 1);
}

function maybeSpawnShrine() {
    if (world.shrines.length >= 8) return;
    if (Math.random() < 0.0006) {           // infrequent (~ once per 28s avg)
        world.shrines.push(findLandSpot(80, 40));
        updateLog("A shrine has appeared.");
    }
}

// ---- Goblins ----
function nearestIn(arr, fromX, fromY, maxPx) {
    let best = null, bd = maxPx;
    for (const o of arr) { const d = Math.hypot(o.x - fromX, o.y - fromY); if (d < bd) { bd = d; best = { obj: o, dist: d }; } }
    return best;
}
function updateGoblins() {
    world.goblinGroups.forEach(g => {
        g.x = clamp(g.x + (Math.random() - 0.5) * 1.2, 40, WORLD_W - 40);
        g.y = clamp(g.y + (Math.random() - 0.5) * 1.2, 40, WORLD_H - 40);
    });
    for (const gob of world.goblins) {
        const v = nearestIn(world.villagers, gob.x, gob.y, GOBLIN_DETECT_PX);
        const h = v ? null : nearestIn(world.huts, gob.x, gob.y, GOBLIN_DETECT_PX);
        if (v) {
            stepToward(gob, v.obj.x, v.obj.y, GOBLIN_CHASE_SPEED);
            if (v.dist < GOBLIN_CONTACT_PX) { const i = world.villagers.indexOf(v.obj); if (i >= 0) world.villagers.splice(i, 1); }
        } else if (h) {
            stepToward(gob, h.obj.x + 25, h.obj.y + 25, GOBLIN_CHASE_SPEED);
            if (Math.hypot(gob.x - (h.obj.x + 25), gob.y - (h.obj.y + 25)) < GOBLIN_CONTACT_PX) {
                const i = world.huts.indexOf(h.obj);
                if (i >= 0) { world.huts.splice(i, 1); world.ashes.push(makeAshes(h.obj.x + 25, h.obj.y + 25)); }
            }
        } else {
            // wander around the pack's drifting anchor
            const a = world.goblinGroups[gob.group] || { x: gob.x, y: gob.y };
            const tx = a.x + (gob.ox || 0), ty = a.y + (gob.oy || 0);
            const dx = tx - gob.x, dy = ty - gob.y, d = Math.hypot(dx, dy) || 1;
            const nx = gob.x + (dx / d) * 0.6 + (Math.random() - 0.5), ny = gob.y + (dy / d) * 0.6 + (Math.random() - 0.5);
            if (!isWater(nx, ny, 8)) { gob.x = nx; gob.y = ny; }
        }
        gob.x = clamp(gob.x, 6, WORLD_W - 6);
        gob.y = clamp(gob.y, 6, WORLD_H - 6);
    }
}
function stepToward(o, tx, ty, speed) {
    const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy) || 1;
    o.x += (dx / d) * speed; o.y += (dy / d) * speed;
}

// ===========================================================
//  ACTIONS (burn / grow / spread_huts)
// ===========================================================
function makeAshes(x, y) {
    const specks = [];
    for (let k = 0; k < 6; k++) specks.push({ dx: Math.random() * 18 - 9, dy: Math.random() * 8 - 4 });
    return { x, y, born: Date.now(), specks };
}
function normalizeTarget(t) {
    if (!t) return 'any';
    t = String(t).toLowerCase();
    const map = { trees: 'tree', villagers: 'villager', huts: 'hut', house: 'hut', home: 'hut', crops: 'crop', goblins: 'goblin', something: 'any', anything: 'any', nearest: 'any' };
    return map[t] || t;
}
function findNearestBurnable(targetType) {
    const pools = { tree: world.trees, villager: world.villagers, hut: world.huts, crop: world.crops, goblin: world.goblins };
    const entries = pools[targetType] ? [[targetType, pools[targetType]]] : Object.entries(pools);
    const cx = creature.x + 30, cy = creature.y + 33;
    let best = null, bd = Infinity;
    for (const [type, arr] of entries)
        for (const o of arr) { const d = Math.hypot(o.x - cx, o.y - cy); if (d < bd) { bd = d; best = { type, arr, obj: o }; } }
    return best;
}
function performBurn(targetType) {
    targetType = normalizeTarget(targetType);
    const target = findNearestBurnable(targetType);
    if (!target) { statusBox.innerText = `Nothing to burn.`; return; }
    creature.state = "casting";
    statusBox.innerText = "Casting Fireball!";
    world.fireballs.push({ x: creature.x + 30, y: creature.y + 33, targetX: target.obj.x, targetY: target.obj.y });
    setTimeout(() => {
        const i = target.arr.indexOf(target.obj);
        if (i >= 0) { const o = target.arr.splice(i, 1)[0]; world.ashes.push(makeAshes(o.x, o.y)); }
    }, 800);
    setTimeout(() => { creature.state = "idle"; statusBox.innerText = "Wandering aimlessly."; }, 2000);
}
function castGrow() {
    if (!world.trees.length) return;
    creature.state = "casting"; statusBox.innerText = "Growing nature!";
    world.trees.push({ x: world.trees[0].x + (Math.random() * 40 - 20), y: world.trees[0].y + (Math.random() * 40 - 20) });
    setTimeout(() => { creature.state = "idle"; statusBox.innerText = "Wandering aimlessly."; }, 2000);
}
function castSpreadHuts() {
    if (!world.huts.length) return;
    creature.state = "casting"; statusBox.innerText = "Spreading huts!";
    world.huts.push({ x: world.huts[0].x + 50, y: world.huts[0].y + (Math.random() * 20 - 10) });
    setTimeout(() => { creature.state = "idle"; statusBox.innerText = "Wandering aimlessly."; }, 2000);
}

// ===========================================================
//  DRAW HELPERS
// ===========================================================
function drawTree(t) {
    if (imgReady('tree')) { ctx.drawImage(images.tree, t.x, t.y, 35, 45); return; }
    ctx.fillStyle = '#6b4226'; ctx.fillRect(t.x + 14, t.y + 28, 7, 17);
    ctx.fillStyle = '#2e6b2e'; ctx.beginPath(); ctx.moveTo(t.x + 17, t.y); ctx.lineTo(t.x + 34, t.y + 32); ctx.lineTo(t.x, t.y + 32); ctx.closePath(); ctx.fill();
}
function drawHut(h) {
    if (imgReady('hut')) { ctx.drawImage(images.hut, h.x, h.y, 50, 50); return; }
    ctx.fillStyle = '#caa472'; ctx.fillRect(h.x + 6, h.y + 22, 38, 28);
    ctx.fillStyle = '#8a3b2a'; ctx.beginPath(); ctx.moveTo(h.x + 25, h.y); ctx.lineTo(h.x + 50, h.y + 24); ctx.lineTo(h.x, h.y + 24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a3a22'; ctx.fillRect(h.x + 20, h.y + 34, 11, 16);
}
function drawVillager(v) {
    if (imgReady('villager')) { ctx.drawImage(images.villager, v.x, v.y, 16, 24); return; }
    ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(v.x + 8, v.y + 5, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b6fb0'; ctx.fillRect(v.x + 3, v.y + 10, 10, 14);
}
function drawCrop(c) {
    if (imgReady('crop')) { ctx.drawImage(images.crop, c.x, c.y, 20, 20); return; }
    ctx.strokeStyle = '#d8b13a'; ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(c.x + 10 + i * 5, c.y + 18); ctx.lineTo(c.x + 10 + i * 5, c.y + 6); ctx.stroke(); }
}
function drawShrine(s) {
    if (imgReady('shrine')) { ctx.drawImage(images.shrine, s.x - 4, s.y - 8, 38, 44); return; }
    ctx.fillStyle = '#FFD700'; ctx.fillRect(s.x, s.y, 30, 30);
}
function drawGoblin(g) {
    if (imgReady('goblin')) { ctx.drawImage(images.goblin, g.x - 8, g.y - 11, 16, 22); return; }
    ctx.fillStyle = '#5a7d3a'; ctx.beginPath(); ctx.arc(g.x, g.y - 4, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3f5a28'; ctx.fillRect(g.x - 4, g.y, 8, 10);
}
function drawFireball(f) {
    if (imgReady('fireball')) { ctx.drawImage(images.fireball, f.x - 12, f.y - 12, 25, 25); return; }
    const g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, 13);
    g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ff8c1a'); g.addColorStop(1, 'rgba(200,40,0,0.1)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 13, 0, Math.PI * 2); ctx.fill();
}
function drawAshes(a) {
    const age = Date.now() - a.born;
    const alpha = age > (ASH_LIFETIME_MS - ASH_FADE_MS) ? Math.max(0, (ASH_LIFETIME_MS - age) / ASH_FADE_MS) : 1;
    ctx.globalAlpha = alpha;
    if (imgReady('ashes')) { ctx.drawImage(images.ashes, a.x - 12, a.y - 8, 26, 18); }
    else {
        ctx.fillStyle = '#3b3b3b'; ctx.beginPath(); ctx.ellipse(a.x, a.y, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#666'; (a.specks || []).forEach(s => ctx.fillRect(a.x + s.dx, a.y + s.dy, 2, 2));
    }
    ctx.globalAlpha = 1;
}
function drawCreature() {
    if (imgReady('creature')) ctx.drawImage(images.creature, creature.x, creature.y, 60, 66);
    else { ctx.fillStyle = '#e8902a'; ctx.fillRect(creature.x, creature.y, 60, 66); }
}
function visible(x, y, pad = 80) {
    return x > camera.x - pad && x < camera.x + canvas.width + pad && y > camera.y - pad && y < camera.y + canvas.height + pad;
}

// ===========================================================
//  MAIN RENDER LOOP
// ===========================================================
function draw() {
    if (isPaused) return;
    updateCamera();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    ctx.fillStyle = grassPattern || '#4f8f43';
    ctx.fillRect(camera.x, camera.y, canvas.width, canvas.height);
    ctx.strokeStyle = '#2c5a26'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    if (waterCanvas) {
        const sw = Math.min(canvas.width, WORLD_W - camera.x), sh = Math.min(canvas.height, WORLD_H - camera.y);
        if (sw > 0 && sh > 0) ctx.drawImage(waterCanvas, camera.x, camera.y, sw, sh, camera.x, camera.y, sw, sh);
    }

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
    updateCreature();
    updateProjectiles();
    updateGoblins();
    updateAshes();
    maybeSpawnShrine();
    requestAnimationFrame(draw);
}

// ===========================================================
//  GEMINI API
// ===========================================================
async function sendCommandToGemini(userMessage) {
    if (!GEMINI_API_KEY) { creatureSays("(No API key yet — press ESC to open settings and add your Gemini key.)"); return; }
    statusBox.innerText = "Thinking...";
    updateLog(`Sending command to brain: "${userMessage}"`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const worldSummary = {
        trees: world.trees.length, huts: world.huts.length, villagers: world.villagers.length,
        crops: world.crops.length, goblins: world.goblins.length, shrines: world.shrines.length,
        lakes: world.lakes.length, rivers: world.rivers.length
    };

    const taskPrompt =
`The player just said: "${userMessage}".

World summary (counts): ${JSON.stringify(worldSummary)}

You are a fire-throwing tiger. Choose ONE action:
- "burn": hurl a fireball at the nearest matching thing and destroy it (leaves ashes).
   Set "target" to one of: "tree","villager","hut","crop","goblin", or "any" for the nearest thing.
   Map ALL of these to a burn: "burn something","burn a <thing>","throw a fireball","torch it",
   "blow something up","i want to see something burned","set fire to <thing>", "incinerate <thing>".
- "grow": grow more nature.
- "spread_huts": add a hut.
- "speak": only talk.
- "idle": do nothing.

Your "speech" MUST be in your established voice/personality.

Respond ONLY with raw JSON (no markdown, no code fences):
{"action":"burn|grow|spread_huts|speak|idle","target":"tree|villager|hut|crop|goblin|any|null","speech":"in-character line","shortStatusText":"1-6 words"}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ systemInstruction: { parts: [{ text: buildPersona() }] }, contents: [{ parts: [{ text: taskPrompt }] }] })
        });
        const data = await response.json();
        let txt = data.candidates[0].content.parts[0].text.trim().replace(/```json|```/g, "");
        const d = JSON.parse(txt);

        if (d.speech) creatureSays(d.speech);
        switch (d.action) {
            case "burn": performBurn(d.target); break;
            case "grow": castGrow(); break;
            case "spread_huts": castSpreadHuts(); break;
        }
        if (d.shortStatusText) statusBox.innerText = d.shortStatusText;
    } catch (error) {
        console.error("API Error:", error);
        updateLog("Error connecting to Gemini API. Check the console / API key.");
        statusBox.innerText = "Wandering aimlessly."; creature.state = "idle";
    }
}

// ===========================================================
//  UI WRITERS
// ===========================================================
function updateLog(message) { actionLog.innerHTML += `<p>&gt; ${message}</p>`; actionLog.scrollTop = actionLog.scrollHeight; }
function playerSays(message) { chatHistory.innerHTML += `<p style="color: yellow;">You: ${escapeHtml(message)}</p>`; chatHistory.scrollTop = chatHistory.scrollHeight; }
function creatureSays(message) { chatHistory.innerHTML += `<p style="color:#7fdfff;">Creature: ${escapeHtml(message)}</p>`; chatHistory.scrollTop = chatHistory.scrollHeight; }
function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ===========================================================
//  CHAT INPUT
// ===========================================================
commandInput.addEventListener('keypress', function (e) {
    if (isPaused) return;
    if (e.key === 'Enter' && commandInput.value.trim() !== '') {
        const cmd = commandInput.value.trim();
        playerSays(cmd);
        commandInput.value = '';
        if (trySwitchVoice(cmd)) return;   // "be snarky" / "be nice"
        sendCommandToGemini(cmd);
    }
});

// ===========================================================
//  INIT
// ===========================================================
resizeCanvas();
buildGrassPattern();
loadGame();
buildWaterLayer();
loadCreatureVoice();
camera.x = creature.x - canvas.width / 2;
camera.y = creature.y - canvas.height / 2;
clampCamera();
setInterval(saveGame, 10000);
requestAnimationFrame(draw);
