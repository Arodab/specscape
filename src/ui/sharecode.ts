import type { Equip, GearSet, Slot } from '../sim/gear';
import { SLOTS } from '../sim/gear';
import type { Buffs } from '../sim/modifiers';
import type { CombatLevels } from '../sim/loadout';
import { SPECS } from '../sim/specs';
import type { SpecSwitches } from './setups';

/**
 * A setup encoded as one short copy-paste string.
 *
 * The payload is a pipe-delimited record rather than JSON - JSON's keys and
 * quoting roughly tripled the length - and it stores only what differs from the
 * defaults. Specs are recorded by which ones are *disabled*, so the usual
 * "everything on" case costs nothing and the code survives the spec roster
 * changing.
 */

const VERSION = '1';
const SEP = '|';

export interface ShareableSetup {
  monsterQuery: string;
  gear: GearSet;
  levels: CombatLevels;
  prayerKey: string;
  styleIndex: number;
  potionId: string;
  spellName: string;
  buffs: Buffs;
  switches: SpecSwitches;
  enabledSpecs: string[];
  specOptions: Record<string, boolean>;
  startEnergy: number;
  kills: number;
  downtimeSeconds: number;
  bankingSeconds: number;
  compareLightbearer: boolean;
}

export type DecodedSetup = ShareableSetup;

const toBase64Url = (text: string): string =>
  btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (code: string): string => {
  const clean = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(clean)));
};

export const encodeSetup = (setup: ShareableSetup, equipment: Equip[]): string => {
  const idOf = (name: string, version: string | null): number | '' =>
    equipment.find((e) => e.name === name && e.version === version)?.id
    ?? equipment.find((e) => e.name === name)?.id
    ?? '';

  // Item ids in base36 - roughly a third shorter than decimal.
  const gear = SLOTS.map((slot) => setup.gear[slot]?.id.toString(36) ?? '').join(',');

  const levels = [
    setup.levels.attack, setup.levels.strength, setup.levels.ranged, setup.levels.magic,
  ].join(',');

  // Recording the disabled specs keeps the common "all on" case empty.
  const enabled = new Set(setup.enabledSpecs);
  const disabled = SPECS.filter((s) => !enabled.has(s.id)).map((s) => s.id).join(',');

  // Only spec options that differ from their default are worth carrying.
  const optionOverrides = SPECS
    .filter((s) => s.option && setup.specOptions[s.option.key] !== undefined
      && setup.specOptions[s.option.key] !== s.option.default)
    .map((s) => `${s.option!.key}:${setup.specOptions[s.option!.key] ? 1 : 0}`)
    .join(',');

  const switches = Object.entries(setup.switches)
    .flatMap(([specId, ov]) => SLOTS
      .filter((slot) => slot in ov)
      .map((slot) => {
        const ref = ov[slot];
        const id = ref ? idOf(ref.name, ref.version) : '';
        return `${specId}:${slot}:${id === '' ? '' : id.toString(36)}`;
      }))
    .join(',');

  const encounter = [
    setup.startEnergy, setup.kills, setup.downtimeSeconds, setup.bankingSeconds,
    setup.compareLightbearer ? 1 : 0,
  ].join(',');

  return toBase64Url([
    VERSION,
    setup.monsterQuery,
    gear,
    levels,
    setup.prayerKey,
    String(setup.styleIndex),
    setup.potionId,
    setup.spellName,
    setup.buffs.offTask ? '1' : '0',
    disabled,
    optionOverrides,
    switches,
    encounter,
  ].join(SEP));
};

/** Returns null for anything that is not a valid code, rather than throwing. */
export const decodeSetup = (code: string, equipment: Equip[]): DecodedSetup | null => {
  try {
    const parts = fromBase64Url(code).split(SEP);
    if (parts[0] !== VERSION || parts.length < 13) return null;

    const [
      , monsterQuery, gearRaw, levelsRaw, prayerKey, styleRaw,
      potionId, spellName, offTaskRaw, disabledRaw, optionsRaw, switchesRaw, encounterRaw,
    ] = parts;

    const byId = new Map(equipment.map((e) => [e.id, e]));
    const itemFor = (token: string): Equip | null => {
      if (!token) return null;
      const id = parseInt(token, 36);
      return Number.isNaN(id) ? null : byId.get(id) ?? null;
    };

    const gear: GearSet = {};
    gearRaw.split(',').forEach((token, i) => {
      const item = itemFor(token);
      if (item) gear[SLOTS[i]] = item;
    });

    const [attack, strength, ranged, magic] = levelsRaw.split(',').map(Number);
    const [startEnergy, kills, downtimeSeconds, bankingSeconds, lb] =
      encounterRaw.split(',').map(Number);

    const disabled = new Set(disabledRaw ? disabledRaw.split(',') : []);
    const enabledSpecs = SPECS.filter((s) => !disabled.has(s.id)).map((s) => s.id);

    const specOptions: Record<string, boolean> = {};
    for (const s of SPECS) {
      if (s.option) specOptions[s.option.key] = s.option.default;
    }
    if (optionsRaw) {
      for (const pair of optionsRaw.split(',')) {
        const [key, value] = pair.split(':');
        if (key) specOptions[key] = value === '1';
      }
    }

    const switches: SpecSwitches = {};
    if (switchesRaw) {
      for (const entry of switchesRaw.split(',')) {
        const [specId, slot, token] = entry.split(':');
        if (!specId || !slot) continue;
        const item = itemFor(token ?? '');
        switches[specId] = switches[specId] ?? {};
        switches[specId][slot as Slot] = item ? { name: item.name, version: item.version } : null;
      }
    }

    return {
      monsterQuery,
      gear,
      levels: {
        attack: attack || 99, strength: strength || 99,
        ranged: ranged || 99, magic: magic || 99,
      },
      prayerKey: prayerKey || 'none',
      styleIndex: Number(styleRaw) || 0,
      potionId: potionId || 'none',
      spellName: spellName || '',
      buffs: { offTask: offTaskRaw === '1' },
      switches,
      enabledSpecs,
      specOptions,
      startEnergy: Number.isFinite(startEnergy) ? startEnergy : 100,
      kills: kills || 1,
      downtimeSeconds: Number.isFinite(downtimeSeconds) ? downtimeSeconds : 0,
      bankingSeconds: Number.isFinite(bankingSeconds) ? bankingSeconds : 0,
      compareLightbearer: lb === 1,
    };
  } catch {
    return null;
  }
};
