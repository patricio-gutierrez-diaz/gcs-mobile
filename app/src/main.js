// main.js — the app: character list, the sheet screens, session tracking and notes.
import { h, icon, signed, plural, fill } from './ui.js';
import * as gcs from './gcs.js';
import * as store from './store.js';

const root = document.getElementById('app');

const S = {
  view: 'home',       // 'home' | 'sheet'
  id: null,           // stored character id
  raw: null,          // the .gcs JSON, edited in place by tracking
  char: null,         // parsed view model
  ui: null,           // { collapsed: [], tab }
  tab: 'stats',
  skillQuery: '',
  skillFilter: 'All',
  spellQuery: '',
  openSpell: null,
  openItem: null,
  savedAt: null,
  editNote: null,     // id of the note being edited, or 'new:<container id>' / 'new:' for a new one
  noteDraft: '',
};

// ---------- rendering ----------

function render(scrollTop = false) {
  const y = window.scrollY;
  root.replaceChildren(S.view === 'sheet' && S.char ? sheet() : home());
  window.scrollTo(0, scrollTop ? 0 : y);
}

let toastTimer;
function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

/**
 * Bottom-sheet number entry: type an amount, then Subtract, Add or Set.
 * Used by every tracked number (HP, FP, uses, quantities).
 */
function numberSheet({ title, current, min = -Infinity, max = Infinity, subtractLabel = 'Subtract', addLabel = 'Add', apply }) {
  const input = h('input', { type: 'number', inputmode: 'numeric', pattern: '[0-9]*', class: 'num-input', 'aria-label': `Amount for ${title}`, placeholder: '0' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const go = mode => {
    const n = Math.abs(parseInt(input.value, 10));
    if (!Number.isFinite(n)) { input.focus(); return; }
    let v = mode === 'set' ? n : mode === 'add' ? current + n : current - n;
    v = Math.max(min, Math.min(max, v));
    close();
    if (v !== current) apply(v);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go('set'); });
  const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(); } },
    h('div', { class: 'num-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'spread' }, h('strong', null, title), h('span', { class: 'muted small' }, max < Infinity ? `Now ${current} of ${max}` : `Now ${current}`)),
      input,
      h('div', { class: 'num-btns' },
        h('button', { type: 'button', class: 'btn', onclick: () => go('sub') }, `− ${subtractLabel}`),
        h('button', { type: 'button', class: 'btn', onclick: () => go('add') }, `+ ${addLabel}`),
        h('button', { type: 'button', class: 'btn primary', onclick: () => go('set') }, 'Set to')),
      h('button', { type: 'button', class: 'btn ghost wide', onclick: close }, 'Cancel')));
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  input.focus();
}

// ---------- characters ----------

const fileInput = h('input', {
  type: 'file', class: 'visually-hidden', 'aria-hidden': 'true', tabindex: '-1',
  onchange: e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); },
});
document.body.append(fileInput);

async function importFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
    gcs.parseCharacter(data);
  } catch (err) {
    toast(`Couldn't read ${file.name}: ${err.message.includes('GCS') ? err.message : 'it is not a GCS character file.'}`);
    return;
  }
  const id = typeof data.id === 'string' && data.id ? data.id : `local-${Date.now()}`;
  try {
    store.saveCharacterText(id, gcs.serializeCharacter(data));
  } catch {
    toast('Phone storage is full. Remove a character from this phone and try again.');
    return;
  }
  const p = data.profile || {};
  store.upsertCharacter({ id, name: p.name || 'Unnamed', title: p.title || '', player: p.player_name || '', file: file.name, updated: Date.now() });
  openCharacter(id);
}

function openCharacter(id) {
  const text = store.loadCharacterText(id);
  if (!text) { toast('That character is no longer saved on this phone.'); store.removeCharacter(id); render(); return; }
  try {
    S.raw = JSON.parse(text);
    S.char = gcs.parseCharacter(S.raw);
  } catch (err) {
    toast(`Couldn't open this character: ${err.message}`);
    return;
  }
  S.id = id;
  S.ui = store.loadUi(id);
  S.tab = S.ui.tab;
  S.view = 'sheet';
  Object.assign(S, { skillQuery: '', skillFilter: 'All', spellQuery: '', openSpell: null, openItem: null, savedAt: null });
  store.touchCharacter(id);
  render(true);
}

function closeCharacter() {
  Object.assign(S, { view: 'home', id: null, raw: null, char: null, ui: null });
  render(true);
}

/** Apply a tracking change to the file, save it on the phone, redraw. */
function track(change) {
  try {
    change(S.raw);
    S.char = gcs.parseCharacter(S.raw);
    store.saveCharacterText(S.id, gcs.serializeCharacter(S.raw));
    store.touchCharacter(S.id);
    S.savedAt = new Date();
  } catch (err) {
    toast(err.name === 'QuotaExceededError' ? 'Phone storage is full; this change was not saved.' : err.message);
  }
  render();
}

async function exportCharacter() {
  const name = `${S.char.profile.name || 'character'}.gcs`;
  const file = new File([gcs.serializeCharacter(S.raw)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function removeFromPhone() {
  if (!confirm(`Remove ${S.char.profile.name} from this phone? The file in GCS or Google Drive is not touched.`)) return;
  store.removeCharacter(S.id);
  closeCharacter();
}

// ---------- collapse state ----------

const isOpen = key => !S.ui.collapsed.includes(key);
function toggle(key) {
  S.ui.collapsed = isOpen(key) ? [...S.ui.collapsed, key] : S.ui.collapsed.filter(k => k !== key);
  store.saveUi(S.id, S.ui);
  render();
}

function chevron(open) {
  return icon('chevron', 16, open ? 'chev open' : 'chev');
}

/** A collapsible section: heading button + body built only when open. */
function section(key, title, meta, body, { forceOpen = false } = {}) {
  const open = forceOpen || isOpen(key);
  return h('section', { class: 'sec' },
    h('h2', { class: 'sec-h' },
      h('button', { type: 'button', class: 'sec-btn', 'aria-expanded': String(open), onclick: () => toggle(key) },
        chevron(open), h('span', { class: 'sec-title' }, title), h('span', { class: 'sec-meta' }, meta))),
    open ? body() : null);
}

function plainSection(title, ...content) {
  return h('section', { class: 'sec' }, h('h2', { class: 'sec-title sec-static' }, title), content);
}

/** A collapsible section whose content is already built; keyed by its title. */
function box(title, meta, ...content) {
  return section(`box:${S.tab}:${title}`, title, meta, () => content);
}

/**
 * Rows for a tree of nodes inside a card. Nested containers get their own
 * collapsible sub-header; leaves are drawn by `leaf`.
 */
function treeRows(nodes, kind, leaf, depth = 0, forceOpen = false) {
  return nodes.map(node => {
    if (!node.container) return leaf(node, depth);
    const key = `${kind}:${node.id}`;
    const open = forceOpen || isOpen(key);
    return [
      h('button', { type: 'button', class: `row sub-h depth-${Math.min(depth, 3)}`, 'aria-expanded': String(open), onclick: () => toggle(key) },
        chevron(open), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, node.title)),
        h('span', { class: 'row-meta' }, String(node.count))),
      open ? treeRows(node.children, kind, leaf, depth + 1, forceOpen) : null,
    ];
  });
}

/** Keep leaves whose text matches; keep containers that still hold something. */
function filterTree(nodes, query, text) {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const out = [];
  for (const n of nodes) {
    if (n.container) {
      if (n.title.toLowerCase().includes(q)) { out.push(n); continue; }
      const kids = filterTree(n.children, q, text);
      if (kids.length) out.push({ ...n, children: kids, count: kids.length });
    } else if (text(n).toLowerCase().includes(q)) {
      out.push(n);
    }
  }
  return out;
}

// ---------- home (character list) ----------

function home() {
  const chars = store.listCharacters();
  return h('div', { class: 'home' },
    h('header', { class: 'home-h' },
      h('h1', { class: 'brand' }, 'GCS Mobile'),
      h('p', { class: 'muted' }, 'Character sheets from GURPS Character Sheet, on your phone.')),
    h('main', { class: 'home-main' },
      h('button', { type: 'button', class: 'btn primary wide', onclick: () => fileInput.click() }, icon('upload', 20), 'Load character file'),
      chars.length
        ? h('div', { class: 'card list' }, chars.map(c => characterRow(c)))
        : h('div', { class: 'card empty' },
          h('p', null, 'No characters on this phone yet.'),
          h('p', { class: 'muted' }, 'Tap Load character file and choose a .gcs file from Files or Google Drive. It stays on this phone and works without signal.'))));
}

function characterRow(entry) {
  let portrait = '';
  try { portrait = gcs.parseCharacter(JSON.parse(store.loadCharacterText(entry.id))).profile.portrait; } catch { /* list it anyway */ }
  const sub = [entry.title, entry.player && `Player: ${entry.player}`].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'row char-row', onclick: () => openCharacter(entry.id) },
    portraitEl(portrait, entry.name, 48),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, entry.name), sub ? h('span', { class: 'row-sub' }, sub) : null),
    icon('chevron', 18, 'muted'));
}

function portraitEl(src, name, size) {
  if (src) return h('img', { class: 'portrait', src, alt: '', width: size, height: size });
  return h('span', { class: 'portrait placeholder', style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' }, (name || '?').charAt(0));
}

// ---------- sheet ----------

const TABS = [
  { id: 'stats', label: 'Stats', icon: 'stats' },
  { id: 'combat', label: 'Combat', icon: 'combat' },
  { id: 'skills', label: 'Skills', icon: 'skills' },
  { id: 'spells', label: 'Spells', icon: 'spells' },
  { id: 'gear', label: 'Gear', icon: 'gear' },
  { id: 'notes', label: 'Notes', icon: 'notes' },
  { id: 'more', label: 'More', icon: 'more' },
];

function visibleTabs() {
  return TABS.filter(t => t.id !== 'spells' || S.char.spells.length);
}

function setTab(id) {
  S.tab = id;
  S.editNote = null;
  S.ui.tab = id;
  store.saveUi(S.id, S.ui);
  render(true);
}

function sheet() {
  const tabs = visibleTabs();
  if (!tabs.some(t => t.id === S.tab)) S.tab = 'stats';
  const screens = { stats: statsScreen, combat: combatScreen, skills: skillsScreen, spells: spellsScreen, gear: gearScreen, notes: notesScreen, more: moreScreen };
  return h('div', { class: 'sheet' },
    sheetHeader(),
    h('main', { class: 'screen', id: 'screen' }, screens[S.tab]()),
    h('nav', { class: 'tabbar', 'aria-label': 'Sections', style: { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } },
      tabs.map(t => h('button', { type: 'button', class: `tab${t.id === S.tab ? ' active' : ''}`, 'aria-current': t.id === S.tab ? 'page' : null, onclick: () => setTab(t.id) },
        icon(t.icon), t.label))));
}

function sheetHeader() {
  const c = S.char;
  const p = c.profile;
  const subtitle = [p.title, c.ancestry].filter(Boolean).join(' · ');
  return h('header', { class: 'sheet-h' },
    h('div', { class: 'id-row' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'All characters', onclick: closeCharacter }, icon('back', 22)),
      portraitEl(p.portrait, p.name, 52),
      h('div', { class: 'id-text' }, h('div', { class: 'name' }, p.name), subtitle ? h('div', { class: 'muted small' }, subtitle) : null),
      h('div', { class: 'pts' }, h('div', { class: 'pts-n' }, String(c.points.total)), h('div', { class: 'label' }, c.points.unspent ? `${c.points.unspent} unspent` : 'Points'))),
    c.attributes.pools.length ? h('div', { class: 'pools' }, poolsInOrder(c.attributes.pools).map(poolCard)) : null);
}

/** HP first, then FP, then any custom pools in file order. */
function poolsInOrder(pools) {
  const rank = id => (id === 'hp' ? 0 : id === 'fp' ? 1 : 2);
  return [...pools].sort((a, b) => rank(a.id) - rank(b.id));
}

function poolCard(pool) {
  const pct = pool.max > 0 ? Math.max(0, Math.min(100, Math.round(pool.current / pool.max * 100))) : 0;
  const hurt = pool.current < pool.max;
  const kind = pool.id === 'hp' ? 'hp' : pool.id === 'fp' ? 'fp' : 'other';
  const set = v => track(d => gcs.setPoolCurrent(d, pool.id, v));
  const ask = () => numberSheet({
    title: pool.fullName || pool.name, current: pool.current, max: pool.max,
    subtractLabel: pool.id === 'hp' ? 'Damage' : 'Spend', addLabel: pool.id === 'hp' ? 'Heal' : 'Recover', apply: set,
  });
  return h('div', { class: `pool ${kind}` },
    h('div', { class: 'pool-top' },
      h('span', { class: 'label' }, pool.name),
      h('span', { class: `status${hurt ? ' hurt' : ''}`, title: pool.statusExplanation || null }, pool.status)),
    h('button', { type: 'button', class: 'pool-val', 'aria-label': `${pool.name} ${pool.current} of ${pool.max}. Tap to enter an amount.`, onclick: ask },
      String(pool.current), h('span', { class: 'pool-max' }, ` / ${pool.max}`)),
    h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: { width: `${pct}%` } })),
    h('div', { class: 'pool-btns' },
      h('button', { type: 'button', class: 'step', 'aria-label': `Lose 1 ${pool.name}`, onclick: () => set(pool.current - 1) }, '−'),
      h('button', { type: 'button', class: 'step', 'aria-label': `Recover 1 ${pool.name}`, disabled: pool.current >= pool.max, onclick: () => set(pool.current + 1) }, '+')));
}

// ---------- Stats ----------

function statsScreen() {
  const c = S.char;
  const e = c.encumbrance;
  const fmt = v => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v));
  return [
    box('Attributes', '',
      h('div', { class: 'tiles cols-4' }, c.attributes.primary.map(a =>
        h('div', { class: 'tile' }, h('span', { class: 'label' }, a.name), h('span', { class: 'tile-v big' }, fmt(a.value)), h('span', { class: 'tile-n' }, a.fullName))))),
    c.attributes.secondary.length ? box('Secondary', plural(c.attributes.secondary.length, 'stat'),
      h('div', { class: 'card list' }, c.attributes.secondary.map(a =>
        h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, a.fullName)), h('span', { class: 'row-num' }, fmt(a.value)))))) : null,
    box('Load & Movement', `${e.name} load`,
      h('div', { class: 'card pad' },
        h('div', { class: 'spread' }, h('strong', null, e.overloaded ? 'Overloaded' : `${e.name} encumbrance`), h('span', { class: 'muted small' }, `${e.carriedText} carried`)),
        h('div', { class: 'enc' }, e.levels.map((l, i) =>
          h('div', { class: `enc-l${i === e.level && !e.overloaded ? ' on' : ''}` }, h('span', null, l.name), h('span', { class: 'enc-max' }, `≤${Math.round(l.max)}`)))),
        h('p', { class: 'muted small' }, `Basic Lift ${c.derived.basicLift}. Dodge and Move below already include this load.`)),
      h('div', { class: 'tiles cols-4' },
        [['Dodge', e.dodge], ['Move', e.move], ['Swing', c.derived.swing], ['Thrust', c.derived.thrust]].map(([k, v]) =>
          h('div', { class: 'tile' }, h('span', { class: 'tile-v' }, v == null || v === '' ? '—' : String(v)), h('span', { class: 'tile-n' }, k))))),
  ];
}

// ---------- Combat ----------

const DR_ABBR = { crushing: 'cr', cutting: 'cut', piercing: 'pi', impaling: 'imp', burning: 'burn', corrosion: 'cor', toxic: 'tox', fatigue: 'fat', all: '' };

function bestDefense(weapons, field) {
  let best = null;
  for (const w of weapons) {
    const n = parseInt(w[field], 10);
    if (Number.isFinite(n) && (!best || n > best.n)) best = { n, text: String(w[field]), name: w.name };
  }
  return best;
}

function weaponCard(w, ranged) {
  const chips = ranged
    ? [w.damage, w.accuracy && `Acc ${w.accuracy}`, w.range && `Range ${w.range}`, w.rateOfFire && `RoF ${w.rateOfFire}`, w.shots && `Shots ${w.shots}`, w.bulk && `Bulk ${w.bulk}`, w.recoil && `Rcl ${w.recoil}`, w.strength && `ST ${w.strength}`]
    : [w.damage, w.reach && `Reach ${w.reach}`, w.parry && w.parry !== 'No' ? `Parry ${w.parry}` : 'No parry', w.block && w.block !== 'No' && `Block ${w.block}`, w.strength && `ST ${w.strength}`];
  return h('div', { class: 'card weapon' },
    h('div', { class: 'row-main' },
      h('div', { class: 'w-name' }, h('span', { class: 'row-title' }, w.name), w.usage ? h('span', { class: 'muted small' }, w.usage) : null),
      h('div', { class: 'chips' }, chips.filter(Boolean).map(t => h('span', { class: 'chip' }, t)))),
    h('div', { class: 'roll' }, h('span', { class: 'roll-n' }, w.level == null ? '—' : String(w.level)), h('span', { class: 'roll-l' }, 'to hit')));
}

function combatScreen() {
  const c = S.char;
  const melee = c.weapons.melee.filter(w => w.level != null || w.reach);
  const ranged = c.weapons.ranged;
  const parry = bestDefense(melee, 'parry');
  const block = bestDefense(melee, 'block');
  const mods = [...c.modifiers.reactions.map(m => ({ ...m, kind: 'Reaction' })), ...c.modifiers.conditional];
  return [
    box('Active Defenses', '',
      h('div', { class: 'tiles cols-3' },
        h('div', { class: 'tile' }, h('span', { class: 'label' }, 'Dodge'), h('span', { class: 'tile-v big' }, String(c.encumbrance.dodge ?? '—')), h('span', { class: 'tile-n' }, `${c.encumbrance.name} load`)),
        h('div', { class: 'tile' }, h('span', { class: 'label' }, 'Parry'), h('span', { class: 'tile-v big' }, parry ? parry.text : '—'), h('span', { class: 'tile-n' }, parry ? parry.name : 'No parry')),
        h('div', { class: 'tile' }, h('span', { class: 'label' }, 'Block'), h('span', { class: 'tile-v big' }, block ? block.text : '—'), h('span', { class: 'tile-n' }, block ? block.name : 'No shield')))),
    melee.length ? box('Melee Attacks', plural(melee.length, 'attack'), melee.map(w => weaponCard(w, false))) : null,
    ranged.length ? box('Ranged Attacks', plural(ranged.length, 'attack'), ranged.map(w => weaponCard(w, true))) : null,
    c.hitLocations.length ? box('Hit Locations & DR', plural(c.hitLocations.length, 'location'),
      h('div', { class: 'card list' },
        h('div', { class: 'loc loc-head' }, h('span', null, 'Roll'), h('span', null, 'Location'), h('span', { class: 'r' }, 'To hit'), h('span', { class: 'r' }, 'DR')),
        c.hitLocations.map(l => h('div', { class: 'loc' },
          h('span', { class: 'muted' }, l.roll || '—'),
          h('span', null, l.name),
          h('span', { class: 'r' }, l.penalty ? signed(l.penalty) : '0'),
          h('span', { class: `r dr${l.dr ? '' : ' muted'}` }, [String(l.dr), ...l.drOther.map(o => `${o.value} ${DR_ABBR[o.type] ?? o.type}`)].join(' · ')))))) : null,
    mods.length ? box('Reactions & Modifiers', plural(mods.length, 'modifier'),
      h('div', { class: 'card list' }, mods.map(m =>
        h('div', { class: 'row top' },
          h('span', { class: `mod-n ${m.amount < 0 ? 'neg' : 'pos'}` }, signed(m.amount)),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, m.kind === 'Reaction' ? `Reaction ${m.situation}` : m.situation),
            h('span', { class: 'row-sub' }, m.source)))))) : null,
  ];
}

// ---------- Skills ----------

function skillLeaf(n, depth) {
  const meta = [n.technique ? 'Technique' : null, n.difficulty, plural(n.points, 'pt')].filter(Boolean).join(' · ');
  return h('div', { class: `row depth-${Math.min(depth, 3)}` },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, n.title), h('span', { class: 'row-sub' }, meta), n.notes ? h('span', { class: 'row-sub' }, n.notes) : null),
    h('span', { class: 'lvl' }, h('span', { class: 'lvl-n' }, n.level == null ? '—' : String(n.level)), h('span', { class: 'lvl-r' }, n.relative)));
}

function searchBox(label, value, onInput) {
  return h('label', { class: 'search' }, icon('search', 18),
    h('input', { type: 'search', 'aria-label': label, placeholder: label, value, oninput: onInput }));
}

function skillsScreen() {
  const sections = S.char.skills;
  if (!sections.length) return h('div', { class: 'card empty' }, h('p', null, 'No skills on this sheet.'));
  const names = ['All', ...new Set(sections.map(s => s.title))];
  if (!names.includes(S.skillFilter)) S.skillFilter = 'All';
  const results = h('div', { class: 'results' }, skillResults());
  return [
    searchBox('Search skills', S.skillQuery, e => { S.skillQuery = e.target.value; fill(results, skillResults()); }),
    names.length > 2 ? h('div', { class: 'filters' }, names.map(n =>
      h('button', { type: 'button', class: `pill${n === S.skillFilter ? ' on' : ''}`, 'aria-pressed': String(n === S.skillFilter), onclick: () => { S.skillFilter = n; render(); } }, n))) : null,
    results,
  ];
}

function skillResults() {
  const searching = !!S.skillQuery.trim();
  const shown = S.char.skills
    .filter(s => S.skillFilter === 'All' || s.title === S.skillFilter)
    .map(s => ({ ...s, children: filterTree(s.children, S.skillQuery, n => `${n.title} ${n.notes}`) }))
    .filter(s => s.children.length);
  if (!shown.length) return h('p', { class: 'muted center' }, 'No skills match.');
  return shown.map(s => section(`skill:${s.id}`, s.title, `${plural(s.count, 'skill')} · ${plural(s.points, 'pt')}`,
    () => h('div', { class: 'card list' }, treeRows(s.children, 'skill', skillLeaf, 0, searching)), { forceOpen: searching }));
}

// ---------- Spells ----------

function spellLeaf(n, depth) {
  const open = S.openSpell === n.id;
  const summary = [n.spellClass, n.cost && `Cost ${n.cost}`, n.time].filter(Boolean).join(' · ');
  const facts = [['Class', n.spellClass], ['Cost', n.cost], ['Maintain', n.maintain], ['Time', n.time], ['Duration', n.duration], ['Resist', n.resist], ['College', n.college], ['Reference', n.reference]]
    .filter(([, v]) => v);
  const attacks = (n.raw.weapons || []).map(w => [w.usage, w.calc?.damage, w.calc?.level != null && `skill ${w.calc.level}`, w.reach && `reach ${w.reach}`, w.range && `range ${w.calc?.range ?? w.range}`].filter(Boolean).join(' · '));
  return h('div', { class: `spell depth-${Math.min(depth, 3)}${open ? ' open' : ''}` },
    h('button', { type: 'button', class: 'row', 'aria-expanded': String(open), onclick: () => { S.openSpell = open ? null : n.id; render(); } },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, n.title), h('span', { class: 'row-sub' }, summary)),
      h('span', { class: 'lvl' }, h('span', { class: 'lvl-n' }, n.level == null ? '—' : String(n.level)), h('span', { class: 'lvl-r' }, n.relative)),
      chevron(open)),
    open ? h('div', { class: 'details' },
      h('div', { class: 'facts' }, facts.map(([k, v]) => h('div', { class: 'fact' }, h('span', { class: 'label' }, k), h('span', null, v)))),
      attacks.length ? h('div', { class: 'attack' }, h('span', { class: 'label' }, 'Attack'), attacks.map(a => h('span', null, a))) : null,
      n.notes ? h('p', { class: 'note-text' }, n.notes) : null) : null);
}

function spellsScreen() {
  const results = h('div', { class: 'results' }, spellResults());
  return [
    searchBox('Search spells', S.spellQuery, e => { S.spellQuery = e.target.value; fill(results, spellResults()); }),
    results,
  ];
}

function spellResults() {
  const searching = !!S.spellQuery.trim();
  const shown = S.char.spells
    .map(s => ({ ...s, children: filterTree(s.children, S.spellQuery, n => `${n.title} ${n.college} ${n.spellClass}`) }))
    .filter(s => s.children.length);
  if (!shown.length) return h('p', { class: 'muted center' }, 'No spells match.');
  return shown.map(s => section(`spell:${s.id}`, s.title, plural(s.count, 'spell'),
    () => h('div', { class: 'card list' }, treeRows(s.children, 'spell', spellLeaf, 0, searching)), { forceOpen: searching }));
}

// ---------- Gear ----------

/** − value + control; tapping the value opens number entry for big changes. */
function stepper({ label, value, text, max = Infinity, set }) {
  const stop = fn => e => { e.stopPropagation(); fn(); };
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', class: 'step', 'aria-label': `${label}: one less`, disabled: value <= 0, onclick: stop(() => set(value - 1)) }, '−'),
    h('button', { type: 'button', class: 'step-v', 'aria-label': `${label}: ${text}. Tap to enter an amount.`,
      onclick: stop(() => numberSheet({ title: label, current: value, min: 0, max, apply: set })) }, text),
    h('button', { type: 'button', class: 'step', 'aria-label': `${label}: one more`, disabled: value >= max, onclick: stop(() => set(value + 1)) }, '+'));
}

function usesStepper(n) {
  const value = n.uses ?? 0;
  return stepper({ label: `${n.title} uses`, value, text: `${value}/${n.maxUses}`, max: n.maxUses,
    set: v => track(d => gcs.setUses(d, n.id, v)) });
}

function qtyStepper(n) {
  return stepper({ label: n.title, value: n.quantity, text: `×${n.quantity}`,
    set: v => track(d => gcs.setQuantity(d, n.id, v)) });
}

function itemRow(n, depth) {
  const open = S.openItem === n.id;
  const inline = n.maxUses != null ? usesStepper(n) : n.quantity !== 1 ? qtyStepper(n) : h('span', { class: 'row-meta' }, n.extendedWeight);
  const sub = [n.notes, ...n.modifiers].filter(Boolean)[0] || (n.quantity !== 1 ? `${n.weight} each` : '');
  return h('div', { class: `item depth-${Math.min(depth, 3)}${open ? ' open' : ''}` },
    h('div', { class: 'row', role: 'button', tabindex: '0', 'aria-expanded': String(open),
      onclick: () => { S.openItem = open ? null : n.id; render(); },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.openItem = open ? null : n.id; render(); } } },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, n.title), sub ? h('span', { class: 'row-sub' }, sub) : null),
      inline),
    open ? h('div', { class: 'details' },
      h('div', { class: 'facts' },
        [['Quantity', String(n.quantity)], ['Weight', n.quantity !== 1 ? `${n.weight} each · ${n.extendedWeight}` : n.extendedWeight], ['Value', String(n.value)], ['Equipped', n.equipped ? 'Yes' : 'No'], ['Reference', n.reference]]
          .filter(([, v]) => v).map(([k, v]) => h('div', { class: 'fact' }, h('span', { class: 'label' }, k), h('span', null, v)))),
      n.notes ? h('p', { class: 'note-text' }, n.notes) : null,
      n.modifiers.length ? h('ul', { class: 'mods' }, n.modifiers.map(m => h('li', null, m))) : null,
      h('div', { class: 'detail-actions' },
        h('span', { class: 'label' }, 'Quantity'), qtyStepper(n),
        n.maxUses != null ? [h('span', { class: 'label' }, 'Uses'), usesStepper(n)] : null)) : null);
}

function gearTree(nodes, depth) {
  return nodes.map(n => {
    if (!n.container) return itemRow(n, depth);
    const key = `gear:${n.id}`;
    const has = n.children.length > 0;
    const open = has && isOpen(key);
    const meta = has ? `${plural(n.count, 'item')} · ${gcs.formatWeight(gcs.parseWeight(n.extendedWeight))}` : `Empty · ${gcs.formatWeight(gcs.parseWeight(n.extendedWeight))}`;
    return [
      h('button', { type: 'button', class: `row sub-h depth-${Math.min(depth, 3)}`, 'aria-expanded': has ? String(open) : null, disabled: !has, onclick: () => toggle(key) },
        has ? chevron(open) : h('span', { class: 'chev-space' }),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, n.quantity !== 1 ? `${n.title} ×${n.quantity}` : n.title), n.notes ? h('span', { class: 'row-sub' }, n.notes) : null),
        h('span', { class: 'row-meta' }, meta)),
      open ? gearTree(n.children, depth + 1) : null,
    ];
  });
}

function gearScreen() {
  const c = S.char;
  const e = c.encumbrance;
  const value = c.equipment.reduce((n, i) => n + (i.value || 0), 0);
  const saved = S.savedAt ? `Saved on this phone · ${S.savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Changes save on this phone as you tap';
  return [
    h('div', { class: 'card pad' },
      h('div', { class: 'spread' }, h('strong', null, `${e.carriedText} carried`), h('span', { class: 'accent small' }, e.overloaded ? 'Overloaded' : `${e.name} load`)),
      h('p', { class: 'muted small' }, `Carried value ${value.toLocaleString()} · Basic Lift ${c.derived.basicLift}`),
      h('p', { class: `small saved${S.savedAt ? ' on' : ''}` }, icon('check', 14), saved)),
    c.equipment.length ? box('Carried', `${plural(c.equipment.length, 'item')} · ${e.carriedText}`, h('div', { class: 'card list' }, gearTree(c.equipment, 0))) : null,
    c.otherEquipment.length ? box('Other Equipment', plural(c.otherEquipment.length, 'item'), h('div', { class: 'card list' }, gearTree(c.otherEquipment, 0))) : null,
    !c.equipment.length && !c.otherEquipment.length ? h('div', { class: 'card empty' }, h('p', null, 'No equipment on this sheet.')) : null,
  ];
}

// ---------- More (traits, notes, bio) ----------

function traitLeaf(n, depth) {
  return h('div', { class: `row depth-${Math.min(depth, 3)}${n.disabled ? ' off' : ''}` },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, n.title),
      n.detail ? h('span', { class: 'row-sub' }, n.detail) : null,
      n.notes ? h('span', { class: 'row-sub' }, n.notes) : null),
    h('span', { class: `pts-chip ${n.points < 0 ? 'neg' : n.points > 0 ? 'pos' : ''}` }, signed(n.points)));
}

// ---------- Notes (editable) ----------

function startNoteEdit(key, text) {
  S.editNote = key;
  S.noteDraft = text;
  render();
  const area = document.querySelector('.note-editor textarea');
  if (area) { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }
}

function saveNote() {
  const text = S.noteDraft.trim();
  if (!text) { toast('Write something first, or delete the note.'); return; }
  const key = S.editNote;
  S.editNote = null;
  if (key.startsWith('new:')) track(d => gcs.addNote(d, key.slice(4) || null, text));
  else track(d => gcs.setNoteText(d, key, text));
}

function deleteNote(id) {
  if (!confirm('Delete this note?')) return;
  S.editNote = null;
  track(d => gcs.deleteNote(d, id));
}

function noteEditor(existingId) {
  return h('div', { class: 'note-editor' },
    h('textarea', { rows: '6', 'aria-label': 'Note text', placeholder: 'Write a note…', oninput: e => { S.noteDraft = e.target.value; } }, S.noteDraft),
    h('div', { class: 'note-actions' },
      existingId ? h('button', { type: 'button', class: 'btn ghost danger-text', onclick: () => deleteNote(existingId) }, icon('trash', 18), 'Delete') : h('span'),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { S.editNote = null; render(); } }, 'Cancel'),
      h('button', { type: 'button', class: 'btn primary', onclick: saveNote }, 'Save')));
}

function noteLeaf(n, depth) {
  const pad = `depth-${Math.min(depth, 3)}`;
  if (S.editNote === n.id) return h('div', { class: `note ${pad}` }, noteEditor(n.id));
  return h('div', { class: `note ${pad}` },
    h('p', { class: 'note-text' }, n.text),
    h('button', { type: 'button', class: 'icon-btn note-edit', 'aria-label': 'Edit note', onclick: () => startNoteEdit(n.id, n.text) }, icon('edit', 18)));
}

function notesScreen() {
  const sections = S.char.notes;
  const addingTop = S.editNote === 'new:';
  return [
    addingTop
      ? h('div', { class: 'card pad' }, h('span', { class: 'label' }, 'New note'), noteEditor(null))
      : h('button', { type: 'button', class: 'btn primary wide', onclick: () => startNoteEdit('new:', '') }, icon('plus', 20), 'Add note'),
    sections.length ? null : h('div', { class: 'card empty' }, h('p', null, 'No notes yet.'), h('p', { class: 'muted small' }, 'Notes you add here are saved into the character file, so they also show up in GCS.')),
    sections.map(s => {
      const adding = S.editNote === `new:${s.id}`;
      return section(`note:${s.id}`, s.synthetic ? 'Notes' : s.title, plural(s.count, 'note'),
        () => h('div', { class: 'card list' },
          treeRows(s.children, 'note', noteLeaf),
          s.synthetic ? null : adding
            ? h('div', { class: 'note' }, noteEditor(null))
            : h('button', { type: 'button', class: 'row add-row', onclick: () => startNoteEdit(`new:${s.id}`, '') }, icon('plus', 18), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `Add to ${s.title}`)))),
        { forceOpen: adding || sectionHasEdit(s) });
    }),
    h('p', { class: `small saved center${S.savedAt ? ' on' : ''}` }, S.savedAt ? `Saved on this phone · ${S.savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Notes save into the character file on this phone'),
  ];
}

function sectionHasEdit(node) {
  return (node.children || []).some(c => c.id === S.editNote || sectionHasEdit(c));
}

function moreScreen() {
  const c = S.char;
  const p = c.profile;
  const facts = [['Age', p.age], ['Birthday', p.birthday], ['Gender', p.gender], ['Height', p.height], ['Weight', p.weight], ['Hand', p.handedness], ['Eyes', p.eyes], ['Hair', p.hair], ['Skin', p.skin], ['TL', p.techLevel]].filter(([, v]) => v);
  const sum = list => list.reduce((n, s) => n + (s.points || 0), 0);
  const attrPts = [...c.attributes.primary, ...c.attributes.secondary, ...c.attributes.pools].reduce((n, a) => n + a.points, 0);
  const breakdown = [['Attrib.', attrPts], ['Traits', sum(c.traits)], ['Skills', sum(c.skills)], ['Spells', sum(c.spells)], ['Unspent', c.points.unspent]];
  return [
    box('Profile', '',
      facts.length ? h('div', { class: 'card pad facts three' }, facts.map(([k, v]) => h('div', { class: 'fact' }, h('span', { class: 'label' }, k), h('span', null, v)))) : null,
      p.organization || p.player ? h('div', { class: 'card pad spread' },
        p.organization ? h('div', { class: 'fact' }, h('span', { class: 'label' }, 'Organization'), h('span', null, p.organization)) : h('span'),
        p.player ? h('div', { class: 'fact', style: { alignItems: 'flex-end', textAlign: 'right' } }, h('span', { class: 'label' }, 'Player'), h('span', null, p.player)) : null) : null),
    box('Point Summary', `${c.points.total} total`,
      h('div', { class: 'tiles cols-5' }, breakdown.map(([k, v]) =>
        h('div', { class: `tile${k === 'Unspent' && v ? ' hi' : ''}` }, h('span', { class: 'tile-v' }, String(v)), h('span', { class: 'tile-n' }, k))))),
    c.traits.map(s => section(`trait:${s.id}`, s.title, `${plural(s.count, 'trait')} · ${plural(s.points, 'pt')}`,
      () => h('div', { class: 'card list' }, treeRows(s.children, 'trait', traitLeaf)))),
    c.points.record.length ? section('log', 'Point Log', plural(c.points.record.length, 'entry', 'entries'),
      () => h('div', { class: 'card list' }, c.points.record.map(r =>
        h('div', { class: 'row top' },
          h('span', { class: `mod-n ${r.points < 0 ? 'neg' : 'pos'}` }, signed(r.points)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.reason || '—'),
            h('span', { class: 'row-sub' }, r.when ? new Date(r.when).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '')))))) : null,
    plainSection('This Phone',
      h('div', { class: 'card list' },
        h('button', { type: 'button', class: 'row action', onclick: exportCharacter }, icon('share', 20), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Export .gcs file'), h('span', { class: 'row-sub' }, 'Includes tracked HP, FP, uses and quantities'))),
        h('button', { type: 'button', class: 'row action', onclick: () => fileInput.click() }, icon('upload', 20), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Load another character'))),
        h('button', { type: 'button', class: 'row action danger', onclick: removeFromPhone }, icon('trash', 20), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Remove from this phone'))))),
  ];
}

// ---------- start ----------

render(true);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
