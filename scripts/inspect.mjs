// Prints how the app would group a .gcs file: `node scripts/inspect.mjs Gega.gcs Edge.gcs`
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseCharacter, serializeCharacter, setPoolCurrent } from '../app/src/gcs.js';

const sign = n => (n > 0 ? `+${n}` : `${n}`);

function printTree(nodes, depth, line) {
  for (const n of nodes) {
    console.log('  '.repeat(depth) + line(n));
    if (n.container && n.children?.length) printTree(n.children, depth + 1, line);
  }
}

function sectionLine(s, unit) {
  const pts = s.points != null ? ` · ${s.points} pts` : '';
  return `▸ ${s.title}${s.synthetic ? ' (loose entries)' : ''} — ${s.count} ${unit}${pts}`;
}

for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  const c = parseCharacter(data);
  const p = c.profile;

  console.log(`\n================ ${basename(file)} ================`);
  console.log(`${p.name}${p.title ? ` — ${p.title}` : ''}${c.ancestry ? ` · ${c.ancestry}` : ''}  (player ${p.player || '?'})`);
  console.log(`Points: ${c.points.total} total, ${c.points.spent} spent, ${c.points.unspent} unspent`);
  console.log('Primary:', c.attributes.primary.map(a => `${a.name} ${a.value}`).join(', '));
  console.log('Secondary:', c.attributes.secondary.map(a => `${a.name} ${a.value}`).join(', '));
  for (const pool of c.attributes.pools) console.log(`${pool.name}: ${pool.current}/${pool.max} — ${pool.status}`);
  const e = c.encumbrance;
  console.log(`Load: ${e.carriedText} carried, Basic Lift ${c.derived.basicLift} → ${e.name} (Move ${e.move}, Dodge ${e.dodge}); Swing ${c.derived.swing}, Thrust ${c.derived.thrust}`);

  for (const [key, unit] of [['traits', 'traits'], ['skills', 'skills'], ['spells', 'spells'], ['notes', 'notes']]) {
    console.log(`\n[${key.toUpperCase()}]${c[key].length ? '' : ' — none, tab/section hidden'}`);
    for (const s of c[key]) {
      console.log('  ' + sectionLine(s, unit));
      printTree(s.children, 2, n => {
        if (n.container) return `▸ ${n.title} (${n.count})`;
        if (key === 'traits') return `${n.title}${n.detail ? ` [${n.detail}]` : ''} ${sign(n.points)}`;
        if (key === 'skills') return `${n.title}${n.technique ? ' (technique)' : ''} — ${n.level} (${n.relative}) ${n.points} pts`;
        if (key === 'spells') return `${n.title} — ${n.level} · ${n.spellClass} · cost ${n.cost}`;
        return n.text.split('\n')[0];
      });
    }
  }

  for (const [label, list] of [['EQUIPMENT', c.equipment], ['OTHER EQUIPMENT', c.otherEquipment]]) {
    console.log(`\n[${label}]`);
    printTree(list, 1, n => {
      const qty = n.quantity !== 1 ? ` ×${n.quantity}` : '';
      const uses = n.maxUses != null ? ` uses ${n.uses}/${n.maxUses}` : '';
      const box = n.container ? (n.children.length ? `▸ ` : '▹ ') : '';
      return `${box}${n.title}${qty}${uses} — ${n.extendedWeight}${n.equipped ? '' : ' (not equipped)'}`;
    });
  }

  console.log('\n[MELEE]');
  for (const w of c.weapons.melee) console.log(`  ${w.name} (${w.usage || '—'}) ${w.level ?? '—'} · ${w.damage} · reach ${w.reach || '—'} · parry ${w.parry || '—'}${w.block ? ` · block ${w.block}` : ''}`);
  console.log('[RANGED]');
  for (const w of c.weapons.ranged) console.log(`  ${w.name} (${w.usage || '—'}) ${w.level ?? '—'} · ${w.damage} · acc ${w.accuracy || '—'} · range ${w.range || '—'}`);
  console.log('[REACTIONS]');
  for (const r of c.modifiers.reactions) console.log(`  ${sign(r.amount)} ${r.situation} — ${r.source}`);
  console.log('[CONDITIONAL]');
  for (const r of c.modifiers.conditional) console.log(`  ${sign(r.amount)} ${r.situation} — ${r.source}`);

  // Round-trip check: reading must not change anything we would write back.
  const same = JSON.stringify(JSON.parse(serializeCharacter(data))) === JSON.stringify(JSON.parse(text));
  console.log(`\nRound trip unchanged: ${same ? 'yes' : 'NO'}`);

  // Tracking check: take 3 HP, re-read, confirm GCS fields.
  const copy = JSON.parse(text);
  const hp = parseCharacter(copy).attributes.pools.find(x => x.id === 'hp');
  setPoolCurrent(copy, 'hp', hp.current - 3);
  const after = parseCharacter(copy).attributes.pools.find(x => x.id === 'hp');
  const raw = copy.attributes.find(a => a.attr_id === 'hp');
  console.log(`HP write test: ${hp.current} → ${after.current}/${after.max} (${after.status}); file now has damage=${raw.damage}`);
}
