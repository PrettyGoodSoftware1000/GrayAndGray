/* ===========================================================
   EGG v1
   - Large scrollable world (WASD / arrow keys)
   - Procedural rivers, lakes, huts, villagers
   - Simple grass texture
   - Creature sprite loaded from GitHub
   - Creature can talk back in the Action Log
   =========================================================== */

const VERSION = "egg-v1";

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const actionLog = document.getElementById('action-log');
const chatHistory = document.getElementById('chat-history');
const commandInput = document.getElementById('command-input');
const statusBox = document.getElementById('creature-status');

// Settings DOM elements
const settingsModal = document.getElementById('settings-modal');
const settingsBtn = document.getElementById('settings-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const apiKeyInput = document.getElementById('api-key-input');

// --- WORLD DIMENSIONS (bigger than the screen, so you can scroll) ---
const WORLD_W = 3000;
const WORLD_H = 2200;

// Global State
let isPaused = false;
let GEMINI_API_KEY = "";

// Camera = top-left corner of the viewport, in world coordinates
let camera = { x: 0, y: 0 };
const CAMERA_SPEED = 7;
const keys = {};

// --- CANVAS SIZING (fills the screen) ---
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    clampCamera();
}
window.addEventListener('resize', resizeCanvas);

// --- IMAGE LOADING (non-blocking; missing sprites fall back to shapes) ---
const images = {};
const spriteFiles = {
    // The creature sprite is served from the project's GitHub repo.
    creature: 'https://raw.githubusercontent.com/PrettyGoodSoftware1000/GrayAndGray/main/creature_placeholder.png',
    // These remain local placeholders. If absent, we draw simple shapes instead.
    tree: 'tree_placeholder.png',
    hut: 'hut_placeholder.png',
    villager: 'villager_placeholder.png',
    crop: 'crop_placeholder.png',
    fireball: 'fireball_placeholder.png'
};

Object.entries(spriteFiles).forEach(([key, filename]) => {
    const img = new Image();
    // GitHub raw sends permissive CORS headers, so this is safe for canvas.
    if (filename.startsWith('http')) img.crossOrigin = 'anonymous';
    img.src = filename;
    img.onload = () => updateLog(`Loaded sprite: ${key}`);
    img.onerror = () => console.warn(`No image for "${key}" (${filename}) — using a drawn placeholder.`);
    images[key] = img;
});

// Returns true if an image actually decoded and is usable.
function imgReady(key) {
    const i = images[key];
    return i && i.complete && i.naturalWidth > 0;
}

// --- GRASS TEXTURE (offscreen repeating tile) ---
let grassPattern = null;
function buildGrassPattern() {
    const tile = document.createElement('canvas');
    tile.width = 48;
    tile.height = 48;
    const tctx = tile.getContext('2d');

    // Base grass fill
    tctx.fillStyle = '#4f8f43';
    tctx.fillRect(0, 0, 48, 48);

    // Subtle blotches for variation
    tctx.fillStyle = 'rgba(60, 120, 50, 0.5)';
    for (let i = 0; i < 6; i++) {
        const x = Math.random() * 48, y = Math.random() * 48;
        tctx.fillRect(x, y, 4, 4);
    }

    // Tiny grass tufts (little blades)
    for (let i = 0; i < 16; i++) {
        const x = Math.random() * 48;
        const y = Math.random() * 48;
        tctx.strokeStyle = Math.random() < 0.5 ? '#5fa84f' : '#3f7a36';
        tctx.lineWidth = 1;
        tctx.beginPath();
        tctx.moveTo(x, y);
        tctx.lineTo(x + (Math.random() * 2 - 1), y - 3 - Math.random() * 2);
        tctx.stroke();
    }

    grassPattern = ctx.createPattern(tile, 'repeat');
}

// --- WORLD STATE ---
let world = {
    lakes: [],       // {x, y, rx, ry}
    rivers: [],      // [{points:[{x,y}...], width}]
    huts: [],
    villagers: [],
    shrines: [],
    trees: [],
    crops: [],
    fireballs: []
};

let creature = {
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    state: "idle",
    spellsUnlocked: ['fireball', 'grow', 'spread_huts']
};

// --- GEOMETRY HELPERS ---
function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
}

function inLake(x, y, pad = 0) {
    return world.lakes.some(l => {
        const nx = (x - l.x) / (l.rx + pad);
        const ny = (y - l.y) / (l.ry + pad);
        return nx * nx + ny * ny <= 1;
    });
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

function isWater(x, y, pad = 0) {
    return inLake(x, y, pad) || nearRiver(x, y, pad);
}

// Find a random spot on dry land, away from edges.
function findLandSpot(margin = 60, waterPad = 25) {
    for (let i = 0; i < 80; i++) {
        const x = margin + Math.random() * (WORLD_W - margin * 2);
        const y = margin + Math.random() * (WORLD_H - margin * 2);
        if (!isWater(x, y, waterPad)) return { x, y };
    }
    return { x: WORLD_W / 2, y: WORLD_H / 2 }; // fallback
}

// --- PROCEDURAL WORLD GENERATION ---
function generateWorld() {
    world = { lakes: [], rivers: [], huts: [], villagers: [], shrines: [], trees: [], crops: [], fireballs: [] };

    // Lakes: a few irregular blobs
    const lakeCount = 4;
    for (let i = 0; i < lakeCount; i++) {
        world.lakes.push({
            x: 200 + Math.random() * (WORLD_W - 400),
            y: 200 + Math.random() * (WORLD_H - 400),
            rx: 70 + Math.random() * 120,
            ry: 55 + Math.random() * 100
        });
    }

    // Rivers: wandering polylines crossing the map
    const riverCount = 2;
    for (let r = 0; r < riverCount; r++) {
        const points = [];
        const horizontal = Math.random() < 0.5;
        let x = horizontal ? 0 : Math.random() * WORLD_W;
        let y = horizontal ? Math.random() * WORLD_H : 0;
        let angle = horizontal ? 0 : Math.PI / 2;
        const step = 60;
        while (x >= -50 && x <= WORLD_W + 50 && y >= -50 && y <= WORLD_H + 50) {
            points.push({ x, y });
            angle += (Math.random() - 0.5) * 0.7; // wander
            x += Math.cos(angle) * step;
            y += Math.sin(angle) * step;
            if (points.length > 120) break;
        }
        world.rivers.push({ points, width: 22 + Math.random() * 14 });
    }

    // Trees scattered on land
    for (let i = 0; i < 55; i++) {
        const p = findLandSpot(40, 18);
        world.trees.push(p);
    }

    // Huts grouped into a couple of little settlements
    const settlements = 3;
    for (let s = 0; s < settlements; s++) {
        const center = findLandSpot(120, 60);
        const hutsHere = 3 + Math.floor(Math.random() * 4);
        for (let h = 0; h < hutsHere; h++) {
            const hx = center.x + (Math.random() * 160 - 80);
            const hy = center.y + (Math.random() * 160 - 80);
            if (!isWater(hx, hy, 20)) world.huts.push({ x: hx, y: hy });
        }
        // A few crops next to each settlement
        for (let c = 0; c < 4; c++) {
            const cx = center.x + (Math.random() * 200 - 100);
            const cy = center.y + (Math.random() * 200 - 100);
            if (!isWater(cx, cy, 15)) world.crops.push({ x: cx, y: cy });
        }
    }

    // Villagers scattered on land
    for (let i = 0; i < 18; i++) {
        world.villagers.push(findLandSpot(60, 20));
    }

    // One shrine (kept as a golden square for the fireball mechanic)
    const shrine = findLandSpot(150, 60);
    world.shrines.push({ x: shrine.x, y: shrine.y, spell: 'fireball' });

    updateLog("Generated a fresh world: rivers, lakes, huts & villagers placed.");
}

// --- PAUSE & MENU LOGIC ---
function openSettings() {
    isPaused = true;
    apiKeyInput.value = GEMINI_API_KEY;
    settingsModal.style.display = 'flex';
}

function closeSettings() {
    GEMINI_API_KEY = apiKeyInput.value.trim();
    localStorage.setItem('gemini_api_key', GEMINI_API_KEY);
    settingsModal.style.display = 'none';
    isPaused = false;
    updateLog("Game resumed.");
    requestAnimationFrame(draw);
}

// --- LOCAL STORAGE ---
function saveGame() {
    if (isPaused) return;
    localStorage.setItem('creatureGameState', JSON.stringify({ version: VERSION, world, creature, camera }));
}

function loadGame() {
    const savedState = localStorage.getItem('creatureGameState');
    let loadedOk = false;
    if (savedState) {
        try {
            const data = JSON.parse(savedState);
            // Only restore saves that match this version (older saves lack rivers/lakes).
            if (data.version === VERSION && data.world && data.world.rivers) {
                world = data.world;
                creature = data.creature;
                if (data.camera) camera = data.camera;
                if (!world.fireballs) world.fireballs = [];
                updateLog("World state loaded.");
                loadedOk = true;
            }
        } catch (e) {
            console.warn("Could not parse saved game, regenerating.", e);
        }
    }
    if (!loadedOk) generateWorld();

    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        GEMINI_API_KEY = savedKey;
    } else {
        updateLog("⚠️ No Gemini API Key found. Click Settings to add one.");
    }
}

settingsBtn.addEventListener('click', openSettings);
saveSettingsBtn.addEventListener('click', closeSettings);

// --- INPUT: camera scrolling ---
function typingInInput() {
    return document.activeElement === commandInput || document.activeElement === apiKeyInput;
}

window.addEventListener('keydown', (e) => {
    if (typingInInput()) return;
    keys[e.key.toLowerCase()] = true;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
        e.preventDefault();
    }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function clampCamera() {
    const maxX = Math.max(0, WORLD_W - canvas.width);
    const maxY = Math.max(0, WORLD_H - canvas.height);
    camera.x = Math.max(0, Math.min(maxX, camera.x));
    camera.y = Math.max(0, Math.min(maxY, camera.y));
}

function updateCamera() {
    if (isPaused) return;
    if (keys['w'] || keys['arrowup']) camera.y -= CAMERA_SPEED;
    if (keys['s'] || keys['arrowdown']) camera.y += CAMERA_SPEED;
    if (keys['a'] || keys['arrowleft']) camera.x -= CAMERA_SPEED;
    if (keys['d'] || keys['arrowright']) camera.x += CAMERA_SPEED;
    clampCamera();
}

// --- UPDATE LOOPS ---
function updateVillagers() {
    world.villagers.forEach(v => {
        const nx = v.x + (Math.random() - 0.5) * 1.5;
        const ny = v.y + (Math.random() - 0.5) * 1.5;
        // Stay on land and inside the world.
        if (!isWater(nx, ny, 10)) {
            v.x = Math.max(10, Math.min(WORLD_W - 10, nx));
            v.y = Math.max(10, Math.min(WORLD_H - 10, ny));
        }
        if (Math.random() < 0.0008) {
            if (Math.random() < 0.5 && !isWater(v.x + 10, v.y + 10, 10)) {
                world.crops.push({ x: v.x + 10, y: v.y + 10 });
            } else if (!isWater(v.x + 20, v.y + 20, 15)) {
                world.huts.push({ x: v.x + 20, y: v.y + 20 });
            }
        }
    });
}

function updateCreature() {
    if (creature.state === "idle") {
        creature.x += (Math.random() - 0.5) * 0.8;
        creature.y += (Math.random() - 0.5) * 0.8;
        creature.x = Math.max(0, Math.min(WORLD_W - 60, creature.x));
        creature.y = Math.max(0, Math.min(WORLD_H - 66, creature.y));
        if (Math.random() < 0.005) {
            const behaviors = ["Wandering aimlessly.", "Sniffing a tree.", "Watching a villager.", "Daydreaming."];
            statusBox.innerText = behaviors[Math.floor(Math.random() * behaviors.length)];
        }
    }
}

function updateProjectiles() {
    for (let i = world.fireballs.length - 1; i >= 0; i--) {
        const f = world.fireballs[i];
        const dx = f.targetX - f.x;
        const dy = f.targetY - f.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 5) {
            world.fireballs.splice(i, 1);
        } else {
            f.x += (dx / dist) * 5;
            f.y += (dy / dist) * 5;
        }
    }
}

// --- SPELLS ---
function castSpell(spellName) {
    creature.state = "casting";

    if (spellName === 'fireball') {
        const target = world.trees[0] || world.villagers[0] || world.crops[0];
        if (target) {
            statusBox.innerText = "Casting Fireball!";
            world.fireballs.push({ x: creature.x + 30, y: creature.y + 30, targetX: target.x, targetY: target.y });
            setTimeout(() => {
                if (world.trees.includes(target)) world.trees.splice(world.trees.indexOf(target), 1);
                else if (world.villagers.includes(target)) world.villagers.splice(world.villagers.indexOf(target), 1);
                else if (world.crops.includes(target)) world.crops.splice(world.crops.indexOf(target), 1);
            }, 800);
        }
    } else if (spellName === 'grow' && (world.trees.length > 0 || world.crops.length > 0)) {
        statusBox.innerText = "Growing nature!";
        if (world.trees.length > 0) {
            world.trees.push({
                x: world.trees[0].x + (Math.random() * 40 - 20),
                y: world.trees[0].y + (Math.random() * 40 - 20)
            });
        }
    } else if (spellName === 'spread_huts' && world.huts.length > 0) {
        statusBox.innerText = "Spreading huts!";
        world.huts.push({ x: world.huts[0].x + 50, y: world.huts[0].y + (Math.random() * 20 - 10) });
    }

    setTimeout(() => {
        creature.state = "idle";
        statusBox.innerText = "Wandering aimlessly.";
    }, 2000);
}

// --- DRAW HELPERS (fallback shapes when an image is missing) ---
function drawWater() {
    // Lakes
    world.lakes.forEach(l => {
        ctx.fillStyle = '#3a6ea5';
        ctx.beginPath();
        ctx.ellipse(l.x, l.y, l.rx, l.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(120, 180, 230, 0.35)'; // lighter rim
        ctx.beginPath();
        ctx.ellipse(l.x, l.y, l.rx * 0.7, l.ry * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
    });
    // Rivers
    world.rivers.forEach(r => {
        ctx.strokeStyle = '#3a6ea5';
        ctx.lineWidth = r.width;
        ctx.linejoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        r.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
        ctx.strokeStyle = 'rgba(120, 180, 230, 0.4)';
        ctx.lineWidth = Math.max(2, r.width * 0.4);
        ctx.stroke();
    });
}

function drawTree(t) {
    if (imgReady('tree')) { ctx.drawImage(images.tree, t.x, t.y, 35, 45); return; }
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(t.x + 14, t.y + 28, 7, 17);          // trunk
    ctx.fillStyle = '#2e6b2e';
    ctx.beginPath();
    ctx.moveTo(t.x + 17, t.y);
    ctx.lineTo(t.x + 34, t.y + 32);
    ctx.lineTo(t.x, t.y + 32);
    ctx.closePath();
    ctx.fill();
}

function drawHut(h) {
    if (imgReady('hut')) { ctx.drawImage(images.hut, h.x, h.y, 50, 50); return; }
    ctx.fillStyle = '#caa472';
    ctx.fillRect(h.x + 6, h.y + 22, 38, 28);           // body
    ctx.fillStyle = '#8a3b2a';
    ctx.beginPath();
    ctx.moveTo(h.x + 25, h.y);
    ctx.lineTo(h.x + 50, h.y + 24);
    ctx.lineTo(h.x, h.y + 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(h.x + 20, h.y + 34, 11, 16);          // door
}

function drawVillager(v) {
    if (imgReady('villager')) { ctx.drawImage(images.villager, v.x, v.y, 16, 24); return; }
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.arc(v.x + 8, v.y + 5, 5, 0, Math.PI * 2);      // head
    ctx.fill();
    ctx.fillStyle = '#3b6fb0';
    ctx.fillRect(v.x + 3, v.y + 10, 10, 14);           // body
}

function drawCrop(c) {
    if (imgReady('crop')) { ctx.drawImage(images.crop, c.x, c.y, 20, 20); return; }
    ctx.strokeStyle = '#d8b13a';
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(c.x + 10 + i * 5, c.y + 18);
        ctx.lineTo(c.x + 10 + i * 5, c.y + 6);
        ctx.stroke();
    }
}

function drawFireball(f) {
    if (imgReady('fireball')) { ctx.drawImage(images.fireball, f.x, f.y, 25, 25); return; }
    const g = ctx.createRadialGradient(f.x + 12, f.y + 12, 2, f.x + 12, f.y + 12, 13);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(0.5, '#ff8c1a');
    g.addColorStop(1, 'rgba(200,40,0,0.1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x + 12, f.y + 12, 13, 0, Math.PI * 2);
    ctx.fill();
}

function drawCreature() {
    if (imgReady('creature')) {
        ctx.drawImage(images.creature, creature.x, creature.y, 60, 66);
    } else {
        ctx.fillStyle = '#e8902a';
        ctx.fillRect(creature.x, creature.y, 60, 66);
    }
}

// Cull objects outside the viewport for performance.
function visible(x, y, pad = 80) {
    return x > camera.x - pad && x < camera.x + canvas.width + pad &&
           y > camera.y - pad && y < camera.y + canvas.height + pad;
}

// --- MAIN RENDER LOOP ---
function draw() {
    if (isPaused) return;

    updateCamera();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Grass texture across the visible region (pattern scrolls with the world)
    if (grassPattern) {
        ctx.fillStyle = grassPattern;
        ctx.fillRect(camera.x, camera.y, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#4f8f43';
        ctx.fillRect(camera.x, camera.y, canvas.width, canvas.height);
    }

    // World edge so you can tell where the map ends
    ctx.strokeStyle = '#2c5a26';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    drawWater();

    // Shrines (golden squares, kept for fireball mechanic)
    ctx.fillStyle = '#FFD700';
    world.shrines.forEach(s => { if (visible(s.x, s.y)) ctx.fillRect(s.x, s.y, 30, 30); });

    world.huts.forEach(h => { if (visible(h.x, h.y)) drawHut(h); });
    world.trees.forEach(t => { if (visible(t.x, t.y)) drawTree(t); });
    world.crops.forEach(c => { if (visible(c.x, c.y)) drawCrop(c); });
    world.villagers.forEach(v => { if (visible(v.x, v.y)) drawVillager(v); });
    world.fireballs.forEach(f => drawFireball(f));

    drawCreature();

    ctx.restore();

    // Engine updates
    updateVillagers();
    updateCreature();
    updateProjectiles();

    requestAnimationFrame(draw);
}

// --- LIVE GEMINI API CONNECTION ---
async function sendCommandToGemini(userMessage) {
    if (!GEMINI_API_KEY) {
        updateLog("⚠️ Cannot contact AI: Missing API Key in Settings.");
        return;
    }

    statusBox.innerText = "Thinking...";
    updateLog(`Sending command to brain: "${userMessage}"`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    // Trimmed world summary (the full world is large now)
    const worldSummary = {
        trees: world.trees.length,
        huts: world.huts.length,
        villagers: world.villagers.length,
        crops: world.crops.length,
        lakes: world.lakes.length,
        rivers: world.rivers.length
    };

    const promptContext = {
        contents: [{
            parts: [{
                text: `You are the brain of a giant autonomous tiger that stands on two legs.
The user has given you a divine voice command: "${userMessage}".

Current world summary (counts of things that exist): ${JSON.stringify(worldSummary)}
Your spells unlocked: ${JSON.stringify(creature.spellsUnlocked)}

Decide what to do. You may cast a spell, or just speak, or idle.
Always include a short line of "speech" — what the tiger says back to the user in its own voice.

Respond ONLY with a raw JSON object matching this schema (no markdown, no code fences):
{
  "action": "cast_spell" | "speak" | "idle",
  "spellName": "fireball" | "grow" | "spread_huts" | null,
  "speech": "a short in-character line the tiger says",
  "shortStatusText": "1-to-6 word summary of what you are doing"
}`
            }]
        }]
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(promptContext)
        });

        const data = await response.json();
        let aiTextResponse = data.candidates[0].content.parts[0].text.trim();
        aiTextResponse = aiTextResponse.replace(/```json|```/g, "");
        const aiDecision = JSON.parse(aiTextResponse);

        // The creature talks back, in both the Action Log and the chat.
        if (aiDecision.speech) {
            updateLog(`🐯 Creature: ${aiDecision.speech}`);
            chatHistory.innerHTML += `<p style="color:#7fdfff;">Creature: ${aiDecision.speech}</p>`;
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }

        if (aiDecision.action === "cast_spell" && aiDecision.spellName) {
            castSpell(aiDecision.spellName);
        }
        if (aiDecision.shortStatusText) {
            statusBox.innerText = aiDecision.shortStatusText;
        }

    } catch (error) {
        console.error("API Error:", error);
        updateLog("❌ Error connecting to Gemini API. Check console/API key.");
        statusBox.innerText = "Wandering aimlessly.";
        creature.state = "idle";
    }
}

function updateLog(message) {
    actionLog.innerHTML += `<p>> ${message}</p>`;
    actionLog.scrollTop = actionLog.scrollHeight;
}

// --- CHAT INPUT LISTENER ---
commandInput.addEventListener('keypress', function (e) {
    if (isPaused) return;
    if (e.key === 'Enter' && commandInput.value.trim() !== '') {
        const cmd = commandInput.value;
        chatHistory.innerHTML += `<p style="color: yellow;">User: ${cmd}</p>`;
        chatHistory.scrollTop = chatHistory.scrollHeight;
        sendCommandToGemini(cmd);
        commandInput.value = '';
    }
});

// --- INITIALIZATION ---
resizeCanvas();
buildGrassPattern();
loadGame();
// Center the camera on the creature at startup.
camera.x = creature.x - canvas.width / 2;
camera.y = creature.y - canvas.height / 2;
clampCamera();
setInterval(saveGame, 10000);
requestAnimationFrame(draw); // Loop starts now; missing sprites use drawn placeholders.
