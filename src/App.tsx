import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GearGrid, { ItemIcon, itemLabel } from './ui/GearGrid';
import SwitchesModal, { type SwitchPreview } from './ui/SwitchesModal';
import {
  SLOTS, DEFAULT_AMMO, ammoFor, ammoKindFor, pickVariant,
  type Equip, type GearSet, type Slot,
} from './sim/gear';
import { PRESETS, parseGearRef } from './sim/presets';
import { SPECS, type SpecDef } from './sim/specs';
import { drainLimit } from './sim/defenceFloors';
import { accuracy, dps } from './sim/combat';
import { isPoweredStaff, type Spell } from './sim/spells';
import {
  POTIONS, activeModifiers, buildMain, buildSpecCandidates, buildSpecLoadout,
  selectedStyle, specWeaponItem, stylesFor, type SetupInput,
} from './ui/build';
import { DEFAULT_BUFFS, type Buffs } from './sim/modifiers';
import {
  deleteSetup, gearToRefs, listSetups, refsToGear, resolveRef, saveSetup,
  type ItemRef, type SavedSetup, type SpecSwitches,
} from './ui/setups';
import { decodeSetup, encodeSetup } from './ui/sharecode';
import {
  DEFAULT_MONSTER, DEFAULT_PRESET, clearSession, loadSession, saveSession,
  type SessionState,
} from './ui/session';
import type { Monster, MonsterState, SpecResult } from './sim/types';
import type { SimRequest, SimResponse, SimVariant } from './worker/sim.worker';

const BASE = import.meta.env.BASE_URL;

const monsterLabel = (m: Monster) => (m.version ? `${m.name} (${m.version})` : m.name);

const PRAYER_OPTIONS = [
  ['none', 'None'], ['chivalry', 'Chivalry'], ['piety', 'Piety'],
  ['eagleEye', 'Eagle Eye'], ['rigour', 'Rigour'], ['augury', 'Augury'],
] as const;

const stateOf = (m: Monster): MonsterState => ({
  hp: m.hp, def: m.def, magic: m.magic, baseDef: m.def, baseAtk: 0, baseStr: 0,
});

export default function App() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [equipment, setEquipment] = useState<Equip[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [monsterQuery, setMonsterQuery] = useState(DEFAULT_MONSTER);
  const [activeTab, setActiveTab] = useState<'melee' | 'ranged' | 'magic'>('melee');
  const [tabs, setTabs] = useState<Record<'melee' | 'ranged' | 'magic', { gear: GearSet, presetId: string, prayerKey: string, styleIndex: number, potionId: string, spellName: string }>>({
    melee: { gear: {}, presetId: DEFAULT_PRESET, prayerKey: 'piety', styleIndex: 0, potionId: 'super_combat', spellName: '' },
    ranged: { gear: {}, presetId: DEFAULT_PRESET, prayerKey: 'rigour', styleIndex: 0, potionId: 'ranging', spellName: '' },
    magic: { gear: {}, presetId: DEFAULT_PRESET, prayerKey: 'augury', styleIndex: 0, potionId: 'imbued_heart', spellName: '' },
  });
  const [sharedSlots, setSharedSlots] = useState<Set<Slot>>(new Set());
  const [filterSpecs, setFilterSpecs] = useState(false);

  const { gear, presetId, prayerKey, styleIndex, potionId, spellName } = tabs[activeTab];

  const [levels, setLevels] = useState({ attack: 99, strength: 99, ranged: 99, magic: 99 });
  const [buffs, setBuffs] = useState<Buffs>(DEFAULT_BUFFS);
  const [specOptions, setSpecOptions] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      SPECS.filter((sp) => sp.option).map((sp) => [sp.option!.key, sp.option!.default]),
    ));
  const [shareCode, setShareCode] = useState('');

  const [switches, setSwitches] = useState<SpecSwitches>({});
  const [editingSpec, setEditingSpec] = useState<SpecDef | null>(null);

  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(SPECS.map((s) => s.id)));
  const [startEnergy, setStartEnergy] = useState(100);
  const [trials, setTrials] = useState(20000);
  const [kills, setKills] = useState(1);
  const [downtimeSeconds, setDowntimeSeconds] = useState(0);
  const [bankingSeconds, setBankingSeconds] = useState(0);
  const [compareLightbearer, setCompareLightbearer] = useState(true);

  const [rows, setRows] = useState<SpecResult[] | null>(null);
  const [lbRows, setLbRows] = useState<SpecResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const [saved, setSaved] = useState<SavedSetup[]>([]);
  const [setupName, setSetupName] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  // ---- data loading -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${BASE}data/monsters.json`).then((r) => r.json()),
      fetch(`${BASE}data/equipment.json`).then((r) => r.json()),
      fetch(`${BASE}data/spells.json`).then((r) => r.json()),
    ])
      .then(([m, e, sp]) => {
        if (cancelled) return;
        setMonsters(m);
        setEquipment(e);
        setSpells(sp);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) { setDataError(String(err)); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setSaved(listSetups()); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- worker -------------------------------------------------------------
  useEffect(() => {
    const w = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<SimResponse>) => {
      if (ev.data.id !== reqId.current) return; // stale result
      setRunning(false);
      if (ev.data.ok) {
        setRows(ev.data.results.normal ?? null);
        setLbRows(ev.data.results.lightbearer ?? null);
      }
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  // ---- derived ------------------------------------------------------------
  const itemsBySlot = useMemo(() => {
    const map = new Map<Slot, Equip[]>();
    for (const slot of SLOTS) map.set(slot, []);
    for (const e of equipment) {
      const list = map.get(e.slot);
      if (list) list.push(e);
    }
    // Darts are weapon-slot items in the wiki data but act as blowpipe ammo.
    const ammo = map.get('ammo')!;
    for (const e of equipment) if (/ dart$|^Dragon dart/i.test(e.name)) ammo.push(e);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [equipment]);

  /** Only offer ammo the equipped weapon can actually fire. */
  const pickerItems = useMemo(() => {
    const map = new Map(itemsBySlot);
    map.set('ammo', ammoFor(gear.weapon, itemsBySlot.get('ammo') ?? []));
    return map;
  }, [itemsBySlot, gear.weapon]);

  const switchPickerItems = useMemo(() => {
    if (!editingSpec) return pickerItems;
    const specWeapon = specWeaponItem(editingSpec, equipment);
    const map = new Map(itemsBySlot);
    map.set('ammo', ammoFor(specWeapon, itemsBySlot.get('ammo') ?? []));
    return map;
  }, [editingSpec, equipment, itemsBySlot, pickerItems]);

  const monster = useMemo(
    () => monsters.find((m) => monsterLabel(m) === monsterQuery) ?? null,
    [monsters, monsterQuery],
  );

  const monsterOptions = useMemo(() => {
    const q = monsterQuery.trim().toLowerCase();
    const pool = q ? monsters.filter((m) => monsterLabel(m).toLowerCase().includes(q)) : monsters;
    return pool.slice(0, 60);
  }, [monsters, monsterQuery]);

  /** Styles the equipped weapon actually offers. */
  const styles = useMemo(() => stylesFor(gear), [gear]);
  const style = useMemo(() => selectedStyle(gear, styleIndex), [gear, styleIndex]);

  const spell = useMemo(
    () => spells.find((s) => s.name === spellName) ?? null,
    [spells, spellName],
  );

  /** A spell choice only matters when casting from a spellbook. */
  const needsSpell = style.attackType === 'magic'
    && style.stance === 'autocast'
    && !isPoweredStaff(gear.weapon?.name);

  const setup: SetupInput = useMemo(
    () => ({ gear, levels, potionId, prayerKey, styleIndex, spell, buffs }),
    [gear, levels, potionId, prayerKey, styleIndex, spell, buffs],
  );

  const main = useMemo(() => buildMain(setup, monster), [setup, monster]);
  const mods = useMemo(() => activeModifiers(setup, monster), [setup, monster]);

  const mainDps = useMemo(
    () => (monster ? dps(main, monster, stateOf(monster)) : 0),
    [main, monster],
  );

  /** Spec switches as resolved items, ready for the loadout builder. */
  const resolvedSwitches = useMemo(() => {
    const out: Record<string, Partial<Record<Slot, Equip | null>>> = {};
    for (const [specId, ov] of Object.entries(switches)) {
      const slots: Partial<Record<Slot, Equip | null>> = {};
      for (const slot of SLOTS) {
        if (slot in ov) slots[slot] = resolveRef(ov[slot], equipment);
      }
      out[specId] = slots;
    }
    return out;
  }, [switches, equipment]);

  const applyPreset = useCallback((id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset || !equipment.length) return;
    const nextGear: GearSet = {};
    for (const [slot, ref] of Object.entries(preset.gear)) {
      if (!ref) continue;
      const { name, version } = parseGearRef(ref);
      const hit = pickVariant(
        equipment.filter((e) => e.name === name && (version === null || e.version === version)),
      );
      if (hit) nextGear[slot as Slot] = hit;
    }
    setTabs(all => {
      const nextStyles = stylesFor(nextGear);
      const idx = nextStyles.findIndex((s) => s.name === preset.styleName);
      const t = all[activeTab];
      return {
        ...all,
        [activeTab]: {
          ...t,
          gear: nextGear,
          presetId: id,
          prayerKey: preset.prayer,
          spellName: preset.spell ?? '',
          styleIndex: idx === -1 ? 0 : idx,
          potionId: preset.type === 'ranged' ? 'ranging' : preset.type === 'magic' ? 'imbued_heart' : 'super_combat',
        }
      };
    });
  }, [equipment, activeTab]);

  /**
   * On first paint, restore where the user left off. Only fall back to the
   * default preset when there is nothing remembered.
   */
  const restored = useRef(false);
  useEffect(() => {
    if (!equipment.length || restored.current) return;
    restored.current = true;

    const prev = loadSession();
    if (!prev || (!prev.tabs && (!prev.gear || !Object.keys(prev.gear).length))) {
      applyPreset(DEFAULT_PRESET);
      return;
    }

    setMonsterQuery(prev.monsterQuery ?? DEFAULT_MONSTER);
    
    if (prev.tabs && prev.activeTab) {
      setTabs({
        melee: { ...prev.tabs.melee, gear: refsToGear(prev.tabs.melee.gear, equipment) },
        ranged: { ...prev.tabs.ranged, gear: refsToGear(prev.tabs.ranged.gear, equipment) },
        magic: { ...prev.tabs.magic, gear: refsToGear(prev.tabs.magic.gear, equipment) },
      });
      setActiveTab(prev.activeTab);
      if (prev.lockedSlots) setSharedSlots(new Set(prev.lockedSlots));
    } else {
      const g = refsToGear(prev.gear || {}, equipment);
      const tab = { gear: g, prayerKey: prev.prayerKey || 'none', styleIndex: prev.styleIndex ?? 0, potionId: prev.potionId || 'none', spellName: prev.spellName || '', presetId: prev.presetId || '' };
      setTabs({ melee: tab, ranged: tab, magic: tab });
    }

    if (prev.levels) setLevels(prev.levels);
    setBuffs(prev.buffs ?? DEFAULT_BUFFS);
    setSwitches(prev.switches ?? {});
    if (prev.enabledSpecs?.length) setEnabled(new Set(prev.enabledSpecs));
    if (typeof prev.startEnergy === 'number') setStartEnergy(prev.startEnergy);
    if (typeof prev.trials === 'number') setTrials(prev.trials);
    if (typeof prev.kills === 'number') setKills(prev.kills);
    if (typeof prev.downtimeSeconds === 'number') setDowntimeSeconds(prev.downtimeSeconds);
    if (typeof prev.bankingSeconds === 'number') setBankingSeconds(prev.bankingSeconds);
    if (typeof prev.compareLightbearer === 'boolean') setCompareLightbearer(prev.compareLightbearer);
    setSetupName(prev.setupName ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment]);

  // Remember the working configuration for the next visit.
  useEffect(() => {
    if (!restored.current || !equipment.length) return;
    
    const tabsRaw = {
      melee: { ...tabs.melee, gear: gearToRefs(tabs.melee.gear) },
      ranged: { ...tabs.ranged, gear: gearToRefs(tabs.ranged.gear) },
      magic: { ...tabs.magic, gear: gearToRefs(tabs.magic.gear) },
    };

    const state: SessionState = {
      monsterQuery,
      tabs: tabsRaw,
      activeTab,
      lockedSlots: [...sharedSlots],
      levels, buffs, switches,
      enabledSpecs: [...enabled],
      startEnergy, trials, kills, downtimeSeconds, bankingSeconds,
      compareLightbearer, setupName,
    };
    saveSession(state);
  }, [
    equipment.length, monsterQuery, tabs, activeTab, sharedSlots, levels,
    buffs, switches, enabled, startEnergy, trials, kills,
    downtimeSeconds, bankingSeconds, compareLightbearer, setupName,
  ]);

  const effectiveTrials = useMemo(
    () => Math.max(500, Math.round(trials / Math.max(1, kills))),
    [trials, kills],
  );

  /** Lightbearer trades the ring's stats for double spec regen. */
  const lightbearerItem = useMemo(
    () => equipment.find((e) => e.name === 'Lightbearer' && e.slot === 'ring') ?? null,
    [equipment],
  );

  const run = useCallback(() => {
    const w = workerRef.current;
    if (!w || !monster) return;

    const baseOpts = {
      startEnergy, trials: effectiveTrials, seed: 12345,
      kills,
      downtimeTicks: Math.round(downtimeSeconds / 0.6),
      bankingTicks: Math.round(bankingSeconds / 0.6),
      specOptions,
    };

    const makeVariant = (key: string, s: SetupInput, lightbearer: boolean): SimVariant => ({
      key,
      main: buildMain(s, monster),
      specs: buildSpecCandidates(s, equipment, enabled, monster, resolvedSwitches)
        .map(({ id, load }) => ({ id, load })),
      opts: { ...baseOpts, lightbearer },
    });

    const variants: SimVariant[] = [makeVariant('normal', setup, false)];
    if (compareLightbearer && lightbearerItem) {
      variants.push(makeVariant(
        'lightbearer',
        { ...setup, gear: { ...gear, ring: lightbearerItem } },
        true,
      ));
    }

    setRunning(true);
    reqId.current += 1;
    const req: SimRequest = { id: reqId.current, monster, variants };
    w.postMessage(req);
  }, [
    monster, setup, gear, equipment, enabled, resolvedSwitches,
    startEnergy, effectiveTrials, kills, downtimeSeconds, bankingSeconds,
    compareLightbearer, lightbearerItem, specOptions,
  ]);

  const ranOnce = useRef(false);
  useEffect(() => {
    if (!ranOnce.current && monster && gear.weapon && equipment.length) {
      ranOnce.current = true;
      run();
    }
  }, [monster, gear.weapon, equipment, run]);

  /**
   * Re-run whenever the inputs change. `run` is rebuilt by useCallback on every
   * relevant change, so depending on it is enough.
   *
   * Without this the table silently goes stale: the headings react to state
   * immediately while the numbers still come from the previous run, so changing
   * kills-per-trip would show a "trip of 10 kills" heading over single-kill
   * results. The debounce coalesces typing into one simulation.
   */
  useEffect(() => {
    if (!ranOnce.current) return;
    const t = setTimeout(() => run(), 450);
    return () => clearTimeout(t);
  }, [run]);

  // ---- handlers -----------------------------------------------------------
  const setSlot = (slot: Slot, item: Equip | null) => {
    setTabs((allTabs) => {
      const t = allTabs[activeTab];
      const nextGear = { ...t.gear, [slot]: item };
      let nextStyleIndex = t.styleIndex;
      if (slot === 'weapon') {
        const s = stylesFor(nextGear);
        nextStyleIndex = Math.min(t.styleIndex, s.length - 1);
        const kind = ammoKindFor(item);
        const allowed = ammoFor(item, itemsBySlot.get('ammo') ?? []);
        if (!kind) {
          nextGear.ammo = null;
        } else if (!nextGear.ammo || !allowed.some((a) => a.id === nextGear.ammo?.id)) {
          const wanted = DEFAULT_AMMO[kind];
          nextGear.ammo = allowed.find((a) => a.name === wanted) ?? allowed[0] ?? null;
        }
      }
      const newTabState = { ...t, gear: nextGear, styleIndex: nextStyleIndex, presetId: '' };
      const nextTabs = { ...allTabs, [activeTab]: newTabState };
      
      if (sharedSlots.has(slot)) {
        for (const k of ['melee', 'ranged', 'magic'] as const) {
          if (k !== activeTab) {
            nextTabs[k] = { ...nextTabs[k], gear: { ...nextTabs[k].gear, [slot]: item }, presetId: '' };
          }
        }
      }
      return nextTabs;
    });
  };

  const toggleSharedSlot = (slot: Slot) => {
    setSharedSlots(prev => {
      const next = new Set(prev);
      if (next.has(slot)) {
        next.delete(slot);
      } else {
        next.add(slot);
        const itemToShare = gear[slot] ?? null;
        setTabs(t => {
          const nextTabs = { ...t };
          for (const k of ['melee', 'ranged', 'magic'] as const) {
            if (k !== activeTab) {
              nextTabs[k] = { ...nextTabs[k], gear: { ...nextTabs[k].gear, [slot]: itemToShare }, presetId: '' };
            }
          }
          return nextTabs;
        });
      }
      return next;
    });
  };

  const updateTab = (updates: Partial<typeof tabs['melee']>) => {
    setTabs(t => ({ ...t, [activeTab]: { ...t[activeTab], ...updates } }));
  };

  const toggleSpec = (id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const previewSwitch = useCallback(
    (def: SpecDef) => (ov: Partial<Record<Slot, ItemRef | null>>): SwitchPreview => {
      const weapon = specWeaponItem(def, equipment);
      if (!weapon || !monster) return { maxHit: 0, attackRoll: 0, hitChance: 0 };
      const resolved: Partial<Record<Slot, Equip | null>> = {};
      for (const slot of SLOTS) {
        if (slot in ov) resolved[slot] = resolveRef(ov[slot], equipment);
      }
      const load = buildSpecLoadout(setup, def, weapon, monster, resolved);
      const hitChance = def.guaranteed
        ? 1
        : accuracy(load, monster, stateOf(monster), {
          styleOverride: def.defStyle,
          accuracyMultiplier: def.accMult,
        });
      return { maxHit: def.maxHit(load.maxHit), attackRoll: load.attackRoll, hitChance };
    },
    [equipment, monster, setup],
  );

  const doSave = () => {
    const name = setupName.trim();
    if (!name) { setToast('Give the setup a name first'); return; }
    
    const tabsRaw = {
      melee: { ...tabs.melee, gear: gearToRefs(tabs.melee.gear) },
      ranged: { ...tabs.ranged, gear: gearToRefs(tabs.ranged.gear) },
      magic: { ...tabs.magic, gear: gearToRefs(tabs.magic.gear) },
    };
    
    setSaved(saveSetup({
      name,
      savedAt: new Date().toISOString(),
      tabs: tabsRaw,
      activeTab,
      lockedSlots: [...sharedSlots],
      levels, buffs, switches,
    }));
    setToast(`Saved "${name}"`);
  };

  const doLoad = (name: string) => {
    const s = saved.find((x) => x.name === name);
    if (!s) return;
    
    if (s.tabs && s.activeTab) {
      setTabs({
        melee: { ...s.tabs.melee, presetId: s.tabs.melee.presetId || '', gear: refsToGear(s.tabs.melee.gear, equipment) },
        ranged: { ...s.tabs.ranged, presetId: s.tabs.ranged.presetId || '', gear: refsToGear(s.tabs.ranged.gear, equipment) },
        magic: { ...s.tabs.magic, presetId: s.tabs.magic.presetId || '', gear: refsToGear(s.tabs.magic.gear, equipment) },
      });
      setActiveTab(s.activeTab);
      if (s.lockedSlots) setSharedSlots(new Set(s.lockedSlots));
    } else {
      const g = refsToGear(s.gear || {}, equipment);
      const tab = { gear: g, prayerKey: s.prayerKey || 'none', styleIndex: s.styleIndex ?? 0, potionId: s.potionId || 'none', spellName: s.spellName || '', presetId: '' };
      setTabs({ melee: tab, ranged: tab, magic: tab });
    }
    
    setLevels(s.levels);
    setBuffs(s.buffs ?? DEFAULT_BUFFS);
    setSwitches(s.switches ?? {});
    setSetupName(s.name);
    setToast(`Loaded "${s.name}"`);
  };

  const currentShareable = () => ({
    monsterQuery, tabs, activeTab, lockedSlots: [...sharedSlots],
    levels, buffs, switches, enabledSpecs: [...enabled], specOptions,
    startEnergy, kills, downtimeSeconds, bankingSeconds, compareLightbearer,
  });

  const doCopyCode = async () => {
    const code = encodeSetup(currentShareable(), equipment);
    setShareCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setToast('Code copied to clipboard');
    } catch {
      // Clipboard access can be blocked; the code is in the box either way.
      setToast('Code ready below - copy it manually');
    }
  };

  const doLoadCode = (codeStr = shareCode) => {
    const decoded = decodeSetup(codeStr, equipment);
    if (!decoded) { setToast('That is not a valid SpecScape code'); return; }
    
    if (decoded.tabs && decoded.activeTab) {
      setTabs({
        melee: { ...decoded.tabs.melee, presetId: '' },
        ranged: { ...decoded.tabs.ranged, presetId: '' },
        magic: { ...decoded.tabs.magic, presetId: '' },
      });
      setActiveTab(decoded.activeTab);
      if (decoded.lockedSlots) setSharedSlots(new Set(decoded.lockedSlots));
    } else {
      const g = decoded.gear || {};
      const tab = { gear: g, prayerKey: decoded.prayerKey || 'none', styleIndex: decoded.styleIndex ?? 0, potionId: decoded.potionId || 'none', spellName: decoded.spellName || '', presetId: '' };
      setTabs({ melee: tab, ranged: tab, magic: tab });
    }

    setMonsterQuery(decoded.monsterQuery);
    setLevels(decoded.levels);
    setBuffs(decoded.buffs);
    setSwitches(decoded.switches);
    if (decoded.enabledSpecs.length) setEnabled(new Set(decoded.enabledSpecs));
    if (Object.keys(decoded.specOptions).length) setSpecOptions(decoded.specOptions);
    setStartEnergy(decoded.startEnergy);
    setKills(decoded.kills);
    setDowntimeSeconds(decoded.downtimeSeconds);
    setBankingSeconds(decoded.bankingSeconds);
    setCompareLightbearer(decoded.compareLightbearer);
    setToast('Setup loaded from code');
  };

  // ---- render -------------------------------------------------------------
  const maxSaved = useMemo(
    () => Math.max(1, ...(rows ?? []).map((r) => Math.abs(r.secondsSaved))),
    [rows],
  );

  const lbById = useMemo(() => {
    const map = new Map<string | null, SpecResult>();
    for (const r of lbRows ?? []) map.set(r.specId, r);
    return map;
  }, [lbRows]);

  const showLb = compareLightbearer && !!lbRows;

  const limit = monster ? drainLimit(monster.name, monster.def) : null;
  const drainNote = monster && limit
    ? limit.immune
      ? `${monster.name} cannot have its Defence drained at all - drain specs are dead weight here.`
      : limit.floor > 0
        ? `${monster.name}'s Defence floors at ${limit.floor} (base ${monster.def}), so drains can only strip ${Math.max(0, monster.def - limit.floor)} levels.`
        : null
    : null;

  if (loading) return <div className="app"><p>Loading game data...</p></div>;
  if (dataError) {
    return (
      <div className="app">
        <p>Could not load game data: {dataError}</p>
        <p>Run <code>npm run data</code> to fetch it.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top-bar">
        <div className="header-text">
          <h1>Spec<span>Scape</span></h1>
          
        </div>
        <div className="saved-setups-compact">
          <input className="mini-input" placeholder="Setup name..." value={setupName} onChange={(e) => setSetupName(e.target.value)} />
          <button className="mini" onClick={doSave}>Save</button>
          <button className="mini" onClick={() => deleteSetup(setupName)}>Delete</button>
          <select className="mini-select" value="" onChange={(e) => e.target.value && doLoad(e.target.value)}>
            <option value="">Load...</option>
            {saved.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
          <button className="mini" onClick={doCopyCode}>Export</button>
          <button className="mini" onClick={async () => { try { const txt = await navigator.clipboard.readText(); doLoadCode(txt); } catch(e) { setToast('Clipboard read failed'); } }}>Import</button>
          <button className="mini" onClick={() => { clearSession(); window.location.reload(); }}>Reset</button>
        </div>
        <div className="header-links">
          <a href="https://runelite.net/plugin-hub/Arodab" target="_blank" rel="noreferrer">
            My RuneLite plugins
          </a>
          <a href="https://buymeacoffee.com/arodab" target="_blank" rel="noreferrer">
            Buy me a coffee
          </a>
        </div>
      </header>

      <div className="top-panels">
        <section className="panel">
          <h2>Target</h2>
          <label>
            <span>Monster</span>
            <input
              list="monster-list"
              value={monsterQuery}
              onChange={(e) => setMonsterQuery(e.target.value)}
              placeholder="Search a monster..."
            />
          </label>
          <datalist id="monster-list">
            {monsterOptions.map((m, i) => (
              <option key={`${m.id}-${m.version}-${i}`} value={monsterLabel(m)} />
            ))}
          </datalist>

          {monster && (
            <div className="target-facts">
              <span className="fact"><b>{monster.hp}</b> HP</span>
              <span className="fact"><b>{monster.def}</b> def</span>
              <span className="fact">stab <b>{monster.d.stab}</b></span>
              <span className="fact">slash <b>{monster.d.slash}</b></span>
              <span className="fact">crush <b>{monster.d.crush}</b></span>
              <span className="fact">magic <b>{monster.d.magic}</b></span>
            </div>
          )}
          {drainNote && <div className="warn">{drainNote}</div>}
          {!monster && <div className="warn">Pick a monster from the list to run a comparison.</div>}
        </section>

        <section className="panel">
          <h2>Encounter</h2>
          <div className="row">
            <label>
              <span>Starting spec energy</span>
              <input
                type="number" min={0} max={100} step={5} value={startEnergy}
                onChange={(e) => setStartEnergy(Number(e.target.value))}
              />
            </label>
            <label>
              <span>Trials {kills > 1 && effectiveTrials !== trials ? `(${effectiveTrials.toLocaleString()} trips x ${kills} kills)` : ''}</span>
              <select value={trials} onChange={(e) => setTrials(Number(e.target.value))}>
                <option value={5000}>5,000 (fast)</option>
                <option value={20000}>20,000</option>
                <option value={100000}>100,000 (precise)</option>
              </select>
            </label>
          </div>`n          <div className="row-3">`n            <label>`n              <span>Kills per trip</span>
              <input
                type="number" min={1} max={200} value={kills}
                onChange={(e) => setKills(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label>
              <span>Downtime between kills (s)</span>
              <input
                type="number" min={0} max={600} value={downtimeSeconds}
                onChange={(e) => setDowntimeSeconds(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label>
              <span>Banking time (s, restores spec)</span>
              <input
                type="number" min={0} max={900} value={bankingSeconds}
                onChange={(e) => setBankingSeconds(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox" checked={compareLightbearer}
              onChange={(e) => setCompareLightbearer(e.target.checked)}
            />
            Compare Lightbearer (swaps your ring, doubles spec regen)
          </label>
          <button className="primary" style={{ marginTop: "16px", width: "100%" }} onClick={run} disabled={running || !monster}>{running ? "Simulating..." : "Compare specs"}</button>
        </section>
      </div>

      <div className="layout">
        <div>
          <section className="panel">
            <h2>Your normal setup</h2>
            <div className="tab-bar">
              {(['melee', 'ranged', 'magic'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  className={`tab-btn ${activeTab === t ? 'active' : ''}`}
                  onClick={() => setActiveTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <label>
              <span>Preset</span>
              <select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">Custom</option>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>

            <GearGrid
              gear={gear}
              itemsBySlot={pickerItems}
              onChange={setSlot}
              sharedSlots={sharedSlots}
              onToggleShared={toggleSharedSlot}
              attackType={style.attackType}
              targetAttributes={monster?.attributes ?? []}
            />

            <div className="row-4">
              {(['attack', 'strength', 'ranged', 'magic'] as const).map((k) => (
                <label key={k}>
                  <span>{k.slice(0, 3)}</span>
                  <input
                    type="number" min={1} max={99} value={levels[k]}
                    onChange={(e) => setLevels((l) => ({ ...l, [k]: Number(e.target.value) || 1 }))}
                  />
                </label>
              ))}
            </div>

            <div className="row">
              <label>
                <span>Prayer</span>
                <select value={prayerKey} onChange={(e) => updateTab({ prayerKey: e.target.value, presetId: '' })}>
                  {PRAYER_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>
                <span>Potion</span>
                <select value={potionId} onChange={(e) => updateTab({ potionId: e.target.value, presetId: '' })}>
                  {POTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            </div>

            <div className="row">
              <label>
                <span>Attack style</span>
                <select
                  value={styleIndex}
                  onChange={(e) => updateTab({ styleIndex: Number(e.target.value), presetId: '' })}
                >
                  {styles.map((s, i) => (
                    <option key={`${s.name}-${i}`} value={i}>
                      {s.name} ({s.stance}, {s.type})
                    </option>
                  ))}
                </select>
              </label>
              {needsSpell ? (
                <label>
                  <span>Spell</span>
                  <select value={spellName} onChange={(e) => updateTab({ spellName: e.target.value, presetId: '' })}>
                    <option value="">None</option>
                    {spells.map((s) => (
                      <option key={s.name} value={s.name}>{s.name} ({s.maxHit})</option>
                    ))}
                  </select>
                </label>
              ) : <div />}
            </div>

            <label className="check">
              <input
                type="checkbox" checked={buffs.offTask}
                onChange={(e) => setBuffs({ offTask: e.target.checked })}
              />
              Force off task (slayer helmet does nothing)
            </label>

            <div className="target-facts">
              <span className="fact">max hit <b>{main.maxHit}</b></span>
              <span className="fact">dps <b>{mainDps.toFixed(2)}</b></span>
              <span className="fact">atk roll <b>{main.attackRoll.toLocaleString()}</b></span>
              <span className="fact">speed <b>{main.speed}t</b></span>
            </div>
            {mods.length > 0 && (
              <div className="target-facts">
                {mods.map((m) => <span key={m} className="fact">{m}</span>)}
              </div>
            )}
            {needsSpell && !spell && (
              <div className="warn">Pick a spell - without one this setup has no magic damage.</div>
            )}
          </section>


          <section className="panel">
            <h2>Specs to compare</h2>
            <label className="check" style={{ marginBottom: '10px' }}>
              <input
                type="checkbox" checked={filterSpecs}
                onChange={(e) => setFilterSpecs(e.target.checked)}
              />
              Only show specs matching the current style
            </label>
            <div className="checks">
              {SPECS.filter(s => !filterSpecs || s.type === style.attackType).map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox" checked={enabled.has(s.id)}
                    onChange={() => toggleSpec(s.id)}
                  />
                  {s.name}
                </label>
              ))}
            </div>
            {SPECS.filter((sp) => sp.option).map((sp) => (
              <label key={sp.option!.key} className="check">
                <input
                  type="checkbox"
                  checked={specOptions[sp.option!.key] ?? sp.option!.default}
                  onChange={(e) => setSpecOptions((o) => ({ ...o, [sp.option!.key]: e.target.checked }))}
                />
                {sp.option!.label}
              </label>
            ))}
          </section>

        </div>

        <section className="panel">
          <h2>
            Results {monster ? `- ${monsterLabel(monster)}` : ''}
            {kills > 1 ? ` - trip of ${kills} kills` : ''}
          </h2>
          {showLb && (
            <p className="hint">
              Lightbearer columns replace your ring, so you lose its stats but regenerate spec
              energy twice as fast.
            </p>
          )}
          {!rows && <div className="empty">Pick a target and setup, then hit Compare specs.</div>}
          {rows && (
            <table>
              <thead>
                <tr>
                  <th>Spec</th>
                  <th title="Mean time to kill the target">Kill</th>
                  <th title="Seconds saved per kill versus not speccing at all">Saved</th>
                  {kills > 1 && (
                    <th title="Total time saved across the whole trip, including downtime">Trip</th>
                  )}
                  <th className="bar-cell" />
                  {showLb && <th title="Kill time wearing Lightbearer instead of your ring">LB kill</th>}
                  {showLb && <th title="Seconds the specs save within the Lightbearer setup">LB saved</th>}
                  <th title="Mean number of spec attacks over the whole trip">Casts</th>
                  <th title="Customise the gear this spec switches to" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const spec = SPECS.find((s) => s.id === r.specId);
                  const isBaseline = r.specId === null;
                  const best = !isBaseline && i === 1 && r.secondsSaved > 0;
                  const specItem = spec ? specWeaponItem(spec, equipment) : null;
                  const overrideCount = spec ? Object.keys(switches[spec.id] ?? {}).length : 0;
                  const lb = lbById.get(r.specId);
                  return (
                    <tr key={r.specId ?? 'baseline'} className={isBaseline ? 'baseline' : best ? 'best' : ''}>
                      <td>
                        <div className="spec-cell">
                          {specItem && (
                            <span className="spec-icon" title={spec?.note ?? specItem.name}>
                              <ItemIcon item={specItem} size={24} />
                            </span>
                          )}
                          <span className="spec-name" title={spec?.note ?? undefined}>
                            {r.specName}
                          </span>
                        </div>
                      </td>
                      <td>{r.meanSeconds.toFixed(1)}s</td>
                      <td className={`saved ${r.secondsSaved > 0 ? 'pos' : r.secondsSaved < 0 ? 'neg' : ''}`}>
                        {isBaseline ? '-' : `${r.secondsSaved > 0 ? '+' : ''}${r.secondsSaved.toFixed(1)}s`}
                      </td>
                      {kills > 1 && (
                        <td className={r.tripSecondsSaved > 0 ? 'pos' : r.tripSecondsSaved < 0 ? 'neg' : ''}>
                          {isBaseline
                            ? `${(r.tripSeconds / 60).toFixed(1)}m`
                            : `${r.tripSecondsSaved > 0 ? '+' : ''}${r.tripSecondsSaved.toFixed(0)}s`}
                        </td>
                      )}
                      <td className="bar-cell">
                        {!isBaseline && (
                          <div
                            className={`bar ${r.secondsSaved < 0 ? 'neg' : ''}`}
                            style={{ width: `${(Math.abs(r.secondsSaved) / maxSaved) * 100}%` }}
                          />
                        )}
                      </td>
                      {showLb && <td>{lb ? `${lb.meanSeconds.toFixed(1)}s` : '-'}</td>}
                      {showLb && (
                        <td className={lb && lb.secondsSaved > 0 ? 'pos' : ''}>
                          {lb && !isBaseline
                            ? `${lb.secondsSaved > 0 ? '+' : ''}${lb.secondsSaved.toFixed(1)}s`
                            : '-'}
                        </td>
                      )}
                      <td>{isBaseline ? '-' : r.meanSpecCasts.toFixed(1)}</td>
                      <td>
                        {spec && (
                          <button
                            className="mini"
                            title="Customise the switch for this spec"
                            onClick={() => setEditingSpec(spec)}
                          >
                            switch{overrideCount ? ` (${overrideCount})` : ''}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {editingSpec && (
        <SwitchesModal
          spec={editingSpec}
          baseGear={gear}
          tabs={tabs}
          specWeapon={specWeaponItem(editingSpec, equipment)}
          overrides={switches[editingSpec.id] ?? {}}
          itemsBySlot={switchPickerItems}
          equipment={equipment}
          preview={previewSwitch(editingSpec)}
          targetAttributes={monster?.attributes ?? []}
          onChange={(ov) => setSwitches((s) => ({ ...s, [editingSpec.id]: ov }))}
          onClose={() => setEditingSpec(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}

      <footer>
        Monster and item data from the{' '}
        <a href="https://oldschool.runescape.wiki" target="_blank" rel="noreferrer">OSRS Wiki</a>{' '}
        (CC BY-NC-SA 3.0), via the{' '}
        <a href="https://github.com/weirdgloop/osrs-dps-calc" target="_blank" rel="noreferrer">wiki DPS calculator</a>{' '}
        dataset. Item images are served from the wiki. Not affiliated with Jagex.
      </footer>
    </div>
  );
}

export { itemLabel };





