// ===========================================================
//  DRAW
// ===========================================================
function drawTree(t) { if (imgReady('tree')) { ctx.drawImage(images.tree, t.x, t.y, 35, 45); return; } ctx.fillStyle = '#6b4226'; ctx.fillRect(t.x + 14, t.y + 28, 7, 17); ctx.fillStyle = '#2e6b2e'; ctx.beginPath(); ctx.moveTo(t.x + 17, t.y); ctx.lineTo(t.x + 34, t.y + 32); ctx.lineTo(t.x, t.y + 32); ctx.closePath(); ctx.fill(); }
function drawHut(h) {
    const img = variantImg('hut', h.vseed);
    if (img) {
        const w = (img.naturalWidth || img.width || 50) * HUT_DRAW_SCALE;
        const ht = (img.naturalHeight || img.height || 50) * HUT_DRAW_SCALE;
        ctx.drawImage(img, h.x + 25 - w / 2, h.y + 25 - ht / 2, w, ht);   // sized to the source art, centered on the hut
        return;
    }
    ctx.fillStyle = '#caa472'; ctx.fillRect(h.x + 6, h.y + 22, 38, 28); ctx.fillStyle = '#8a3b2a'; ctx.beginPath(); ctx.moveTo(h.x + 25, h.y); ctx.lineTo(h.x + 50, h.y + 24); ctx.lineTo(h.x, h.y + 24); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#5a3a22'; ctx.fillRect(h.x + 20, h.y + 34, 11, 16);
}
function drawVillager(v) { const sc = v.baby ? BABY_SCALE : 1, w = 16 * sc, h = 24 * sc; if (imgReady('villager')) { ctx.drawImage(images.villager, v.x, v.y, w, h); return; } ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(v.x + w / 2, v.y + 5 * sc, 5 * sc, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#3b6fb0'; ctx.fillRect(v.x + 3 * sc, v.y + 10 * sc, 10 * sc, 14 * sc); }
function drawWheat(c) { const img = variantImg('wheat', c.vseed); if (img) { const w = (img.naturalWidth || 24) * WHEAT_DRAW_SCALE, h = (img.naturalHeight || 24) * WHEAT_DRAW_SCALE; ctx.drawImage(img, c.x - w / 2, c.y - h / 2, w, h); return; } ctx.strokeStyle = '#d8b13a'; ctx.lineWidth = 2; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(c.x + i * 5, c.y + 8); ctx.lineTo(c.x + i * 5, c.y - 6); ctx.stroke(); } }
function drawShrine(s) { const img = variantImg('shrine', s.vseed); if (img) ctx.drawImage(img, s.x - 6, s.y - 12, 44, 50); /* no yellow placeholder */ }
function drawWell(w) { const img = variantImg('well', w.vseed); if (img) { ctx.drawImage(img, w.x - 22, w.y - 26, 44, 48); return; } ctx.fillStyle = '#777'; ctx.beginPath(); ctx.arc(w.x, w.y, 16, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#2b5b86'; ctx.beginPath(); ctx.arc(w.x, w.y, 9, 0, Math.PI * 2); ctx.fill(); }
function drawSign(s) { const img = variantImg('sign', s.vseed); if (img) { ctx.drawImage(img, s.x - 14, s.y - 24, 28, 30); return; } ctx.fillStyle = '#6b4226'; ctx.fillRect(s.x - 2, s.y - 8, 4, 16); ctx.fillStyle = '#caa472'; ctx.fillRect(s.x - 12, s.y - 22, 24, 14); }
function drawCave(c) { const img = variantImg('cave', c.vseed); if (img) { ctx.drawImage(img, c.x - 28, c.y - 30, 56, 56); return; } ctx.fillStyle = '#5a5560'; ctx.beginPath(); ctx.arc(c.x, c.y, 26, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#15131a'; ctx.beginPath(); ctx.arc(c.x, c.y, 14, Math.PI, 0); ctx.fill(); }
function drawGoblin(g) { if (imgReady('goblin')) { ctx.drawImage(images.goblin, g.x - 8, g.y - 11, 16, 22); return; } ctx.fillStyle = '#5a7d3a'; ctx.beginPath(); ctx.arc(g.x, g.y - 4, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#3f5a28'; ctx.fillRect(g.x - 4, g.y, 8, 10); }
function drawOgre(o) { const img = variantImg('ogre', o.vseed); if (img) { ctx.drawImage(img, o.x - 22, o.y - 30, 48, 54); return; } ctx.fillStyle = '#6b6f4a'; ctx.beginPath(); ctx.arc(o.x, o.y - 8, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#4d5136'; ctx.fillRect(o.x - 9, o.y, 18, 22); }
function drawGoblinHut(h) { const img = variantImg('goblin_hut', h.vseed); if (img) { ctx.drawImage(img, h.x, h.y, 50, 50); return; } ctx.fillStyle = '#3a4a2a'; ctx.fillRect(h.x + 6, h.y + 22, 38, 28); ctx.fillStyle = '#26331c'; ctx.beginPath(); ctx.moveTo(h.x + 25, h.y); ctx.lineTo(h.x + 50, h.y + 24); ctx.lineTo(h.x, h.y + 24); ctx.closePath(); ctx.fill(); }
let hoveredEntity = null, hoveredMax = 1;
function drawFireball(f) { const sc = FIRE_SCALE, R = 13 * sc; if (imgReady('fireball')) { const s = 25 * sc; ctx.drawImage(images.fireball, f.x - s / 2, f.y - s / 2, s, s); return; } const g = ctx.createRadialGradient(f.x, f.y, 2 * sc, f.x, f.y, R); g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ff8c1a'); g.addColorStop(1, 'rgba(200,40,0,0.1)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, R, 0, Math.PI * 2); ctx.fill(); }
function drawAshes(a) { const age = Date.now() - a.born; const alpha = age > (ASH_LIFETIME_MS - ASH_FADE_MS) ? Math.max(0, (ASH_LIFETIME_MS - age) / ASH_FADE_MS) : 1; ctx.globalAlpha = alpha; if (imgReady('ashes')) ctx.drawImage(images.ashes, a.x - 12, a.y - 8, 26, 18); else { ctx.fillStyle = '#3b3b3b'; ctx.beginPath(); ctx.ellipse(a.x, a.y, 12, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#666'; (a.specks || []).forEach(s => ctx.fillRect(a.x + s.dx, a.y + s.dy, 2, 2)); } ctx.globalAlpha = 1; }
function drawCreature() { if (creature.dead) ctx.globalAlpha = 0.35; if (imgReady('creature')) ctx.drawImage(images.creature, creature.x, creature.y, 60, 66); else { ctx.fillStyle = '#e8902a'; ctx.fillRect(creature.x, creature.y, 60, 66); } ctx.globalAlpha = 1; }
function visible(x, y, pad = 80) { const vw = canvas.width / zoom, vh = canvas.height / zoom; return x > camera.x - pad && x < camera.x + vw + pad && y > camera.y - pad && y < camera.y + vh + pad; }

let lastTs = null;
function renderScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.scale(zoom, zoom); ctx.translate(-camera.x, -camera.y);
    const vw = canvas.width / zoom, vh = canvas.height / zoom;
    ctx.fillStyle = grassPattern || '#4f8f43'; ctx.fillRect(camera.x, camera.y, vw, vh);
    ctx.strokeStyle = '#2c5a26'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
    if (waterCanvas) { const sw = Math.min(vw, WORLD_W - camera.x), sh = Math.min(vh, WORLD_H - camera.y); if (sw > 0 && sh > 0) ctx.drawImage(waterCanvas, camera.x, camera.y, sw, sh, camera.x, camera.y, sw, sh); }
    // --- ground layer (flat, always under everything) ---
    world.caves.forEach(c => { if (visible(c.x, c.y)) drawCave(c); });
    world.ashes.forEach(a => { if (visible(a.x, a.y)) drawAshes(a); });
    world.crops.forEach(c => { if (visible(c.x, c.y)) drawWheat(c); });
    // --- standing layer: sorted by image-bottom Y so lower-on-map draws in front ---
    const drawables = [];
    const add = (y, fn) => drawables.push({ y, fn });
    world.goblinHuts.forEach(h => { if (visible(h.x, h.y)) add(h.y + 50, () => drawGoblinHut(h)); });
    world.shrines.forEach(s => { if (visible(s.x, s.y)) add(s.y + 38, () => drawShrine(s)); });
    world.huts.forEach(h => { if (visible(h.x, h.y)) { const ih = variantImg('hut', h.vseed); const hh = ih ? (ih.naturalHeight || 50) * HUT_DRAW_SCALE : 50; add(h.y + 25 + hh / 2, () => drawHut(h)); } });
    world.wells.forEach(w => { if (visible(w.x, w.y)) add(w.y + 22, () => drawWell(w)); });
    world.signs.forEach(s => { if (visible(s.x, s.y)) add(s.y + 6, () => drawSign(s)); });
    world.trees.forEach(t => { if (visible(t.x, t.y)) add(t.y + 45, () => drawTree(t)); });
    world.villagers.forEach(v => { if (visible(v.x, v.y)) add(v.y + 24 * (v.baby ? BABY_SCALE : 1), () => drawVillager(v)); });
    world.ogres.forEach(o => { if (visible(o.x, o.y)) add(o.y + 24, () => drawOgre(o)); });
    world.goblins.forEach(g => { if (visible(g.x, g.y)) add(g.y + 11, () => drawGoblin(g)); });
    add(creature.y + 66, drawCreature);                                   // creature sorts with the rest
    drawables.sort((a, b) => a.y - b.y);
    drawables.forEach(d => d.fn());
    // --- top layer ---
    world.fireballs.forEach(f => drawFireball(f));
    if (hoveredEntity && hoveredEntity.hearts !== undefined) drawMiniHearts(hoveredEntity.x, hoveredEntity.y - 28, hoveredEntity.hearts, hoveredEntity.maxHearts || hoveredMax);
    if (!creature.dead) eraseFog(creature.x + 30, creature.y + 33);        // uncover around the creature (permanent)
    if (!fogReveal && fogCanvas) ctx.drawImage(fogCanvas, 0, 0, fogCanvas.width, fogCanvas.height, 0, 0, WORLD_W, WORLD_H);
    ctx.restore();
}
function draw(ts) {
    if (isPaused) return;
    if (lastTs == null) lastTs = ts || 0;
    let dt = ((ts || 0) - lastTs) / 1000; lastTs = ts || 0; if (dt > 0.05 || dt < 0) dt = 0.05;
    const now = Date.now();

    updateCamera();
    renderScene();

    if (!chatPaused && !dialogPaused) {                 // freeze sim while chatting or while the villager dialog is open
        updateVillagers(dt, now);
        updateReproduction(dt);
        updateHutGrowth(dt);
        updateCreature(dt, now);
        updateProjectiles();
        updateGoblins(dt);
        updateOgres(dt, now);
        updateGoblinHuts(dt);
        updateAshes();
        updateStamina(dt);
        if ((frameCount = (frameCount + 1) % 60) === 0) maybeSpawnWell();   // check for new cities ~1x/sec
    }
    updateCharge();
    requestAnimationFrame(draw);
}
let frameCount = 0;

