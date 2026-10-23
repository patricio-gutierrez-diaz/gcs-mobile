// gcs.js — turns a GURPS Character Sheet (GCS) v5 character file into a view model
// the app can render, without hardcoding any container names.
//
// How GCS structures lists (traits, skills, spells, equipment, other_equipment, notes):
// - Every row has an `id`. An UPPER-case first letter marks a container
//   (T trait, S skill, P spell, E equipment, N note); lower-case is a single entry
//   (t, s, q = technique, r = spell, e, n). Empty containers have no `children` key,
//   so the id prefix is the reliable test.
// - Containers can nest to any depth, and loose entries can sit at the top level.
// - Equipment containers are real items too (a backpack has weight and quantity).
// - Weapons: id prefix `w` = melee, `W` = ranged.
// - Names may hold @Placeholders@ filled from the row's own `replacements`.
//
// The original JSON object is kept (`character.raw`) and every node keeps a pointer
// to its raw row, so tracking edits change only the raw fields and the file can be
// written back without losing anything GCS stored.

/** True when a list row is a container (works for empty containers too). */
export function isContainer(row) {
  const first = typeof row?.id === 'string' ? row.id.charAt(0) : '';
  if (first && first !== first.toLowerCase()) return true;
  return Array.isArray(row?.children);
}

/** Fill @Key@ placeholders from a row's `replacements`. Unknown keys are left as-is. */
export function resolveText(text, replacements) {
  if (text == null) return '';
  const str = String(text);
  if (!replacements) return str;
  return str.replace(/@([^@]+)@/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(replacements, key) ? String(replacements[key]) : match);
}

/** Parse a GCS weight string ("16.8 lb", ".02", "3 oz", "1.5 kg") into pounds. */
export function parseWeight(value) {
  if (value == null) return 0;
  const m = String(value).trim().match(/^(-?[\d.]+)\s*([a-z]*)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  switch (m[2].toLowerCase()) {
    case 'oz': return n / 16;
    case 'kg': return n * 2;      // GURPS convention: 1 kg ≈ 2 lb
    case 'g': return n * 0.002;
    case 'tn': case 't': return n * 2000;
    default: return n;            // lb, or no unit (GCS default unit is lb)
  }
}

/** Format pounds for display: 42.654 → "42.7 lb", 0.104 → "0.1 lb". */
export function formatWeight(lb) {
  const r = Math.round(lb * 10) / 10;
  return `${r === Math.trunc(r) ? r.toFixed(0) : r.toFixed(1)} lb`;
}

/**
 * Evaluate a GCS attribute formula such as "Math.ceil($hp / 3) - 1".
 * The file is untrusted input, so only numbers, + - * / ( ) and a few Math
 * functions are allowed; anything else returns NaN instead of running.
 */
export function evalFormula(expr, vars) {
  let s = String(expr ?? '').replace(/\$([a-z_][a-z0-9_]*)/gi, (_, id) =>
    Object.prototype.hasOwnProperty.call(vars, id) ? `(${Number(vars[id])})` : 'NaN');
  const words = s.match(/[A-Za-z_][A-Za-z0-9_.]*/g) || [];
  if (words.some(w => w !== 'NaN' && !/^Math\.(round|ceil|floor|min|max|abs|trunc)$/.test(w))) return NaN;
  if (!/^[\d\s+\-*/().,A-Za-z_]*$/.test(s)) return NaN;
  try {
    const v = Function(`"use strict"; return (${s});`)();
    return typeof v === 'number' ? v : NaN;
  } catch {
    return NaN;
  }
}

const KIND = { traits: 'trait', skills: 'skill', spells: 'spell', equipment: 'equipment', other_equipment: 'equipment', notes: 'note' };
const LOOSE_TITLE = { trait: 'Traits', skill: 'Skills', spell: 'Spells', note: 'Notes' };

function activeModifiers(row) {
  return (row.modifiers || []).filter(m => !m.disabled && !isContainer(m));
}

function modifierLabel(mod, replacements) {
  const notes = mod.calc?.resolved_notes ?? resolveText(mod.local_notes, replacements);
  const name = resolveText(mod.name, replacements);
  return notes ? `${name}: ${notes}` : name;
}

function describe(row, kind, container) {
  const rep = row.replacements;
  switch (kind) {
    case 'trait': {
      const out = {
        title: resolveText(row.name, rep),
        points: row.calc?.points ?? 0,
        notes: resolveText(row.local_notes, rep),
        reference: row.reference || '',
        disabled: !!row.disabled,
      };
      if (container) {
        out.ancestry = row.container_type === 'ancestry';
        return out;
      }
      const parts = [];
      if (row.can_level) parts.push(`Level ${row.calc?.current_level ?? row.levels ?? 0}`);
      for (const m of activeModifiers(row)) parts.push(modifierLabel(m, rep));
      out.detail = parts.join(' · ');
      return out;
    }
    case 'skill': {
      if (container) return { title: resolveText(row.name, rep) };
      const spec = resolveText(row.specialization, rep);
      const tl = row.tech_level ? `/TL${row.tech_level}` : '';
      return {
        title: `${resolveText(row.name, rep)}${tl}${spec ? ` (${spec})` : ''}`,
        technique: row.id?.charAt(0) === 'q',
        difficulty: (row.difficulty || '').toUpperCase(),
        points: row.points ?? 0,
        level: row.calc?.level ?? null,
        relative: row.calc?.rsl ?? '',
        notes: resolveText(row.local_notes, rep),
        reference: row.reference || '',
      };
    }
    case 'spell': {
      if (container) return { title: resolveText(row.name, rep) };
      return {
        title: resolveText(row.name, rep),
        college: (row.college || []).join(', '),
        spellClass: row.spell_class || '',
        cost: row.casting_cost || '',
        maintain: row.maintenance_cost || '',
        time: row.casting_time || '',
        duration: row.duration || '',
        resist: row.resist || '',
        points: row.points ?? 0,
        level: row.calc?.level ?? null,
        relative: row.calc?.rsl ?? '',
        notes: resolveText(row.local_notes, rep),
        reference: row.reference || '',
      };
    }
    case 'equipment':
      return {
        title: resolveText(row.description, rep),
        quantity: row.quantity ?? 0,
        uses: row.uses ?? null,
        maxUses: row.max_uses ?? null,
        equipped: !!row.equipped,
        weight: row.calc?.weight ?? '0 lb',
        extendedWeight: row.calc?.extended_weight ?? '0 lb',
        value: row.calc?.extended_value ?? 0,
        notes: resolveText(row.local_notes, rep),
        modifiers: activeModifiers(row).map(m => modifierLabel(m, rep)),
        reference: row.reference || '',
      };
    case 'note': {
      const text = row.markdown || '';
      return { title: container ? text.split('\n')[0] : '', text };
    }
    default:
      return { title: row.name || row.description || '' };
  }
}

function buildNode(row, kind, ancestors = []) {
  const container = isContainer(row);
  const node = { id: row.id, kind, container, raw: row, ...describe(row, kind, container) };
  if (container) {
    node.children = (row.children || []).map(c => buildNode(c, kind, [...ancestors, row]));
    node.count = countEntries(node.children);
    if (kind === 'skill' || kind === 'spell') node.points = sumPoints(node.children);
  }
  return node;
}

function countEntries(nodes) {
  return nodes.reduce((n, c) => n + (c.container && c.kind !== 'equipment' ? countEntries(c.children) : 1), 0);
}

function sumPoints(nodes) {
  return nodes.reduce((n, c) => n + (c.container ? sumPoints(c.children) : (c.points || 0)), 0);
}

/**
 * Turn a top-level list into collapsible sections: each top-level container is a
 * section; runs of loose top-level entries are gathered into a plain section.
 */
function toSections(list, kind) {
  const sections = [];
  let loose = [];
  const flush = () => {
    if (!loose.length) return;
    const children = loose;
    sections.push({
      id: `loose-${kind}-${sections.length}`, kind, container: true, synthetic: true,
      title: LOOSE_TITLE[kind], children, count: countEntries(children),
      points: kind === 'trait' ? children.reduce((n, c) => n + (c.points || 0), 0) : sumPoints(children),
    });
    loose = [];
  };
  for (const row of list || []) {
    const node = buildNode(row, kind);
    if (node.container) { flush(); sections.push(node); } else loose.push(node);
  }
  flush();
  return sections;
}

function walkRows(list, visit, ancestors = []) {
  for (const row of list || []) {
    visit(row, ancestors);
    if (row.children) walkRows(row.children, visit, [...ancestors, row]);
  }
}

function collectWeapons(data) {
  const melee = [];
  const ranged = [];
  const add = (owner, ownerName) => {
    for (const w of owner.weapons || []) {
      const entry = {
        id: w.id,
        name: ownerName,
        usage: resolveText(w.usage, owner.replacements),
        level: w.calc?.level ?? null,
        damage: w.calc?.damage ?? '',
        strength: w.strength || '',
        reach: w.calc?.reach ?? w.reach ?? '',
        parry: w.calc?.parry ?? w.parry ?? '',
        block: w.calc?.block ?? w.block ?? '',
        accuracy: w.calc?.accuracy ?? w.accuracy ?? '',
        range: w.calc?.range ?? w.range ?? '',
        rateOfFire: w.calc?.rate_of_fire ?? w.rate_of_fire ?? '',
        shots: w.calc?.shots ?? w.shots ?? '',
        bulk: w.calc?.bulk ?? w.bulk ?? '',
        recoil: w.calc?.recoil ?? w.recoil ?? '',
      };
      (w.id?.charAt(0) === 'W' ? ranged : melee).push(entry);
    }
  };
  walkRows(data.traits, (row, anc) => {
    if (!row.disabled && !anc.some(a => a.disabled)) add(row, resolveText(row.name, row.replacements));
  });
  walkRows(data.skills, row => add(row, resolveText(row.name, row.replacements)));
  walkRows(data.spells, row => add(row, resolveText(row.name, row.replacements)));
  walkRows(data.equipment, (row, anc) => {
    if (row.equipped && anc.every(a => a.equipped)) add(row, resolveText(row.description, row.replacements));
  });
  return { melee, ranged };
}

function collectModifiers(data) {
  const reactions = [];
  const conditional = [];
  const take = (features, source, levels, rep) => {
    for (const f of features || []) {
      if (f.type !== 'reaction_bonus' && f.type !== 'conditional_modifier') continue;
      const amount = (f.amount || 0) * (f.per_level ? (levels || 1) : 1);
      const entry = { amount, situation: resolveText(f.situation, rep), source };
      (f.type === 'reaction_bonus' ? reactions : conditional).push(entry);
    }
  };
  walkRows(data.traits, (row, anc) => {
    if (row.disabled || anc.some(a => a.disabled) || isContainer(row)) return;
    const name = resolveText(row.name, row.replacements);
    const levels = row.calc?.current_level ?? row.levels;
    take(row.features, name, levels, row.replacements);
    for (const m of activeModifiers(row)) take(m.features, `${name} (${resolveText(m.name, row.replacements)})`, levels, row.replacements);
  });
  walkRows(data.equipment, (row, anc) => {
    if (!row.equipped || !anc.every(a => a.equipped)) return;
    const name = resolveText(row.description, row.replacements);
    take(row.features, name, 1, row.replacements);
    for (const m of activeModifiers(row)) take(m.features, name, 1, row.replacements);
  });
  return { reactions, conditional };
}

const ENCUMBRANCE = [
  { name: 'None', multiple: 1 },
  { name: 'Light', multiple: 2 },
  { name: 'Medium', multiple: 3 },
  { name: 'Heavy', multiple: 6 },
  { name: 'X-Heavy', multiple: 10 },
];

function encumbrance(data) {
  const carried = (data.equipment || []).reduce((n, row) => n + parseWeight(row.calc?.extended_weight), 0);
  const basicLift = parseWeight(data.calc?.basic_lift);
  let level = ENCUMBRANCE.findIndex(e => carried <= basicLift * e.multiple);
  const overloaded = level === -1;
  if (overloaded) level = ENCUMBRANCE.length - 1;
  return {
    carried, carriedText: formatWeight(carried), basicLift, overloaded, level,
    name: overloaded ? 'Overloaded' : ENCUMBRANCE[level].name,
    levels: ENCUMBRANCE.map(e => ({ name: e.name, max: basicLift * e.multiple })),
    move: data.calc?.move?.[level] ?? null,
    dodge: data.calc?.dodge?.[level] ?? null,
  };
}

function attributes(data) {
  const defs = data.settings?.attributes || [];
  const values = Object.fromEntries((data.attributes || []).map(a => [a.attr_id, a]));
  const vars = Object.fromEntries((data.attributes || []).map(a => [a.attr_id, a.calc?.value ?? 0]));
  const primary = [];
  const secondary = [];
  const pools = [];
  for (const def of defs) {
    if (!['integer', 'decimal', 'integer_ref', 'decimal_ref', 'pool'].includes(def.type)) continue; // skip separators
    const a = values[def.id] || {};
    const value = a.calc?.value ?? 0;
    const base = { id: def.id, name: def.name, fullName: def.full_name || def.name, value, points: a.calc?.points ?? 0 };
    if (def.type === 'pool') {
      const current = a.calc?.current ?? value - (a.damage || 0);
      const thresholds = (def.thresholds || []).map(t => ({
        state: t.state, max: evalFormula(t.value, vars), explanation: t.explanation || '',
      }));
      const status = thresholds.find(t => current <= t.max) || null;
      pools.push({ ...base, max: value, current, status: status?.state ?? '', statusExplanation: status?.explanation ?? '', thresholds });
    } else if (/\$/.test(String(def.base))) {
      secondary.push(base);
    } else {
      primary.push(base);
    }
  }
  return { primary, secondary, pools };
}

function hitLocations(data) {
  return (data.settings?.body_type?.locations || []).map(loc => {
    const dr = loc.calc?.dr || {};
    const all = dr.all ?? 0;
    const others = Object.entries(dr).filter(([k]) => k !== 'all').map(([k, v]) => ({ type: k, value: all + v }));
    return {
      id: loc.id, name: loc.table_name || loc.choice_name, roll: loc.calc?.roll_range ?? '',
      penalty: loc.hit_penalty ?? 0, dr: all, drOther: others, description: loc.description || '',
    };
  });
}

function portraitUrl(b64) {
  if (!b64) return '';
  const type = b64.startsWith('iVBOR') ? 'png' : b64.startsWith('/9j/') ? 'jpeg' : b64.startsWith('R0lG') ? 'gif' : 'webp';
  return `data:image/${type};base64,${b64}`;
}

/** Read a parsed .gcs JSON object into the app's view model. */
export function parseCharacter(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.attributes)) {
    throw new Error('This does not look like a GCS character file.');
  }
  const attrs = attributes(data);
  const traits = toSections(data.traits, 'trait');
  const skills = toSections(data.skills, 'skill');
  const spells = toSections(data.spells, 'spell');
  const notes = toSections(data.notes, 'note');

  const spent =
    attrs.primary.concat(attrs.secondary, attrs.pools).reduce((n, a) => n + a.points, 0) +
    traits.reduce((n, s) => n + (s.points || 0), 0) +
    sumPoints(skills) + sumPoints(spells);

  const p = data.profile || {};
  return {
    raw: data,
    version: data.version,
    profile: {
      name: p.name || 'Unnamed', title: p.title || '', organization: p.organization || '',
      player: p.player_name || '', age: p.age || '', birthday: p.birthday || '', gender: p.gender || '',
      height: p.height || '', weight: p.weight || '', eyes: p.eyes || '', hair: p.hair || '', skin: p.skin || '',
      handedness: p.handedness || '', techLevel: p.tech_level || '', portrait: portraitUrl(p.portrait),
    },
    ancestry: (data.traits || []).find(t => t.container_type === 'ancestry')?.ancestry || '',
    points: { total: data.total_points ?? 0, spent, unspent: (data.total_points ?? 0) - spent, record: data.points_record || [] },
    attributes: attrs,
    derived: {
      swing: data.calc?.swing ?? '', thrust: data.calc?.thrust ?? '', basicLift: data.calc?.basic_lift ?? '',
    },
    encumbrance: encumbrance(data),
    traits, skills, spells, notes,
    equipment: (data.equipment || []).map(r => buildNode(r, 'equipment')),
    otherEquipment: (data.other_equipment || []).map(r => buildNode(r, 'equipment')),
    weapons: collectWeapons(data),
    modifiers: collectModifiers(data),
    hitLocations: hitLocations(data),
  };
}

// ---- Narrow write-back: only the fields players track during a session ----

/** Set a pool's current value (HP, FP…). GCS stores this as `damage` = max − current. */
export function setPoolCurrent(data, attrId, current) {
  const a = (data.attributes || []).find(x => x.attr_id === attrId);
  if (!a) throw new Error(`No attribute "${attrId}" in this file.`);
  const max = a.calc?.value ?? 0;
  const value = Math.min(max, Math.round(current));
  a.damage = max - value;
  if (a.damage === 0) delete a.damage;
  if (a.calc) a.calc.current = value;
  touch(data);
}

/** Find an equipment row by id, with its parent containers (outermost first). */
export function findEquipment(data, id) {
  for (const key of ['equipment', 'other_equipment']) {
    const found = findIn(data[key], id, []);
    if (found) return found;
  }
  return null;
}

function findIn(list, id, parents) {
  for (const row of list || []) {
    if (row.id === id) return { row, parents };
    const inner = findIn(row.children, id, [...parents, row]);
    if (inner) return inner;
  }
  return null;
}

function addToCalc(row, weightDelta, valueDelta) {
  if (!row.calc) return;
  const w = parseWeight(row.calc.extended_weight) + weightDelta;
  row.calc.extended_weight = `${Math.max(0, Math.round(w * 10000) / 10000)} lb`;
  if (typeof row.calc.extended_value === 'number') {
    row.calc.extended_value = Math.max(0, Math.round((row.calc.extended_value + valueDelta) * 100) / 100);
  }
}

/**
 * Set an equipment row's quantity (ammo, potions, coins, rations).
 * Also adjusts the cached extended weight/value of the row and its containers,
 * so encumbrance on the phone stays right; GCS recalculates these on open anyway.
 */
export function setQuantity(data, id, quantity) {
  const found = findEquipment(data, id);
  if (!found) throw new Error('That item is no longer in this file.');
  const { row, parents } = found;
  const next = Math.max(0, Math.round(quantity));
  const diff = next - (row.quantity ?? 0);
  if (!diff) return;
  const each = parseWeight(row.calc?.weight);
  const value = typeof row.calc?.value === 'number' ? row.calc.value : 0;
  row.quantity = next;
  for (const r of [row, ...parents]) addToCalc(r, each * diff, value * diff);
  touch(data);
}

/** Set an equipment row's remaining uses (charges), capped at max_uses. */
export function setUses(data, id, uses) {
  const found = findEquipment(data, id);
  if (!found) throw new Error('That item is no longer in this file.');
  const max = found.row.max_uses ?? Infinity;
  found.row.uses = Math.max(0, Math.min(max, Math.round(uses)));
  touch(data);
}

function touch(data) {
  data.modified_date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Serialize back to the same tab-indented JSON GCS writes. */
export function serializeCharacter(data) {
  return JSON.stringify(data, null, '\t') + '\n';
}
