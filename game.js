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

// --- IMAGE LOADING ---
const images = {};
const spriteFiles = {
    tree: 'tree_placeholder.png',
    hut: 'hut_placeholder.png',
    villager: 'villager_placeholder.png',
    crop: 'crop_placeholder.png',
    fireball: 'fireball_placeholder.png',
    creature: 'creature_placeholder.png'
};

let imagesLoaded = 0;
const totalImages = Object.keys(spriteFiles).length;

// Loop through and load every sprite
Object.entries(spriteFiles).forEach(([key, filename]) => {
    images[key] = new Image();
    images[key] = new Image();
    images[key].src = filename;
    images[key].onload = () => {
        imagesLoaded++;
        if (imagesLoaded === totalImages) {
            console.log("All assets loaded. Starting game loop.");
            draw(); // Start game loop only after images are ready
        }
    };
    images[key].onerror = () => {
        console.error(`Failed to load image: ${filename}. Make sure it is named correctly in your root folder.`);
    };
});

// --- WORLD STATE ---
let world = {
    villagers: [{x: 100, y: 150}, {x: 400, y: 450}],
    huts: [{x: 120, y: 120}],
    shrines: [{x: 300, y: 300, spell: 'fireball'}], // Kept as a golden square for mechanics
    trees: [{x: 50, y: 50}, {x: 500, y: 100}],
    crops: [],
    fireballs: [] // Tracks active fireball animations
};

let creature = {
    x: 300, y: 300,
    state: "idle", // idle, casting
    spellsUnlocked: ['fireball', 'grow', 'spread_huts']
};

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
    draw(); 
}

// --- LOCAL STORAGE ---
function saveGame() {
    if (isPaused) return; 
    localStorage.setItem('creatureGameState', JSON.stringify({ world, creature }));
}

function loadGame() {
    const savedState = localStorage.getItem('creatureGameState');
    if (savedState) {
        const data = JSON.parse(savedState);
        world = data.world;
        creature = data.creature;
        updateLog("World state loaded.");
    }
    
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        GEMINI_API_KEY = savedKey;
    } else {
        updateLog("⚠️ No Gemini API Key found. Click Settings to add one.");
    }
}

settingsBtn.addEventListener('click', openSettings);
saveSettingsBtn.addEventListener('click', closeSettings);

// --- UPDATE LOOPS ---
function updateVillagers() {
    world.villagers.forEach(v => {
        v.x += (Math.random() - 0.5) * 1.5;
        v.y += (Math.random() - 0.5) * 1.5;
        
        // Prevent walking off-canvas
        v.x = Math.max(10, Math.min(canvas.width - 10, v.x));
        v.y = Math.max(10, Math.min(canvas.height - 10, v.y));

        if (Math.random() < 0.001) {
            if (Math.random() < 0.5) world.crops.push({x: v.x + 10, y: v.y + 10});
            else world.huts.push({x: v.x + 20, y: v.y + 20});
        }
    });
}

function updateCreature() {
    if (creature.state === "idle") {
        creature.x += (Math.random() - 0.5) * 0.8;
        creature.y += (Math.random() - 0.5) * 0.8;
        
        creature.x = Math.max(0, Math.min(canvas.width - 50, creature.x));
        creature.y = Math.max(0, Math.min(canvas.height - 50, creature.y));

        if (Math.random() < 0.005) {
            const behaviors = ["Wandering aimlessly.", "Sniffing a tree.", "Watching a villager.", "Daydreaming."];
            statusBox.innerText = behaviors[Math.floor(Math.random() * behaviors.length)];
        }
    }
}

function updateProjectiles() {
    // Process active fireballs moving toward targets
    for (let i = world.fireballs.length - 1; i >= 0; i--) {
        let f = world.fireballs[i];
        let dx = f.targetX - f.x;
        let dy = f.targetY - f.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
            // Impact! Remove the fireball projectile
            world.fireballs.splice(i, 1);
        } else {
            // Move toward target location
            f.x += (dx / dist) * 5;
            f.y += (dy / dist) * 5;
        }
    }
}

// --- SPELLS ---
function castSpell(spellName) {
    creature.state = "casting";
    
    if (spellName === 'fireball') {
        let target = world.trees[0] || world.villagers[0] || world.crops[0];
        if (target) {
            statusBox.innerText = "Casting Fireball!";
            // Spawn a fireball projectile traveling from tiger to target
            world.fireballs.push({ x: creature.x + 25, y: creature.y + 25, targetX: target.x, targetY: target.y });
            
            // Burn target away after traveling time
            setTimeout(() => {
                if (world.trees.includes(target)) world.trees.splice(world.trees.indexOf(target), 1);
                else if (world.villagers.includes(target)) world.villagers.splice(world.villagers.indexOf(target), 1);
                else if (world.crops.includes(target)) world.crops.splice(world.crops.indexOf(target), 1);
            }, 800);
        }
    } else if (spellName === 'grow' && (world.trees.length > 0 || world.crops.length > 0)) {
        statusBox.innerText = "Growing nature!";
        if (world.trees.length > 0) {
            world.trees.push({ x: world.trees[0].x + (Math.random() * 40 - 20), y: world.trees[0].y + (Math.random() * 40 - 20) });
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

// --- MAIN RENDER LOOP ---
function draw() {
    if (isPaused) return; 

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw Huts
    world.huts.forEach(h => ctx.drawImage(images.hut, h.x, h.y, 50, 50));

    // Draw Shrines (Kept as golden square overlay vector)
    ctx.fillStyle = '#FFD700'; 
    world.shrines.forEach(s => ctx.fillRect(s.x, s.y, 30, 30));

    // Draw Trees
    world.trees.forEach(t => ctx.drawImage(images.tree, t.x, t.y, 35, 45));

    // Draw Crops
    world.crops.forEach(c => ctx.drawImage(images.crop, c.x, c.y, 20, 20));

    // Draw Villagers
    world.villagers.forEach(v => ctx.drawImage(images.villager, v.x, v.y, 16, 24));

    // Draw Active Fireballs
    world.fireballs.forEach(f => ctx.drawImage(images.fireball, f.x, f.y, 25, 25));

    // Draw Tiger Creature
    ctx.drawImage(images.creature, creature.x, creature.y, 55, 65);

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

    const promptContext = {
        contents: [{
            parts: [{
                text: `You are the brain of a giant autonomous tiger standing on two legs. 
                The user has given you a divine voice command: "${userMessage}".
                
                Current World State data arrays: ${JSON.stringify(world)}
                Your Spells Unlocked: ${JSON.stringify(creature.spellsUnlocked)}
                
                Choose your next action based on the user's intent. If told to cast something, pick a targeted location element from what is available in the data arrays.
                
                Respond ONLY with a raw JSON object matching this schema (do not wrap in markdown code blocks):
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
        let aiTextResponse = data.candidates[0].content.parts[0].text.trim();
        aiTextResponse = aiTextResponse.replace(/```json|```/g, "");
        
        const aiDecision = JSON.parse(aiTextResponse);
        
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

// Initialization
loadGame();
setInterval(saveGame, 10000); 
// Note: draw() is triggered internally now once the image loading sequence successfully completely clears.
