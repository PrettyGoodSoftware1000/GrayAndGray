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
- "explore": wander toward unexplored (black) parts of the map to uncover them. Maps: "explore","explore the map","uncover the map","scout".
- "stop": cancel whatever the creature is doing. Maps: "stop","cancel","halt","that's enough","nevermind".
- "grow": grow more nature.   - "spread_huts": add a hut.   - "speak": only talk.   - "idle": do nothing.

Your "speech" MUST be in your established voice/personality.

Respond ONLY with raw JSON (no fences):
{"action":"burn|burn_many|attack|attack_many|eat_crops|explore|run|stop_running|guard|stop|grow|spread_huts|speak|idle","target":"tree|villager|hut|crop|goblin|ogre|any|null","speech":"in-character line","shortStatusText":"1-6 words"}`;
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
        case "explore": startExplore(); break;
        case "run": startRunning(); break;
        case "stop_running": stopRunning(); break;
        case "guard": startGuard(Date.now()); break;
        case "stop": cancelAll(); break;
        case "grow": castGrow(); break;
        case "spread_huts": castSpreadHuts(); break;
    }
    if (action === 'run') bumpGoRun();                                                    // +10% go_run propensity
    else if (['burn', 'burn_many', 'attack', 'attack_many', 'eat_crops', 'guard', 'explore'].includes(action)) maybeAlsoRun();   // may also run
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
    const many = /\b(some|several|a few|a bunch of|bunch|all|every|lots of|many|the\s+\w+s\b|goblins|ogres|villagers|trees|huts|crops)\b/.test(t);
    let type = null;                                       // null target -> 'any' -> ENEMIES ONLY (goblins + ogres)
    if (/\bogres?\b/.test(t)) type = 'ogre';
    else if (/\bgoblins?\b/.test(t)) type = 'goblin';
    else if (/\bvillagers?\b/.test(t)) type = 'villager';
    else if (/\btrees?\b/.test(t)) type = 'tree';
    else if (/\bhuts?\b/.test(t)) type = 'hut';
    else if (/\bcrops?\b/.test(t)) type = 'crop';
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

