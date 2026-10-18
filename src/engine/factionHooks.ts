// Faction modules subscribe to the game loop here. One block per faction; within each event the handlers run in the
// order of the blocks below, which keeps dice rolls (and so seeded games) the same.
// To add a faction: write its module, then add a block that subscribes its functions to the events it needs.
import { addCombatMods, addPoolFinisher } from './combatMods';
import { addActionHandler, addChoiceHooks, addCondition, addDieRescue, addEffectSource, addModifier, addStratSpecial, addTargetFilter, on } from './events';
import { shockTest } from './activations';
import { log } from './state';
import type { GameState } from './types';
import { ftggAttackModifiers, getFtggPairForGuided, isTauArmy } from './tau';
import { activeIds, blessingEffects, blessingsRoll, blessingsRoundStart, butchersFightStart } from './blessings';
import { autoPact } from './darkPacts';
import { destroyedThisRound, ecUnitWiped, initFavoured, noteTarget, pledgeRoundEnd, pledgeRoundStart, poisonTick, raisePledge, sensationalBlock, sensationalOk, snapshotEngaged, thrillBlock } from './emperorsChildren';
import { attachNear, blightedLand, dgBattleStart, dgCommandEnd, dgCommandStart, dgEffects, dgPhaseEnd, dgRoundStart, dsKeep, extraPlague, eyestingerStorm, inContagionOf, isAfflicted, leechspore, PLAGUE_IDS, putridHit, setPlague, signalPox, stinkBlocks } from './deathGuard';
import { auraBonus, bondAgain, choicePicked, choiceWhy, expend, knightsAttackDone, knightsBattleStart, knightsCommandStart, knightsCond, knightsEffects, knightsMoved, knightsRoundEnd, knightsRoundStart, knightsShockFailed, knightsShootingStart, knightsTurnEnd, knightsTurnStart, longLeash, maleficSurge, superHeavy } from './knights';
import { resetPhaseActsOfFaith, sororitasCommandEnd, sororitasTurnStart, sororitasUnitDestroyed, tryActOfFaith } from './sororitas';
import { aeldariBattleStart, aeldariCommandEnd, aeldariTurnStart, resetPhaseStrandsOfFate, tryFateDie } from './aeldari';
import { votannAttackModifiers, votannBattleStart, votannCommandEnd, votannDefenseModifiers, votannUnitDestroyed } from './votann';
import { admechAttackModifiers, admechCommandStart, admechDefenseModifiers, admechRoundStart, unitActiveImperatives } from './admech';
import { drukhariAttackModifiers, drukhariBattleShockFailed, drukhariBattleStart, drukhariCommandStart, drukhariDefenseModifiers, drukhariPhaseEnd, drukhariUnitDestroyed, isUnitEmpowered } from './drukhari';
import { daemonBattleShockMod, daemonsAttackModifiers, daemonsBattleStart, daemonsCommandStart, daemonsDeepStrikeDist, daemonsDefenseModifiers, daemonsOnBattleShockResult, daemonsPhaseEnd, daemonsUnitDestroyed } from './daemons';
import { cultAmbushArrival, cultAmbushCheckEnemyMoved, cultAmbushUnitDestroyed, cultAttackModifiers, cultBattleStart, cultDefenseModifiers, cultIconCommandPhase } from './cult';
import { necAttackModifiers, necBattleStart, necCommandStart, necDefenseModifiers } from './necrons';
import { gkAttackModifiers, gkDefenseModifiers, gkEndOpponentTurn } from './greyKnights';
import { circleInFlow, inFlow, isThousandSonsArmy } from './flow';
import { RULES } from './config';
import { clamp } from './geometry';
import { inSynapse } from './tyranids';

const unitOf = (s: GameState, id?: string) => (id ? s.units.find((x) => x.id === id) : undefined);

// World Eaters: Blessings of Khorne
on('roundStart', (s) => blessingsRoundStart(s));
on('fightStart', (s) => butchersFightStart(s));
addCondition(/^blessing:/, (c, x) => activeIds(x.s, x.A.owner).includes(c.slice(9)));
addEffectSource((s, u) => blessingEffects(s, u));
// Skulls for the Skull Throne!: one more Blessing of Khorne until the end of the battle round
addStratSpecial('blessingOne', (s, x) => blessingsRoll(s, x.p, { label: x.label, until: 'round' }));

// Heretic Astartes: Dark Pacts, made when a unit is selected to shoot or fight (for bots and players who leave their
// rules to the app; a player who decides picks it on screen)
on('unitSelected', (s, e) => autoPact(s, e.u, e.kind, (p) => (s.decides ?? []).includes(p) && !(s.bots ?? []).includes(p)));

// Emperor's Children
on('battleStart', (s) => initFavoured(s));
on('turnBegin', (s) => snapshotEngaged(s));
on('roundStart', (s) => pledgeRoundStart(s));
on('commandStart', (s) => poisonTick(s));
on('roundEnd', (s) => pledgeRoundEnd(s));
on('targetChosen', (s, e) => noteTarget(s, e.attackerId, e.targetId));
on('modelKilled', (s, e) => ecUnitWiped(s, e.u, e.killerId));
addStratSpecial('raisePledge', (s, x) => raisePledge(s, x.p));
addCondition('sensationalOk', (_c, x) => sensationalOk(x.s, x.A));
addCondition('pledgeBeaten', (_c, { s, A }) => { const pl = s.players[A.owner].pledge; return !!pl && pl.round === s.round && destroyedThisRound(s, A.owner) > pl.n; });
// Thrill Seekers (shooting and charging after Advancing / Falling Back; not needed for [ASSAULT] after an Advance) and
// Sensational Performance (fighting)
addModifier('targetBlock', (s, A, T, kind, assault) =>
  kind === 'fight' ? sensationalBlock(s, A, T) : kind === 'shoot' && A.move === 'advance' && assault ? null : thrillBlock(s, A, T));

// Death Guard
on('battleStart', (s) => dgBattleStart(s));
on('roundStart', (s) => dgRoundStart(s));
on('commandStart', (s) => dgCommandStart(s));
on('phaseEnd', (s) => dgPhaseEnd(s));
on('commandEnd', (s) => dgCommandEnd(s));
addModifier('moveBlock', (s, u, m, from, to, kind) => (kind === 'advance' && stinkBlocks(s, u, m, from, to) ? 'Putrefying Stink: cannot start or end an Advance move within 9" of a Foul Blightspawn' : null));
addModifier('deepStrikeKeep', (s, u, e, at, m) => dsKeep(s, u, e, at, m));
on('deadlyDemiseHit', (s, e) => putridHit(s, e.u, e.v));
addCondition('targetAfflicted', (_c, x) => !!x.T && isAfflicted(x.s, x.T));
// Afflicted (-1 T) and the Plagues
addEffectSource((s, u) => dgEffects(s, u));
addStratSpecial('attachNear', (s, x) => attachNear(s, x.u, x.label));
addTargetFilter('contagion', (s, u, e) => inContagionOf(s, u, e));
// Nurgle's Gift / Manifold Maladies: the Plague picked
addChoiceHooks({ picked: (s, p, _rule, ids) => { if (PLAGUE_IDS.includes(ids[0])) setPlague(s, p, ids[0]); } });
addActionHandler((s, a, x) => {
  if (a.dg === 'signalPox') signalPox(s, x.u, x.label);
  if (a.dg === 'blightedLand') blightedLand(s, x.u, x.label);
  if (a.dg === 'extraPlague') extraPlague(s, x.u.owner, x.label);
  if (a.dg === 'eyestinger') eyestingerStorm(s, x.u, x.label, (e) => shockTest(s, e, 0, x.label));
  if (a.dg === 'leechspore' && x.target) leechspore(s, x.u, x.target, x.label);
});

// Imperial Knights and Chaos Knights
on('battleStart', (s) => knightsBattleStart(s));
on('roundStart', (s) => knightsRoundStart(s));
on('turnStart', (s) => knightsTurnStart(s));
on('commandStart', (s) => knightsCommandStart(s));
on('shootingStart', (s) => knightsShootingStart(s));
on('moved', (s, e) => knightsMoved(s, e.u, e.paths));
on('shockResult', (s, e) => { if (!e.passed) knightsShockFailed(s, e.u); });
on('turnEnd', (s) => knightsTurnEnd(s));
on('roundEnd', (s) => knightsRoundEnd(s));
addCondition(/^(quality:|dread:|fresh:|honoured$|onLine$|holderOnLine$|lineClear$|targetOnLine$|bonded$|bondedTo$|twoBonded$|bondQuarry$|knightAdvanced$|empowered$|warlordOnBoard$|enemyFly$)/, (c, x) => knightsCond(c, x) ?? false);
// Malefic Surge
addEffectSource((s, u) => knightsEffects(s, u));
addModifier('auraRange', (s, u) => auraBonus(s, u));
on('attackDone', (s, e) => knightsAttackDone(s, e.A, e.T)); // Malefic Surge: Diabolic Power / Unnatural Fortitude used
addStratSpecial('maleficSurge', (s, x) => maleficSurge(s, x.u));
// Code Chivalric's Oath, Harbingers of Dread
addChoiceHooks({ why: (s, p, rule, o) => choiceWhy(s, p, rule, o), picked: (s, p, rule, ids, randomly) => choicePicked(s, p, rule, ids, randomly) });
addActionHandler((s, a, x) => {
  if (a.bondFar) bondAgain(s, x.on, a.bondFar);
  if (a.leash) longLeash(s, x.on);
  if (a.expend) { expend(s, x.u.owner, a.expend); log(s, `${a.expend} is expended (it comes back when the army fulfils an Oath)`, 'info', x.u.owner); }
});
// Super-heavy Walker: Normal, Advance and Fall Back moves go through every model but TITANIC ones, and through terrain
const SUPER_HEAVY = ['normal', 'advance', 'fallback'];
addModifier('moveThroughModels', (_s, u, kind) => (SUPER_HEAVY.includes(kind) && superHeavy(u) ? 'titanic' : null));
addModifier('moveThroughTerrain', (_s, u, kind) => SUPER_HEAVY.includes(kind) && superHeavy(u));

// Adepta Sororitas
on('turnStart', (s, e) => sororitasTurnStart(s, e.p));
on('phaseEnd', (s) => resetPhaseActsOfFaith(s));
on('commandEnd', (s, e) => sororitasCommandEnd(s, e.p));
addDieRescue('Act of Faith', 'Miracle die', (s, u, stage, x) => tryActOfFaith(s, u, stage, x));
on('unitDestroyed', (s, e) => sororitasUnitDestroyed(s, e.u));

// Aeldari
on('battleStart', (s) => aeldariBattleStart(s));
on('turnStart', (s, e) => aeldariTurnStart(s, e.p));
on('phaseEnd', (s) => resetPhaseStrandsOfFate(s));
on('commandEnd', (s, e) => aeldariCommandEnd(s, e.p));
addDieRescue('Strands of Fate', 'Fate die', (s, u, stage, x) => tryFateDie(s, u, stage, x));

// Leagues of Votann
on('battleStart', (s) => votannBattleStart(s));
on('commandEnd', (s, e) => votannCommandEnd(s, e.p));
on('unitDestroyed', (s, e) => votannUnitDestroyed(s, e.u, e.attackerId));

// Adeptus Mechanicus: the Doctrina Imperatives are set at the start of every battle round, the first one included
on('battleStart', (s) => admechRoundStart(s));
on('roundStart', (s) => admechRoundStart(s));
on('commandStart', (s, e) => admechCommandStart(s, e.p));
// Conqueror Imperative: ranged weapons have [ASSAULT]
addModifier('assaultWeapons', (s, u) => unitActiveImperatives(s, u).has('Conqueror Imperative'));

// Drukhari
on('battleStart', (s) => drukhariBattleStart(s));
on('commandStart', (s, e) => drukhariCommandStart(s, e.p));
on('unitDestroyed', (s, e) => drukhariUnitDestroyed(s, e.u, unitOf(s, e.attackerId)));
// Empowered Wyches (Acrobatic Gladiators) can charge after Advancing or Falling Back
addModifier('eligible', (s, u, what) => (what === 'chargeAfterAdvance' || what === 'chargeAfterFallBack') && isUnitEmpowered(s, u) && (u.name.includes('Wyches') || u.abilities.some((a) => a.name.includes('Acrobatic Gladiators'))));
on('phaseEnd', (s) => drukhariPhaseEnd(s));
// Power from Pain: an enemy unit failing any Battle-shock test gives a Pain token
on('shockResult', (s, e) => { if (!e.passed) drukhariBattleShockFailed(s, e.u); });

// Chaos Daemons
on('setup', (s) => daemonsBattleStart(s));
on('battleStart', (s) => daemonsBattleStart(s));
on('commandStart', (s) => daemonsCommandStart(s));
on('unitDestroyed', (s, e) => daemonsUnitDestroyed(s, e.u, unitOf(s, e.attackerId)));
on('phaseEnd', (s) => daemonsPhaseEnd(s));
on('shockResult', (s, e) => daemonsOnBattleShockResult(s, e.u, e.passed));
addModifier('battleShock', (s, u) => daemonBattleShockMod(s, u));
addModifier('deepStrikeDistance', (s, u, at) => daemonsDeepStrikeDist(s, u, at));

// Genestealer Cults
on('setup', (s) => cultBattleStart(s));
on('battleStart', (s) => cultBattleStart(s));
on('commandStart', (s, e) => cultIconCommandPhase(s, e.p));
on('unitDestroyed', (s, e) => cultAmbushUnitDestroyed(s, e.u));
on('movementEnd', (s) => cultAmbushArrival(s));
on('unitMoved', (s, e) => cultAmbushCheckEnemyMoved(s, e.u));

// Necrons
on('setup', (s) => necBattleStart(s));
on('battleStart', (s) => necBattleStart(s));
on('commandStart', (s, e) => necCommandStart(s, e.p));

// T'au Empire: Mont'ka, the first three battle rounds: ranged weapons have [ASSAULT]
addCondition('targetSpotted', (_c, { s, A, T }) => { const pr = getFtggPairForGuided(s, A); return !!T && !!pr && pr.spottedId === T.id; });
addModifier('assaultWeapons', (s, u) => isTauArmy(s, u.owner) && (s.players[u.owner].detachments ?? []).some((d) => d.name.toLowerCase().includes('mont')) && s.round <= 3);

// Thousand Sons: units that must Deep Strike within the Flow of Magic
addModifier('deepStrikeZone', (s, p, at, r) => circleInFlow(s, p, at, r));
addCondition('inFlow', (_c, x) => inFlow(x.s, x.holder ?? x.A));

// Tyranids: Synapse (Battle-shock and Leadership tests on 3D6)
addModifier('shockDice', (s, u) => (inSynapse(s, u) ? 3 : 2));
addModifier('meleeStrength', (s, u) => (inSynapse(s, u) ? { n: 1, note: 'Synapse +1 S' } : null));
addCondition('inSynapse', (_c, x) => inSynapse(x.s, x.A));

// Grey Knights
on('turnEnd', (s) => gkEndOpponentTurn(s));

// ---------- attack modifiers (combatMods.ts) ----------
// Asked in this order for every weapon profile; the attacker's rules first, then the defender's.

// T'au: For the Greater Good (ranged only)
addCombatMods((x) => {
  if (x.mode !== 'ranged') return null;
  const f = ftggAttackModifiers(x.s, x.A, x.T, x.d);
  return { ...f, skillBonus: -f.skillDelta };
});
// Leagues of Votann
addCombatMods((x) => votannAttackModifiers(x.s, x.A, x.T, x.d, x.mode));
addCombatMods((x) => votannDefenseModifiers(x.s, x.A, x.T, x.p, x.d));
// Adeptus Mechanicus
addCombatMods((x) => {
  const a = admechAttackModifiers(x.s, x.A, x.T, x.d, x.mode, x.p, x.weapon);
  return { ...a, skillBonus: x.mode === 'ranged' ? a.bsBonus : a.wsBonus };
});
addCombatMods((x) => admechDefenseModifiers(x.s, x.A, x.T, x.mode));
// Drukhari
addCombatMods((x) => drukhariAttackModifiers(x.s, x.A, x.T, x.d, x.mode, x.p, x.weapon));
addCombatMods((x) => drukhariDefenseModifiers(x.s, x.A, x.T, x.mode, x.p));
// Chaos Daemons
addCombatMods((x) => daemonsAttackModifiers(x.s, x.A, x.T, x.d, x.mode, x.p, x.weapon));
addCombatMods((x) => daemonsDefenseModifiers(x.s, x.A, x.T, x.mode, x.p));
// Genestealer Cults
addCombatMods((x) => { const c = cultAttackModifiers(x.s, x.A, x.T, x.d, x.mode, x.p, x.weapon); return { ...c, critHitOn: c.critHitThreshold }; });
addCombatMods((x) => cultDefenseModifiers(x.s, x.A, x.T, x.mode, x.p));
// Necrons
addCombatMods((x) => { const n = necAttackModifiers(x.s, x.A, x.T, x.d, x.mode, x.p, x.weapon); return { ...n, critHitOn: n.critHitThreshold }; });
addCombatMods((x) => necDefenseModifiers(x.s, x.A, x.T, x.mode, x.p));
// Grey Knights
addCombatMods((x) => { const g = gkAttackModifiers(x.s, x.A, x.T, x.d, x.mode, x.p, x.weapon); return { ...g, critHitOn: g.critHitThreshold }; });
addCombatMods((x) => gkDefenseModifiers(x.s, x.A, x.T, x.mode, x.p));

// Thousand Sons: Arcane Might (+1 S to Psychic Attacks, +2 in the Flow of Magic), Empyric Onslaught (+3 Attacks for
// the CHARACTER's Psychic ranged weapons in the Flow of Magic)
addCombatMods((x) => {
  if (!x.psychic || !isThousandSonsArmy(x.s, x.A.owner)) return null;
  const has = (n: string) => x.A.enhancements?.some((e) => e.name === n);
  return {
    strengthBonus: has('Arcane Might') ? (inFlow(x.s, x.A) ? 2 : 1) : 0,
    attacksBonus: x.mode === 'ranged' && x.m.isCharacter && has('Empyric Onslaught') && inFlow(x.s, x.A) ? 3 : 0,
  };
});
// Flow of Magic: THOUSAND SONS Psychic Attacks get +1 to wound in the Flow, re-roll wound rolls of 1 outside it
addPoolFinisher((x, pool) => {
  if (!x.psychic || !isThousandSonsArmy(x.s, x.A.owner)) return;
  if (!x.A.factionKeywords.includes('THOUSAND SONS') && !x.A.keywords.includes('THOUSAND SONS')) return;
  if (inFlow(x.s, x.A)) {
    pool.woundMod = clamp(pool.woundMod + 1, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll);
    pool.woundNote = [pool.woundNote, 'Flow of Magic: +1 Wound'].filter(Boolean).join(' · ');
  } else {
    pool.rerollWounds1 = true;
    pool.woundNote = [pool.woundNote, 'Flow of Magic: re-roll 1s'].filter(Boolean).join(' · ');
  }
});
