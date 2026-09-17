import { useEffect, useMemo, useRef, useState } from 'react';
import { itemImageUrl, type Equip, type GearSet, type Slot } from '../sim/gear';
import { isBaneWeaponFor } from '../sim/bane';
import type { AttackType } from '../sim/types';

/**
 * Equipment laid out the way the in-game worn-equipment tab is, so the shape is
 * familiar at a glance:
 *
 *          head
 *   cape   neck   ammo
 *   weapon body   shield
 *          legs
 *   hands  feet   ring
 */
const LAYOUT: (Slot | null)[] = [
  null, 'head', null,
  'cape', 'neck', 'ammo',
  'weapon', 'body', 'shield',
  null, 'legs', null,
  'hands', 'feet', 'ring',
];

export const itemLabel = (e: Equip): string => (e.version ? `${e.name} (${e.version})` : e.name);

interface ItemIconProps {
  item: Equip;
  size?: number;
  /** Lazy-load only makes sense for long scrolling lists, not the always-visible grid. */
  lazy?: boolean;
}

export function ItemIcon({ item, size = 28, lazy = false }: ItemIconProps) {
  const [failed, setFailed] = useState(false);
  const url = itemImageUrl(item);
  if (!url || failed) {
    return <span className="icon-fallback" style={{ width: size, height: size }}>{item.name.slice(0, 2)}</span>;
  }
  return (
    <img
      src={url}
      alt={item.name}
      title={itemLabel(item)}
      width={size}
      height={size}
      loading={lazy ? 'lazy' : 'eager'}
      onError={() => setFailed(true)}
      style={{ maxWidth: size, maxHeight: size, objectFit: 'contain' }}
    />
  );
}

type StatKey = keyof Equip['o'];
type SortKey = 'name' | StatKey;

/** Sorting by a stat turns the picker into a quick best-in-slot lookup. */
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name (A-Z)' },
  { key: 'str', label: 'Melee strength' },
  { key: 'ranged_str', label: 'Ranged strength' },
  { key: 'magic_str', label: 'Magic damage' },
  { key: 'stab', label: 'Stab attack' },
  { key: 'slash', label: 'Slash attack' },
  { key: 'crush', label: 'Crush attack' },
  { key: 'ranged', label: 'Ranged attack' },
  { key: 'magic', label: 'Magic attack' },
];

/** The strength stat that matters for the style you are currently using. */
export const defaultSortForType = (type: AttackType): SortKey => {
  if (type === 'ranged') return 'ranged_str';
  if (type === 'magic') return 'magic_str';
  return 'str';
};

interface PickerProps {
  slot: Slot;
  items: Equip[];
  current: Equip | null;
  /** Sort the list by this stat when the picker opens. */
  defaultSort: SortKey;
  /** Target attributes, so bane weapons can be floated to the top. */
  targetAttributes: string[];
  onPick: (item: Equip | null) => void;
  onClose: () => void;
}

function ItemPicker({
  slot, items, current, defaultSort, targetAttributes, onPick, onClose,
}: PickerProps) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(defaultSort);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? items.filter((e) => e.name.toLowerCase().includes(q)) : items;

    // A bane weapon beats almost any generic upgrade against its own monster
    // type, so those come first whatever the sort is.
    const baneRank = (e: Equip) => (isBaneWeaponFor(e.name, targetAttributes) ? 0 : 1);
    const byStat = (a: Equip, b: Equip) =>
      (b.o[sortKey as StatKey] - a.o[sortKey as StatKey]) || a.name.localeCompare(b.name);

    const sorted = [...pool].sort(
      (a, b) => (baneRank(a) - baneRank(b))
        || (sortKey === 'name' ? a.name.localeCompare(b.name) : byStat(a, b)),
    );
    return sorted.slice(0, 120);
  }, [items, query, sortKey, targetAttributes]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>Choose {slot}</h3>
          <button className="link" onClick={onClose}>close</button>
        </header>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${slot} items...`}
        />
        <label className="picker-sort">
          <span>Sort by</span>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <div className="picker-list">
          <button className="picker-row" onClick={() => { onPick(null); onClose(); }}>
            <span className="icon-fallback" style={{ width: 28, height: 28 }}>-</span>
            <span>(empty)</span>
          </button>
          {results.map((item, i) => (
            <button
              key={`${item.id}-${item.version}-${i}`}
              className={`picker-row${current && current.id === item.id && current.version === item.version ? ' selected' : ''}`}
              onClick={() => { onPick(item); onClose(); }}
            >
              <ItemIcon item={item} lazy />
              <span className="picker-name">{itemLabel(item)}</span>
              {isBaneWeaponFor(item.name, targetAttributes) && (
                <span className="bane-badge">
                  {isBaneWeaponFor(item.name, targetAttributes)!.label}
                </span>
              )}
              {sortKey !== 'name' && (
                <span className={`picker-stat${item.o[sortKey] > 0 ? ' pos' : item.o[sortKey] < 0 ? ' neg' : ''}`}>
                  {item.o[sortKey] > 0 ? '+' : ''}{item.o[sortKey]}
                </span>
              )}
            </button>
          ))}
          {results.length === 0 && <div className="picker-empty">No matches</div>}
        </div>
      </div>
    </div>
  );
}

interface GearGridProps {
  gear: GearSet;
  itemsBySlot: Map<Slot, Equip[]>;
  onChange: (slot: Slot, item: Equip | null) => void;
  /** Slots the caller does not want editable (e.g. the spec weapon itself). */
  lockedSlots?: Slot[];
  /** Slots locked across tabs */
  sharedSlots?: Set<Slot>;
  onToggleShared?: (slot: Slot) => void;
  /** Slots visually marked as overridden, used by the spec switches editor. */
  highlightSlots?: Slot[];
  /** Attack type of the current style, used to pick a sensible default sort. */
  attackType?: AttackType;
  /** Target attributes, so bane weapons float to the top of the picker. */
  targetAttributes?: string[];
}

export default function GearGrid({
  gear, itemsBySlot, onChange, lockedSlots = [], sharedSlots, onToggleShared, highlightSlots = [],
  attackType = 'melee', targetAttributes = [],
}: GearGridProps) {
  const [editing, setEditing] = useState<Slot | null>(null);

  return (
    <>
      <div className="gear-grid">
        {LAYOUT.map((slot, i) => {
          if (!slot) return <div key={`gap-${i}`} className="gear-gap" />;
          const item = gear[slot] ?? null;
          const locked = lockedSlots.includes(slot);
          const shared = sharedSlots?.has(slot) ?? false;
          const highlighted = highlightSlots.includes(slot);
          return (
            <div key={slot} className="gear-slot-wrapper">
              <button
                type="button"
                className={`gear-slot${item ? ' filled' : ''}${locked ? ' locked' : ''}${highlighted ? ' overridden' : ''}`}
                title={item ? itemLabel(item) : slot}
                disabled={locked}
                onClick={() => setEditing(slot)}
              >
                {item
                  ? <ItemIcon item={item} size={30} />
                  : <span className="gear-slot-label">{slot}</span>}
              </button>
              {onToggleShared && (
                <button
                  type="button"
                  className={`shared-toggle ${shared ? 'is-shared' : ''}`}
                  onClick={() => onToggleShared(slot)}
                  title={shared ? "Shared across tabs (click to unshare)" : "Specific to this tab (click to share)"}
                >
                  {shared ? '🔒' : '🔓'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <ItemPicker
          slot={editing}
          items={itemsBySlot.get(editing) ?? []}
          current={gear[editing] ?? null}
          defaultSort={defaultSortForType(attackType)}
          targetAttributes={targetAttributes}
          onPick={(item) => onChange(editing, item)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
