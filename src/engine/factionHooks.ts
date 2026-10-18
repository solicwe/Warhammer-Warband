// Faction modules subscribe to the game loop here. One block per faction; within each event the handlers run in the
// order of the blocks below, which keeps dice rolls (and so seeded games) the same.
// To add a faction: write its module, then add a block that subscribes its functions to the events it needs.
import { addModifier, on } from './events';
import { blessingsRoundStart } from './blessings';
import { initFavoured, pledgeRoundEnd, pledgeRoundStart, poisonTick, snapshotEngaged } from './emperorsChildren';
import { dgBattleStart, dgCommandEnd, dgCommandStart, dgPhaseEnd, dgRoundStart } from './deathGuard';
import { knightsBattleStart, knightsCommandStart, knightsMoved, knightsRoundEnd, knightsRoundStart, knightsShockFailed, knightsShootingStart, knightsTurnEnd, knightsTurnStart } from './knights';
import { resetPhaseActsOfFaith, sororitasCommandEnd, sororitasTurnStart } from './sororitas';
import { aeldariBattleStart, aeldariCommandEnd, aeldariTurnStart, resetPhaseStrandsOfFate } from './aeldari';
import { votannBattleStart, votannCommandEnd } from './votann';
import { admechCommandStart, admechRoundStart } from './admech';
import { drukhariBattleStart, drukhariCommandStart, drukhariPhaseEnd } from './drukhari';
import { daemonBattleShockMod, daemonsBattleStart, daemonsCommandStart, daemonsDeepStrikeDist, daemonsOnBattleShockResult, daemonsPhaseEnd } from './daemons';
import { cultAmbushArrival, cultAmbushCheckEnemyMoved, cultBattleStart, cultIconCommandPhase } from './cult';
import { necBattleStart, necCommandStart } from './necrons';
import { gkEndOpponentTurn } from './greyKnights';

// World Eaters: Blessings of Khorne
on('roundStart', (s) => blessingsRoundStart(s));

// Emperor's Children
on('battleStart', (s) => initFavoured(s));
on('turnBegin', (s) => snapshotEngaged(s));
on('roundStart', (s) => pledgeRoundStart(s));
on('commandStart', (s) => poisonTick(s));
on('roundEnd', (s) => pledgeRoundEnd(s));

// Death Guard
on('battleStart', (s) => dgBattleStart(s));
on('roundStart', (s) => dgRoundStart(s));
on('commandStart', (s) => dgCommandStart(s));
on('phaseEnd', (s) => dgPhaseEnd(s));
on('commandEnd', (s) => dgCommandEnd(s));

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

// Adepta Sororitas
on('turnStart', (s, e) => sororitasTurnStart(s, e.p));
on('phaseEnd', (s) => resetPhaseActsOfFaith(s));
on('commandEnd', (s, e) => sororitasCommandEnd(s, e.p));

// Aeldari
on('battleStart', (s) => aeldariBattleStart(s));
on('turnStart', (s, e) => aeldariTurnStart(s, e.p));
on('phaseEnd', (s) => resetPhaseStrandsOfFate(s));
on('commandEnd', (s, e) => aeldariCommandEnd(s, e.p));

// Leagues of Votann
on('battleStart', (s) => votannBattleStart(s));
on('commandEnd', (s, e) => votannCommandEnd(s, e.p));

// Adeptus Mechanicus: the Doctrina Imperatives are set at the start of every battle round, the first one included
on('battleStart', (s) => admechRoundStart(s));
on('roundStart', (s) => admechRoundStart(s));
on('commandStart', (s, e) => admechCommandStart(s, e.p));

// Drukhari
on('battleStart', (s) => drukhariBattleStart(s));
on('commandStart', (s, e) => drukhariCommandStart(s, e.p));
on('phaseEnd', (s) => drukhariPhaseEnd(s));

// Chaos Daemons
on('setup', (s) => daemonsBattleStart(s));
on('battleStart', (s) => daemonsBattleStart(s));
on('commandStart', (s) => daemonsCommandStart(s));
on('phaseEnd', (s) => daemonsPhaseEnd(s));
on('shockResult', (s, e) => daemonsOnBattleShockResult(s, e.u, e.passed));
addModifier('battleShock', daemonBattleShockMod);
addModifier('deepStrikeDistance', daemonsDeepStrikeDist);

// Genestealer Cults
on('setup', (s) => cultBattleStart(s));
on('battleStart', (s) => cultBattleStart(s));
on('commandStart', (s, e) => cultIconCommandPhase(s, e.p));
on('movementEnd', (s) => cultAmbushArrival(s));
on('unitMoved', (s, e) => cultAmbushCheckEnemyMoved(s, e.u));

// Necrons
on('setup', (s) => necBattleStart(s));
on('battleStart', (s) => necBattleStart(s));
on('commandStart', (s, e) => necCommandStart(s, e.p));

// Grey Knights
on('turnEnd', (s) => gkEndOpponentTurn(s));
