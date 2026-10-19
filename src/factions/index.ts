// Faction modules subscribe to the game loop here. One block per faction; within each event the handlers run in the
// order of the blocks below, which keeps dice rolls (and so seeded games) the same.
// To add a faction: write its module, then add a block that subscribes its functions to the events it needs.
// Modules that register themselves when loaded:
import './rituals';
import { extraOrder } from './orders';
import { addCombatMods, addPoolFinisher } from '../engine/combatMods';
import { addActionHandler, addChoiceHooks, addCondition, addDieRescue, addEffectSource, addModifier, addStratSpecial, addTargetFilter, on } from '../engine/events';
import { heal, shockTest } from '../rules-engine/activations';
import { applyMortalWounds } from '../engine/attack';
import { boardUnits, log, other, unitById, unitDistance } from '../engine/state';
import type { GameState, UnitState } from '../engine/types';
import { ftggMods, ftggTargetChosen, guidedVs, isTauArmy, observerFor, spotOf } from './tau';
import { activeIds, blessingEffects, blessingsRoll, blessingsRoundStart, butchersFightStart } from './blessings';
import { autoPact } from './darkPacts';
import { destroyedThisRound, ecUnitWiped, initFavoured, noteTarget, pledgeRoundEnd, pledgeRoundStart, poisonTick, raisePledge, sensationalBlock, sensationalOk, snapshotEngaged, thrillBlock } from './emperorsChildren';
import { attachNear, blightedLand, dgBattleStart, dgCommandEnd, dgCommandStart, dgEffects, dgPhaseEnd, dgRoundStart, dsKeep, extraPlague, eyestingerStorm, inContagionOf, isAfflicted, leechspore, PLAGUE_IDS, putridHit, setPlague, signalPox, stinkBlocks } from './deathGuard';
import { auraBonus, bondAgain, choicePicked, choiceWhy, expend, knightsAttackDone, knightsBattleStart, knightsCommandStart, knightsCond, knightsEffects, knightsMoved, knightsRoundEnd, knightsRoundStart, knightsShockFailed, knightsShootingStart, knightsTurnEnd, knightsTurnStart, longLeash, maleficSurge, superHeavy } from './knights';
import { discardMiracle, gainMiracleDice, resetPhaseActsOfFaith, sororitasCommandEnd, sororitasCommandStart, sororitasTurnStart, sororitasUnitDestroyed, tryActOfFaith } from './sororitas';
import { aeldariBattleStart, aeldariRoundStart, canFocus, lucidEye, noteVibro, relentlessRaiders, resetPhaseStrandsOfFate, seerDiscounts, shadowFieldCheck, sonicDestruction, spendFocus, tryFateDie, voidThieves } from './aeldari';
import { gainYieldPoints, spendYieldPoints, tryUtharAncestralFortune, votannBattleStart, votannTurnEnd, votannCommandEnd, votannUnitDestroyed } from './votann';
import { admechImperativePicked, onAcquisition, pickAcquisition } from './admech';
import { drugBlocked, drugPicked, drukhariAction, drukhariAttackMods, drukhariBattleShockFailed, drukhariBattleStart, drukhariCommandStart, drukhariPhaseEnd, drukhariUnitDestroyed, isUnitEmpowered, losingWager, painReady, pickContract } from './drukhari';
import { corruptRealspace, daemonBattleShockMod, daemonsBattleStart, daemonsCommandStart, daemonsDeepStrikeDist, daemonsOnBattleShockResult, daemonsUnitDestroyed, isUnderShadowOfChaos, spendFluxToken, tryFlux } from './daemons';
import { cultAmbushArrival, cultAmbushCheckEnemyMoved, cultAmbushUnitDestroyed, cultBattleStart, cultInfiltration, psionicParasitism, regimentalReinforcements } from './cult';
import { activateReanimation, necCommandEnd, repairBarge, resurrect } from './necrons';
import { whollyHallowed } from './greyKnights';
import { circleInFlow, inFlow, isThousandSonsArmy } from './flow';
import { RULES } from '../engine/config';
import { clamp } from '../engine/geometry';
import { inSynapse, tyranidsCommandStart, tyranidsShockResult, unleashShadowInTheWarp } from './tyranids';

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
addActionHandler((s, a, x) => { if (a.order) extraOrder(s, x.u, a.order); });
// Reactive Command: an enemy unit set up within 8" of the bearer's unit → one more Order
on('unitMoved', (s, e) => {
  if (e.u.move !== 'ingress') return;
  for (const o of boardUnits(s, other(e.u.owner))) if (o.enhancements.some((x) => x.name === 'Reactive Command') && unitDistance(o, e.u) <= 8 + 1e-6) extraOrder(s, o);
});
addActionHandler((s, a, x) => {
  if (a.bondFar) bondAgain(s, x.on, a.bondFar);
  if (a.leash) longLeash(s, x.on);
  if (a.expend) { expend(s, x.u.owner, a.expend); log(s, `${a.expend} is expended (it comes back when the army fulfils an Oath)`, 'info', x.u.owner); }
});
// Super-heavy Walker: Normal, Advance and Fall Back moves go through every model but TITANIC ones, and through terrain
const SUPER_HEAVY = ['normal', 'advance', 'fallback'];
// … and Heavy Walker (Stormsurge), the same movement
const heavyWalker = (u: UnitState) => superHeavy(u) || u.abilities.some((a) => a.name === 'Heavy Walker' || a.name === 'Stalking Forward');
addModifier('moveThroughModels', (_s, u, kind) => (SUPER_HEAVY.includes(kind) && heavyWalker(u) ? 'titanic' : null));
addModifier('moveThroughTerrain', (_s, u, kind) => SUPER_HEAVY.includes(kind) && heavyWalker(u));

// Adepta Sororitas
on('turnStart', (s, e) => sororitasTurnStart(s, e.p));
on('phaseEnd', (s) => resetPhaseActsOfFaith(s));
on('commandEnd', (s, e) => sororitasCommandEnd(s, e.p));
on('commandStart', (s, e) => sororitasCommandStart(s, e.p));
// Miracle dice spent or gained by abilities and enhancements (data: { "miracle": 1 } gains, { "miracle": -1 } discards)
addActionHandler((s, a, x) => {
  if (!a.miracle) return;
  if (a.miracle > 0) gainMiracleDice(s, x.u.owner, a.miracle, a.miracleValue, x.label);
  else discardMiracle(s, x.u.owner, -a.miracle);
});
addCondition(/^miracle:\d+$/, (c, { s, A }) => (s.players[A.owner].miracleDice ?? []).length >= Number(c.slice(8)));
addDieRescue('Act of Faith', 'Miracle die', (s, u, stage, x) => tryActOfFaith(s, u, stage, x));
on('unitDestroyed', (s, e) => sororitasUnitDestroyed(s, e.u, e.attackerId));

// Aeldari
on('battleStart', (s) => aeldariBattleStart(s));
on('roundStart', (s) => aeldariRoundStart(s));
on('phaseEnd', (s) => resetPhaseStrandsOfFate(s));
// Battle Focus: Agile Manoeuvres (data/detachment-rules.json) and Seer Council's Fate dice discounts
addCondition(/^focusReady:/, (c, x) => canFocus(x.s, x.holder ?? x.A, c.slice(11)));
addActionHandler((s, a, x) => {
  if (a.ae?.startsWith('focus:')) spendFocus(s, x.on, a.ae.slice(6), x.label);
  if (a.ae === 'lucidEye') lucidEye(s, x.u.owner, x.label);
});
addEffectSource((s, u) => seerDiscounts(s, u));
// Corsair Coterie
on('unitMoved', (s, e) => relentlessRaiders(s, e.u, (u, n, why) => applyMortalWounds(s, u, n, why)));
on('phaseEnd', (s) => voidThieves(s));
// Sonic Destruction, Shadow Field
on('attackDone', (s, e) => { noteVibro(s, e.A, e.T); shadowFieldCheck(s, e.T); });
addCombatMods((x) => sonicDestruction(x.s, x.A, x.T, x.weapon));
addDieRescue('Strands of Fate', 'Fate die', (s, u, stage, x) => tryFateDie(s, u, stage, x));

// Leagues of Votann
on('battleStart', (s) => votannBattleStart(s));
on('commandEnd', (s, e) => votannCommandEnd(s, e.p));
on('unitDestroyed', (s, e) => votannUnitDestroyed(s, e.u, e.attackerId));
on('turnEnd', (s) => votannTurnEnd(s));
addCondition('hostile', (_c, x) => (x.s.players[x.A.owner].votannAbility ?? 'Hostile Acquisition') === 'Hostile Acquisition');
addCondition('fortify', (_c, x) => x.s.players[x.A.owner].votannAbility === 'Fortify Takeover');
addCondition('yp', (_c, x) => (x.s.players[x.A.owner].yieldPoints ?? 0) >= 1);
addCondition(/^yp:\d+$/, (c, x) => (x.s.players[x.A.owner].yieldPoints ?? 0) >= Number(c.slice(3)));
addActionHandler((s, a, x) => { if (a.lov && a.lov > 0) spendYieldPoints(s, x.u.owner, a.lov, x.label); if (a.lov && a.lov < 0) gainYieldPoints(s, x.u.owner, -a.lov, x.label); });
addDieRescue('Ancestral Fortune', 'YP', (s, u, stage, x) => (stage === 'hit' || stage === 'wound' || stage === 'save' ? tryUtharAncestralFortune(s, u, stage, x) : null));

// Adeptus Mechanicus: the active Doctrina Imperative shown on the HUD
addChoiceHooks({ picked: (s, p, rule, ids) => admechImperativePicked(s, p, rule, ids) });
on('commandStart', (s, e) => pickAcquisition(s, e.p));
addCondition('onAcquisition', (_c, x) => onAcquisition(x.s, x.A.owner, x.A));
addCondition('targetOnAcquisition', (_c, x) => !!x.T && onAcquisition(x.s, x.A.owner, x.T));

// Drukhari
on('battleStart', (s) => drukhariBattleStart(s));
on('commandStart', (s, e) => drukhariCommandStart(s, e.p));
on('unitDestroyed', (s, e) => drukhariUnitDestroyed(s, e.u, unitOf(s, e.attackerId)));
// Pain: Empower buttons (data), Kabalite Cartel's Contract, Combat Drugs
on('roundStart', (s) => { if (s.round === 1) for (const p of [0, 1] as const) pickContract(s, p); });
addCondition('painReady', (_c, x) => painReady(x.s, x.holder ?? x.A));
addCondition('painEmpowered', (_c, x) => isUnitEmpowered(x.s, x.holder ?? x.A));
addCondition('losingWager', (_c, x) => losingWager(x.s, x.A));
addCondition('targetContract', (_c, x) => { const c = x.s.players[x.A.owner].contract; return !!x.T && !!c && !c.done && c.unitId === x.T.id; });
addCondition('contractDone', (_c, x) => !!x.s.players[x.A.owner].contract?.done);
addCondition('painToken', (_c, x) => (x.s.players[x.A.owner].painTokens ?? 0) >= 1);
addActionHandler((s, a, x) => { if (a.dru) drukhariAction(s, a.dru, x.on, x.label); });
addChoiceHooks({ why: (s, p, rule, o) => drugBlocked(s, p, rule, o.id, !!o.random), picked: (s, p, rule, ids, randomly) => drugPicked(s, p, rule, ids, randomly) });
on('phaseEnd', (s) => drukhariPhaseEnd(s));
// Power from Pain: an enemy unit failing any Battle-shock test gives a Pain token
on('shockResult', (s, e) => { if (!e.passed) drukhariBattleShockFailed(s, e.u); });

// Chaos Daemons
on('setup', (s) => daemonsBattleStart(s));
on('battleStart', (s) => daemonsBattleStart(s));
on('commandStart', (s) => daemonsCommandStart(s));
on('unitDestroyed', (s, e) => daemonsUnitDestroyed(s, e.u, unitOf(s, e.attackerId)));
addCondition('inShadow', (_c, x) => isUnderShadowOfChaos(x.s, x.A.owner, x.A));
addCondition('targetInShadow', (_c, x) => !!x.T && isUnderShadowOfChaos(x.s, x.A.owner, x.T));
addCondition('fluxToken', (_c, x) => (x.s.players[x.A.owner].fluxTokens ?? 0) > 0);
addActionHandler((s, a, x) => { if (a.cd === 'flux') spendFluxToken(s, x.u.owner); });
addDieRescue('Fates in Flux', 'Flux token', (s, u, stage, x) => tryFlux(s, u, stage, x));
addStratSpecial('corrupt', (s, x) => corruptRealspace(s, x.u));
on('shockResult', (s, e) => daemonsOnBattleShockResult(s, e.u, e.passed));
addModifier('battleShock', (s, u) => daemonBattleShockMod(s, u));
addModifier('deepStrikeDistance', (s, u, at) => daemonsDeepStrikeDist(s, u, at));

// Genestealer Cults
on('setup', (s) => cultBattleStart(s));
on('battleStart', (s) => cultBattleStart(s));
on('commandStart', (s) => cultInfiltration(s));
on('unitDestroyed', (s, e) => cultAmbushUnitDestroyed(s, e.u));
on('movementEnd', (s) => cultAmbushArrival(s));
on('unitMoved', (s, e) => cultAmbushCheckEnemyMoved(s, e.u));
addStratSpecial('regimental', (s, x) => regimentalReinforcements(s, x.u));
addActionHandler((s, a, x) => { if (a.gc === 'parasitism' && x.target) psionicParasitism(s, x.u, x.target, (u, n) => applyMortalWounds(s, u, n, 'Psionic Parasitism'), (u, n) => heal(s, u, n)); });

// Necrons
on('commandEnd', (s, e) => necCommandEnd(s, e.p));
addStratSpecial('reanimationCrypts', (s, x) => { for (const u of s.units) if (u.owner === x.p && u.status === 'reserves' && u.abilities.some((a) => a.name === 'Reanimation Protocols')) activateReanimation(s, u, 'D3', 'Reanimation Crypts'); });
on('attackDone', (s, e) => repairBarge(s, e.T));
addActionHandler((s, a, x) => {
  if (a.nec === 'reanimate') activateReanimation(s, x.on);
  if (a.nec === 'resurrect') resurrect(s, x.on);
});

// T'au Empire: Mont'ka, the first three battle rounds: ranged weapons have [ASSAULT]
addCondition('targetSpotted', (_c, { s, T }) => !!T && !!spotOf(s, T));
addCondition('guided', (_c, { s, A, T }) => !!T && guidedVs(s, A, T));
addCondition('targetSpottedBySelf', (_c, { s, A, T }) => !!T && spotOf(s, T)?.observerId === A.id);
// Through Unity, Devastation / Coordinated Exploitation: the Observer of the Guided shot carries this Enhancement
addCondition(/^observerEnh:/, (c, { s, A, T }) => !!T && guidedVs(s, A, T) && !!observerFor(s, A, T)?.enhancements?.some((e) => e.name === c.slice(12)));
on('targetChosen', (s, e) => { if (s.phase === 'shooting') ftggTargetChosen(s, unitById(s, e.attackerId), unitById(s, e.targetId)); });
addModifier('assaultWeapons', (s, u) => isTauArmy(s, u.owner) && (s.players[u.owner].detachments ?? []).some((d) => d.name.toLowerCase().includes('mont')) && s.round <= 3);

// Thousand Sons: units that must Deep Strike within the Flow of Magic
addModifier('deepStrikeZone', (s, p, at, r) => circleInFlow(s, p, at, r));
addCondition('inFlow', (_c, x) => inFlow(x.s, x.holder ?? x.A));

// Tyranids: Synapse (Battle-shock and Leadership tests on 3D6)
addModifier('shockDice', (s, u) => (inSynapse(s, u) ? 3 : 2));
addModifier('meleeStrength', (s, u) => (inSynapse(s, u) ? { n: 1, note: 'Synapse +1 S' } : null));
addCondition('inSynapse', (_c, x) => inSynapse(x.s, x.A));
on('shockResult', (s, e) => tyranidsShockResult(s, e.u, e.passed));
on('commandStart', (s) => tyranidsCommandStart(s));
addActionHandler((s, a, x) => { if (a.tyr === 'shadow' && !s.players[x.u.owner].shadowInTheWarpUsed) unleashShadowInTheWarp(s, x.u.owner); });

// Grey Knights
// Grey Knights: Hallowed Ground
addCondition('hallowed', (_c, x) => whollyHallowed(x.s, x.A));

// ---------- attack modifiers (combatMods.ts) ----------
// Asked in this order for every weapon profile; the attacker's rules first, then the defender's.

// T'au: For the Greater Good (ranged only)
addCombatMods((x) => (x.mode === 'ranged' ? ftggMods(x.s, x.A, x.T) : null));
// Leagues of Votann
// Drukhari
addCombatMods((x) => drukhariAttackMods(x.s, x.A, x.T));
// Necrons
// Grey Knights

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
