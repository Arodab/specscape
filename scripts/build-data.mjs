/**
 * Fetches monster + equipment data from the OSRS Wiki DPS calculator CDN and
 * slims it to the fields SpecScape actually simulates.
 *
 * Data is wiki content (CC BY-NC-SA 3.0) - see README attribution.
 * Run with: npm run data
 */
import { writeFile, mkdir } from 'node:fs/promises';

const BRANCH = 'main'; // note: the `master` branch of this repo is stale
const CDN = `https://raw.githubusercontent.com/weirdgloop/osrs-dps-calc/${BRANCH}/cdn/json`;
const OUT = new URL('../public/data/', import.meta.url);

const get = async (name) => {
  const res = await fetch(`${CDN}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
};

/** Monsters worth simulating: they must be killable and have HP. */
const usableMonster = (m) =>
  m.skills?.hp > 0 && m.defensive && m.name && !/^(Null|Dummy)/i.test(m.name);

const slimMonster = (m) => ({
  id: m.id,
  name: m.name,
  version: m.version || null,
  size: m.size ?? 1,
  speed: m.speed ?? 4,
  hp: m.skills.hp,
  def: m.skills.def,
  magic: m.skills.magic,
  // defensive bonuses; `standard/light/heavy` are the post-rework ranged defences
  d: {
    stab: m.defensive.stab ?? 0,
    slash: m.defensive.slash ?? 0,
    crush: m.defensive.crush ?? 0,
    magic: m.defensive.magic ?? 0,
    standard: m.defensive.standard ?? 0,
    light: m.defensive.light ?? 0,
    heavy: m.defensive.heavy ?? 0,
  },
  flatArmour: m.defensive.flat_armour ?? 0,
  attributes: m.attributes ?? [],
  // Needed for the slayer helmet bonus, which only applies to assigned monsters.
  isSlayerMonster: !!m.is_slayer_monster,
});

const slimEquipment = (e) => ({
  id: e.id,
  name: e.name,
  slot: e.slot,
  version: e.version || null,
  speed: e.speed ?? null,
  category: e.category || null,
  twoHanded: !!e.isTwoHanded,
  image: e.image || null,
  o: {
    stab: e.offensive?.stab ?? 0,
    slash: e.offensive?.slash ?? 0,
    crush: e.offensive?.crush ?? 0,
    magic: e.offensive?.magic ?? 0,
    ranged: e.offensive?.ranged ?? 0,
    // Strength bonuses live under `bonuses`, not `offensive`.
    str: e.bonuses?.str ?? 0,
    ranged_str: e.bonuses?.ranged_str ?? 0,
    magic_str: e.bonuses?.magic_str ?? 0,
  },
});

/**
 * Many items ship several `version` variants that are purely cosmetic or
 * state labels - Normal / Locked / Broken - with byte-identical stats. Those
 * only clutter the pickers, so collapse them into a single unversioned entry.
 *
 * Variants that genuinely differ (Charged vs Uncharged, and the Avernic treads
 * attachment tiers) have different stats, so they survive this untouched.
 */
const collapseIdenticalVersions = (items) => {
  const signature = (e) =>
    JSON.stringify([e.slot, e.speed, e.category, e.twoHanded, e.o]);

  const byName = new Map();
  for (const item of items) {
    const list = byName.get(item.name);
    if (list) list.push(item);
    else byName.set(item.name, [item]);
  }

  const out = [];
  for (const group of byName.values()) {
    if (group.length === 1) {
      // A lone variant's label disambiguates nothing, so drop it too.
      out.push({ ...group[0], version: null });
      continue;
    }
    const first = signature(group[0]);
    const allSame = group.every((g) => signature(g) === first);
    if (allSame) {
      // Keep the normal variant's artwork rather than a broken/locked reskin.
      const rank = (g) => {
        const v = (g.version ?? '').toLowerCase();
        const img = (g.image ?? '').toLowerCase();
        let score = 0;
        if (v && v !== 'normal') score += 2;
        if (/\((l|broken|inactive|uncharged)\)/.test(img)) score += 4;
        if (!g.image) score += 1;
        return score;
      };
      const best = [...group].sort((a, b) => rank(a) - rank(b))[0];
      out.push({ ...best, version: null });
    } else {
      out.push(...group);
    }
  }
  return out;
};

/**
 * Items with no offensive stats at all are cosmetics, quest junk and holiday
 * gear - none of it affects a DPS comparison, and it drowns the pickers.
 *
 * The exception is gear the engine keys on *by name* rather than by stats:
 * the void sets, salve amulets, black masks, crystal armour and Lightbearer all
 * have blank offensive bonuses but drive real modifiers. Dropping them would
 * silently break the elite void preset and the Lightbearer comparison, so they
 * are kept explicitly. `src/sim/data.test.ts` asserts nothing the engine
 * references ever goes missing from the shipped data.
 */
const KEEP_WITHOUT_STATS = [
  /^Lightbearer$/,
  /^Void /,
  /^Elite void /,
  /^Crystal (helm|body|legs)$/,
  /^Salve amulet/,
  /^Black mask/,
  /^Slayer helmet/,
  /^Oathplate slayer helmet/,
];

const hasOffensiveStats = (e) => Object.values(e.o).some((v) => v !== 0);

const isUseful = (e) =>
  hasOffensiveStats(e) || KEEP_WITHOUT_STATS.some((re) => re.test(e.name));

/**
 * Gear that belongs to a separate game mode and cannot be used in the main game.
 */
const UNUSABLE_PATTERNS = [
  /deadman/i,
  /trailblazer|shattered relic| league /i,
  /\(beta\)|tournament/i,
  /wilderness champion/i,
];

const isUsableInMainGame = (e) =>
  !UNUSABLE_PATTERNS.some((re) => re.test(e.name) || (e.version && re.test(e.version)));

/**
 * Purely cosmetic name suffixes, as a plain regex literal so there is no
 * template-literal escaping to get wrong. These are collapsed into the base
 * item, but only when the stats match exactly, so nothing that is actually an
 * upgrade is lost.
 *
 * Deliberately NOT listed: (i) imbued, (f) fortified, (c)/(e) charged or
 * enchanted, and the Avernic treads attachment tiers (pr)/(et)/(pe)/(max). Some
 * of those are offensively identical to their base item - Masori mask (f) is -
 * but they are the item players actually mean, so they stay.
 */
const COSMETIC_SUFFIX_RE = /^(.*) \((or|g|t|s|wrapped|bh|l|cr|lg|sk)\)$/i;

const statSignature = (e) => JSON.stringify([e.slot, e.speed, e.o]);

/** Drop "Item (or)" when plain "Item" exists with identical stats. */
const collapseCosmeticVariants = (items) => {
  const byName = new Map(items.map((e) => [e.name, e]));
  return items.filter((e) => {
    const m = e.name.match(COSMETIC_SUFFIX_RE);
    if (!m) return true;
    const base = byName.get(m[1]);
    return !(base && statSignature(base) === statSignature(e));
  });
};

async function getCategory(cat) {
  const pages = [];
  let cmcontinue = '';
  while (true) {
    const res = await fetch(`https://oldschool.runescape.wiki/api.php?action=query&list=categorymembers&cmtitle=${cat}&cmlimit=500&format=json&cmcontinue=${cmcontinue}`);
    const d = await res.json();
    pages.push(...d.query.categorymembers.map((x) => x.title));
    if (!d.continue) break;
    cmcontinue = d.continue.cmcontinue;
  }
  return pages;
}

const main = async () => {
  await mkdir(OUT, { recursive: true });

  const [monsters, equipment, spells, bosses, cox, tob, toa] = await Promise.all([
    get('monsters.json'),
    get('equipment.json'),
    get('spells.json'),
    getCategory('Category:Bosses'),
    getCategory('Category:Chambers_of_Xeric'),
    getCategory('Category:Theatre_of_Blood'),
    getCategory('Category:Tombs_of_Amascut')
  ]);

  const keepSet = new Set([...bosses, ...cox, ...tob, ...toa].map(x => x.toLowerCase()));

  const baseMonsters = monsters
    .filter(usableMonster)
    .filter((x) => x.is_slayer_monster || keepSet.has(x.name.toLowerCase()))
    .map(slimMonster);

  /**
   * The Doom of Mokhaiotl's "Melee Punish" window drops its defence roll to 15%
   * against crush styles. There is no phase concept in this data, so each delve
   * gets a second selectable entry with the flag set.
   */
  const punishVariants = baseMonsters
    .filter((x) => /^Doom of Mokhaiotl$/i.test(x.name))
    .map((x) => ({
      ...x,
      version: `${x.version ?? 'Default'} (Melee Punish)`,
      meleePunish: true,
    }));

  const m = [...baseMonsters, ...punishVariants];
  const e = collapseIdenticalVersions(
    equipment.filter((x) => x.name && x.slot).map(slimEquipment),
  ).filter(isUseful).filter(isUsableInMainGame);
  const eFinal = collapseCosmeticVariants(e);

  const sp = spells.map((x) => ({
    name: x.name,
    maxHit: x.max_hit,
    spellbook: x.spellbook,
    image: x.image || null,
  }));

  await writeFile(new URL('spells.json', OUT), JSON.stringify(sp));
  await writeFile(new URL('monsters.json', OUT), JSON.stringify(m));
  await writeFile(new URL('equipment.json', OUT), JSON.stringify(eFinal));

  console.log(`monsters: ${m.length} (from ${monsters.length})`);
  console.log(`equipment: ${eFinal.length} (from ${equipment.length})`);
  console.log(`spells: ${sp.length}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
