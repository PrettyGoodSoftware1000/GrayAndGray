// ===========================================================
//  MAP REGEN / FILE SAVE
// ===========================================================
function regenerateMap(opts) {
    generateWorld(opts);
    buildWaterLayer();
    initFog();
    raidSize = 3;
    placeCreatureInVillage();
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
            if (typeof data.burn_a_villager === 'number') burnAVillager = data.burn_a_villager;
            if (data.rerunCommands && typeof data.rerunCommands === 'object') { rerunMemory = data.rerunCommands; saveRerunMemory(); }
            normalizeWorld();
            resetCreatureRuntime();
            buildWaterLayer();
            renderHearts(creature.hearts); renderStamina(creature.stamina); lastStamina = creature.stamina;
            clampCamera();
            localStorage.setItem('creatureGameState', JSON.stringify({ version: VERSION, world, creature, camera, zoom, burn_a_villager: burnAVillager }));
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
//  VILLAGER DIALOG (creature burned/attacked a villager)
// ===========================================================
function onCreatureBurnedVillager() {
    if (dialogPaused || isPaused) return;          // one at a time
    dialogPaused = true;
    villagerModal.classList.add('open');
}
function closeVillagerDialog() { villagerModal.classList.remove('open'); dialogPaused = false; }
vilIgnoreBtn.addEventListener('click', () => { narratorSays("You've ignored the creature for now."); closeVillagerDialog(); });
vilPraiseBtn.addEventListener('click', () => { narratorSays("Who's a good boy? You are."); burnAVillager += 10; saveGame(); closeVillagerDialog(); });
vilScoldBtn.addEventListener('click', () => { narratorSays("Stop that! No! Bad Creature! Bad"); burnAVillager -= 10; saveGame(); closeVillagerDialog(); });

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
    const radius = power * FIRE_MAX_RADIUS_PX * FIRE_SCALE;
    const dmg = power * FIRE_BASE_DMG;                                  // 4 hearts at full charge, 2 at 50%
    // living things take heart damage
    let villagerKilled = false;
    for (const arr of [world.villagers, world.goblins, world.ogres]) for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i]; if (Math.hypot(o.x - x, o.y - y) <= radius) { const dead = damageEntity(o, arr, dmg); if (dead && arr === world.villagers) villagerKilled = true; }
    }
    // non-living objects are destroyed to ash
    for (const arr of [world.trees, world.huts, world.crops, world.wells, world.signs, world.shrines, world.goblinHuts]) for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i]; const c = entityCenter(o, arr); if (Math.hypot(c.x - x, c.y - y) <= radius) { arr.splice(i, 1); world.ashes.push(makeAshes(c.x, c.y)); }
    }
    // caves survive
    if (villagerKilled) onCreatureBurnedVillager();
}
function showExplosionGif(worldX, worldY, power) {
    const diaWorld = power * FIRE_MAX_RADIUS_PX * FIRE_SCALE * 2;
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
    FIRE_SCALE = g('fireball', 'scale', FIRE_SCALE);
}

