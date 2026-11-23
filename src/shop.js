// ---------------------------------------------------------------------------
// Marketplace: catalogue, wallet/save (local + per-user cloud sync), shop UI.
// Coins collected in runs are added to the wallet and spent on vessels and skins.
// Skins are cosmetic. Vessels keep the raft's hitbox (difficulty never changes) and each
// carries one perk: more coins, a coin-pulling wind, longer power-ups, armour or a dive.
// ---------------------------------------------------------------------------

export const CATS = [
  { id: 'boat', name: 'BOT' },
  { id: 'raft', name: 'DESEN' },
  { id: 'crew', name: 'EKİP' },
  { id: 'paddle', name: 'KÜREK' },
  { id: 'trail', name: 'İZ' },
];

const g2 = (a, b) => `linear-gradient(135deg, ${a}, ${b})`;

// vessel thumbnails: side views on a strip of sky and water
const SKY = '<rect width="160" height="90" fill="#bfe5f3"/><rect y="62" width="160" height="28" fill="#2b86aa"/><rect y="62" width="160" height="3" fill="#e9f7fb" opacity=".7"/>';
const WET = '<rect y="63" width="160" height="27" fill="#2b86aa" opacity=".55"/>';
const ves = (body, over = '') => `url('data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90">${SKY}${body}${over}</svg>`)}') center/cover no-repeat`;
const head = (x, y, c) => `<rect x="${x - 4}" y="${y + 4}" width="8" height="11" rx="3" fill="#2f3542"/><circle cx="${x}" cy="${y}" r="4.6" fill="${c}"/>`;

export const CATALOG = {
  boat: [
    { id: 'raft', name: 'Rafting Botu', price: 0, perk: {},
      sw: ves(`<line x1="44" y1="40" x2="34" y2="70" stroke="#222" stroke-width="2"/><line x1="96" y1="40" x2="88" y2="70" stroke="#222" stroke-width="2"/>${head(50, 40, '#f2f2ee')}${head(72, 39, '#d8241c')}${head(94, 40, '#f3c218')}${head(116, 37, '#191b1f')}<rect x="24" y="52" width="116" height="17" rx="8.5" fill="#e0501c"/><rect x="24" y="57" width="116" height="2" fill="#fff" opacity=".7"/>`, WET),
      desc: '5 kişilik kürekli şişme bot. Özel yetenek yok.' },
    { id: 'rib', name: 'Gelişmiş Bot', price: 1000, perk: { coin: 0.1 },
      sw: ves(`<path d="M34 66 L138 66 L128 75 L44 75 Z" fill="#e9ecef"/><rect x="74" y="36" width="20" height="17" fill="#eceff2"/><path d="M74 36 L82 27 L94 27 L94 36 Z" fill="#9fc4d6"/>${head(100, 34, '#f2f2ee')}${head(52, 44, '#d8241c')}<rect x="20" y="40" width="11" height="15" rx="3" fill="#25282e"/><rect x="23.5" y="54" width="4" height="18" fill="#25282e"/><path d="M28 52 L136 52 Q152 52 152 43 L152 60 Q146 68 128 68 L34 68 Q24 68 24 60 Q24 52 28 52 Z" fill="#e0501c"/>`, WET),
      desc: 'Sert tabanlı, motorlu şişme bot. ★ Altın +%10' },
    { id: 'sail', name: 'Yelkenli', price: 2500, perk: { coin: 0.2, wind: true },
      sw: ves(`<rect x="79" y="6" width="2.6" height="50" fill="#5a5f68"/><path d="M77 9 L77 53 L38 53 Z" fill="#fff"/><path d="M84 12 L84 53 L116 53 Z" fill="#f0f2f4"/><rect x="66" y="47" width="26" height="9" rx="2" fill="#d9472f"/><path d="M22 55 L146 55 L130 70 L38 70 Z" fill="#f6f6f6"/><rect x="22" y="55" width="124" height="3" fill="#d9472f"/>`, WET),
      desc: '★ Rüzgâr: yakındaki altınları kendiliğinden toplar · Altın +%20' },
    { id: 'yacht', name: 'Yarış Yatı', price: 5000, perk: { coin: 0.35, pow: 2 },
      sw: ves(`<path d="M58 52 L80 36 L118 36 L126 52 Z" fill="#dfe9f2"/><path d="M84 39 L114 39 L119 49 L72 49 Z" fill="#34495e"/><path d="M12 50 L152 50 Q152 57 140 66 L30 66 Q14 62 12 50 Z" fill="#2f6fd6"/><path d="M12 50 L152 50 L150 54 L14 54 Z" fill="#fff"/>`, WET),
      desc: '★ Kalkan ve mıknatıs 2 kat uzun sürer · Altın +%35' },
    { id: 'ship', name: 'Gemi', price: 10000, perk: { coin: 0.5, armor: 1 },
      sw: ves(`<rect x="51" y="8" width="2.5" height="44" fill="#6b4126"/><rect x="88" y="4" width="2.5" height="48" fill="#6b4126"/><rect x="120" y="14" width="2.2" height="36" fill="#6b4126"/><rect x="40" y="14" width="26" height="14" rx="2" fill="#fbf7ee"/><rect x="42" y="31" width="22" height="12" rx="2" fill="#fbf7ee"/><rect x="75" y="9" width="30" height="16" rx="2" fill="#fbf7ee"/><rect x="77" y="28" width="26" height="14" rx="2" fill="#fbf7ee"/><rect x="110" y="18" width="22" height="13" rx="2" fill="#fbf7ee"/><path d="M90 4 L102 7 L90 10 Z" fill="#d8241c"/><rect x="18" y="38" width="28" height="13" fill="#8a4a2a"/><path d="M18 50 L150 46 L134 70 L34 70 Z" fill="#a8603a"/><rect x="24" y="55" width="110" height="2.5" fill="#6b3a20"/>`, WET),
      desc: '★ Zırh: her turda bir çarpmayı affeder · Altın +%50' },
    { id: 'sub', name: 'Denizaltı', price: 20000, perk: { coin: 1.0, dive: true },
      sw: ves(`<path d="M90 36 V20 H97" stroke="#6b7078" stroke-width="2.6" fill="none"/><path d="M68 50 L72 34 L98 34 L101 50 Z" fill="#f2c313"/><ellipse cx="82" cy="60" rx="64" ry="13" fill="#f2c313"/><circle cx="50" cy="56" r="3" fill="#1a2a33" stroke="#c79a3a" stroke-width="1.2"/><circle cx="66" cy="56" r="3" fill="#1a2a33" stroke="#c79a3a" stroke-width="1.2"/><circle cx="98" cy="56" r="3" fill="#1a2a33" stroke="#c79a3a" stroke-width="1.2"/><circle cx="114" cy="56" r="3" fill="#1a2a33" stroke="#c79a3a" stroke-width="1.2"/><path d="M142 52 L152 46 L152 74 L142 68 Z" fill="#e0b010"/>`, WET),
      desc: '★ Dalış: çarpacağın an dalar, engelin altından geçer (20 sn\'de bir) · Altın ×2' },
  ],
  raft: [
    { id: 'klasik', name: 'Klasik', price: 0, base: '#d9441a', pattern: 'solid', sw: g2('#ff7a3a', '#c9370f'), desc: 'Turuncu klasik rafting botu.' },
    { id: 'okyanus', name: 'Okyanus', price: 250, base: '#1f63c8', pattern: 'solid', sw: g2('#4aa0ff', '#1648a0'), desc: 'Derin mavi.' },
    { id: 'orman', name: 'Orman', price: 400, base: '#2f7d36', pattern: 'solid', sw: g2('#5fc060', '#1f5a26'), desc: 'Koyu yeşil.' },
    { id: 'gece', name: 'Gece Neon', price: 700, base: '#1b1d22', pattern: 'neon', accent: '#31f0ff', thwart: '#24272e', sw: 'linear-gradient(180deg,#1b1d22 40%,#31f0ff 42%,#1b1d22 46%,#1b1d22 70%,#31f0ff 72%,#1b1d22 76%)', desc: 'Karanlıkta parlayan şeritler.' },
    { id: 'kamuflaj', name: 'Kamuflaj', price: 900, base: '#5a6b3a', pattern: 'camo', thwart: '#3d4a28', sw: 'radial-gradient(circle at 30% 30%,#3d4a28 18%,transparent 20%),radial-gradient(circle at 70% 65%,#6b5a3a 20%,transparent 22%),radial-gradient(circle at 60% 20%,#2a3320 14%,transparent 16%),#5a6b3a', desc: 'Askeri desen.' },
    { id: 'alev', name: 'Alev', price: 1200, base: '#a8160e', pattern: 'flame', accent: '#ffb21a', sw: 'linear-gradient(0deg,#a8160e 30%,#ff6a12 55%,#ffd44a 80%)', desc: 'Yanlarında alev deseni.' },
    { id: 'kutup', name: 'Kutup', price: 1500, base: '#e6eef5', pattern: 'stripe', accent: '#2f8fe0', accent2: '#1d3c6e', logo: 'rgba(20,40,80,0.9)', thwart: '#2f8fe0', sw: 'linear-gradient(180deg,#e6eef5 45%,#2f8fe0 47%,#2f8fe0 62%,#e6eef5 64%)', desc: 'Beyaz gövde, buz mavisi şerit.' },
    { id: 'altin', name: 'Altın', price: 2500, base: '#d4a017', pattern: 'gold', metal: true, logo: 'rgba(80,50,0,0.85)', sw: g2('#fff1a8', '#b07a00'), desc: 'Parlak metal altın. Gösteriş için.' },
  ],
  crew: [
    { id: 'karma', name: 'Karma', price: 0, members: null, sw: 'conic-gradient(#d8241c 0 25%,#f2c313 0 50%,#1f62c9 0 75%,#e24a17 0)', desc: 'Herkes kendi renginde.' },
    { id: 'kirmizi', name: 'Kırmızı Takım', price: 300, members: { jacket: ['#eef0f3'], pants: ['#1c1f26'], vest: ['#d8241c'], helmet: ['#d8241c', '#d8241c', '#d8241c', '#d8241c', '#f2f2ee'] }, sw: g2('#ff4a3a', '#a8160e'), desc: 'Beyaz mont, kırmızı yelek ve kask.' },
    { id: 'lacivert', name: 'Lacivert', price: 500, members: { jacket: ['#1d2f5e'], pants: ['#14182a'], vest: ['#f2c313'], helmet: ['#1d2f5e', '#1d2f5e', '#1d2f5e', '#1d2f5e', '#f2c313'] }, sw: 'linear-gradient(180deg,#1d2f5e 50%,#f2c313 50%)', desc: 'Lacivert takım, sarı yelekler.' },
    { id: 'neon', name: 'Neon', price: 800, members: { jacket: ['#14161a'], pants: ['#14161a'], vest: ['#7dff3a', '#ff2fd0', '#7dff3a', '#ff2fd0', '#31f0ff'], helmet: ['#14161a'], glowVest: true }, sw: 'linear-gradient(135deg,#7dff3a 0 33%,#14161a 0 66%,#ff2fd0 0)', desc: 'Siyah takım, fosforlu yelekler.' },
    { id: 'komando', name: 'Komando', price: 1000, members: { jacket: ['#4b5a32'], pants: ['#3a4228'], vest: ['#2d3520'], helmet: ['#262b1c'] }, sw: g2('#6b7a48', '#2d3520'), desc: 'Haki tonlar.' },
    { id: 'kutup', name: 'Kutup', price: 1200, members: { jacket: ['#f4f7fb'], pants: ['#c9d6e3'], vest: ['#3aa0e8'], helmet: ['#f4f7fb'] }, sw: 'linear-gradient(180deg,#f4f7fb 50%,#3aa0e8 50%)', desc: 'Beyaz ve buz mavisi.' },
    { id: 'vip', name: 'Siyah-Altın', price: 2000, members: { jacket: ['#121316'], pants: ['#121316'], vest: ['#d4a017'], helmet: ['#d4a017'], metalVest: true, metalHelmet: true }, sw: 'linear-gradient(180deg,#121316 50%,#d4a017 50%)', desc: 'Siyah takım, altın yelek ve kask.' },
  ],
  paddle: [
    { id: 'sari', name: 'Standart', price: 0, colors: null, sw: g2('#ffd23a', '#1f6fd6'), desc: 'Sarı ve mavi kürekler (rafting botunda).' },
    { id: 'karbon', name: 'Karbon', price: 200, colors: ['#16181c'], sw: 'repeating-linear-gradient(45deg,#16181c 0 4px,#2a2d33 4px 8px)', desc: 'Mat siyah karbon.' },
    { id: 'turkuaz', name: 'Turkuaz', price: 300, colors: ['#18c4c0'], sw: g2('#5ff0e8', '#0e8a86'), desc: 'Turkuaz kürekler.' },
    { id: 'gokkusagi', name: 'Gökkuşağı', price: 600, colors: ['#ff3b3b', '#ffb21a', '#38d430', '#2f8dff', '#b04dff'], sw: 'linear-gradient(90deg,#ff3b3b,#ffb21a,#38d430,#2f8dff,#b04dff)', desc: 'Her kürek başka renk.' },
    { id: 'altin', name: 'Altın', price: 1500, colors: ['#d4a017'], metal: true, sw: g2('#fff1a8', '#b07a00'), desc: 'Metal altın kürekler.' },
  ],
  trail: [
    { id: 'yok', name: 'Yok', price: 0, color: null, sw: 'repeating-linear-gradient(45deg,#2a3a40 0 6px,#22323a 6px 12px)', desc: 'Sadece köpük.' },
    { id: 'altin', name: 'Altın Tozu', price: 500, color: '#ffc83a', glow: 3.2, up: 0.6, sw: 'radial-gradient(circle,#fff6b8 10%,#ffc83a 30%,#3a2a00 75%)', desc: 'Botun arkasında altın pırıltılar.' },
    { id: 'buz', name: 'Buz Kristali', price: 700, color: '#9ff4ff', glow: 2.6, up: 0.3, sw: 'radial-gradient(circle,#ffffff 10%,#9ff4ff 32%,#0a3040 75%)', desc: 'Soğuk mavi kristaller.' },
    { id: 'kivilcim', name: 'Kıvılcım', price: 900, color: '#ff6a1a', glow: 3.6, up: 1.6, sw: 'radial-gradient(circle,#ffe08a 10%,#ff6a1a 35%,#300800 75%)', desc: 'Yükselen ateş kıvılcımları.' },
    { id: 'gokkusagi', name: 'Gökkuşağı', price: 1500, rainbow: true, glow: 2.8, up: 0.5, sw: 'conic-gradient(#ff3b3b,#ffb21a,#38d430,#2f8dff,#b04dff,#ff3b3b)', desc: 'Renk değiştiren iz.' },
  ],
};

export const item = (cat, id) => CATALOG[cat].find((x) => x.id === id) || CATALOG[cat][0];

// ---------------------------------------------------------------------------
// Save: localStorage (always) + per-user cloud document when the page runs on claude.ai
// ---------------------------------------------------------------------------
const KEY = 'akinti_save_v1';
const defaults = () => ({
  v: 1, coins: 0, best: 0, runs: 0, t: 0,
  owned: { boat: ['raft'], raft: ['klasik'], crew: ['karma'], paddle: ['sari'], trail: ['yok'] },
  equip: { boat: 'raft', raft: 'klasik', crew: 'karma', paddle: 'sari', trail: 'yok' },
});

function sanitize(o) {
  const d = defaults();
  if (!o || typeof o !== 'object') return d;
  d.coins = Math.max(0, Math.floor(Number(o.coins) || 0));
  d.best = Math.max(0, Math.floor(Number(o.best) || 0));
  d.runs = Math.max(0, Math.floor(Number(o.runs) || 0));
  d.t = Number(o.t) || 0;
  for (const c of Object.keys(d.owned)) {
    const ids = CATALOG[c].map((x) => x.id);
    const own = Array.isArray(o.owned && o.owned[c]) ? o.owned[c].filter((x) => ids.includes(x)) : [];
    d.owned[c] = [...new Set([ids[0], ...own])];
    const eq = o.equip && o.equip[c];
    d.equip[c] = d.owned[c].includes(eq) ? eq : ids[0];
  }
  return d;
}

export const save = {
  data: defaults(),
  listeners: [],
  cloud: null,
  writing: false,
  dirty: false,
  load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    this.data = sanitize(raw);
    if (!raw) { // migrate the old best score
      try { this.data.best = parseInt(localStorage.getItem('akinti_best') || '0', 10) || 0; } catch (e) { /* ignore */ }
    }
    return this.data;
  },
  commit() {
    this.data.t = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* storage may be unavailable */ }
    this.push();
    for (const f of this.listeners) f(this.data);
  },
  onChange(f) { this.listeners.push(f); },
  /** one cloud write at a time, coalescing changes made meanwhile */
  async push() {
    if (!this.cloud) return;
    if (this.writing) { this.dirty = true; return; }
    this.writing = true;
    try {
      do {
        this.dirty = false;
        await this.cloud.set(JSON.parse(JSON.stringify(this.data)));
      } while (this.dirty);
    } catch (e) {
      if (e && (e.code === 'invalid_argument' || e.code === 'revoked' || e.code === 'not_granted')) this.cloud = null;
    }
    this.writing = false;
  },
  /** merge a cloud save: newest wins for coins/equip, owned items and best are united */
  merge(remote) {
    const r = sanitize(remote), l = this.data;
    const newer = r.t > l.t ? r : l;
    const out = sanitize({ ...newer, best: Math.max(r.best, l.best), runs: Math.max(r.runs, l.runs) });
    for (const c of Object.keys(out.owned)) out.owned[c] = [...new Set([...l.owned[c], ...r.owned[c]])];
    this.data = out;
    return JSON.stringify(sanitize(remote)) !== JSON.stringify(out);
  },
  async initCloud() {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return;
      const id = await user.id();
      if (!id) return;
      const ref = db.doc('data/users/' + id + '/akinti');
      const snap = await Promise.race([ref.get(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
      this.cloud = ref;
      const changed = snap.exists ? this.merge(snap.data()) : true;
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
      for (const f of this.listeners) f(this.data);
      if (changed) this.push();
    } catch (e) { /* offline or not on claude.ai: local save only */ }
  },
};

// ---------------------------------------------------------------------------
// Shop UI (bottom sheet over the live 3D raft)
// ---------------------------------------------------------------------------
export class ShopUI {
  /** hooks: { preview(cat, item), sound(name), close() } */
  constructor(hooks) {
    this.h = hooks;
    this.el = document.getElementById('shop');
    this.grid = document.getElementById('shopGrid');
    this.btn = document.getElementById('shopAction');
    this.coinsEl = document.getElementById('shopCoins');
    this.nameEl = document.getElementById('shopName');
    this.descEl = document.getElementById('shopDesc');
    this.cat = 'boat';
    this.sel = null;
    this.open = false;
    this.tabs = [...this.el.querySelectorAll('.tab')];
    for (const t of this.tabs) t.addEventListener('click', () => { this.h.sound('click'); this.setCat(t.dataset.cat); });
    document.getElementById('shopClose').addEventListener('click', () => this.hide());
    this.btn.addEventListener('click', () => this.action());
    save.onChange(() => { if (this.open) this.render(); });
  }

  show(cat) {
    this.open = true;
    this.el.classList.remove('hidden');
    this.setCat(cat || this.cat);
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    // drop any un-bought try-on
    for (const c of CATS) this.h.preview(c.id, item(c.id, save.data.equip[c.id]));
    this.h.close();
  }

  setCat(cat) {
    this.cat = cat;
    for (const t of this.tabs) t.classList.toggle('on', t.dataset.cat === cat);
    // restore other categories to what is equipped, select the equipped item here
    // (paddles only show on the rafting boat, so that tab previews on the raft)
    for (const c of CATS) if (c.id !== cat) this.h.preview(c.id, c.id === 'boat' && cat === 'paddle' ? item('boat', 'raft') : item(c.id, save.data.equip[c.id]));
    this.select(save.data.equip[cat], true);
  }

  select(id, quiet) {
    this.sel = id;
    this.h.preview(this.cat, item(this.cat, id));
    if (!quiet) this.h.sound('click');
    this.render();
  }

  render() {
    const D = save.data;
    this.coinsEl.textContent = D.coins.toLocaleString('tr-TR');
    const list = CATALOG[this.cat];
    this.grid.innerHTML = '';
    for (const it of list) {
      const owned = D.owned[this.cat].includes(it.id);
      const eq = D.equip[this.cat] === it.id;
      const card = document.createElement('button');
      card.className = 'item' + (it.id === this.sel ? ' sel' : '') + (eq ? ' eq' : '');
      const tag = eq ? '<span class="tag on">KULLANILIYOR</span>' : owned ? '<span class="tag">SENİN</span>'
        : `<span class="price${D.coins < it.price ? ' poor' : ''}"><i class="coin"></i>${it.price.toLocaleString('tr-TR')}</span>`;
      card.innerHTML = `<span class="sw" style="background:${it.sw}"></span><span class="nm">${it.name}</span>${tag}`;
      card.addEventListener('click', () => this.select(it.id));
      this.grid.appendChild(card);
    }
    const it = item(this.cat, this.sel);
    const owned = D.owned[this.cat].includes(it.id), eq = D.equip[this.cat] === it.id;
    this.nameEl.textContent = it.name;
    this.descEl.textContent = it.desc || '';
    this.btn.classList.remove('dim', 'buy');
    if (eq) { this.btn.textContent = 'KULLANILIYOR'; this.btn.classList.add('dim'); }
    else if (owned) this.btn.textContent = 'KULLAN';
    else if (D.coins >= it.price) { this.btn.innerHTML = `SATIN AL · <i class="coin"></i>${it.price.toLocaleString('tr-TR')}`; this.btn.classList.add('buy'); }
    else { this.btn.innerHTML = `${(it.price - D.coins).toLocaleString('tr-TR')} ALTIN DAHA LAZIM`; this.btn.classList.add('dim'); }
  }

  action() {
    const D = save.data, it = item(this.cat, this.sel);
    const owned = D.owned[this.cat].includes(it.id);
    if (D.equip[this.cat] === it.id) return;
    if (!owned) {
      if (D.coins < it.price) { this.h.sound('no'); return; }
      D.coins -= it.price;
      D.owned[this.cat].push(it.id);
      this.h.sound('buy');
      this.h.bought && this.h.bought(this.cat, it);
    } else this.h.sound('click');
    D.equip[this.cat] = it.id;
    save.commit();
    this.render();
  }
}
