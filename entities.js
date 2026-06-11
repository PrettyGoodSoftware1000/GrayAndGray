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
    if (r < 0.8) {                                                                                 // explore for 10-40 s
        creature.ncUntil = now + (10 + Math.random() * 30) * 1000;
        creature.moveState = 'walking'; creature.stateUntil = now + (3000 + Math.random() * 9000); statusBox.innerText = pickWalkStatus();
    } else {                                                                                       // rest for 10-120 s
        creature.ncUntil = now + (10 + Math.random() * 110) * 1000;
        creature.moveState = 'stopped'; creature.stateUntil = creature.ncUntil; statusBox.innerText = 'Resting.';
    }
}
// --- Behavior system helpers ---
function parseTimerRange(t) {
    const toSec = (str) => { const m = String(str).split(':'); return (parseInt(m[0], 10) || 0) * 60 + (parseInt(m[1], 10) || 0); };
    const parts = String(t || '0:00').split('-');
    const min = toSec(parts[0]); const max = parts[1] ? toSec(parts[1]) : min;
    return { min, max: Math.max(min, max) };
}
function behaviorChance(section, name) { const b = behaviors[section]; if (!b || !b.entries[name]) return 0; return (b.entries[name].value || 0) * (b.multiplier || 1); }
function maybeAlsoRun() { if (Math.random() * 100 < behaviorChance('neutral', 'go_run')) startRunning(); }   // run in addition to a commanded action
function bumpGoRun() { const e = behaviors.neutral && behaviors.neutral.entries.go_run; if (e) e.value = Math.min(100, (e.value || 0) + 10); }
function updateBehaviors(now) {
    if (creature.dead || creature.act !== 'free') return;     // autonomous behaviors only when NOT commanded
    const e = behaviors.aggressive && behaviors.aggressive.entries.burn_a_villager;
    if (!e) return;
    const reroll = () => { const r = parseTimerRange(e.timer); behaviorTimers.burn_a_villager = now + (r.min + Math.random() * (r.max - r.min)) * 1000; };
    if (!behaviorTimers.burn_a_villager) { reroll(); return; }
    if (now >= behaviorTimers.burn_a_villager) {
        reroll();                                              // timer restarts whether or not it burns
        const v = nearestIn(world.villagers, creature.x + 30, creature.y + 33, m2px(25));   // villager within 25 m?
        if (v && Math.random() * 100 < behaviorChance('aggressive', 'burn_a_villager')) performBurn('villager');
    }
}
// --- Explore command: head toward the nearest unexplored (black) area ---
function findNearestFog() {
    if (!fogCtx) return null;
    let data; try { data = fogCtx.getImageData(0, 0, fogCanvas.width, fogCanvas.height).data; } catch (e) { return null; }
    const fw = fogCanvas.width, fh = fogCanvas.height, cfx = (creature.x + 30) / FOG_SCALE, cfy = (creature.y + 33) / FOG_SCALE;
    let best = null, bd = Infinity, step = 3;
    for (let y = 0; y < fh; y += step) for (let x = 0; x < fw; x += step) {
        if (data[(y * fw + x) * 4 + 3] > 10) { const dx = x - cfx, dy = y - cfy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = { x: x * FOG_SCALE, y: y * FOG_SCALE }; } }
    }
    return best;
}
function startExplore() { creature.exploreTarget = null; creature.act = 'exploring'; statusBox.innerText = 'Exploring the unknown...'; }
function updateExplore(dt) {
    if (!creature.exploreTarget) { const t = findNearestFog(); if (!t) { narratorSays('The map is fully explored.'); creature.act = 'free'; creature.ncUntil = 0; return; } creature.exploreTarget = t; }
    const t = creature.exploreTarget, d = Math.hypot(t.x - (creature.x + 30), t.y - (creature.y + 33));
    if (d < VISION_PX * 0.6) { creature.exploreTarget = null; return; }                  // close enough -> it's uncovered; retarget
    stepCreatureToward(t.x, t.y, WANDER_SPEED_MPS * PIXELS_PER_METER * dt * runMult());
    statusBox.innerText = 'Exploring the unknown...';
}
function updateCreature(dt, now) {
    if (creature.dead) return;
    creatureAutoAttack(now);                                            // attacking ALWAYS takes precedence
    updateBehaviors(now);                                               // autonomous behaviors (only act when free)
    if (creature.act === 'busy') return;
    if (creature.act === 'seeking') { seekStep(dt); return; }
    if (creature.act === 'burning') { updateBurnCampaign(dt, now); return; }
    if (creature.act === 'attacking') { updateAttackCampaign(dt, now); return; }
    if (creature.act === 'eating') { updateEatCampaign(dt, now); return; }
    if (creature.act === 'guarding') { updateGuard(dt, now); return; }
    if (creature.act === 'goto') { updateGoto(dt); return; }
    if (creature.act === 'exploring') { updateExplore(dt); return; }
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
function attackablePool(type) { return ({ goblin: world.goblins, ogre: world.ogres, villager: world.villagers, tree: world.trees, hut: world.huts, crop: world.crops })[type] || null; }
function nearestEnemyOfType(type, x, y, maxPx) {
    let best = null, bd = maxPx;
    const scan = (arr) => { for (const o of arr) { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = { obj: o, arr, dist: d }; } } };
    const pool = attackablePool(type);
    if (pool) scan(pool);
    else { scan(world.goblins); scan(world.ogres); }       // no/unknown target -> ENEMIES ONLY (goblins + ogres)
    return best;
}
function startAttackCampaign(type, now) {
    type = normalizeTarget(type);                          // map plurals/synonyms (goblins->goblin, etc.)
    if (!attackablePool(type)) type = 'any';               // anything not directly attackable -> enemies only
    const first = nearestEnemyOfType(type, creature.x + 30, creature.y + 33, Infinity);
    if (!first) { statusBox.innerText = (type === 'any' ? 'No enemies to attack.' : 'Nothing to attack.'); creature.act = 'free'; return; }
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
    else if (now >= camp.nextHit) { statusBox.innerText = 'Attacking!'; narrateAttack(camp.arr, now); const wasVillager = (camp.arr === world.villagers); const dead = damageEntity(o, camp.arr, CREATURE_ATTACK_DMG); if (dead) { camp.lastPos = { x: o.x, y: o.y }; camp.cur = null; camp.arr = null; if (wasVillager) onCreatureBurnedVillager(); } camp.nextHit = now + CREATURE_ATTACK_MS; }
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

