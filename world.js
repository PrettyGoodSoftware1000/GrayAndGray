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
function hutCollisionDist() { let m = MIN_HUT_DIST_PX; for (const img of variations.hut) m = Math.max(m, (img.naturalWidth || 0) * HUT_DRAW_SCALE, (img.naturalHeight || 0) * HUT_DRAW_SCALE); return m; }
function canPlaceHut(x, y) { if (isWater(x, y, 15)) return false; const cx = x + 25, cy = y + 25, d = hutCollisionDist(); for (const h of world.huts) if (Math.hypot((h.x + 25) - cx, (h.y + 25) - cy) < d) return false; return true; }
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
    for (let s = 0; s < 1; s++) {   // ONE village per map
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
    if (world.villages.length) { const vc = world.villages[0]; world.shrines.push({ x: vc.x, y: vc.y, vseed: Math.random() }); }   // shrine = village center
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
function saveGame() { if (isPaused) return; localStorage.setItem('creatureGameState', JSON.stringify({ version: VERSION, world, creature, camera, zoom, behaviors })); }
function loadGame() {
    const saved = localStorage.getItem('creatureGameState'); let ok = false;
    if (saved) { try { const data = JSON.parse(saved); if (data.version === VERSION && data.world && data.world.rivers) { world = data.world; creature = data.creature; if (data.camera) camera = data.camera; if (data.zoom) zoom = data.zoom; if (data.behaviors) behaviors = data.behaviors; if (typeof data.burn_a_villager === 'number') { normalizeBehaviors(); behaviors.aggressive.entries.burn_a_villager.value = data.burn_a_villager; } normalizeBehaviors(); normalizeWorld(); updateLog("World state loaded."); ok = true; } } catch (e) { console.warn("Bad save, regenerating.", e); } }
    if (!ok) { generateWorld(); placeCreatureInVillage(); }
    resetCreatureRuntime();
}
function placeCreatureInVillage() {
    const vc = world.villages && world.villages[0];
    if (vc) { creature.x = clamp(vc.x - 30, 0, WORLD_W - 60); creature.y = clamp(vc.y - 33, 0, WORLD_H - 66); }
    else { creature.x = WORLD_W / 2; creature.y = WORLD_H / 2; }
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


// Ensure the behaviors object always has the expected shape (covers old/edited saves)
function normalizeBehaviors() {
    if (!behaviors || typeof behaviors !== 'object') behaviors = {};
    const def = { aggressive: { burn_a_villager: { timer: '3:00-4:00', value: 50 } }, helpful: {}, neutral: { go_run: { timer: '0:00', value: 10 } } };
    for (const sec of ['aggressive', 'helpful', 'neutral']) {
        if (!behaviors[sec] || typeof behaviors[sec] !== 'object') behaviors[sec] = {};
        if (typeof behaviors[sec].multiplier !== 'number') behaviors[sec].multiplier = 1.0;
        if (!behaviors[sec].entries || typeof behaviors[sec].entries !== 'object') behaviors[sec].entries = {};
        for (const name in def[sec]) if (!behaviors[sec].entries[name]) behaviors[sec].entries[name] = Object.assign({}, def[sec][name]);
    }
}
