// ===========================================================
//  INIT
// ===========================================================
(async function init() {
    if (gameTitleEl) gameTitleEl.textContent = '🥚 Egg v' + GAME_VERSION;
    resizeCanvas();
    buildGrassPattern();
    loadRerunMemory();
    loadAiLog();
    loadApiKeys();
    await loadStats();          // load combat values BEFORE the world is generated
    loadGame();
    buildWaterLayer();
    initFog();
    loadCreatureVoice();
    loadCanned();
    loadAllVariations();
    loadCreatureImage();
    buildSpellBar();
    renderHearts(creature.hearts, creature.maxHearts || CREATURE_MAX_HEARTS);
    renderStamina(creature.stamina);
    canvas.style.cursor = 'default';
    zoom = clamp(zoom, minZoom(), maxZoom());          // keep within the 60-100 m view range
    camera.x = creature.x - (canvas.width / zoom) / 2;
    camera.y = creature.y - (canvas.height / zoom) / 2;
    clampCamera();
    setInterval(saveGame, 10000);
    requestAnimationFrame(draw);
})();
