// ===========================================================
//  VOICE
// ===========================================================
let voiceStyles = {}; let activeVoice = 'adhd';   // default until a creature's personality is loaded
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
function typingInInput() { const ae = document.activeElement; return !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'); }
window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); togglePause(); return; }
    if (typingInInput()) return;
    if (k === 'enter') { e.preventDefault(); commandInput.focus(); return; }
    if (k === '=' || k === '+') { if (!isPaused) { e.preventDefault(); setZoom(zoom * 1.12); } return; }
    if (k === '-' || k === '_') { if (!isPaused) { e.preventDefault(); setZoom(zoom / 1.12); } return; }
    if (k === ' ') { if (!isPaused && selectedSpell === 0 && !charging) { e.preventDefault(); startCharge(); } return; }   // hold space to charge fireball
    if (k === 'f') { fogReveal = !fogReveal; return; }                     // F toggles full-map reveal
    if (k === 't') { toggleTree(); return; }                              // T: Tree of Knowledge
    if (/^[0-9]$/.test(k)) { selectSpell(k === '0' ? 9 : (parseInt(k, 10) - 1)); return; }   // 1..9,0 select spell slots
    if (MOVE_KEYS.includes(k)) { keys[k] = true; if (k.startsWith('arrow')) e.preventDefault(); if (!controlsHintHidden) { controlsHint.style.display = 'none'; controlsHintHidden = true; } }
});
window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (k === ' ') { if (charging) releaseCharge(); return; } keys[k] = false; });
commandInput.addEventListener('focus', () => { for (const kk in keys) keys[kk] = false; if (pauseWhenChatting) chatPaused = true; });
commandInput.addEventListener('blur', () => { chatPaused = false; });
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
    const nm = cmd.match(/^\s*(?:your name is|you are called|name yourself|i name you|i'?ll call you)\s+(.+?)\s*[.!]?\s*$/i);
    if (nm) { creature.name = nm[1].trim().slice(0, 40); narratorSays('The creature is now called ' + creature.name + '.'); return true; }
    if (/\b(change|swap|new|switch)\s+(the\s+)?creature\b/i.test(cmd)) { changeCreature(); return true; }
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
function cancelAll() { creature.act = 'free'; creature.burnGoal = null; creature.burnCampaign = null; creature.attackCampaign = null; creature.eatCampaign = null; creature.guard = null; creature.resumeGuard = false; creature.running = false; creature.goto = null; statusBox.innerText = 'Exploring.'; }

