// Faction modules subscribe to the game loop here. One block per faction; within each event the handlers run in the
// order of the blocks below, which keeps dice rolls (and so seeded games) the same.
// To add a faction: write its module, then add a block that subscribes its functions to the events it needs.
// Modules that register themselves when loaded:
import './rituals';
import { deathstrikeShooting, officerDeath, sigilOfExigence } from './deathstrike';
import { copyOrders, extraOrder, ordersShockFailed, orderTo, isOfficer } from './orders';
import { amOppMovementEnd, disembarkOne, shootFrom, shootWith } from './amTransports';
import { addCombatMods, addPoolFinisher } from '../engine/combatMods';
import { emit, addActionHandler, addChoiceHooks, addCondition, addDieRescue, addEffectSource, addModifier, addStratSpecial, addTargetFilter, on } from '../engine/events';
import { heal, runActions, setBackUp, shockTest } from '../rules-engine/activations';
import { applyMortalWounds, killModel, onAttackFinished, onAttackStart, onMortalWounds } from '../engine/attack';
import { rollExpr, rollN } from '../engine/dice';
import { addTimed, cond, effectsFor, unitFlags } from '../rules-engine/effects';
import { alive, boardUnits, emitReact, onBoard, engagedEnemies, log, other, phaseKey, unitById, unitDistance } from '../engine/state';
import { unitVisibleTo } from '../engine/visibility';
import { setUpAway, setUpNear, shootNow } from '../engine/game';
import { unitInRange, zonePoly } from '../engine/missions';
import { pointInPoly } from '../engine/geometry';
import type { GameState, UnitState } from '../engine/types';
import { ftggMods, ftggTargetChosen, guidedVs, isTauArmy, observerFor, spotOf } from './tau';
import { activeIds, blessingEffects, blessingsRoll, blessingsRoundStart, butchersFightStart } from './blessings';
import { autoPact } from './darkPacts';
import { destroyedThisRound, ecUnitWiped, initFavoured, noteTarget, pledgeRoundEnd, pledgeRoundStart, poisonTick, raisePledge, sensationalBlock, sensationalOk, snapshotEngaged, thrillBlock } from './emperorsChildren';
import { attachNear, blightedLand, dgBattleStart, dgCommandEnd, dgCommandStart, dgEffects, dgPhaseEnd, dgRoundStart, dsKeep, extraPlague, eyestingerStorm, inContagionOf, isAfflicted, leechspore, PLAGUE_IDS, putridHit, setPlague, signalPox, stinkBlocks } from './deathGuard';
import { auraBonus, bondAgain, choicePicked, choiceWhy, expend, knightsAttackDone, knightsBattleStart, knightsCommandStart, knightsCond, knightsEffects, knightsMoved, knightsRoundEnd, knightsRoundStart, knightsShockFailed, knightsShootingStart, knightsTurnEnd, knightsTurnStart, longLeash, maleficSurge, superHeavy } from './knights';
import { discardMiracle, gainMiracleDice, resetPhaseActsOfFaith, sororitasCommandEnd, sororitasCommandStart, sororitasTurnStart, sororitasUnitDestroyed, tryActOfFaith } from './sororitas';
import { aeldariBattleStart, aeldariRoundStart, canFocus, lucidEye, noteVibro, relentlessRaiders, resetPhaseStrandsOfFate, seerDiscounts, shadowFieldCheck, sonicDestruction, spendFocus, tryFateDie, voidThieves } from './aeldari';
import { delvwerkeNavigator, nomadStrategist, gainYieldPoints, spendYieldPoints, tryUtharAncestralFortune, votannBattleStart, votannTurnEnd, votannCommandEnd, votannUnitDestroyed } from './votann';
import { admechImperativePicked, infoslaveSkull, onAcquisition, pickAcquisition } from './admech';
import { drugBlocked, drugPicked, drukhariAction, drukhariAttackMods, drukhariBattleShockFailed, drukhariBattleStart, drukhariCommandStart, drukhariPhaseEnd, drukhariUnitDestroyed, isUnitEmpowered, losingWager, painReady, pickContract } from './drukhari';
import { corruptRealspace, impossibleEclipse, seedTheGarden, daemonBattleShockMod, daemonsBattleStart, daemonsCommandStart, daemonsDeepStrikeDist, daemonsOnBattleShockResult, daemonsUnitDestroyed, isUnderShadowOfChaos, spendFluxToken, tryFlux } from './daemons';
import { cultAmbushArrival, cultAmbushCheckEnemyMoved, cultAmbushUnitDestroyed, cultBattleStart, cultInfiltration, psionicParasitism, regimentalReinforcements } from './cult';
import { activateReanimation, necCommandEnd, repairBarge, resurrect } from './necrons';
import { inHallowedGround, whollyHallowed } from './greyKnights';
import { circleInFlow, inFlow, isThousandSonsArmy } from './flow';
import { RULES } from '../engine/config';
import { clamp } from '../engine/geometry';
import { harpoonHit, inSynapse, nearTunnel, parasiteDone, parasiteKill, seedSpores, tunnelArrived, tunnelDeepStrike, tunnelEnemyMoved, tunnelNetwork, tyranidsCommandStart, tyranidsShockResult, unleashShadowInTheWarp } from './tyranids';

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
on('shootingStart', (s, e) => deathstrikeShooting(s, e.p));
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
addActionHandler((s, a, x) => { if (a.order) extraOrder(s, x.u, a.order); if (a.copyOrders) copyOrders(s, x.u, a.copyOrders); if (a.shootWith) shootWith(s, x.u, a.shootWith, 'Servo-sentry'); });
on('shockResult', (s, e) => { if (!e.passed) ordersShockFailed(s, e.u); });
on('movementEnd', (s, e) => amOppMovementEnd(s, other(e.p)));
// Mechanised Spearhead: a REGIMENT unit getting out of a transport near this Commissar gets an Order at once
on('disembarked', (s, { u, t }) => {
  if (s.phase !== 'movement' || u.owner !== s.active || !u.keywords.includes('REGIMENT')) return;
  const o = boardUnits(s, u.owner).find((x) => isOfficer(x) && x.abilities.some((a) => a.name === 'Mechanised Spearhead') && unitDistance(x, t) <= 6 + 1e-6);
  if (o) orderTo(s, o, u);
});
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
on('phaseEnd', (s, e) => { if (e.phase === 'fight') nomadStrategist(s); });
on('movementStart', (s) => delvwerkeNavigator(s));
addCondition('hostile', (_c, x) => (x.s.players[x.A.owner].votannAbility ?? 'Hostile Acquisition') === 'Hostile Acquisition');
addCondition('fortify', (_c, x) => x.s.players[x.A.owner].votannAbility === 'Fortify Takeover');
addCondition('yp', (_c, x) => (x.s.players[x.A.owner].yieldPoints ?? 0) >= 1);
addCondition(/^yp:\d+$/, (c, x) => (x.s.players[x.A.owner].yieldPoints ?? 0) >= Number(c.slice(3)));
addActionHandler((s, a, x) => { if (a.lov && a.lov > 0) spendYieldPoints(s, x.u.owner, a.lov, x.label); if (a.lov && a.lov < 0) gainYieldPoints(s, x.u.owner, -a.lov, x.label); });
addActionHandler((s, a, x) => {
  if (a.disembarkOne) disembarkOne(s, x.on, x.label);
  if (!a.shootFrom || !x.target) return;
  // VENGEANCE FLARE: 2YP lets a HEKATON LAND FORTRESS answer instead (when one stands within 6")
  const hek = a.shootFrom.includes('KAPRICUS') && (s.players[x.on.owner].yieldPoints ?? 0) >= 2
    && boardUnits(s, x.on.owner).some((f) => f.keywords.includes('HEKATON LAND FORTRESS') && unitDistance(f, x.on) <= 6 + 1e-6);
  if (hek && spendYieldPoints(s, x.on.owner, 2, x.label)) shootFrom(s, x.on, x.target, 'HEKATON LAND FORTRESS', x.label);
  else shootFrom(s, x.on, x.target, a.shootFrom, x.label);
});
addActionHandler((s, a, x) => {
  if (!a.lovHostile) return;
  const p = x.u.owner, yp = s.players[p].yieldPoints ?? 0;
  if (yp > 6) spendYieldPoints(s, p, yp - 6, x.label);
  s.players[p].votannAbility = 'Hostile Acquisition';
  log(s, `${x.label}: Leagues of Votann units have Hostile Acquisition`, 'info', p);
});
addCondition('fortifyTakeover', (_c, { s, A }) => s.players[A.owner].votannAbility === 'Fortify Takeover');
addActionHandler((s, a, x) => { if (a.lovRefund && rollN(s, 1)[0] >= a.lovRefund) gainYieldPoints(s, x.u.owner, 1, 'Mantle of Elders'); });
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
addActionHandler((s, a, x) => { if (a.cd === 'flux') spendFluxToken(s, x.u.owner); else if (a.cd) impossibleEclipse(s, x.u.owner, a.cd); });
on('movementEnd', (s, e) => seedTheGarden(s, e.p));
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
on('modelKilled', (s, e) => parasiteKill(s, e.u, e.m, e.killerId));
on('attackDone', (s, e) => parasiteDone(s, e.A));
on('attackDone', (s, e) => harpoonHit(s, e.A, e.T));
addCondition('harpooned', (_c, x) => x.A.chargeMust?.turn === x.s.turn && x.A.abilities.some((a) => a.name === 'Harpooned') && (x.s.units.find((u) => u.id === x.A.chargeMust!.id)?.status === 'board') && unitDistance(x.A, x.s.units.find((u) => u.id === x.A.chargeMust!.id)!) <= 12 + 1e-6);
on('attackDone', (s, e) => officerDeath(s, e.A, e.T));
onAttackStart((s, at) => sigilOfExigence(s, at));
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

// HEXWROUGHT REPRISAL: mortal wounds a unit suffered this phase, and from which enemy unit
onMortalWounds((s, u, n) => {
  const src = s.attack && s.attack.targetId === u.id ? s.attack.attackerId : s.lastAct && s.lastAct.owner !== u.owner ? s.lastAct.unitId : undefined;
  if (!src) return;
  const k = phaseKey(s), [pk, c] = (u.used?.mwTaken ?? '').split('|');
  (u.used ??= {}).mwTaken = `${k}|${(pk === k ? Number(c) : 0) + n}|${src}`;
});
addCondition('mwThisPhase', (_c, { s, A }) => (A.used?.mwTaken ?? '').startsWith(`${phaseKey(s)}|`));
addActionHandler((s, a, x) => {
  if (!a.hexReprisal || !x.target) return;
  const n = Math.min(6, Number((x.u.used?.mwTaken ?? '').split('|')[1]) || 0);
  const r = rollN(s, n), hits = Math.min(6, r.filter((v) => v >= 2).length);
  log(s, `${x.label}: [${r.join(' ')}] → ${hits} mortal wound${hits === 1 ? '' : 's'} on ${x.target.name}`, 'roll', x.u.owner);
  if (hits) applyMortalWounds(s, x.target, hits, x.label);
});

// FIRES OF COVENANT: an enemy unit set up or ending a Normal / Advance / Fall Back move near the unit may take mortal wounds
on('unitMoved', (s, { u }) => {
  if (!['normal', 'advance', 'fallback'].includes(u.move ?? '') && u.setUpTurn !== s.turn) return;
  for (const x of boardUnits(s, other(u.owner))) for (const a of effectsFor(s, x)) {
    const q = a.e.moveNearMortals;
    if (!q || unitDistance(x, u) > q.range + 1e-6 || !alive(u).length) continue;
    const r = rollN(s, 1)[0] + ((q.plusIf ?? []).length && q.plusIf!.every((c) => cond(c, { s, A: x, holder: x })) ? q.plus ?? 0 : 0);
    log(s, `${a.label}: ${u.name} ended a move near ${x.name}, rolled ${r} (${q.on}+)`, 'roll', x.owner);
    if (r >= q.on) applyMortalWounds(s, u, rollExpr(s, q.dmg).total, a.label);
  }
});

// Tally of Pestilence (Epidemius): enemy models destroyed by NURGLE daemons; 7 or more at the start of your Command phase: +1CP
on('modelKilled', (s, { u, killerId }) => {
  const k = killerId ? s.units.find((x) => x.id === killerId) : undefined;
  if (!k || k.owner === u.owner || !k.factionKeywords.includes('LEGIONES DAEMONICA') || !k.keywords.includes('NURGLE')) return;
  const P = s.players[k.owner];
  if (boardUnits(s, k.owner).some((x) => x.abilities.some((a) => a.name === 'Tally of Pestilence'))) P.pestilence = (P.pestilence ?? 0) + 1;
});
on('commandStart', (s, { p }) => {
  const P = s.players[p];
  if ((P.pestilence ?? 0) < 7 || !boardUnits(s, p).some((x) => x.abilities.some((a) => a.name === 'Tally of Pestilence'))) return;
  P.pestilence = 0; P.cp += 1;
  log(s, 'Tally of Pestilence: 7 enemy models destroyed → +1CP', 'cp', p);
});


// Formless Horror (The Changeling): an enemy unit that wishes to attack it takes a Battle-shock test first (once per phase); failed: it cannot target it this phase
addModifier('targetBlock', (s, A, T, kind) => {
  if (kind === 'charge' || A.owner === T.owner || !T.abilities.some((a) => a.name === 'Formless Horror')) return null;
  const key = `formless:${A.id}`, now = phaseKey(s);
  const seen = (T.used ?? {})[key];
  if (!seen?.startsWith(now)) (T.used ??= {})[key] = `${now}|${shockTest(s, A, 0, 'Formless Horror') ? 'ok' : 'no'}`;
  return T.used![key].endsWith('|no') ? `Formless Horror: ${A.name} failed its Battle-shock test and cannot target ${T.name} this phase` : null;
});

// Reverberating Summons (Great Unclean One's Doomsday bell): each model it destroys brings a Plaguebearer back to a unit within 12"
on('modelKilled', (s, { u, killerId }) => {
  const k = killerId ? s.units.find((x) => x.id === killerId) : undefined;
  const pl = s.attack?.pools[s.attack.idx];
  if (!k || k.owner === u.owner || !pl || !/doomsday bell/i.test(pl.weapon) || !k.abilities.some((a) => a.name === 'Reverberating Summons')) return;
  const t = boardUnits(s, k.owner).find((x) => /plaguebearer/i.test(x.name) && unitDistance(x, k) <= 12 && x.models.some((m) => m.dead && !m.isCharacter));
  const m = t?.models.find((x) => x.dead && !x.isCharacter);
  if (!t || !m) return;
  m.dead = false; m.wounds = m.profile.W;
  if (setBackUp(s, t, m, alive(t).find((x) => x.id !== m.id) ?? m)) log(s, `Reverberating Summons: a Plaguebearer returns to ${t.name}`, 'info', k.owner);
  else { m.dead = true; m.wounds = 0; }
});

// FICKLEFIRE / CALLOUS SACRIFICE: an enemy model destroyed while engaged with the unit costs it a mortal wound / a model on X+
on('modelKilled', (s, { u, m }) => {
  for (const x of engagedEnemies(s, u)) {
    const q = unitFlags(s, x).ignoreEngaged;
    if (!q || !alive(x).some((n) => Math.hypot(n.x - m.x, n.y - m.y) <= n.r + m.r + 1 + 1e-6)) continue;
    const r = rollN(s, 1)[0];
    if (r < q.on || q.cost !== 'mortal') continue;
    applyMortalWounds(s, x, 1, 'Ficklefire');
  }
});
// ACCEPTABLE LOSSES: after shooting into the melee, each GENESTEALER CULTS unit engaged with the target suffers D3+1 mortal wounds on a 5+
onAttackFinished((s, at) => {
  const A = unitById(s, at.attackerId), T = unitById(s, at.targetId);
  if (at.kind !== 'shoot' || !(A.timed ?? []).some((t) => t.label === 'ACCEPTABLE LOSSES')) return;
  for (const g of engagedEnemies(s, T).filter((x) => x.owner === A.owner && x.factionKeywords.includes('GENESTEALER CULTS'))) {
    if (rollN(s, 1)[0] >= 5) applyMortalWounds(s, g, rollExpr(s, 'D3+1').total, 'Acceptable Losses');
  }
});
// CALLOUS SACRIFICE: each wound an enemy unit engaged with it loses: D6, on 4+ one of its models is destroyed after the attack
onAttackFinished((s, at, info) => {
  const T = unitById(s, at.targetId);
  if (!info.woundsLost) return;
  for (const x of engagedEnemies(s, T)) {
    const q = unitFlags(s, x).ignoreEngaged;
    if (!q || q.cost !== 'model') continue;
    const lost = rollN(s, info.woundsLost).filter((r) => r >= q.on).length;
    for (let i = 0; i < lost; i++) { const v = alive(x).find((n) => !n.isCharacter) ?? alive(x)[0]; if (!v) break; log(s, `Callous Sacrifice: ${v.name} of ${x.name} is destroyed`, 'info', x.owner); killModel(s, x, v); }
  }
});

// THIEVES OF PAIN: another friendly unit within 9" takes the wounds instead
addActionHandler((s, a, x) => {
  if (!a.redirectTo) return;
  const ks = a.redirectTo.split('|');
  const t = boardUnits(s, x.on.owner).filter((f) => f.id !== x.on.id && ks.every((k) => f.keywords.includes(k)) && unitDistance(f, x.on) <= 9 + 1e-6)
    .sort((p, q) => alive(q).reduce((n, m) => n + m.wounds, 0) / Math.max(1, q.pts) - alive(p).reduce((n, m) => n + m.wounds, 0) / Math.max(1, p.pts))[0];
  if (!t) return;
  addTimed(s, x.on, { e: { redirectWounds: t.id }, label: x.label, until: 'phase', by: x.on.owner });
  log(s, `${x.label}: ${t.name} takes the wounds ${x.on.name} would lose this phase`, 'info', x.on.owner);
});

// FAITH AND FURY, DIVINE GUIDANCE, RIGHTEOUS BLOWS, RITES OF FIRE: after an attack that destroyed enemy models
on('attackDone', (s, { A, T }) => {
  if ((T.used ?? {}).lostModel !== `${s.turn}:${s.phase}` || (A.used ?? {}).killedModel !== phaseKey(s)) return;
  for (const a of effectsFor(s, A)) {
    const q = a.e.onKill;
    if (!q || (A.used ?? {})[`onKill:${a.label}`] === phaseKey(s)) continue;
    (A.used ??= {})[`onKill:${a.label}`] = phaseKey(s);
    if (q.miracle) gainMiracleDice(s, A.owner, q.miracle, undefined, a.label);
    if (q.shock && T.status === 'board') shockTest(s, T, 0, a.label);
  }
});


// Recount the Deeds of the Saints: Agathae Dolan destroyed → D3 Miracle dice
on('modelKilled', (s, { u, m }) => {
  if (!/Agathae Dolan/i.test(m.name) || !u.abilities.some((a) => a.name === 'Recount the Deeds of the Saints')) return;
  gainMiracleDice(s, u.owner, rollExpr(s, 'D3').total, undefined, 'Recount the Deeds of the Saints');
});
on('unitDestroyed', (s, { u, attackerId }) => {
  // Denuncia Oratory: the quarry is gone, a new one is picked (the most valuable enemy unit)
  const q = (u.timed ?? []).find((t) => t.mark === 'Quarry');
  if (q && boardUnits(s, q.by).some((x) => x.abilities.some((a) => a.name === 'Denuncia Oratory'))) {
    const next = boardUnits(s, u.owner).filter((x) => x.id !== u.id).sort((a, b) => b.pts - a.pts)[0];
    if (next) { addTimed(s, next, { e: {}, label: q.label, until: 'battle', by: q.by, mark: 'Quarry' }); log(s, `Denuncia Oratory: ${next.name} is the new quarry`, 'info', q.by); }
  }
  // Psalm of Righteous Judgement: a PENITENT unit destroyed an enemy unit → one Miracle dice becomes a 6
  const k = attackerId ? s.units.find((x) => x.id === attackerId) : undefined;
  if (!k || k.owner === u.owner || !k.keywords.includes('PENITENT') || !boardUnits(s, k.owner).some((x) => x.enhancements.some((e) => e.name === 'Psalm of Righteous Judgement'))) return;
  const dice = s.players[k.owner].miracleDice ?? [];
  if (!dice.length || Math.min(...dice) === 6) return;
  dice.splice(dice.indexOf(Math.min(...dice)), 1, 6);
  log(s, 'Psalm of Righteous Judgement: a Miracle dice becomes a 6', 'info', k.owner);
});

// THE GRISLY FEAST: in the opponent's next Command phase, enemy units within 6" of the Kroot unit take a Battle-shock test
on('commandStart', (s, { p }) => {
  for (const k of boardUnits(s, other(p)).filter((x) => (x.timed ?? []).some((t) => t.mark === 'grislyFeast'))) {
    k.timed = k.timed!.filter((t) => t.mark !== 'grislyFeast');
    for (const e of boardUnits(s, p).filter((x) => unitDistance(x, k) <= 6 + 1e-6)) shockTest(s, e, alive(e).length * 2 <= e.startingStrength ? -1 : 0, 'THE GRISLY FEAST');
  }
});

// YOUR TIME IS NIGH: offered when the opponent's Warlord is destroyed; then enemy Battle-shock tests are at -1
on('unitDestroyed', (s, { u }) => { if (u.isWarlordUnit) emitReact(s, other(u.owner), 'enemyWarlordDestroyed', { unitId: u.id }); });
addActionHandler((s, a, x) => { if (a.armyFlag && !(s.players[x.u.owner].flags ??= []).includes(a.armyFlag)) s.players[x.u.owner].flags!.push(a.armyFlag); });
addModifier('battleShock', (s, u) => ((s.players[other(u.owner)].flags ?? []).includes('timeIsNigh') ? -1 : 0));

// Hyperspace Hunters (Deathmarks): an enemy unit arriving from Reserves within 18" in your opponent's turn is shot at once (once per turn)
on('arrived', (s, { u }) => {
  if (s.phase !== 'movement' || u.owner !== s.active) return;
  for (const d of boardUnits(s, other(u.owner)).filter((x) => x.abilities.some((a) => a.name === 'Hyperspace Hunters') && (x.used ?? {}).hyperspace !== String(s.turn))) {
    if (unitDistance(d, u) > 18 || !alive(d).some((m) => unitVisibleTo(s, m, u))) continue;
    (d.used ??= {}).hyperspace = String(s.turn);
    shootNow(s, d, u, 'Hyperspace Hunters');
  }
});

// Hunting Grounds: an enemy unit set up from Reserves, 2+: it takes a Battle-shock test
on('arrived', (s, { u }) => {
  if (!boardUnits(s, other(u.owner)).some((x) => x.enhancements.some((e) => e.name === 'Hunting Grounds')) || rollN(s, 1)[0] < 2) return;
  shockTest(s, u, 0, 'Hunting Grounds');
});
// THE SMOTHERING SHADOW: an enemy unit that fails a Battle-shock test
on('shockResult', (s, e) => { if (!e.passed && e.u.status === 'board') emitReact(s, other(e.u.owner), 'enemyShockFailed', { unitId: e.u.id }); });
// Bio-minefield: enemy units cannot start or end an Advance move within 6" of it
addModifier('moveBlock', (s, u, m, from, to, kind) => {
  if (kind !== 'advance') return null;
  const mine = boardUnits(s, other(u.owner)).find((x) => x.abilities.some((a) => a.name === 'Bio-minefield') && alive(x).some((n) => Math.hypot(n.x - from.x, n.y - from.y) - n.r - m.r <= 6 + 1e-6 || Math.hypot(n.x - to.x, n.y - to.y) - n.r - m.r <= 6 + 1e-6));
  return mine ? `Bio-minefield: no Advance move starting or ending within 6" of ${mine.name}` : null;
});


// Swallow Whole (The Red Terror): an INFANTRY / MOUNTED / BEASTS model destroyed by the gaping maw: it regains D3+2 wounds
on('modelKilled', (s, { u, m, killerId }) => {
  const k = killerId ? s.units.find((x) => x.id === killerId) : undefined;
  const pl = s.attack?.pools[s.attack.idx];
  if (!k || !pl || !/gaping maw/i.test(pl.weapon) || !k.abilities.some((a) => a.name === 'Swallow Whole') || !['INFANTRY', 'MOUNTED', 'BEASTS'].some((kw) => m.keywords.includes(kw))) return;
  const me = alive(k).find((x) => x.wounds < x.profile.W);
  if (!me) return;
  const n = Math.min(me.profile.W - me.wounds, rollExpr(s, 'D3+2').total);
  me.wounds += n;
  log(s, `Swallow Whole: ${k.name} regains ${n} wound${n === 1 ? '' : 's'}`, 'info', k.owner);
});

// RECLAIM BIOMASS: the HARVESTER regenerates a friendly TYRANIDS unit within 6" (models back for INFANTRY, else D3+1 wounds)
addActionHandler((s, a, x) => {
  if (!a.regenNear) return;
  const near = boardUnits(s, x.on.owner).filter((f) => f.factionKeywords.includes('TYRANIDS') && unitDistance(f, x.on) <= a.regenNear! + 1e-6);
  const inf = near.find((f) => f.keywords.includes('INFANTRY') && f.models.some((m) => m.dead && !m.isCharacter));
  if (inf) {
    let back = 0;
    for (const m of inf.models.filter((y) => y.dead && !y.isCharacter).slice(0, inf.keywords.includes('ENDLESS MULTITUDE') ? 3 : 1)) {
      m.dead = false; m.wounds = m.profile.W;
      if (setBackUp(s, inf, m, alive(inf).find((y) => y.id !== m.id) ?? m)) back++; else { m.dead = true; m.wounds = 0; }
    }
    if (back) log(s, `${x.label}: ${back} model(s) return to ${inf.name}`, 'info', x.on.owner);
    return;
  }
  const hurt = near.find((f) => alive(f).some((m) => m.wounds < m.profile.W));
  if (hurt) heal(s, hurt, rollExpr(s, 'D3+1').total);
});


// Metalodermal Tesla Weave: an enemy unit picks the bearer's unit as a charge target (once per phase): 2-5 D3, 6: 3 mortal wounds
on('targetChosen', (s, { attackerId, targetId }) => {
  if (s.phase !== 'charge') return;
  const A = unitById(s, attackerId), T = unitById(s, targetId);
  if (!A || !T || A.owner === T.owner || A.chargedTurn !== s.turn || !T.enhancements.some((e) => e.name === 'Metalodermal Tesla Weave') || (T.used ?? {}).tesla === phaseKey(s)) return;
  (T.used ??= {}).tesla = phaseKey(s);
  const r = rollN(s, 1)[0];
  log(s, `Metalodermal Tesla Weave: rolled ${r}`, 'roll', T.owner);
  if (r >= 2) applyMortalWounds(s, A, r === 6 ? 3 : rollExpr(s, 'D3').total, 'Metalodermal Tesla Weave');
});

// Seed Spore Mines / Seed Mucolids / Spore Mine Cysts: a new spore unit joins the army
addActionHandler((s, a, x) => {
  if (!a.seed) return;
  const n = a.seed.n === 'models' ? alive(x.u).length : rollExpr(s, a.seed.n).total;
  if (seedSpores(s, x.u, a.seed.name, n, a.seed.range, x.label) && a.seed.noShoot) x.u.weaponsFired = [...new Set(alive(x.u).flatMap((m) => m.weapons.map((w) => w.name)))];
});

// Eternity Gate (Monolith): a NECRONS INFANTRY unit is set up wholly within 6" of it, towards the closest enemy
addActionHandler((s, a, x) => {
  if (!a.gateWithin || x.on.id === x.u.id) return;
  const c = alive(x.u)[0];
  const foe = c ? boardUnits(s, other(x.u.owner)).flatMap(alive).sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0] : undefined;
  if (!setUpNear(s, x.on, x.u, a.gateWithin, foe ?? null)) { log(s, `${x.label}: no room for ${x.on.name}`, 'info', x.u.owner); return; }
  addTimed(s, x.on, { e: {}, label: x.label, until: 'turn', by: x.u.owner, mark: 'Eternity Gate' });
  x.on.cantCharge = true; // no charge this turn (DIMENSIONAL CORRIDOR lifts it)
  log(s, `${x.label}: ${x.on.name} steps through the Eternity Gate`, 'info', x.u.owner);
  emit(s, 'arrived', { u: x.on });
});

// Imposing Arrival: from Reserves, wholly within 8" of one battlefield edge and more than 6" from enemy units, nearest the enemy
addActionHandler((s, a, x) => {
  if (!a.edgeArrival || x.on.status !== 'reserves') return;
  const { edge, keep } = a.edgeArrival;
  const W = RULES.battlefield.width, H = RULES.battlefield.height;
  const foe = boardUnits(s, other(x.on.owner)).flatMap(alive)[0];
  const byEdge = (pos: Map<string, { x: number; y: number }>) => [(p: { x: number }) => p.x, (p: { y: number }) => p.y, (p: { x: number }) => W - p.x, (p: { y: number }) => H - p.y]
    .some((d) => [...pos.entries()].every(([id, p]) => d(p as { x: number; y: number }) + (x.on.models.find((m) => m.id === id)?.r ?? 0) <= edge + 1e-6));
  if (!setUpAway(s, x.on, keep, foe ?? { x: W / 2, y: H / 2 }, byEdge)) { log(s, `${x.label}: no room for ${x.on.name}`, 'info', x.on.owner); return; }
  x.on.move = 'ingress';
  log(s, `${x.label}: ${x.on.name} arrives near the battlefield edge`, 'info', x.on.owner);
  emit(s, 'arrived', { u: x.on });
});

// Hallowed Beacon: Deep Strike wholly within your Hallowed Ground, more than 6" from enemy units, nearest the enemy
addActionHandler((s, a, x) => {
  if (!a.hallowedArrival || x.on.status !== 'reserves') return;
  const foe = boardUnits(s, other(x.on.owner)).flatMap(alive)[0];
  const inside = (pos: Map<string, { x: number; y: number }>) => [...pos.values()].every((p) => inHallowedGround(s, x.on.owner, p));
  if (!setUpAway(s, x.on, a.hallowedArrival, foe ?? { x: 30, y: 22 }, inside)) { log(s, `${x.label}: no room for ${x.on.name} in Hallowed Ground`, 'info', x.on.owner); return; }
  x.on.move = 'ingress';
  log(s, `${x.label}: ${x.on.name} arrives in Hallowed Ground`, 'info', x.on.owner);
  emit(s, 'arrived', { u: x.on });
});

// Surrogate Hosts (Trazyn): another NECRONS INFANTRY CHARACTER model is destroyed (no death rules) and Trazyn takes its
// place, joining the unit it led
addActionHandler((s, a, x) => {
  if (!a.surrogate || x.on.id === x.u.id) return;
  const me = alive(x.u).find((m) => /Trazyn/i.test(m.source)) ?? alive(x.u)[0];
  const host = alive(x.on).find((m) => m.keywords.includes('CHARACTER') && m.keywords.includes('INFANTRY') && !m.keywords.includes('EPIC HERO') && !/Skorpekh Lord/i.test(m.source));
  if (!me || !host) return;
  me.x = host.x; me.y = host.y;
  host.dead = true; host.wounds = 0;
  x.u.models = x.u.models.filter((m) => m !== me);
  x.on.models.push(me);
  x.on.sources = [...new Set([...x.on.sources, me.source])];
  x.on.keywords = [...new Set([...x.on.keywords, ...me.keywords])];
  x.on.abilities = [...x.on.abilities, ...x.u.abilities.filter((ab) => !x.on.abilities.some((o) => o.name === ab.name))];
  x.on.pts += x.u.pts;
  if (!alive(x.u).length) x.u.status = 'destroyed';
  log(s, `Surrogate Hosts: ${me.name} takes the place of ${host.name} in ${x.on.name}`, 'info', x.on.owner);
});

// Transdimensional Displacement: an Advance with no maximum, through any model, ending more than 8" from every enemy unit
// (Reletavistic Tether: 6", and no charge this turn when it ends within 8")
addActionHandler((s, a, x) => {
  if (!a.displace || !onBoard(x.u) || x.u.move) return;
  const tether = x.u.enhancements.some((e) => e.name === 'Reletavistic Tether');
  const keep = tether ? 6 : a.displace;
  const foes = boardUnits(s, other(x.u.owner));
  const c = alive(x.u)[0];
  const foe = foes.flatMap(alive).sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0];
  if (!foe || !setUpAway(s, x.u, keep, foe)) return;
  x.u.move = 'advance';
  x.u.setUpTurn = -10; // it moved, it was not set up
  if (tether && foes.some((e) => unitDistance(x.u, e) <= 8 + 1e-6)) x.u.cantCharge = true;
  log(s, `${x.label}: ${x.u.name} reappears ${keep}" from the enemy`, 'info', x.u.owner);
});

// Strike Swiftly: up to two T'AU EMPIRE units within 6" of the bearer (without Scouts) get Scouts 6" for the battle
on('preBattle', (s) => {
  for (const b of s.units.filter((u) => u.status === 'board' && u.enhancements.some((e) => e.name === 'Strike Swiftly'))) {
    const picks = boardUnits(s, b.owner).filter((u) => u.id !== b.id && u.factionKeywords.includes('T’AU EMPIRE') && !unitFlags(s, u).scouts && !u.core.scouts && unitDistance(u, b) <= 6 + 1e-6)
      .sort((p, q) => q.pts - p.pts).slice(0, 2);
    for (const u of picks) addTimed(s, u, { e: { scouts: 6 }, label: 'Strike Swiftly', until: 'battle', by: b.owner });
    if (picks.length) log(s, `Strike Swiftly: ${picks.map((u) => u.name).join(', ')} gain Scouts 6"`, 'info', b.owner);
  }
});

// Psychostatic Disruption: once per battle in the first two rounds, an enemy unit arriving from Strategic Reserves is held back on a 4+
addModifier('arrivalDenied', (s, u) => {
  if ((u.used ?? {}).heldBack === String(s.turn)) return 'Held back by Psychostatic Disruption this turn';
  if (s.round > 2) return null;
  const b = boardUnits(s, other(u.owner)).find((x) => x.enhancements.some((e) => e.name === 'Psychostatic Disruption') && !x.used?.psychostatic);
  if (!b) return null;
  (b.used ??= {}).psychostatic = 'yes';
  const r = rollN(s, 1)[0];
  log(s, `Psychostatic Disruption: ${b.name} rolls ${r} against ${u.name}${r >= 4 ? ' — it cannot arrive this turn' : ''}`, 'roll', b.owner);
  if (r < 4) return null;
  (u.used ??= {}).heldBack = String(s.turn);
  return 'Held back by Psychostatic Disruption this turn';
});

// Solar Pulse: the objective marker within 18" with the most enemy value in range; those units lose cover against NECRONS
addActionHandler((s, a, x) => {
  if (!a.solarPulse) return;
  const near = (o: (typeof s.objectives)[number], u: UnitState) => unitInRange(s, u, o);
  const foes = boardUnits(s, other(x.u.owner));
  const objs = s.objectives.filter((o) => alive(x.u).some((m) => Math.hypot(m.x - o.x, m.y - o.y) - m.r <= a.solarPulse! + 1e-6));
  const o = objs.sort((p, q) => foes.filter((e) => near(q, e)).reduce((n, e) => n + e.pts, 0) - foes.filter((e) => near(p, e)).reduce((n, e) => n + e.pts, 0))[0];
  if (!o) return;
  const hit = foes.filter((e) => near(o, e));
  for (const e of hit) addTimed(s, e, { e: { incoming: { by: x.u.owner, units: ['NECRONS'], noCover: true } }, label: x.label, until: 'phase', by: x.u.owner });
  log(s, `${x.label}: ${hit.length ? hit.map((e) => e.name).join(', ') : 'no enemy unit'} near objective ${o.id} lose cover`, 'info', x.u.owner);
});

// A Tempting Trap: the Trap objective marker, picked the first time (not in the opponent's deployment zone), where the enemy stands
addActionHandler((s, a, x) => {
  const P = s.players[x.u.owner];
  if (!a.trap || P.trapObj) return;
  const opp = zonePoly(s, other(x.u.owner));
  const val = (o: (typeof s.objectives)[number]) => boardUnits(s, other(x.u.owner)).filter((e) => unitInRange(s, e, o)).reduce((n, e) => n + e.pts, 0);
  const o = s.objectives.filter((q) => !pointInPoly(q, opp)).sort((p, q) => val(q) - val(p))[0];
  if (o) { P.trapObj = o.id; log(s, `${x.label}: objective ${o.id} becomes the Trap objective marker`, 'info', x.u.owner); }
});
addCondition('targetNearTrap', (_c, x) => {
  const id = x.s.players[x.A.owner].trapObj;
  // before the first use: any objective marker it could become (the bot weighs the stratagem with that)
  const os = id ? x.s.objectives.filter((q) => q.id === id) : x.s.objectives.filter((q) => !pointInPoly(q, zonePoly(x.s, other(x.A.owner))));
  return !!x.T && os.some((o) => unitInRange(x.s, x.T!, o));
});

// unravelling (Pantheon of Woe): the last enemy unit to act is within a NECRONS MONSTER's Distortion Fields (6", 9" when paid for)
addCondition('lastUnravelling', (_c, x) => {
  const L = x.s.lastAct && x.s.lastAct.owner !== x.A.owner ? x.s.units.find((u) => u.id === x.s.lastAct!.unitId) : undefined;
  return !!L && boardUnits(x.s, x.A.owner).some((n) => n.keywords.includes('MONSTER') && n.factionKeywords.includes('NECRONS')
    && unitDistance(n, L) <= ((n.timed ?? []).some((t) => t.mark === 'distortion9') ? 9 : 6) + 1e-6);
});

// Integrated Tactics (Brood Brother Auxilia): the ASTRA MILITARUM unit can then only shoot at the enemy unit caught in overlapping fire
addModifier('targetBlock', (s, A, T, kind) => {
  if (kind !== 'shoot' || !(A.timed ?? []).some((t) => t.mark === 'integrated')) return null;
  return (T.timed ?? []).some((t) => t.mark === 'overlapping fire' && t.by === A.owner) ? null : 'Integrated Tactics: it can only shoot the unit caught in overlapping fire';
});

// On My Signal (Squadron Command): an enemy unit ends a Normal / Advance move within 8": the ordered unit makes a Normal move of up to D6" (once per turn)
on('unitMoved', (s, { u }) => {
  if (u.move !== 'normal' && u.move !== 'advance') return;
  for (const x of boardUnits(s, other(u.owner)).filter((x) => (x.timed ?? []).some((t) => t.mark === 'order:On My Signal') && unitDistance(x, u) <= 8 + 1e-6)) {
    if ((x.used ??= {}).onMySignal === String(s.turn) || x.extraMove || engagedEnemies(s, x).length) continue;
    x.used.onMySignal = String(s.turn);
    runActions(s, 'On My Signal', x, [{ on: 'self', move: 'D6' }], null);
  }
});

// Protean Purpose: re-pick Singular Purpose once its enemy unit is gone
addCondition(/^markGone:/, (c, x) => !boardUnits(x.s, other(x.A.owner)).some((e) => (e.timed ?? []).some((t) => t.mark === c.slice(9) && t.by === x.A.owner)));

addActionHandler((s, a, x) => { if (a.infoslave) infoslaveSkull(s, x.u); });

// Hyperphasic Recall: the unit steps back out next to a friendly MONOLITH
addActionHandler((s, a, x) => {
  if (!a.recallTo) return;
  const q = a.recallTo;
  const c = alive(x.on)[0];
  const host = c && boardUnits(s, x.on.owner).filter((h) => h.id !== x.on.id && alive(h).some((m) => m.keywords.includes(q.kw)))
    .sort((p, r) => unitDistance(p, x.on) - unitDistance(r, x.on))[0];
  if (!host || !setUpNear(s, x.on, host, q.within, null)) { log(s, `${x.label}: no room for ${x.on.name}`, 'info', x.on.owner); return; }
  log(s, `${x.label}: ${x.on.name} is recalled next to ${host.name}`, 'info', x.on.owner);
});

// Subterranean Assault: Tunnel Markers
on('arrived', (s, { u }) => tunnelArrived(s, u));
on('unitMoved', (s, { u }) => tunnelEnemyMoved(s, u));
addModifier('deepStrikeDistance', (s, u, at) => tunnelDeepStrike(s, u, at));
addCondition('tunnels:2', (_c, { s, A }) => (s.players[A.owner].tunnels ?? []).length >= 2);
addCondition(/^nearTunnel:/, (c, { s, A }) => nearTunnel(s, A, Number(c.split(':')[1])) >= 0);
addActionHandler((s, a, x) => { if (a.tyr === 'tunnel') tunnelNetwork(s, x.on); });

// Vox-relay Beacon: set up at the start of the battle on the objective closest to the enemy outside their deployment zone;
// removed at the end of a phase with an enemy unit within 1" of it
on('battleStart', (s) => {
  for (const p of [0, 1] as const) {
    const recon = s.units.find((u) => u.owner === p && u.abilities.some((a) => a.name === 'Vox-relay Beacon'));
    if (!recon) continue;
    const opp = zonePoly(s, other(p));
    const spot = s.objectives.filter((o) => !pointInPoly(o, opp)).sort((a, b) => Math.hypot(b.x - 22, b.y - 30) - Math.hypot(a.x - 22, a.y - 30)).reverse()[0];
    if (spot) { s.players[p].voxBeacon = { x: spot.x, y: spot.y }; log(s, 'Vox-relay Beacon set up', 'info', p); }
  }
});
on('phaseEnd', (s) => {
  for (const p of [0, 1] as const) {
    const b = s.players[p].voxBeacon;
    if (b && boardUnits(s, other(p)).some((e) => alive(e).some((m) => Math.hypot(m.x - b.x, m.y - b.y) - m.r <= 1 + 1e-6))) { s.players[p].voxBeacon = undefined; log(s, 'The Vox-relay Beacon is lost', 'info', p); }
  }
});

