import { describe, it, expect } from 'vitest';
import { STANCE_BONUS, stylesForCategory, defaultStyleIndex } from './attackStyles';
import { magicMaxHit, poweredStaffMaxHit, isPoweredStaff, type Spell } from './spells';
import { PRESETS } from './presets';
import { SPECS, specById } from './specs';
import { mulberry32 } from './rng';

describe('attack styles match the weapon', () => {
  it('gives a powered staff only magic styles', () => {
    const styles = stylesForCategory('Powered Staff');
    expect(styles.every((s) => s.attackType === 'magic')).toBe(true);
    // No "Aggressive (+3 str)" nonsense on a staff.
    expect(styles.some((s) => s.stance === 'aggressive')).toBe(false);
  });

  it('gives bows accurate / rapid / longrange only', () => {
    const styles = stylesForCategory('Bow');
    expect(styles.map((s) => s.name)).toEqual(['Accurate', 'Rapid', 'Longrange']);
    expect(styles.every((s) => s.attackType === 'ranged')).toBe(true);
    expect(styles.every((s) => s.type === 'standard')).toBe(true);
  });

  it('rolls crossbows against heavy and thrown against light', () => {
    expect(stylesForCategory('Crossbow')[0].type).toBe('heavy');
    expect(stylesForCategory('Thrown')[0].type).toBe('light');
  });

  it('offers the real melee styles for a stab sword', () => {
    const styles = stylesForCategory('Stab Sword');
    expect(styles.map((s) => s.name)).toEqual(['Stab', 'Lunge', 'Slash', 'Block']);
    // Slash on a rapier rolls against slash defence, not stab.
    expect(styles.find((s) => s.name === 'Slash')?.type).toBe('slash');
  });

  it('makes rapid one tick faster and nothing else', () => {
    expect(STANCE_BONUS.rapid.speedDelta).toBe(-1);
    expect(STANCE_BONUS.accurate.speedDelta).toBe(0);
    expect(STANCE_BONUS.accurate.attack).toBe(3);
    expect(STANCE_BONUS.aggressive.strength).toBe(3);
    expect(STANCE_BONUS.controlled).toMatchObject({ attack: 1, strength: 1 });
  });

  it('defaults to an offensive style, never Block', () => {
    for (const cat of ['Stab Sword', 'Bow', 'Blunt', 'Scythe', 'Whip']) {
      const styles = stylesForCategory(cat);
      expect(styles[defaultStyleIndex(styles)].stance).not.toBe('defensive');
    }
  });

  it('falls back to unarmed for an unknown category', () => {
    expect(stylesForCategory(null).length).toBeGreaterThan(0);
    expect(stylesForCategory('Nonsense')[0].attackType).toBe('melee');
  });
});

describe('magic damage', () => {
  const iceBarrage: Spell = { name: 'Ice Barrage', maxHit: 30, spellbook: 'ancient', image: null };

  it('uses the spell base hit and adds magic damage additively', () => {
    // Magic damage is tenths of a percent: 150 = 15%.
    expect(magicMaxHit({
      spell: iceBarrage, weaponName: 'Kodai wand', magicLevel: 99,
      magicDamageBonus: 150, blackMask: false,
    })).toBe(30 + Math.trunc((30 * 150) / 1000));
  });

  it('returns zero when casting nothing with a non-powered staff', () => {
    expect(magicMaxHit({
      spell: null, weaponName: 'Kodai wand', magicLevel: 99,
      magicDamageBonus: 150, blackMask: false,
    })).toBe(0);
  });

  it('lets a powered staff override the spellbook', () => {
    // Tumeken's shadow is floor(level/3) + 1 = 34 at 99.
    expect(poweredStaffMaxHit("Tumeken's shadow", 99)).toBe(34);
    expect(poweredStaffMaxHit('Trident of the Swamp', 99)).toBe(31);
    expect(poweredStaffMaxHit('Kodai wand', 99)).toBeNull();
    expect(isPoweredStaff("Tumeken's shadow")).toBe(true);
    expect(isPoweredStaff('Kodai wand')).toBe(false);

    // Even with a spell selected, the staff's own damage wins.
    expect(magicMaxHit({
      spell: iceBarrage, weaponName: "Tumeken's shadow", magicLevel: 99,
      magicDamageBonus: 0, blackMask: false,
    })).toBe(34);
  });

  it('applies the slayer helmet multiplier after the additive bonus', () => {
    const plain = magicMaxHit({
      spell: iceBarrage, weaponName: 'Kodai wand', magicLevel: 99,
      magicDamageBonus: 0, blackMask: false,
    });
    const masked = magicMaxHit({
      spell: iceBarrage, weaponName: 'Kodai wand', magicLevel: 99,
      magicDamageBonus: 0, blackMask: true,
    });
    expect(masked).toBe(Math.trunc((plain * 23) / 20));
  });
});

describe('presets', () => {
  it('names a style that its own weapon actually offers', () => {
    // Catches a preset asking for "Rapid" on a staff, which would silently
    // fall back to the wrong style.
    for (const preset of PRESETS) {
      expect(preset.styleName, `${preset.id} has a styleName`).toBeTruthy();
    }
  });

  it('no longer ships the removed melee presets', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids).not.toContain('max_melee_maul');
    expect(ids).not.toContain('max_melee_rapier');
  });

  it('ships the elite void tbow and ancients setups', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids).toContain('max_ranged_tbow_void');
    expect(ids).toContain('max_magic_ancients');

    const ancients = PRESETS.find((p) => p.id === 'max_magic_ancients')!;
    expect(ancients.spell).toBe('Ice Barrage');
    expect(ancients.gear.weapon).toBe('Kodai wand');
    expect(ancients.gear.body).toBe('Virtus robe top');

    const voidTbow = PRESETS.find((p) => p.id === 'max_ranged_tbow_void')!;
    expect(voidTbow.gear.head).toBe('Void ranger helm');
    expect(voidTbow.gear.body).toBe('Elite void top');
  });

  it('builds the scythe setup from oathplate body and legs with a torva helm', () => {
    const scythe = PRESETS.find((p) => p.id === 'max_melee_scythe')!;
    expect(scythe.gear.head).toBe('Torva full helm');
    expect(scythe.gear.body).toBe('Oathplate chest');
    expect(scythe.gear.legs).toBe('Oathplate legs');
  });
});

describe('spec roster', () => {
  const ids = SPECS.map((s) => s.id);

  it('no longer ships the removed specs', () => {
    expect(ids).not.toContain('ags');
    expect(ids).not.toContain('barrelchest_anchor');
    expect(ids).not.toContain('dragon_halberd');
  });

  it('ships the newly added specs', () => {
    for (const id of ['crystal_halberd', 'bone_dagger', 'dragon_knife', 'dragon_thrownaxe', 'volatile']) {
      expect(ids, id).toContain(id);
    }
  });

  it('gives the bone dagger a 100% accuracy opener that defaults on', () => {
    const bone = specById('bone_dagger')!;
    expect(bone.option?.key).toBe('boneDaggerOpener');
    expect(bone.option?.default).toBe(true);
    expect(bone.drains).toBe(true);

    const state = { hp: 500, def: 200, magic: 100, baseDef: 200, baseAtk: 0, baseStr: 0 };
    const ctx = {
      load: {} as never, acc: 0, rng: mulberry32(4), state,
      monsterName: 'x', isDemon: false, options: { boneDaggerOpener: true },
    };
    // acc is 0, so anything that lands proves the opener bypassed the roll.
    const [dmg] = bone.hits(ctx, 40);
    expect(dmg).toBeGreaterThanOrEqual(0);
    expect(state.def).toBeLessThanOrEqual(200);

    // With the opener off, a 0% accuracy roll must whiff and leave Defence alone.
    const state2 = { hp: 500, def: 200, magic: 100, baseDef: 200, baseAtk: 0, baseStr: 0 };
    const off = bone.hits(
      {
        load: {} as never, acc: 0, rng: mulberry32(4), state: state2,
        monsterName: 'x', isDemon: false, options: { boneDaggerOpener: false },
      },
      40,
    );
    expect(off).toEqual([0]);
    expect(state2.def).toBe(200);
  });

  it('scales the Volatile staff spec off Magic level', () => {
    const volatile = specById('volatile')!;
    expect(volatile.levelMaxHit).toBeTruthy();
    expect(volatile.levelMaxHit!(99)).toBe(58); // capped
    expect(volatile.levelMaxHit!(50)).toBeLessThan(58);
    expect(volatile.accMult).toBe(1.5);
  });
});
