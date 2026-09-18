import { describe, it, expect } from 'vitest';
import { encodeSetup, decodeSetup, type ShareableSetup } from './sharecode';
import type { Equip, GearSet } from '../sim/gear';
import equipmentData from '../../public/data/equipment.json';
import { SPECS } from '../sim/specs';

const SPEC_IDS = SPECS.map((s) => s.id);

const equipment = equipmentData as unknown as Equip[];
const item = (name: string): Equip => {
  const e = equipment.find((x) => x.name === name);
  if (!e) throw new Error(`missing ${name}`);
  return e;
};

const sample = (): ShareableSetup => {
  const gear: GearSet = {
    head: item('Torva full helm'),
    neck: item('Amulet of rancour'),
    weapon: item("Osmumten's fang"),
    body: item('Oathplate chest'),
    ring: item('Ultor ring'),
  };
  return {
    monsterQuery: 'Vorkath (Post-quest)',
    gear,
    levels: { attack: 99, strength: 98, ranged: 97, magic: 96 },
    prayerKey: 'piety',
    styleIndex: 2,
    potionId: 'super_combat',
    spellName: '',
    buffs: { offTask: true },
    switches: { zcb: { neck: { name: 'Necklace of rupture', version: null } } },
    enabledSpecs: ['voidwaker', 'dwh'],
    specOptions: {},
    startEnergy: 75,
    kills: 12,
    downtimeSeconds: 5,
    bankingSeconds: 60,
    compareLightbearer: false,
  };
};

describe('share codes', () => {
  it('round-trips a full setup', () => {
    const original = sample();
    const decoded = decodeSetup(encodeSetup(original, equipment), equipment);
    expect(decoded).not.toBeNull();

    expect(decoded!.monsterQuery).toBe(original.monsterQuery);
    expect(decoded!.levels).toEqual(original.levels);
    expect(decoded!.prayerKey).toBe('piety');
    expect(decoded!.styleIndex).toBe(2);
    expect(decoded!.buffs.offTask).toBe(true);
    expect([...decoded!.enabledSpecs].sort()).toEqual(['dwh', 'voidwaker']);
    // No spec declares a toggle right now, so this round-trips empty. The
    // encoding still carries them, so a future toggle needs no format change.
    expect(decoded!.specOptions).toEqual({});
    expect(decoded!.startEnergy).toBe(75);
    expect(decoded!.kills).toBe(12);
    expect(decoded!.downtimeSeconds).toBe(5);
    expect(decoded!.bankingSeconds).toBe(60);
    expect(decoded!.compareLightbearer).toBe(false);
  });

  it('restores gear and spec switches by item', () => {
    const decoded = decodeSetup(encodeSetup(sample(), equipment), equipment)!;
    const g = decoded.gear || decoded.tabs?.melee?.gear || {};
    expect(g.weapon?.name).toBe("Osmumten's fang");
    expect(g.head?.name).toBe('Torva full helm');
    expect(g.body?.name).toBe('Oathplate chest');
    expect(g.cape).toBeUndefined();
    expect(decoded.switches.zcb?.neck?.name).toBe('Necklace of rupture');
  });

  it('stays short enough to paste', () => {
    // The realistic case: a full loadout with every spec left enabled.
    const code = encodeSetup({ ...sample(), enabledSpecs: SPEC_IDS, switches: {} }, equipment);
    expect(code.length).toBeLessThan(250);
    // base64url only - safe to paste anywhere.
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns null for junk instead of throwing', () => {
    expect(decodeSetup('', equipment)).toBeNull();
    expect(decodeSetup('not-a-code!!', equipment)).toBeNull();
    expect(decodeSetup(btoa('999|nope'), equipment)).toBeNull();
  });
});

describe('share code size', () => {
  it('costs nothing to leave every spec enabled', () => {
    const all = { ...sample(), enabledSpecs: [] as string[] };
    // An empty enabledSpecs means "all disabled", which is the worst case.
    const allDisabled = encodeSetup(all, equipment);
    const allEnabled = encodeSetup(
      { ...sample(), enabledSpecs: SPEC_IDS },
      equipment,
    );
    expect(allEnabled.length).toBeLessThan(allDisabled.length);
  });
});
