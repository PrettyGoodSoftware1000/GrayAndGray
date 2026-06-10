/* ===========================================================
   EGG V2
   - Scrollable world: WASD/arrows, hold LEFT-CLICK to drag-pan,
     mouse wheel (or -/=) to zoom
   - Procedural rivers, lakes, huts, villagers, goblins, shrines
   - Sprites from /images (backgrounds keyed out)
   - ESC = pause: top ruler (meters) + settings + Action Log
   - HUD vitals: 3 Zelda-style hearts + 5 stamina dots (2 each)
   - Creature wanders (2 m/s) / runs (8 m/s); greets/eats villagers;
     burns by walking up close first; speaks from CreatureVoice.txt
   - Villagers stroll near their hut; goblins march & charge
   =========================================================== */

const VERSION = "egg-v2.2";          // save-schema version (only bump when world data changes)
const GAME_VERSION = "3.5";          // displayed build version — bump on every update

const PIXELS_PER_METER = 10;
const m2px = (m) => m * PIXELS_PER_METER;

// Speeds & ranges
let WANDER_SPEED_MPS = 2.0;              // creature stroll (stats_and_shit.txt)
let RUN_SPEED_MPS = 8.0;                 // running
const SEEK_SPEED_MPS = 3.2;              // base approach (scaled by run)
let VILLAGER_SPEED_MPS = 1.0;
const VILLAGER_LEASH_PX = m2px(20);      // villagers stay within 20 m of home
const BABY_SCALE = 0.8;                  // baby villager render scale (80% of an adult)
const BABY_GROW_MS = 120000;             // a baby grows into an adult after 2 min
const VILLAGER_CAP = 80;                 // hard population cap (prevents runaway breeding)
const REPRO_FIRST_S = 60, REPRO_EVERY_S = 300;   // first baby at 1 min, then every 5 min
const HUT_CROWD_RADIUS_PX = m2px(200);
const INTERACT_RANGE_PX = m2px(10);
const INTERACT_COOLDOWN_MS = 10000;
const FIREBALL_RANGE_M = 15;             // max allowed throw range
const FIREBALL_RANGE_PX = m2px(FIREBALL_RANGE_M);
const BURN_APPROACH_PX = m2px(11);       // creature walks up to ~11 m, then throws (within range)
const GOBLIN_DETECT_PX = m2px(40);
let GOBLIN_SPEED_MPS = 2.4;
const GOBLIN_CONTACT_PX = 18;
// --- combat / hearts (read from stats_and_shit.txt; these are defaults) ---
let CREATURE_MAX_HEARTS = 3, CREATURE_ATTACK_DMG = 2, CREATURE_ATTACK_MS = 1200;
let VILLAGER_HEARTS = 1;
let GOBLIN_HEARTS = 2, GOBLIN_HIT_DMG = 0.5, GOBLIN_ATTACK_MS = 4000;
let OGRE_HEARTS = 5, OGRE_ATTACK_DMG = 2, OGRE_ATTACK_MS = 2000, OGRE_SPEED_MPS = 3.0, OGRE_AGGRO_PX = m2px(30);
let FIRE_BASE_DMG = 4, FIRE_SPEED = 14, FIRE_SCALE = 1;   // fireball size/area multiplier (stats_and_shit.txt)
const ATTACK_RANGE_PX = m2px(5);
const EAT_RANGE_PX = m2px(5), EAT_COOLDOWN_MS = 3000;   // eat crops: within 5 m, 1 heart each, 3 s apart
const HUT_DRAW_SCALE = 0.18;              // villager huts render at (native image size × this)
const WHEAT_DRAW_SCALE = 0.5;             // wheat renders at (native image size × this)
const WHEAT_PLANTING_SCALE = 25;          // horizontal px between planted wheat (vertical = half this)
const GOBLIN_AGGRO_PX = m2px(50), OGRE_CONTACT_PX = 24;
const GOBLINHUT_MIN_VILLAGE_PX = m2px(80);   // "far" on a 300m-wide map
const GOBLIN_CHAIN_RANGE_PX = m2px(50);   // chain a burn-spree to the next target within 50 m
const CROP_SPACING = 25;                  // grid spacing for villager crop fields (2.5 m)
const GUARD_ENEMY_RANGE_PX = m2px(40);
const FIREBALL_COOLDOWN_MS = 2000;
const MIN_HUT_DIST_PX = 50;              // don't build huts on top of huts

// Stamina
const STAMINA_MAX = 10;
const RUN_DRAIN_S = 1, STAMINA_REGEN_S = 3;

const ASH_LIFETIME_MS = 120000, ASH_FADE_MS = 20000;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const rulerCanvas = document.getElementById('ruler');
const rulerCtx = rulerCanvas.getContext('2d');
const actionLog = document.getElementById('action-log');
const chatHistory = document.getElementById('chat-history');
const commandInput = document.getElementById('command-input');
const statusBox = document.getElementById('creature-status');
const controlsHint = document.getElementById('controls-hint');
const pausePanel = document.getElementById('pause-panel');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const regenMapBtn = document.getElementById('regen-map-btn');
const saveFileBtn = document.getElementById('save-file-btn');
const newGameBtn = document.getElementById('new-game-btn');
const loadFileBtn = document.getElementById('load-file-btn');
const logFileBtn = document.getElementById('log-file-btn');
const loadFileInput = document.getElementById('load-file-input');
const gameTitleEl = document.getElementById('game-title');
const keysBtn = document.getElementById('keys-btn');
const keysModal = document.getElementById('keys-modal');
const keysList = document.getElementById('keys-list');
const addKeyBtn = document.getElementById('add-key-btn');
const keysFromFileBtn = document.getElementById('keys-from-file-btn');
const keysFileInput = document.getElementById('keys-file-input');
const keysSaveBtn = document.getElementById('keys-save-btn');
const keysCloseBtn = document.getElementById('keys-close-btn');
const treeModal = document.getElementById('tree-modal');
const treeList = document.getElementById('tree-list');
const treeCloseBtn = document.getElementById('tree-close-btn');
const pauseChatCheckbox = document.getElementById('pause-chat-checkbox');
const villagerModal = document.getElementById('villager-modal');
const vilPraiseBtn = document.getElementById('vil-praise');
const vilIgnoreBtn = document.getElementById('vil-ignore');
const vilScoldBtn = document.getElementById('vil-scold');
const heartsEl = document.getElementById('hearts');
const staminaEl = document.getElementById('stamina');
const apiUsageEl = document.getElementById('api-usage');
const spellBarEl = document.getElementById('spell-bar');

const WORLD_W = 3000, WORLD_H = 2200;

let isPaused = false;
let chatPaused = false;
let dialogPaused = false;
let burnAVillager = 50;   // saved "approval" meter for burning villagers
let pauseWhenChatting = (localStorage.getItem('pauseWhenChatting') !== '0');   // default ON
let apiKeys = [];          // up to many Gemini keys; rotated across requests / on rate limits
let keyCallCounts = {};    // session: key string -> number of requests sent with it
let keyIndex = 0;
const MAX_KEY_FIELDS = 5;  // manual "+" fields cap; file upload may add more

let camera = { x: 0, y: 0 };
let zoom = 1;
const MAX_VIEW_METERS = 100;             // most zoomed-OUT: screen spans 100 m
const MIN_VIEW_METERS = 60;              // most zoomed-IN: screen spans 60 m
function minZoom() { return canvas.width / (MAX_VIEW_METERS * PIXELS_PER_METER); }   // wider view = smaller zoom
function maxZoom() { return canvas.width / (MIN_VIEW_METERS * PIXELS_PER_METER); }
const CAMERA_SPEED = 7;
const keys = {};
let controlsHintHidden = false;

// drag-to-pan
let dragging = false, dragLastX = 0, dragLastY = 0, dragMoved = false, dragStartX = 0, dragStartY = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

