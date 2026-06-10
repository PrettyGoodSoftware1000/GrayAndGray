// ===========================================================
//  CANVAS / ZOOM / PAN
// ===========================================================
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; zoom = clamp(zoom, minZoom(), maxZoom()); clampCamera(); if (isPaused) drawRuler(); }
window.addEventListener('resize', resizeCanvas);

// Zoom, keeping the world point under (ax,ay) fixed. Defaults to screen center.
function setZoom(nz, ax, ay) {
    nz = clamp(nz, minZoom(), maxZoom());
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
const CREATURE_TYPES = ['tiger', 'lion', 'bobcat', 'chameleon', 'frilledlizard', 'lizard', 'wolf', 'bear', 'dragon', 'goat', 'owl', 'cat', 'fox', 'frog', 'snake', 'rhino', 'gorilla', 'hyena', 'panther', 'crocodile'];
const CREATURE_PERSONALITIES = ['adhd', 'snarky', 'nice', 'mean', 'wise', 'grumpy', 'cheerful', 'shy'];
let creatureImages = [], creatureIndex = -1;
function applyCreature(entry) {
    if (!entry) return;
    images.creature = entry.img; activeVoice = (entry.personality || 'adhd').toLowerCase() || 'adhd';
    updateLog(`Creature: ${entry.type} (${entry.personality}). Voice "${activeVoice}".`);
}
function addCreatureImg(img, type, personality) {
    creatureImages.push({ img, type, personality });
    if (creatureIndex < 0) { creatureIndex = 0; applyCreature(creatureImages[0]); }
}
function loadCreatureFromName(raw) {
    let fn = raw.endsWith('.png') ? raw : raw + '.png';
    if (!/^creature_/i.test(fn)) fn = 'creature_' + fn;
    const base = fn.replace(/\.png$/i, '').replace(/^creature_/i, '');
    const parts = base.split('_');
    const personality = parts.length >= 2 ? parts[parts.length - 1] : 'adhd';
    const type = parts.length >= 2 ? parts.slice(0, -1).join('_') : base;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => addCreatureImg(img, type, personality);
    img.src = 'images/creature/' + fn;
}
// Discover creatures: a manifest (images/creature/creatures.txt) handles arbitrary type names;
// otherwise we probe a known type×personality list.
async function loadCreatureImage() {
    creatureImages = []; creatureIndex = -1;
    try {
        const res = await fetch('images/creature/creatures.txt', { cache: 'no-store' });
        if (res.ok) {
            const names = (await res.text()).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#') && !s.startsWith('//'));
            if (names.length) { names.forEach(loadCreatureFromName); updateLog('Loading ' + names.length + ' creatures from creatures.txt.'); return; }
        }
    } catch (e) { }
    for (const t of CREATURE_TYPES) for (const p of CREATURE_PERSONALITIES) {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => addCreatureImg(img, t, p);
        img.src = `images/creature/creature_${t}_${p}.png`;
    }
}
// "change creature" — cycle to the NEXT available creature (loops through all of them, repeatable)
function changeCreature() {
    if (!creatureImages.length) { activeVoice = 'adhd'; narratorSays('No creature images found in images/creature/.'); return; }
    creatureIndex = (creatureIndex + 1) % creatureImages.length;
    applyCreature(creatureImages[creatureIndex]);
    narratorSays('The creature takes a new form.');
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

