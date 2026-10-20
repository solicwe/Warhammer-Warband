// Adeptus Mechanicus: the Doctrina Imperatives are a choice each battle round (data/detachment-rules.json, with the
// abilities, detachment rules and stratagems in data). This keeps the active Imperative on the player for the HUD.
import { alive, boardUnits, log } from '../engine/state';
import { dist } from '../engine/geometry';
import { unitInRange } from '../engine/missions';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';

export function admechImperativePicked(s: GameState, p: PlayerId, rule: string, ids: string[]) {
  if (rule !== 'Doctrina Imperatives') return;
  s.players[p].admechImperative = ids.includes('conqueror') ? 'Conqueror Imperative' : 'Protector Imperative';
}

/** Acquisition At Any Cost (Explorator Maniple): start of your Command phase, the objective marker you do not control
 *  closest to your units becomes the Acquisition objective until your next Command phase. */
export function pickAcquisition(s: GameState, p: PlayerId) {
  if (!(s.players[p].detachments ?? []).some((d) => d.name === 'Explorator Maniple')) return;
  const ms = boardUnits(s, p).flatMap(alive);
  const near = (o: Pt) => Math.min(99, ...ms.map((m) => dist(m, o)));
  const o = s.objectives.filter((x) => x.controller !== p).sort((a, b) => near(a) - near(b))[0] ?? s.objectives.sort((a, b) => near(a) - near(b))[0];
  if (!o) return;
  s.players[p].acquisitionId = o.id;
  s.players[p].acquisitionExtra = undefined;
  log(s, `Acquisition At Any Cost: objective ${o.id} is the Acquisition objective`, 'info', p);
}

/** Is the unit within range of player p's Acquisition objective? */
export const onAcquisition = (s: GameState, p: PlayerId, u: UnitState) => {
  const ids = [s.players[p].acquisitionId, s.players[p].acquisitionExtra];
  return s.objectives.some((o) => ids.includes(o.id) && unitInRange(s, u, o));
};

/** INFOSLAVE SKULL: an objective marker within 24" of the TECH-PRIEST becomes a second Acquisition objective (the one we
 *  do not control closest to our units). */
export function infoslaveSkull(s: GameState, u: UnitState) {
  const P = s.players[u.owner];
  const ms = boardUnits(s, u.owner).flatMap(alive);
  const near = (o: Pt) => Math.min(99, ...ms.map((m) => dist(m, o)));
  const o = s.objectives.filter((x) => x.id !== P.acquisitionId && alive(u).some((m) => dist(m, x) <= 24)).sort((a, b) => Number(a.controller === u.owner) - Number(b.controller === u.owner) || near(a) - near(b))[0];
  if (!o) return;
  P.acquisitionExtra = o.id;
  log(s, `INFOSLAVE SKULL: objective ${o.id} is also an Acquisition objective`, 'info', u.owner);
}
