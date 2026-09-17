# SpecScape

Compare OSRS special attacks by the only thing that actually matters: **how much time
each one saves you**.

Existing DPS tools tell you what a spec hits for. They don't tell you whether a
defence-draining spec beats a Voidwaker, or whether a big slow spec is worth losing
main-weapon attacks for. SpecScape answers that directly.

## The model

A spec is worth using only if the damage it adds beats what your main weapon would
have done during the ticks it costs.

- **Damage specs** (Voidwaker, claws): `gain = E[spec damage] - mainDPS x specSpeed`.
  A slow, hard-hitting spec can lose outright to a fast main weapon.
- **Defence drains** (DWH, Elder maul, BGS, Arclight): the payoff is spread across the
  rest of the kill, *and* the drain shortens the kill, which shrinks the window it pays
  back over. That feedback loop has no clean closed form.

So instead of a formula, SpecScape runs a **tick-by-tick Monte Carlo of the whole kill**
under each spec, and compares it against a no-spec baseline. That naturally captures the
things closed-form calculators miss:

- **Overkill waste** - a Voidwaker spec into a 90 HP target throws away half its damage.
- **Defence floors** - Nex floors at 250 Defence, so drains barely move it. Vardorvis and
  Verzik can't be drained at all.
- **Spec energy as a budget** - energy regenerates 10% per 50 ticks (doubled by Lightbearer),
  so cheap specs can be used more often.
- **Accuracy asymmetry** - the Dragon warhammer gets *no* accuracy bonus while godswords get
  2x, which is exactly why "just DWH it" is often wrong against high-Defence targets.
- **Drains that miss** - every drain rolls accuracy first and only reduces Defence on a hit,
  re-rolled each cast against the already-drained Defence, so a second hammer is more likely
  to land than the first. The Bandos godsword drains by the damage that cast actually rolled,
  not by an average, so a low roll really does strip less.

Results are reported as **seconds saved per kill**, and the table re-runs automatically when
you change anything - otherwise the headings update instantly while the numbers still come
from the previous run, which quietly shows single-kill results under a "trip of 10 kills"
heading.

### When specs get used

Defence drains are restricted to the **opening of a fight**: once the main weapon swings, a
drain has no kill left to pay back over, so casting one later is a loss. Damage specs stay
greedy and fire whenever the energy is there. This is set per spec via `policy` in
`src/sim/specs.ts` and defaults from whether the spec drains.

### Lightbearer comparison

Lightbearer is a real trade: you give up your ring's stats to regenerate spec energy twice
as fast. The results table runs both setups side by side. **LB kill** is the kill time with
Lightbearer on - compare it against **Kill** to see whether the trade pays. **LB saved**
shows how much the specs gain *within* the Lightbearer setup, which is usually larger than
in the normal one, and is exactly the tension worth seeing: more spec uptime bought with a
worse baseline.

### Trip mode

Set kills per trip above 1 and the sim runs consecutive kills, carrying spec energy across
them and regenerating through the downtime you specify. **Casts** is the total for the whole
trip, not a per-kill average, because "8 casts over the trip" is what tells you whether a
spec is affordable.

**Banking time** is optional and closes the trip. You are assumed to return with full special
attack energy, so unlike downtime it is not a regeneration window - it is dead time on the
clock. It is also the same for every spec, so it lengthens the trip without changing the
ranking; it is there to make trip durations realistic. This is what decides whether an
expensive spec is affordable every kill or only some of them, and it routinely reorders the
table: over 20 Vorkath kills the Zaryte crossbow drops from 1st to 3rd purely because at 75%
energy it fires 0.4 times per kill against the Voidwaker's 0.7.

### Spec switches

A spec swap keeps the rest of your gear and only changes the weapon - which is
exactly why speccing a Zaryte crossbow out of a max melee setup is a bad idea: it
rolls ranged accuracy with no ranged bonus and no Rigour. The **switch** button on
each results row opens the gear grid for that spec, shows its live max hit, attack
roll and hit chance against the current target, and warns when the spec lands under
35% of the time. Anything you change there (ammo, an amulet, whatever you would
really swap) is used for that spec's simulation only.

### Multipliers

Salve, slayer helmet, void and crystal armour are **detected from what you have equipped** -
there are no toggles to forget. Salve on your neck applies to undead targets, a slayer helmet
on your head applies to slayer-assignable monsters, a complete void set applies to its own
attack type, and crystal armour applies alongside a crystal bow. Salve and the slayer helmet
do not stack (salve wins). Elite void is distinguished from regular: +12.5% ranged damage
rather than +10%.

The only thing you still say by hand is **"force off task"**, because that is the one fact
the gear cannot tell us. The panel lists which modifiers actually fired, including any that
are inactive and why.

### Attack styles

Style options come from the equipped weapon's category, so a staff never offers
"Aggressive (+3 str)" and a bow only offers Accurate / Rapid / Longrange. The chosen style
also decides which defence stat you roll against - Slash on a rapier rolls slash, not stab -
and Rapid correctly shaves a tick off the weapon's attack speed.

### Magic

Magic does not use the strength formula at all. The base hit comes from the spell you cast
or, for a powered staff, from that staff's own Magic-level formula, and the magic damage
bonus is then applied additively in tenths of a percent. A powered staff overrides the
spellbook, so the spell picker only appears when it would actually change something.

These interact in ways worth seeing: a salve (ei) on Vorkath boosts your main weapon and
every melee spec by 20%, but does nothing for the Zaryte crossbow's percent-of-HP ruby proc -
so turning salve on drops ZCB from 1st to 4th.

## Running it

```bash
npm install
npm run data     # fetch monster + item data (writes public/data/)
npm run dev
```

Other commands:

```bash
npm test         # engine unit + integration tests
npm run build    # static production build into dist/
```

`npm run data` must be run at least once before `dev` or `build`, and re-run whenever
you want to pick up game updates.

### Finding gear

Clicking a slot opens a picker that **sorts by the strength stat matching your equipped
style** by default - melee strength for a scythe, ranged strength for a bow, magic damage for
a staff - so the list opens as a best-in-slot lookup. You can re-sort by any of the five
attack bonuses instead, with the value shown next to each item.

Ammo is filtered to what the equipped weapon can actually fire - arrows for bows, bolts for
crossbows, javelins for ballistae, darts for the blowpipe - and equipping a weapon swaps in
that weapon's usual ammo rather than leaving the slot empty.

**Bane weapons are pinned to the top** when the selected target qualifies, badged with what
they do. Against Vorkath the three dragon hunter weapons sit above everything else, because a
bane bonus beats almost any generic upgrade. The bonuses are applied to the simulation too, so
the numbers match: Arclight is +70% accuracy and damage against demons, the dragon hunter
crossbow +30% accuracy / +25% damage against dragons, and so on for kalphitebane, golembane,
leafy and vampyrebane gear.

### Remembering where you left off

The working configuration - target, gear, levels, prayer, style, spell, spec switches and
encounter settings - is written to `localStorage` under `specscape.session.v1` and restored
on your next visit. A first-time visitor gets **Vorkath (Post-quest)** with the max melee
fang setup. **Reset** forgets it and returns to that default.

This is separate from named saved setups: one is "where you left off", the other is a
library you choose from.

### Saved setups and share codes

Setups save to `localStorage` under `specscape.setups.v1`. Gear is stored as name +
version references rather than whole item records, so a saved setup survives a data
refresh. All storage access is wrapped in try/catch - private mode or blocked site data
degrades to "nothing saved" rather than breaking the page.

**Copy code** turns the whole configuration into one short string - about 150 characters
for a full loadout - that pastes straight into Discord. The payload is a pipe-delimited
record rather than JSON (JSON's keys and quoting roughly tripled the length), item ids are
base36, and only values that differ from the defaults are stored. Specs are recorded by
which ones are *disabled*, so the usual "everything on" case costs nothing and a code keeps
working when the spec roster changes.

### Deploying

The build is fully static with no backend. `vite.config.ts` defaults `base` to
`/specscape/` for GitHub Pages project sites; override it for a root domain:

```bash
BASE=/ npm run build
```

In Git Bash prefix that with `MSYS_NO_PATHCONV=1`, which otherwise rewrites a bare `/` into a
Windows path. Note `base` is deliberately not conditional on the Vite command: `vite preview`
runs as `serve`, so a conditional base makes preview serve paths the built `index.html` never
asks for.

## Layout

```
src/sim/          pure simulation engine, no UI dependencies
  combat.ts       accuracy, defence rolls, max hit
  specs.ts        spec attack registry (damage, accuracy, drain effects)
  simulate.ts     Monte Carlo kill simulation
  defenceFloors.ts per-boss drain floors and immunities
  loadout.ts      levels + prayers + gear -> attack roll / max hit
  attackStyles.ts per-weapon-category style tables and stance bonuses
  spells.ts       spell base hits and powered-staff damage formulas
  gear.ts         equipment aggregation
  presets.ts      curated meta setups
  modifiers.ts    salve / slayer helm / void / crystal, resolved against the target
src/ui/
  build.ts        turns the UI's gear + buffs into simulator loadouts
  GearGrid.tsx    in-game equipment layout, item icons and the item picker
  SwitchesModal.tsx  per-spec switch editor with a live accuracy readout
  setups.ts       localStorage save/load plus JSON import/export
src/worker/       runs the Monte Carlo off the main thread
scripts/          data fetch + scratch harnesses
```

The engine is deliberately free of UI imports so it can be tested directly, and
`scripts/scenario.ts` prints comparison tables straight to the terminal:

```bash
npx vite-node scripts/scenario.ts
```

## Accuracy of the numbers

Combat formulas follow the OSRS Wiki's documented mechanics (originally derived from
Bitterkoekje's spreadsheet). Integer truncation order is preserved, since moving a
`floor()` shifts max hits by 1.

Spec multipliers, defence-drain percentages and drain floors were cross-checked against
the wiki's own DPS calculator behaviour. The engine is an independent implementation -
no calculator code is vendored.

Presets are best-in-slot by the stat that matters, checked against the data rather than
from memory: Amulet of rancour over torture, Avernic treads over primordials/pegasians/
eternals, Necklace of rupture over anguish, Confliction gauntlets over tormented.

The data build collapses item `version` variants whose stats are byte-identical (Normal /
Locked / Broken), so the pickers are not full of duplicates. Variants that genuinely
differ - Charged vs Uncharged, and the Avernic treads attachment tiers - are kept, and
item icons come from the wiki image for the normal variant.

It also drops gear with no offensive stats at all - cosmetics, holiday and quest items -
taking the pickers from 5,436 entries down to about 2,200. There is a deliberate exception
list: the void sets, salve amulets, black masks, crystal armour and **Lightbearer** all have
blank offensive bonuses but drive real modifiers, so removing them would silently break the
elite void preset and the Lightbearer comparison. `src/sim/data.test.ts` asserts that every
item the engine references by name - modifiers, spec weapons and presets - survives the
filter, so the two cannot drift apart.

Note this also removes purely defensive gear, because the simulation models player damage
only and never rolls the monster's attacks.

Two further passes cut the pickers to around 2,000 entries:

- **Gear from other game modes** - Deadman, Leagues/Trailblazer, beta and tournament
  variants - is dropped, since none of it can be used in the main game.
- **Cosmetic name variants** are collapsed into their base item: `(or)` ornament kits,
  `(g)`/`(t)` trim, `(wrapped)`, `(l)` and so on, but *only when the stats match exactly*.
  Anything that is really an upgrade survives, which is why `Slayer helmet (i)` (+3 ranged
  over the plain one) and `Abyssal dagger (bh)` (+10 stab) are still listed. Suffixes that
  denote real upgrades - `(i)`, `(f)`, `(c)`, `(e)`, and the Avernic treads attachment tiers
  - are never collapsed, because some of them are offensively identical to their base item
  yet are the item players actually mean.

### Known gaps

- Magic shortbow, ballistae and the Eldritch staff are not in the spec registry yet.
- The Bone dagger and Dragon thrownaxe specs are unimplemented in the wiki's own calculator,
  so unlike every other spec here they are built from the wiki's written mechanics with no
  reference implementation to check against. The thrownaxe's real value is bouncing between
  targets, which this single-target simulation does not model at all.
- The Zaryte crossbow spec assumes ruby bolts (the usual boss setup) and does not model the
  10% self-damage the proc costs you. Diamond bolts are not offered as an alternative.
  The proc is guaranteed only on a landed hit, so the spec still rolls accuracy normally.
- Dark bow assumes dragon arrows.
- Toxic blowpipe dart strength isn't modelled specially.
- Obsidian, Inquisitor's, dragon hunter gear, demonbane damage and Twisted bow / Tumeken's
  scaling are not applied.
- The simulation is player-damage only: it ignores incoming damage, supplies, prayer drain
  and death, so it answers "what kills fastest", not "what is safest".
- The Bandos godsword's drain does not cascade past Defence into Strength/Attack/Magic/Ranged
  the way it does in game. Nothing downstream reads those stats, so it cannot change a result.
- Demonbane vulnerability scaling (some bosses take a reduced demonbane bonus) is not applied.

## Data and licensing

Monster and item data comes from the [OSRS Wiki](https://oldschool.runescape.wiki),
via the dataset published with the
[wiki DPS calculator](https://github.com/weirdgloop/osrs-dps-calc).
Wiki content is **CC BY-NC-SA 3.0** - attribution is required and commercial use is not
permitted.

The wiki calculator itself is GPL-3.0. SpecScape does not include any of its code.

Not affiliated with Jagex. Old School RuneScape is a trademark of Jagex Ltd.
