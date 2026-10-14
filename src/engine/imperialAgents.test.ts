import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { abilityRule, abilityStatus, DET_RULES, incomingFor, modelDefence, unitFlags, unitGrants } from './effects';
import { buildUnits, listPoints, validateList } from './army';
import { botAct } from './bot';
import { applyDetachmentStratagem, stratRule } from './stratagems';
import { canEmbarkIn, createGame, deployUnit, endRedeploy, findPlacement, formationAt, placeUnit, redeployCandidates, redeployUnit, validatePlacement } from './game';
import { detChoices, pickDetChoice } from './detachments';
import { buildShootPools } from './attack';
import { d6 } from './dice';
import { addTimed } from './effects';
import { engagedEnemies, notifyAbilityCpGain, unitDistance } from './state';
import type { FactionData, UnitState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const AoI = load('AoI');

describe('Imperial Agents rule coverage', () => {
  it('every army rule and detachment has an engine rule', () => {
    const missing = [
      ...AoI.armyRules.map((r) => r.name),
      ...AoI.detachments.map((d) => d.name),
    ].filter((name) => !DET_RULES[name]);
    expect(missing).toEqual([]);
  });

  it('automatically resolves implemented Aquila Kill Team and Veiled Blade rules', () => {
    const probe = { sources: ['Aquila Kill Team'], abilities: [], models: [] } as unknown as UnitState;
    for (const name of ['Kill Team', 'Death to the Alien', 'Astartes Shield']) {
      expect(abilityStatus(probe, { name, type: 'Datasheet', text: '', sheet: 'Aquila Kill Team', faction: AoI.id }).status).toBe('auto');
    }
    expect(abilityStatus(probe, { name: 'Micromelta Rounds', type: 'Enhancement', text: '', sheet: 'Vindicare Assassin', faction: AoI.id }).status).toBe('auto');
  });

  it('registers the implemented Imperial Agents enhancements', () => {
    const supported = [
      'Blackweave Shroud', 'Universal Anathema', 'Ignis Judicium', 'Witch Hunter', 'Daemon Slayer',
      'Beacon Angelis', 'Fleetmaster', 'Formidable Resolve', 'Grimoire of True Names (Aura)', 'No Escape (Aura)',
      'Intraneural Biotech',
    ];
    const partial = ['Clandestine Operation', 'Combat Landers', 'Digital Weapons'];
    const probe = { sources: ['Inquisitor'], abilities: [], models: [] } as unknown as UnitState;
    for (const name of supported) {
      expect(abilityStatus(probe, { name, type: 'Enhancement', text: '', sheet: 'Inquisitor', faction: AoI.id }).status).toBe('auto');
    }
    for (const name of partial) {
      expect(abilityStatus(probe, { name, type: 'Enhancement', text: '', sheet: 'Inquisitor', faction: AoI.id }).status).toBe('partial');
    }
  });

  it('accounts for every Imperial Agents enhancement', () => {
    const unregistered = AoI.detachments.flatMap((detachment) => detachment.enhancements)
      .filter((enhancement) => {
        const probe = { sources: ['Inquisitor'], abilities: [], models: [] } as unknown as UnitState;
        return abilityStatus(probe, {
          name: enhancement.name, type: 'Enhancement', text: enhancement.text, sheet: 'Inquisitor', faction: AoI.id,
        }).status === 'none';
      }).map((enhancement) => enhancement.name);
    expect(unregistered).toEqual([]);
  });

  it('enforces Shadow Assignment Warlord and duplicate Assassin restrictions', () => {
    const list = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: [],
      units: [
        { uid: 'v1', datasheet: 'Vindicare Assassin', models: 1, pts: 80, warlord: true },
        { uid: 'v2', datasheet: 'Vindicare Assassin', models: 1, pts: 80 },
      ],
    };
    const errors = validateList(list, AoI, { points: 1000, dp: 0, unitLimit: 3, enhancements: 3 });
    expect(errors).toContain('SHADOW ASSIGNMENT: no more than one Vindicare Assassin');
    expect(errors).toContain('Vindicare Assassin cannot be your Warlord');
  });

  it('redeploys up to D3 Imperium Battleline units with Warrant of Trade', () => {
    const own = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: [],
      units: [
        { uid: 'trader', datasheet: 'Rogue Trader Entourage', models: 4, pts: 95, warlord: true },
        { uid: 'breachers', datasheet: 'Imperial Navy Breachers', models: 10, pts: 90 },
        { uid: 'vigilants', datasheet: 'Vigilant Squad', models: 10, pts: 105 },
        { uid: 'deathwatch', datasheet: 'Deathwatch Kill Team', models: 5, pts: 100 },
      ],
    };
    const enemy = {
      name: 'Orks', factionId: 'ORK', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'boyz', datasheet: 'Boyz', models: 10, pts: 90 }],
    };
    const state = createGame({
      lists: [own, enemy], factions: [AoI, load('ORK')], names: ['A', 'B'], seed: 42,
    });
    state.bots = [1];
    let steps = 0;
    while (state.phase === 'deploy' && !state.redeploy && steps++ < 50) {
      if (state.deployTurn === 1) { botAct(state); continue; }
      const unit = state.units.find((candidate) => candidate.owner === 0 && candidate.status === 'pending')!;
      expect(deployUnit(state, unit.id, findPlacement(state, unit, 'deploy')!)).toMatchObject({ ok: true });
    }
    expect(state.redeploy?.source).toBe('Warrant of Trade');
    expect(state.redeploy!.left).toBeGreaterThanOrEqual(1);
    expect(state.redeploy!.left).toBeLessThanOrEqual(3);
    const candidates = redeployCandidates(state);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((unit) => unit.keywords.includes('BATTLELINE') && unit.keywords.includes('IMPERIUM'))).toBe(true);
    const breachers = candidates.find((unit) => unit.sources.includes('Imperial Navy Breachers'))!;
    expect(redeployUnit(state, breachers.id, true)).toBeNull();
    expect(breachers.status).toBe('reserves');
    expect(endRedeploy(state)).toBeNull();
    expect(state.phase).not.toBe('deploy');
  });

  it('rolls the correct number of dice for multi-die abilities', () => {
    const probe = { sources: ['Corvus Blackstar'], abilities: [], models: [] } as unknown as UnitState;
    const rule = abilityRule(probe, {
      name: 'Blackstar Cluster Launcher', type: 'Datasheet', text: '', sheet: 'Corvus Blackstar', faction: AoI.id,
    });
    expect(rule?.act).toMatchObject({ when: 'endOfNormalMove', rollCount: 6, each: { on: 5 } });

    const culexus = { sources: ['Culexus Assassin'], abilities: [], models: [] } as unknown as UnitState;
    const emergence = abilityRule(culexus, {
      name: 'Etheric Emergence', type: 'Datasheet', text: '', sheet: 'Culexus Assassin', faction: AoI.id,
    });
    expect(emergence?.effects).toContainEqual({ deepStrikeRange: 6 });

    const rogueTrader = { sources: ['Rogue Trader Entourage'], abilities: [], models: [] } as unknown as UnitState;
    const backroomDeals = abilityRule(rogueTrader, {
      name: 'Backroom Deals', type: 'Datasheet', text: '', sheet: 'Rogue Trader Entourage', faction: AoI.id,
    });
    expect(backroomDeals?.act).toMatchObject({
      when: 'formation',
      target: { units: ['ROGUE TRADER ENTOURAGE'], count: 1 },
      do: [{ on: 'target', buff: [{ scope: 'led', infiltrators: true }], until: 'battle' }],
    });
  });

  it('automates supported attacks and stun effects for Agents stratagems', () => {
    const find = (name: string) => AoI.detachments.flatMap((detachment) => detachment.stratagems)
      .find((stratagem) => stratagem.name === name)!;
    const shooting = stratRule(find('CLOSE-QUARTERS BARRAGE'), AoI.id, 'Imperialis Fleet');
    expect(shooting.status).toBe('auto');
    expect(shooting.effects).toContainEqual(expect.objectContaining({ strength: 1, ap: 1 }));

    const stun = stratRule(find('STUN GRENADES'), AoI.id, 'Ordo Hereticus Purgation Force');
    expect(stun.status).toBe('auto');
    expect(stun.enemyEffects).toContainEqual(expect.objectContaining({ hit: -1 }));
    expect(stun.do).toContainEqual(expect.objectContaining({ shock: 0, on: 'target' }));

    const adaptive = stratRule(find('ADAPTIVE TACTICS'), AoI.id, 'Ordo Xenos Alien Hunters');
    expect(adaptive.status).toBe('auto');
    expect(adaptive.choice?.map((option) => option.label)).toEqual(['Furor Tactics', 'Malleus Tactics', 'Purgatus Tactics']);

    const relocation = stratRule(find('RAPID TACTICAL RELOCATION'), AoI.id, 'Ordo Xenos Alien Hunters');
    expect(relocation.status).toBe('partial');
    expect(relocation.do).toContainEqual({ on: 'self', reserves: true });

    const hexagrammic = stratRule(find('HEXAGRAMMIC WARDS'), AoI.id, 'Ordo Malleus Daemon Hunters');
    expect(hexagrammic.status).toBe('auto');
    expect(hexagrammic.effects).toContainEqual({
      incoming: { abilities: ['hazardous'], psychic: true },
    });

    const orbital = stratRule(find('ORBITAL OVERSIGHT'), AoI.id, 'Veiled Blade Elimination Force');
    expect(orbital.status).toBe('auto');
    expect(orbital.effects).toContainEqual({ targetableWithin: 6, if: ['hasAbility:Lone Operative'] });

    const blind = stratRule(find('BLIND GRENADES'), AoI.id, 'Ordo Hereticus Purgation Force');
    expect(blind.status).toBe('auto');
    expect(blind.effects).toContainEqual({ chargedMinus: 2, if: ['kw:VINDICARE ASSASSIN'] });

    const displacer = stratRule(find('DISPLACER FIELD'), AoI.id, 'Imperialis Fleet');
    expect(displacer.status).toBe('partial');
    expect(displacer.effects).toContainEqual({ defend: { inv: 4 } });

    const own = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: ['Ordo Malleus Daemon Hunters'],
      units: [{ uid: 'coteaz', datasheet: 'Inquisitor Coteaz', models: 1, pts: 75 }],
    };
    const enemy = {
      name: 'Space Marines', factionId: 'SM', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'intercessors', datasheet: 'Intercessor Squad', models: 5, pts: 80 }],
    };
    const state = createGame({
      lists: [own, enemy], factions: [AoI, load('SM')], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    state.phase = 'shooting';
    const malleus = state.units.find((unit) => unit.owner === 0)!;
    const attacker = state.units.find((unit) => unit.owner === 1)!;
    placeUnit(state, attacker, formationAt(attacker, { x: 20, y: 20 }));
    state.lastAct = { unitId: attacker.id, owner: 1, kind: 'attack', turn: state.turn, phase: state.phase, targets: [malleus.id], lost: [], halved: [] };
    const hexStratagem = AoI.detachments.find((detachment) => detachment.name === 'Ordo Malleus Daemon Hunters')!.stratagems
      .find((stratagem) => stratagem.name === 'HEXAGRAMMIC WARDS')!;
    applyDetachmentStratagem(state, 0, hexStratagem, malleus.id);
    expect(incomingFor(state, attacker, attacker.models[0], malleus, 'ranged')).toContainEqual(
      expect.objectContaining({ abilities: ['hazardous'], by: attacker.owner, psychic: true, units: [`id:${attacker.id}`] }),
    );
  });

  it('applies Coteaz’s invulnerable saves against Psychic and Daemon attacks', () => {
    const own = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: [],
      units: [
        { uid: 'agents', datasheet: 'Inquisitorial Agents', models: 5, pts: 100 },
        { uid: 'coteaz', datasheet: 'Inquisitor Coteaz', models: 1, pts: 75, attachTo: 'agents' },
      ],
    };
    const enemy = {
      name: 'Space Marines', factionId: 'SM', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'intercessors', datasheet: 'Intercessor Squad', models: 5, pts: 80 }],
    };
    const sm = load('SM');
    const state = createGame({
      lists: [own, enemy], factions: [AoI, sm], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    const inquisitorialAgents = state.units.find((unit) => unit.sources.includes('Inquisitorial Agents'))!;
    const inquisitor = inquisitorialAgents.models.find((model) => model.source === 'Inquisitor Coteaz')!;
    const attacker = state.units.find((unit) => unit.owner === 1)!;
    attacker.factionKeywords.push('DAEMON');
    expect(modelDefence(state, inquisitorialAgents, inquisitor, 'ranged', true, attacker).inv).toBe(4);
    expect(modelDefence(state, inquisitorialAgents, inquisitor, 'ranged', false, attacker).inv).toBe(4);
    attacker.factionKeywords = attacker.factionKeywords.filter((keyword) => keyword !== 'DAEMON');
    expect(modelDefence(state, inquisitorialAgents, inquisitor, 'ranged', false, attacker).inv).toBe(6);
  });

  it('Wards a controlled objective and prevents enemy Daemons setting up within 6 inches', () => {
    const own = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: ['Ordo Malleus Daemon Hunters'],
      units: [{ uid: 'coteaz', datasheet: 'Inquisitor Coteaz', models: 1, pts: 75 }],
    };
    const enemy = {
      name: 'Orks', factionId: 'ORK', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'boyz', datasheet: 'Boyz', models: 10, pts: 90 }],
    };
    const state = createGame({ lists: [own, enemy], factions: [AoI, load('ORK')], names: ['A', 'B'], seed: 42 });
    const inquisitor = state.units.find((unit) => unit.owner === 0)!;
    const daemon = state.units.find((unit) => unit.owner === 1)!;
    const objective = state.objectives.find((candidate) => candidate.type === 'central')!;
    placeUnit(state, inquisitor, formationAt(inquisitor, { x: objective.x, y: objective.y }));
    objective.controller = 0;
    daemon.status = 'reserves';
    daemon.keywords.push('DAEMON');
    const ritual = AoI.detachments.find((detachment) => detachment.name === 'Ordo Malleus Daemon Hunters')!.stratagems
      .find((stratagem) => stratagem.name === 'RITUAL OF WARDING')!;
    applyDetachmentStratagem(state, 0, ritual, inquisitor.id);
    expect(objective.warded).toBe(0);
    expect(objective.secured).toBe(0);
    const forbiddenSetup = validatePlacement(state, daemon, formationAt(daemon, { x: objective.x + 5, y: objective.y }), 'deepStrike');
    expect(forbiddenSetup.errors.join(' ')).toContain('Warded by your opponent');
  });

  it('refunds CP from opponent ability gains with Spy Network on a 2+', () => {
    const own = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'coteaz', datasheet: 'Inquisitor Coteaz', models: 1, pts: 75 }],
    };
    const enemy = {
      name: 'Space Marines', factionId: 'SM', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'intercessors', datasheet: 'Intercessor Squad', models: 5, pts: 80 }],
    };
    const state = createGame({
      lists: [own, enemy], factions: [AoI, load('SM')], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    const coteaz = state.units.find((unit) => unit.owner === 0)!;
    placeUnit(state, coteaz, formationAt(coteaz, { x: 20, y: 20 }));
    const before = state.players[0].cp;
    const expectedRoll = d6({ rng: state.rng });
    state.players[1].cp += 1;
    notifyAbilityCpGain(state, 1, 1, 'Test ability');
    expect(state.players[0].cp).toBe(before + (expectedRoll >= 2 ? 1 : 0));
    expect(state.log.some((entry) => entry.text.includes('Spy Network') && entry.text.includes(`rolled ${expectedRoll}`))).toBe(true);
  });

  it('allows Line of Fire shots at engaged targets within 12 inches without Blast weapons', () => {
    const own = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: [],
      units: [
        { uid: 'breachers', datasheet: 'Imperial Navy Breachers', models: 5, pts: 100 },
        { uid: 'subductors', datasheet: 'Subductor Squad', models: 10, pts: 100 },
      ],
    };
    const enemy = {
      name: 'Space Marines', factionId: 'SM', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'intercessors', datasheet: 'Intercessor Squad', models: 5, pts: 80 }],
    };
    const sm = load('SM');
    const state = createGame({
      lists: [own, enemy], factions: [AoI, sm], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    state.terrain = state.terrain.filter((terrain) => terrain.objectiveId);
    const breachers = state.units.find((unit) => unit.owner === 0 && unit.sources[0] === 'Imperial Navy Breachers')!;
    const subductors = state.units.find((unit) => unit.sources[0] === 'Subductor Squad')!;
    const intercessors = state.units.find((unit) => unit.owner === 1)!;
    placeUnit(state, breachers, formationAt(breachers, { x: 20, y: 20 }));
    placeUnit(state, subductors, formationAt(subductors, { x: 28, y: 20 }));
    placeUnit(state, intercessors, formationAt(intercessors, { x: 32, y: 20 }));
    state.phase = 'shooting';
    state.active = 0;
    expect(engagedEnemies(state, intercessors).some((unit) => unit.id === subductors.id)).toBe(true);
    expect(unitDistance(breachers, intercessors)).toBeLessThanOrEqual(12);
    expect(buildShootPools(state, breachers.id, intercessors.id, { mode: 'normal' }).error).toMatch(/engaged/);
    addTimed(state, breachers, { e: { shootIntoEngagement: 12 }, label: 'Line of Fire', until: 'phase', by: 0 });
    expect(buildShootPools(state, breachers.id, intercessors.id, { mode: 'normal' }).error).toBeUndefined();
  });

  it('lets Deadshot ignore Lone Operative while the Vindicare shoots', () => {
    const own = {
      name: 'Space Marines', factionId: 'SM', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'intercessors', datasheet: 'Intercessor Squad', models: 5, pts: 80 }],
    };
    const enemy = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'vindicare', datasheet: 'Vindicare Assassin', models: 1, pts: 80 }],
    };
    const state = createGame({
      lists: [own, enemy], factions: [load('SM'), AoI], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    state.terrain = state.terrain.filter((terrain) => terrain.objectiveId);
    state.terrain.forEach((terrain) => { terrain.walls = []; terrain.category = 'exposed'; });
    const intercessors = state.units.find((unit) => unit.owner === 0)!;
    const vindicare = state.units.find((unit) => unit.owner === 1)!;
    placeUnit(state, intercessors, formationAt(intercessors, { x: 20, y: 20 }));
    placeUnit(state, vindicare, formationAt(vindicare, { x: 40, y: 20 }));
    state.phase = 'shooting';
    state.active = 0;
    expect(vindicare.core.loneOperative).toBe(12);
    expect(unitDistance(intercessors, vindicare)).toBeGreaterThan(12);
    expect(buildShootPools(state, intercessors.id, vindicare.id, { mode: 'normal' }).pools).toHaveLength(0);
    addTimed(state, intercessors, { e: { ignoreLoneOperative: true }, label: 'Deadshot', until: 'phase', by: 0 });
    expect(unitFlags(state, intercessors).ignoreLoneOperative).toBe(true);
    expect(buildShootPools(state, intercessors.id, vindicare.id, { mode: 'normal' }).pools.length).toBeGreaterThan(0);
  });

  it('audits remaining Imperial Agents datasheet abilities', () => {
    const missing: string[] = [];
    for (const sheet of AoI.datasheets) {
      const probe = { sources: [sheet.name], abilities: [], models: [] } as unknown as UnitState;
      for (const ability of sheet.abilities) {
        const status = abilityStatus(probe, { ...ability, sheet: sheet.name, faction: AoI.id }).status;
        if (!['auto', 'info', 'core'].includes(status)) missing.push(`${sheet.name}: ${ability.name} (${status})`);
      }
    }
    console.log(missing.join('\n'));
    expect(missing).toEqual([]);
  });
  it('audits remaining Imperial Agents stratagem rules', () => {
    const missing = AoI.detachments.flatMap((detachment) => detachment.stratagems.flatMap((stratagem) => {
      const rule = stratRule(stratagem, AoI.id, detachment.name);
      return rule.status === 'auto' ? [] : [`${detachment.name}: ${stratagem.name} (${rule.status})`];
    }));
    console.log(missing.join('\n'));
    expect(missing).toEqual([]);
  });

  it('exposes the once-per-battle Deathwatch Mission Tactics in Command phase', () => {
    const own = { name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: ['Ordo Xenos Alien Hunters'], units: [{ uid: 'a', datasheet: 'Deathwatch Kill Team', models: 5, pts: 100 }] };
    const enemy = { name: 'Space Marines', factionId: 'SM', battleSize: 'incursion', detachments: [], units: [{ uid: 's', datasheet: 'Intercessor Squad', models: 5, pts: 80 }] };
    const sm = load('SM');
    const state = createGame({
      lists: [own, enemy], factions: [AoI, sm], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    state.phase = 'command';
    state.active = 0;
    const tactics = detChoices(state, 0).find((choice) => choice.rule === 'Ordo Xenos Alien Hunters')!;
    expect(tactics.open).toBe(true);
    expect(tactics.options.map((option) => option.o.id)).toEqual(['furor', 'malleus', 'purgatus']);
    expect(pickDetChoice(state, 0, tactics.rule, ['malleus'])).toBeNull();

    const unit = state.units.find((candidate) => candidate.owner === 0)!;
    const adaptive = state.players[0].detachments.flatMap((detachment) => detachment.stratagems)
      .find((stratagem) => stratagem.name === 'ADAPTIVE TACTICS')!;
    applyDetachmentStratagem(state, 0, adaptive, unit.id, { choice: 0 });
    expect(unitGrants(state, unit, 'sustained hits 1', 'ranged')).toBe(true);
    expect(unitGrants(state, unit, 'lethal hits', 'ranged')).toBe(false);
  });

  it('matches the v1.2 datasheet and Extremis corrections', () => {
    const greyKnights = AoI.datasheets.find((sheet) => sheet.name === 'Grey Knights Terminator Squad')!;
    const rhino = AoI.datasheets.find((sheet) => sheet.name === 'Imperial Rhino')!;
    expect(greyKnights.models[0].T).toBe(6);
    for (const sheet of [greyKnights, rhino]) {
      const stormBolter = sheet.weapons.find((weapon) => weapon.name === 'Storm bolter')!;
      expect(stormBolter.profiles[0]).toMatchObject({ S: 5, AP: -1 });
    }
    for (const name of ['Inquisitor', 'Inquisitor Draxus']) {
      expect(AoI.datasheets.find((sheet) => sheet.name === name)!.leads).not.toContain('Deathwatch Kill Team');
    }
    const veiledBlade = AoI.detachments.find((detachment) => detachment.name === 'Veiled Blade Elimination Force')!;
    expect(Object.fromEntries(veiledBlade.enhancements.map(({ name, pts }) => [name, pts]))).toEqual({
      'Decoy Targets': 40, 'Esoteric Explosives': 40, 'Intraneural Biotech': 35, 'Micromelta Rounds': 45,
    });
    expect(veiledBlade.stratagems.find((stratagem) => stratagem.name === 'ENSNARING TRAP')!.text).not.toContain('does not receive a Charge bonus');
  });

  it('automatically adds the Veiled Blade Micromelta ability and its points cost', () => {
    const list = {
      name: 'Assassins', factionId: 'AoI', battleSize: 'incursion', detachments: ['Veiled Blade Elimination Force'],
      units: [{ uid: 'vindicare', datasheet: 'Vindicare Assassin', models: 1, pts: 100 }],
    };
    expect(listPoints(list, AoI)).toBe(145);
    expect(buildUnits(list, AoI, 0)[0].abilities.some((ability) => ability.name === 'Micromelta Rounds')).toBe(true);
    list.detachments = [];
    expect(listPoints(list, AoI)).toBe(100);
  });

  it('counts Gravis Veterans as two transport spaces', () => {
    const own = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: [],
      units: [
        { uid: 'kill-team', datasheet: 'Aquila Kill Team', models: 5, pts: 300 },
        { uid: 'rhino', datasheet: 'Imperial Rhino', models: 1, pts: 75 },
      ],
    };
    const enemy = {
      name: 'Space Marines', factionId: 'SM', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'intercessors', datasheet: 'Intercessor Squad', models: 5, pts: 80 }],
    };
    const sm = load('SM');
    const state = createGame({
      lists: [own, enemy], factions: [AoI, sm], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    const killTeam = state.units.find((unit) => unit.sources[0] === 'Aquila Kill Team')!;
    const rhino = state.units.find((unit) => unit.sources[0] === 'Imperial Rhino')!;
    rhino.transport!.capacity = 5;
    expect(canEmbarkIn(state, killTeam, rhino)).toMatch(/Not enough room/);
    rhino.transport!.capacity = 6;
    expect(canEmbarkIn(state, killTeam, rhino)).toBeNull();
  });

  it('lets an attached Inquisitor use a transport accepted by its bodyguard', () => {
    const own = {
      name: 'Agents', factionId: 'AoI', battleSize: 'incursion', detachments: [],
      units: [
        { uid: 'breachers', datasheet: 'Imperial Navy Breachers', models: 5, pts: 100 },
        { uid: 'inquisitor', datasheet: 'Inquisitor', models: 1, pts: 55, attachTo: 'breachers' },
        { uid: 'rhino', datasheet: 'Imperial Rhino', models: 1, pts: 75 },
      ],
    };
    const enemy = {
      name: 'Space Marines', factionId: 'SM', battleSize: 'incursion', detachments: [],
      units: [{ uid: 'intercessors', datasheet: 'Intercessor Squad', models: 5, pts: 80 }],
    };
    const sm = load('SM');
    const state = createGame({
      lists: [own, enemy], factions: [AoI, sm], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    const ledUnit = state.units.find((unit) => unit.sources[0] === 'Imperial Navy Breachers')!;
    const rhino = state.units.find((unit) => unit.sources[0] === 'Imperial Rhino')!;
    expect(ledUnit.sources).toContain('Inquisitor');
    rhino.transport!.forbid.push('INQUISITOR');
    expect(canEmbarkIn(state, ledUnit, rhino)).toBeNull();
  });
});
