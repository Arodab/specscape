import { useEffect, useMemo, useState } from 'react';
import GearGrid from './GearGrid';
import { SLOTS, type Equip, type GearSet, type Slot } from '../sim/gear';
import type { SpecDef } from '../sim/specs';
import { resolveRef, toRef, type ItemRef } from './setups';

export interface SwitchPreview {
  maxHit: number;
  attackRoll: number;
  /** Chance this spec lands against the currently selected target, 0-1. */
  hitChance: number;
}

import type { TabKind } from './session';

interface Props {
  spec: SpecDef;
  /** The main setup's gear, used as the starting point for the swap. */
  baseGear: GearSet;
  tabs: Record<TabKind, { gear: GearSet }>;
  /** The weapon the spec forces into the weapon slot. */
  specWeapon: Equip | null;
  overrides: Partial<Record<Slot, ItemRef | null>>;
  itemsBySlot: Map<Slot, Equip[]>;
  equipment: Equip[];
  preview: (overrides: Partial<Record<Slot, ItemRef | null>>) => SwitchPreview;
  /** Target attributes, so bane weapons float to the top of the picker. */
  targetAttributes: string[];
  onChange: (overrides: Partial<Record<Slot, ItemRef | null>>) => void;
  onClose: () => void;
}

/**
 * Lets you set up the actual switch for a spec, not just the weapon.
 *
 * This matters because a spec swap keeps the rest of your gear: speccing a
 * Zaryte crossbow out of a max melee setup means rolling ranged accuracy with
 * zero ranged bonus, which mostly misses. The live readout makes that obvious,
 * and the grid lets you bring the pieces you would actually swap.
 */
export default function SwitchesModal({
  spec, baseGear, tabs, specWeapon, overrides, itemsBySlot, equipment, preview,
  targetAttributes, onChange, onClose,
}: Props) {
  const [draft, setDraft] = useState(overrides);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Gear as the sim will actually see it: base, then overrides, then the spec weapon. */
  const effectiveGear = useMemo(() => {
    const out: GearSet = { ...baseGear };
    for (const slot of SLOTS) {
      if (slot in draft) out[slot] = resolveRef(draft[slot], equipment);
    }
    out.weapon = specWeapon;
    if (specWeapon?.twoHanded) out.shield = null;
    return out;
  }, [baseGear, draft, equipment, specWeapon]);

  const changedSlots = useMemo(
    () => SLOTS.filter((s) => s in draft),
    [draft],
  );

  const stats = useMemo(() => preview(draft), [preview, draft]);

  const setSlot = (slot: Slot, item: Equip | null) => {
    if (slot === 'weapon') return; // the spec weapon defines this slot
    setDraft((d) => ({ ...d, [slot]: item ? toRef(item) : null }));
  };

  const applyTab = (tabKind: TabKind) => {
    const targetGear = tabs[tabKind].gear;
    const newOverrides: Partial<Record<Slot, ItemRef | null>> = {};
    for (const slot of SLOTS) {
      if (slot === 'weapon') continue;
      const targetItem = targetGear[slot];
      const baseItem = baseGear[slot];
      if (targetItem?.id !== baseItem?.id || targetItem?.version !== baseItem?.version) {
        newOverrides[slot] = targetItem ? toRef(targetItem) : null;
      }
    }
    setDraft(newOverrides);
  };

  const apply = () => { onChange(draft); onClose(); };
  const reset = () => setDraft({});

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>{spec.name} switch</h3>
          <button className="link" onClick={onClose}>close</button>
        </header>

        <p className="modal-note">
          A spec swap keeps the rest of your gear and only changes the weapon. Bring the
          pieces you would actually switch to - especially ammo and anything that carries
          this spec&apos;s attack type.
        </p>

        <div className="switch-body">
          <GearGrid
            gear={effectiveGear}
            itemsBySlot={itemsBySlot}
            onChange={setSlot}
            lockedSlots={['weapon']}
            highlightSlots={changedSlots}
            attackType={spec.type}
            targetAttributes={targetAttributes}
          />

          <div className="switch-stats">
            <div className="fact">max hit <b>{stats.maxHit}</b></div>
            <div className="fact">atk roll <b>{stats.attackRoll.toLocaleString()}</b></div>
            <div className={`fact${stats.hitChance < 0.35 ? ' bad-fact' : ''}`}>
              hit chance <b>{(stats.hitChance * 100).toFixed(1)}%</b>
            </div>
            {spec.guaranteed && (
              <div className="fact">always hits</div>
            )}
            {!spec.guaranteed && stats.hitChance < 0.35 && (
              <div className="warn">
                This spec lands under {(stats.hitChance * 100).toFixed(0)}% of the time with the
                current switch. Bring gear matching its attack type.
              </div>
            )}
            {changedSlots.length > 0 && (
              <div className="fact">{changedSlots.length} slot(s) overridden</div>
            )}
          </div>
        </div>

        <div className="switch-tabs-pull" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
          <span style={{ fontSize: '12px', color: 'var(--muted)', alignSelf: 'center' }}>Pull from tab:</span>
          <button className="mini" onClick={() => applyTab('melee')}>Melee</button>
          <button className="mini" onClick={() => applyTab('ranged')}>Ranged</button>
          <button className="mini" onClick={() => applyTab('magic')}>Magic</button>
        </div>

        <footer className="modal-foot">
          <button className="link" onClick={reset}>reset to main setup</button>
          <button className="primary" onClick={apply}>Apply switch</button>
        </footer>
      </div>
    </div>
  );
}
