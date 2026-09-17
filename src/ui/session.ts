import type { Slot } from '../sim/gear';
import type { Buffs } from '../sim/modifiers';
import type { CombatLevels } from '../sim/loadout';
import type { ItemRef, SpecSwitches } from './setups';

/**
 * The working configuration, remembered across visits.
 *
 * This is separate from named saved setups: it is the "where you left off"
 * state, restored automatically so returning to the site does not mean
 * rebuilding your loadout every time.
 */

const KEY = 'specscape.session.v1';

/** What a first-time visitor sees: the boss most people are actually killing. */
export const DEFAULT_MONSTER = 'Vorkath (Post-quest)';
export const DEFAULT_PRESET = 'max_melee_fang';

export interface TabStateRaw {
  gear: Partial<Record<Slot, ItemRef>>;
  presetId: string;
  prayerKey: string;
  styleIndex: number;
  potionId: string;
  spellName: string;
}

export type TabKind = 'melee' | 'ranged' | 'magic';

export interface SessionState {
  monsterQuery: string;
  
  tabs?: Record<TabKind, TabStateRaw>;
  activeTab?: TabKind;
  lockedSlots?: Slot[];

  gear?: Partial<Record<Slot, ItemRef>>;
  presetId?: string;
  prayerKey?: string;
  styleIndex?: number;
  potionId?: string;
  spellName?: string;

  levels: CombatLevels;
  buffs: Buffs;
  switches: SpecSwitches;
  enabledSpecs: string[];
  startEnergy: number;
  trials: number;
  kills: number;
  downtimeSeconds: number;
  bankingSeconds: number;
  compareLightbearer: boolean;
  setupName: string;
}

/**
 * localStorage throws in private mode and when site data is blocked, so a
 * failure here must never stop the page rendering - it just means no memory.
 */
export const loadSession = (): Partial<SessionState> | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<SessionState>) : null;
  } catch {
    return null;
  }
};

export const saveSession = (state: SessionState): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Nothing to do - the app works fine without persistence.
  }
};

export const clearSession = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
};
