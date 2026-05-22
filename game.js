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

// Global State
let isPaused = false;
let GEMINI_API_KEY = "";

let world = {
    villagers: [{x: 100, y: 150}, {x: 400, y: 450}],
    huts: [{x: 120, y: 120}],
    shrines: [{x: 300, y: 300, spell: 'fireball'}],
    trees: [{x: 50, y: 50}, {x: 500, y: 100}],
    crops: [],
    resourcePiles: []
};

let creature = {
    x: 300, y: 300,
    state: "idle",
    spellsUnlocked: ['fireball', 'grow', 'spread_huts']
};

// --- PAUSE & MENU LOGIC ---
function openSettings() {
    isPaused = true;
    apiKeyInput.value = GEMINI_API_KEY; // Populate input with current key
    settingsModal.style.display = 'flex';
}

function closeSettings() {
    GEMINI_API_KEY = apiKeyInput.value.trim();
    localStorage.setItem('gemini_api_key', GEMINI_API_KEY); // Save key securely to browser
    
    settingsModal.style.display = 'none';
    isPaused = false;
    
    updateLog("Game resumed.");
    draw(); // Restart the rendering loop
}

// --- LOCAL STORAGE (WORLD STATE) ---
function saveGame() {
    if (isPaused) return; // Don't auto-save while paused
    localStorage.setItem('creatureGameState', JSON.stringify({ world, creature }));
    console.log("Game saved.");
}

function loadGame() {
    // Load Game State
    const savedState = localStorage.getItem('creatureGameState');
    if (savedState) {
        const data = JSON.parse(savedState);
        world = data.world;
        creature = data.creature;
        updateLog("World state loaded.");
    }
    
    // Load API Key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        GEMINI_API_KEY = savedKey;
    } else {
        updateLog("⚠️ No Gemini API Key found. Click Settings to add one.");
    }
}

// --- EVENT LISTENERS ---
settingsBtn.addEventListener('click', openSettings);
saveSettingsBtn.addEventListener('click', closeSettings);

// --- ACTUAL GEMINI API INTEGRATION ---
async function sendCommandToGemini(userMessage) {
    if (!GEMINI_API_KEY) {
        updateLog("⚠️ Cannot contact AI: Missing API Key in Settings.");
        return;
    }

    statusBox.innerText = "Thinking...";
    updateLog(`Sending command to brain: "${userMessage}"`);

    // We use gemini-2.5-flash because it is incredibly fast and cheap/free for hobby projects
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    // Construct the context so the AI knows exactly what is happening in the game world
    const promptContext = {
        contents: [{
            parts: [{
                text: `You are the brain of a giant autonomous 2D creature. 
                The user has given you a divine command: "${userMessage}".
                
                Current World State: ${JSON.stringify(world)}
                Your Spells Unlocked: ${JSON.stringify(creature.spellsUnlocked)}
                
                Choose your next action based on the user's intent. You must pick your own specific target from the objects available in the world state.
                
                Respond ONLY with a raw JSON object matching this schema (do not wrap in markdown blocks):
                {
                    "action": "cast_spell", 
                    "spellName": "fireball" or "grow" or "spread_huts", 
                    "shortStatusText": "A 1-to-6 word summary of what you are doing"
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
        
        // Extract text response from Gemini's nested JSON structure
        let aiTextResponse = data.candidates[0].content.parts[0].text.trim();
        
        // Clean up markdown block wraps if Gemini accidentally included them
        aiTextResponse = aiTextResponse.replace(/```json|```/g, "");
        
        const aiDecision = JSON.parse(aiTextResponse);
        
        // Execute the AI's chosen spell
        if (aiDecision.action === "cast_spell") {
            castSpell(aiDecision.spellName);
            if (aiDecision.shortStatusText) {
                statusBox.innerText = aiDecision.shortStatusText;
            }
        }

    } catch (error) {
        console.error("API Error:", error);
        updateLog("❌ Error connecting to Gemini API. Check console/API key.");
        statusBox.innerText = "Wandering aimlessly.";
        creature.state = "idle";
    }
}

// --- UPDATED INPUT LISTENER ---
commandInput.addEventListener('keypress', function (e) {
    if (isPaused) return; 
    
    if (e.key === 'Enter' && commandInput.value.trim() !== '') {
        const cmd = commandInput.value;
        
        // Display user chat
        chatHistory.innerHTML += `<p style="color: yellow;">User: ${cmd}</p>`;
        chatHistory.scrollTop = chatHistory.scrollHeight;
        
        // Send to actual AI
        sendCommandToGemini(cmd);
        
        commandInput.value = '';
    }
});

// --- ENGINE UPDATE LOOPS ---
function updateVillagers() {
    world.villagers.forEach(v => {
        v.x += (Math.random() - 0.5) * 1.5;
        v.y += (Math.random() - 0.5) * 1.5;
        if (Math.random() < 0.001) {
            if (Math.random() < 0.5) world.crops.push({x: v.x + 10, y: v.y + 10});
            else world.huts.push({x: v.x + 20, y: v.y + 20});
        }
    });
}

function updateCreature() {
    if (creature.state === "idle") {
        creature.x += (Math.random() - 0.5) * 0.5;
        creature.y += (Math.random() - 0.5) * 0.5;

        if (Math.random() < 0.005) {
            const behaviors = ["Wandering aimlessly.", "Sniffing a tree.", "Watching a villager."];
            statusBox.innerText = behaviors[Math.floor(Math.random() * behaviors.length)];
        }
    }
}

function castSpell(spellName) {
    creature.state = "casting";
    if (spellName === 'fireball' && world.trees.length > 0) {
        statusBox.innerText = "Casting Fireball!";
    } else if (spellName === 'grow' && world.trees.length > 0) {
        statusBox.innerText = "Growing nature!";
        world.trees.push({x: world.trees[0].x + 20, y: world.trees[0].y + 20});
    } else if (spellName === 'spread_huts' && world.huts.length > 0) {
        statusBox.innerText = "Spreading huts!";
        world.huts.push({x: world.huts[0].x + 45, y: world.huts[0].y});
    }
    setTimeout(() => { creature.state = "idle"; statusBox.innerText = "Wandering aimlessly."; }, 2000);
}

// --- MAIN RENDER LOOP ---
function draw() {
    // CRITICAL: If the game is paused, stop calling requestAnimationFrame. 
    // This entirely halts the rendering and logic loops.
    if (isPaused) return; 

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw Game Objects
    ctx.fillStyle = '#8B4513'; world.huts.forEach(h => ctx.fillRect(h.x, h.y, 40, 40));
    ctx.fillStyle = '#FFD700'; world.shrines.forEach(s => ctx.fillRect(s.x, s.y, 30, 30));
    ctx.fillStyle = '#006400'; world.trees.forEach(t => ctx.fillRect(t.x, t.y, 20, 30));
    ctx.fillStyle = '#9ACD32'; world.crops.forEach(c => ctx.fillRect(c.x, c.y, 15, 15));
    ctx.fillStyle = '#0000FF'; world.villagers.forEach(v => { ctx.beginPath(); ctx.arc(v.x, v.y, 5, 0, Math.PI*2); ctx.fill(); });
    ctx.fillStyle = '#FF0000'; creature.fillRect = ctx.fillRect(creature.x, creature.y, 50, 50);

    // Update Logic
    updateVillagers();
    updateCreature();

    requestAnimationFrame(draw);
}

// Initialization
loadGame();
setInterval(saveGame, 10000); 
draw();
