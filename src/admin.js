// =====================================================================================
//  YÖNETİCİ MODU (admin / test panel)  —  APP STORE / PLAY STORE SÜRÜMÜNE GİRMEMELİ!
//  Only bundled when built with `node build.mjs --admin` (esbuild define __ADMIN__=true).
//  A plain `node build.mjs` drops this whole file from dist/index.html.
//  Everything (markup, styles) is created from here so the template stays clean.
// =====================================================================================

const CSS = `
#admBtn { position: fixed; z-index: 6; top: calc(var(--sat) + 12px); left: calc(var(--sal) + 14px); padding: 7px 12px; border-radius: 99px;
  background: #c8102e; color: #fff; font: 800 13px/1 inherit; font-family: inherit; letter-spacing: 1.5px; box-shadow: 0 4px 14px rgba(0,0,0,.35), inset 0 0 0 1.5px rgba(255,255,255,.35); }
body:not(.adm-menu) #admBtn { display: none; }
body.shop-open #admBtn { display: none; }
#admFlags { position: fixed; z-index: 6; left: calc(var(--sal) + 10px); bottom: calc(var(--sab) + 10px); display: flex; gap: 6px; pointer-events: none; }
#admFlags span { padding: 3px 8px; border-radius: 99px; background: rgba(200,16,46,.85); font-size: 11px; font-weight: 800; letter-spacing: 1px; }
#admPanel { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(4,14,20,.6);
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); padding: calc(var(--sat) + 12px) calc(var(--sar) + 12px) calc(var(--sab) + 12px) calc(var(--sal) + 12px); }
#admPanel.hidden { display: none; }
#admPanel .box { width: min(420px, 100%); max-height: 100%; overflow-y: auto; touch-action: pan-y; -webkit-overflow-scrolling: touch; border-radius: 22px; padding: 14px 14px 16px;
  background: linear-gradient(180deg, rgba(40,12,18,.97), rgba(18,8,12,.98)); box-shadow: inset 0 0 0 2px #c8102e, 0 20px 60px rgba(0,0,0,.5); }
#admPanel .hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
#admPanel h3 { margin: 0; font-size: 20px; letter-spacing: 3px; color: #ff6b7f; }
#admPanel .warn { font-size: 11px; font-weight: 700; opacity: .75; margin: 0 0 8px; letter-spacing: .5px; }
#admPanel h4 { margin: 12px 0 6px; font-size: 12px; letter-spacing: 2px; opacity: .7; }
#admPanel .g { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; }
#admPanel .a { min-height: 44px; padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,.1); color: #fff; font-size: 14px; font-weight: 800;
  letter-spacing: .5px; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.16); text-align: center; }
#admPanel .a.on { background: #c8102e; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.4); }
#admPanel .a.danger { color: #ff9aa2; }
#admPanel .a:active { transform: translateY(2px); }
#admPanel .a:focus-visible, #admBtn:focus-visible { outline: 3px solid #ffe066; outline-offset: 2px; }
#admPanel .x { width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,.12); color: #fff; font-size: 20px; font-weight: 800; }
#admPanel .st { margin-top: 10px; font-size: 12px; opacity: .7; text-align: center; min-height: 16px; }
`;

/**
 * api: { S, save, CATALOG, BIOMES, biomeStart, startRun, restart, jump, over, togglePause, applyEquipped, popup, sound }
 */
export function installAdmin(api) {
  const { S, save, CATALOG, BIOMES, biomeStart } = api;
  console.warn('[AKINTI] YÖNETİCİ MODU AÇIK — mağaza sürümünden önce `node build.mjs` (bayraksız) ile derle.');
  S.god = false;
  S.timeMul = 1;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // menu button + flags badge
  const btn = document.createElement('button');
  btn.id = 'admBtn';
  btn.textContent = 'YÖNETİCİ';
  btn.setAttribute('aria-label', 'Yönetici paneli');
  document.body.appendChild(btn);
  const flags = document.createElement('div');
  flags.id = 'admFlags';
  document.body.appendChild(flags);

  // pause screen entry
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'btn2';
  pauseBtn.textContent = 'YÖNETİCİ';
  pauseBtn.style.cssText = 'margin-top:14px;background:#c8102e';
  const pause = document.getElementById('pause');
  if (pause) pause.appendChild(pauseBtn);

  const biomeBtns = BIOMES.map((b, k) => `<button class="a" data-biome="${k}">${b.name}</button>`).join('');
  const panel = document.createElement('div');
  panel.id = 'admPanel';
  panel.className = 'hidden';
  panel.innerHTML = `<div class="box" role="dialog" aria-label="Yönetici paneli">
    <div class="hd"><h3>YÖNETİCİ</h3><button class="x" data-act="close" aria-label="Kapat">×</button></div>
    <p class="warn">Sadece test sürümünde var. Mağaza sürümünde görünmez.</p>
    <h4>CÜZDAN</h4>
    <div class="g">
      <button class="a" data-act="coins" data-n="1000">+1.000 altın</button>
      <button class="a" data-act="coins" data-n="10000">+10.000 altın</button>
      <button class="a" data-act="coins" data-n="100000">+100.000 altın</button>
    </div>
    <h4>MAĞAZA</h4>
    <div class="g">
      <button class="a" data-act="unlock">Hepsini aç</button>
      <button class="a danger" data-act="reset">Kaydı sıfırla</button>
    </div>
    <h4>OYUN</h4>
    <div class="g">
      <button class="a" data-act="god">Ölümsüz: KAPALI</button>
      <button class="a" data-act="speed">Zaman: x1</button>
      <button class="a" data-act="shield">Kalkan ver</button>
      <button class="a" data-act="magnet">Mıknatıs ver</button>
      <button class="a" data-act="over">Oyun sonu ekranı</button>
    </div>
    <h4>ORTAMA GİT</h4>
    <div class="g">${biomeBtns}</div>
    <div class="st" id="admSt"></div>
  </div>`;
  document.body.appendChild(panel);
  const st = panel.querySelector('#admSt');
  const say = (t) => { st.textContent = t; };

  const renderFlags = () => {
    const f = [];
    if (S.god) f.push('ÖLÜMSÜZ');
    if (S.timeMul !== 1) f.push('x' + S.timeMul);
    flags.innerHTML = f.map((x) => `<span>${x}</span>`).join('');
    panel.querySelector('[data-act="god"]').textContent = 'Ölümsüz: ' + (S.god ? 'AÇIK' : 'KAPALI');
    panel.querySelector('[data-act="god"]').classList.toggle('on', S.god);
    panel.querySelector('[data-act="speed"]').textContent = 'Zaman: x' + S.timeMul;
    panel.querySelector('[data-act="speed"]').classList.toggle('on', S.timeMul !== 1);
  };

  // show the menu button only on the title screen
  const menu = document.getElementById('menu');
  const syncMenu = () => document.body.classList.toggle('adm-menu', !!menu && !menu.classList.contains('hidden'));
  if (menu) new MutationObserver(syncMenu).observe(menu, { attributes: true, attributeFilter: ['class'] });
  syncMenu();

  let lastFocus = null;
  const open = () => {
    lastFocus = document.activeElement;
    panel.classList.remove('hidden');
    renderFlags();
    say('');
    try { panel.querySelector('[data-act="close"]').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };
  const close = () => {
    panel.classList.add('hidden');
    try { lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };
  const isOpen = () => !panel.classList.contains('hidden');

  btn.addEventListener('pointerdown', (e) => e.stopPropagation()); // don't start a run under it
  btn.addEventListener('click', (e) => { e.stopPropagation(); api.sound.init(); api.sound.click(); open(); });
  pauseBtn.addEventListener('click', () => { api.sound.click(); open(); });
  panel.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === panel) close(); });

  // modal: Escape closes the panel and nothing behind it reacts to keys
  window.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    e.stopPropagation();
    if (e.code === 'Escape') close();
  }, true);

  // get into a run (from menu / game over / pause), then call fn
  const inRun = (fn) => {
    close();
    if (S.mode === 'paused') api.togglePause(false);
    if (S.mode === 'play') { fn(); return; }
    if (S.mode === 'menu' && !S.shopOpen) { api.startRun(); fn(); return; }
    if (S.mode === 'over' || S.mode === 'dying' || S.mode === 'menu') { api.restart(); setTimeout(fn, 320); }
  };

  let resetArmed = 0;
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    api.sound.click();
    const act = b.dataset.act;
    const D = save.data;
    if (b.dataset.biome !== undefined) {
      const k = +b.dataset.biome;
      inRun(() => api.jump(Math.max(0, biomeStart(k) - 30), 60));
      return;
    }
    if (act === 'close') close();
    else if (act === 'coins') { D.coins += +b.dataset.n; save.commit(); say('Cüzdan: ' + D.coins.toLocaleString('tr-TR')); }
    else if (act === 'unlock') {
      for (const c of Object.keys(D.owned)) D.owned[c] = CATALOG[c].map((x) => x.id);
      save.commit();
      say('Mağazadaki her şey açıldı.');
    } else if (act === 'reset') {
      if (Date.now() - resetArmed > 4000) { resetArmed = Date.now(); say('Emin misin? Silmek için tekrar dokun.'); return; }
      resetArmed = 0;
      try { localStorage.removeItem('akinti_save_v1'); } catch (er) { /* ignore */ }
      save.data = save.load();
      save.commit();
      api.applyEquipped();
      say('Kayıt sıfırlandı.');
    } else if (act === 'god') { S.god = !S.god; renderFlags(); }
    else if (act === 'speed') { S.timeMul = S.timeMul === 1 ? 2 : S.timeMul === 2 ? 4 : 1; renderFlags(); }
    else if (act === 'shield') inRun(() => { S.shield = S.shieldMax; api.popup('KALKAN!', 'yönetici', 'cyan'); });
    else if (act === 'magnet') inRun(() => { S.magnet = S.magnetMax; api.popup('MIKNATIS!', 'yönetici', 'red'); });
    else if (act === 'over') inRun(() => api.over());
  });

  renderFlags();
}
