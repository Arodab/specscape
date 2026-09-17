import type { Equip, GearSet, Slot } from '../sim/gear';
import { SLOTS } from '../sim/gear';
import type { Buffs } from '../sim/modifiers';
import type { CombatLevels } from '../sim/loadout';

/**
 * Saved setups live in localStorage and export as a plain JSON file, so people
 * can keep and share loadouts without an account or a backend.
 *
 * Gear is stored as name + version references rather than whole item records:
 * a saved setup then survives a data refresh, and the file stays readable.
 */

const STORAGE_KEY = 'specscape.setups.v1';

export interface ItemRef {
  name: string;
  version: string | null;
}

/** Per-spec gear overrides, e.g. putting ruby bolts on for the Zaryte crossbow. */
export type SpecSwitches = Record<string, Partial<Record<Slot, ItemRef | null>>>;

export interface TabStateRaw {
  gear: Partial<Record<Slot, ItemRef>>;
  presetId?: string; // setups historically didn't save presetId, but we might want it.
  prayerKey: string;
  styleIndex: number;
  potionId: string;
  spellName: string;
}

export type TabKind = 'melee' | 'ranged' | 'magic';

export interface SavedSetup {
  name: string;
  savedAt: string;
  
  encounters?: import('./session').EncounterDef[];
  
  tabs?: Record<TabKind, TabStateRaw>;
  activeTab?: TabKind;
  lockedSlots?: Slot[];

  gear?: Partial<Record<Slot, ItemRef>>;
  prayerKey?: string;
  styleIndex?: number;
  potionId?: string;
  spellName?: string;

  levels: CombatLevels;
  buffs: Buffs;
  switches: SpecSwitches;
}

export const toRef = (item: Equip): ItemRef => ({ name: item.name, version: item.version });

export const resolveRef = (ref: ItemRef | null | undefined, equipment: Equip[]): Equip | null => {
  if (!ref) return null;
  return (
    equipment.find((e) => e.name === ref.name && e.version === ref.version)
    ?? equipment.find((e) => e.name === ref.name)
    ?? null
  );
};

export const gearToRefs = (gear: GearSet): Partial<Record<Slot, ItemRef>> => {
  const out: Partial<Record<Slot, ItemRef>> = {};
  for (const slot of SLOTS) {
    const item = gear[slot];
    if (item) out[slot] = toRef(item);
  }
  return out;
};

export const refsToGear = (
  refs: Partial<Record<Slot, ItemRef>>,
  equipment: Equip[],
): GearSet => {
  const out: GearSet = {};
  for (const slot of SLOTS) {
    const hit = resolveRef(refs[slot], equipment);
    if (hit) out[slot] = hit;
  }
  return out;
};

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

/** localStorage can throw (private mode, blocked site data), so never let it break the page. */
const safeRead = (): SavedSetup[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedSetup[]) : [];
  } catch {
    return [];
  }
};

const safeWrite = (setups: SavedSetup[]): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setups));
    return true;
  } catch {
    return false;
  }
};

export const listSetups = (): SavedSetup[] => safeRead();

/** Saving under an existing name overwrites it. */
export const saveSetup = (setup: SavedSetup): SavedSetup[] => {
  const all = safeRead().filter((s) => s.name !== setup.name);
  const next = [...all, setup].sort((a, b) => a.name.localeCompare(b.name));
  safeWrite(next);
  return next;
};

export const deleteSetup = (name: string): SavedSetup[] => {
  const next = safeRead().filter((s) => s.name !== name);
  safeWrite(next);
  return next;
};

// ---------------------------------------------------------------------------
// import / export
// ---------------------------------------------------------------------------

export const exportSetups = (setups: SavedSetup[]): void => {
  const blob = new Blob([JSON.stringify(setups, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'specscape-setups.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/** Imported files are untrusted input, so validate the shape before storing. */
export const parseSetupsFile = (text: string): SavedSetup[] => {
  const parsed = JSON.parse(text);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.filter(
    (s): s is SavedSetup =>
      !!s && typeof s.name === 'string' && (
        (typeof s.gear === 'object' && s.gear !== null) ||
        (typeof s.tabs === 'object' && s.tabs !== null)
      ),
  );
};

export const importSetups = (incoming: SavedSetup[]): SavedSetup[] => {
  const existing = safeRead();
  const byName = new Map(existing.map((s) => [s.name, s]));
  for (const s of incoming) byName.set(s.name, s);
  const next = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  safeWrite(next);
  return next;
};
