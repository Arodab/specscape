import { describe, it, expect } from 'vitest';
import { SPECS } from './specs';
import { PRESETS, parseGearRef } from './presets';
import { MODIFIER_ITEM_NAMES } from './modifiers';
import equipmentData from '../../public/data/equipment.json';

/**
 * The data build drops gear with no offensive stats. Several items the engine
 * keys on by name - the void sets, salve amulets, black masks, crystal armour,
 * Lightbearer - have no offensive stats at all, so this guards against the
 * filter quietly deleting something the simulation depends on.
 */

interface Equip { name: string; slot: string; version: string | null }
const equipment = equipmentData as unknown as Equip[];

const has = (name: string) => equipment.some((e) => e.name === name);

describe('shipped equipment data', () => {
  it('keeps every item the modifier logic looks for', () => {
    const missing = MODIFIER_ITEM_NAMES.filter((n) => !has(n));
    expect(missing, `missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps every spec weapon', () => {
    const missing = SPECS
      .map((s) => s.item)
      .filter((n) => !equipment.some((e) => e.name === n && e.slot === 'weapon'));
    expect(missing, `missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps every item referenced by a preset', () => {
    const missing: string[] = [];
    for (const preset of PRESETS) {
      for (const [slot, ref] of Object.entries(preset.gear)) {
        if (!ref) continue;
        const { name, version } = parseGearRef(ref);
        const hit = equipment.some(
          (e) => e.name === name && (version === null || e.version === version),
        );
        if (!hit) missing.push(`${preset.id}/${slot}: ${ref}`);
      }
    }
    expect(missing, `missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('has actually stripped the stat-less cosmetics', () => {
    expect(has('20th anniversary cape')).toBe(false);
    expect(equipment.length).toBeLessThan(3000);
  });
});
