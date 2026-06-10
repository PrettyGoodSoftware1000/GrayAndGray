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
        if (living) { const dead = damageEntity(o, arr, FIRE_BASE_DMG); if (dead && arr === world.villagers) onCreatureBurnedVillager(); }   // respects hearts
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
    const SX = WHEAT_PLANTING_SCALE, SY = WHEAT_PLANTING_SCALE / 2;   // vertical spacing is half the horizontal
    const startX = center.x - ((FIELD_COLS - 1) / 2) * SX;   // centered horizontally on the village
    const startY = center.y + 55;                            // field begins just south of the village
    for (let r = 0; r < FIELD_ROWS; r++) for (let c = 0; c < FIELD_COLS; c++) {
        const x = startX + c * SX, y = startY + r * SY;
        let taken = false; for (const cr of world.crops) if (Math.abs(cr.x - x) < SX * 0.4 && Math.abs(cr.y - y) < SY * 0.4) { taken = true; break; }
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
    if (a === 'eat') { const i = world.villagers.indexOf(v); if (i >= 0) { world.villagers.splice(i, 1); onCreatureBurnedVillager(); } }
    finishInteraction();
}

