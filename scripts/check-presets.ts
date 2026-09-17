import { PRESETS, parseGearRef } from '../src/sim/presets';
import equipmentData from '../public/data/equipment.json';
const eq = equipmentData as { name: string; version: string | null; slot: string }[];
let bad = 0;
for (const p of PRESETS) {
  for (const [slot, ref] of Object.entries(p.gear)) {
    if (!ref) continue;
    const { name, version } = parseGearRef(ref);
    const hit = eq.find((e) => e.name === name && (version === null || e.version === version));
    if (!hit) { console.log(`MISS ${p.id} ${slot}: ${ref}`); bad++; }
    else if (hit.slot !== slot && !(slot === 'ammo' && /dart$/i.test(name))) { console.log(`SLOT ${p.id} ${slot}: ${ref} is actually ${hit.slot}`); bad++; }
  }
}
console.log(bad === 0 ? 'all preset items resolve' : `${bad} problems`);
