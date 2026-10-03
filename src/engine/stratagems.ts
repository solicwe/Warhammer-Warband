// Reads detachment stratagem text (WHEN / TARGET / EFFECT) so the game can offer them at the right time
// and apply the common effects automatically. Anything it cannot read is still usable: CP is spent and logged.
import { canUseStratagem, log, spendStratagem, stratCost, unitById } from './state';
import type { BuffKind, GameState, Phase, PlayerId, StratagemData, UnitState } from './types';

export interface StratagemPlan {
  phases: Phase[] | 'any';
  turn: 'your' | 'opponent' | 'either';
  target: 'own' | 'enemy' | 'none';
  effects: BuffKind[];
  until: 'phase' | 'turn';
  /** true when every sentence of the effect was understood */
  full: boolean;
}

const PHASES: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight'];

const OFFENSE: [RegExp, BuffKind][] = [
  [/add 1 to the hit roll/, 'hit+1'],
  [/add 1 to the wound roll/, 'wound+1'],
  [/re-roll a hit roll of 1/, 'rerollHits1'],
  [/re-roll the hit roll/, 'rerollHits'],
  [/re-roll a wound roll of 1/, 'rerollWounds1'],
  [/re-roll the wound roll/, 'rerollWounds'],
  [/improve the armour penetration characteristic of (?:that|those|the) (?:attack|weapon)s? by 1/, 'ap+1'],
  [/\[lethal hits\]/, 'lethal'],
  [/\[sustained hits 1\]/, 'sustained1'],
  [/\[devastating wounds\]/, 'devastating'],
  [/\[ignores cover\]/, 'ignoresCover'],
];
const DEFENSE: [RegExp, BuffKind][] = [
  [/subtract 1 from the hit roll/, 'enemyHit-1'],
  [/subtract 1 from the wound roll/, 'enemyWound-1'],
  [/worsen the armour penetration characteristic of (?:that|the) attack by 1/, 'enemyAp-1'],
  [/subtract 1 from the damage characteristic/, 'damage-1'],
  [/feel no pain 4\+/, 'fnp4'],
  [/feel no pain 5\+/, 'fnp5'],
  [/feel no pain 6\+/, 'fnp6'],
  [/benefit of cover/, 'cover'],
  [/add 1 to the armour saving throw|improve the save characteristic .* by 1/, 'save+1'],
];
const OTHER: [RegExp, BuffKind][] = [
  [/fights first/, 'fightsFirst'],
  [/add 1 to (?:advance and charge rolls|the advance and charge rolls)/, 'advanceCharge+1'],
];

export const EFFECT_LABEL: Partial<Record<BuffKind, string>> = {
  'hit+1': '+1 Hit', 'wound+1': '+1 Wound', rerollHits1: 'Re-roll Hit 1', rerollHits: 'Re-roll Hits', rerollWounds1: 'Re-roll Wound 1', rerollWounds: 'Re-roll Wounds',
  'ap+1': 'AP +1', lethal: 'Lethal Hits', sustained1: 'Sustained Hits 1', devastating: 'Devastating Wounds', ignoresCover: 'Ignores Cover',
  'enemyHit-1': 'ศัตรู −1 Hit', 'enemyWound-1': 'ศัตรู −1 Wound', 'enemyAp-1': 'ศัตรู AP −1', 'damage-1': '−1 Damage', fnp4: 'FNP 4+', fnp5: 'FNP 5+', fnp6: 'FNP 6+',
  cover: 'Benefit of Cover', 'save+1': '+1 Save', fightsFirst: 'Fights First', 'advanceCharge+1': '+1 Advance/Charge',
};

const section = (text: string, key: string) => {
  const m = text.match(new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n?(?:WHEN|TARGET|EFFECT|RESTRICTIONS):|$)`, 'i'));
  return m ? m[1].trim() : '';
};

export function planStratagem(st: StratagemData): StratagemPlan {
  const phaseText = `${st.phase} ${section(st.text, 'WHEN')}`.toLowerCase();
  const phases: Phase[] | 'any' = /any phase/.test(st.phase.toLowerCase()) ? 'any' : PHASES.filter((p) => phaseText.includes(`${p} phase`) || st.phase.toLowerCase().includes(p));
  const tt = st.turn.toLowerCase();
  const turn = tt.startsWith('your') ? 'your' : tt.startsWith('opponent') ? 'opponent' : 'either';
  const tgt = section(st.text, 'TARGET').toLowerCase();
  const target = /from your army/.test(tgt) ? 'own' : /enemy unit/.test(tgt) ? 'enemy' : tgt ? 'own' : 'none';
  const eff = section(st.text, 'EFFECT').toLowerCase().replace(/’/g, "'");
  const effects: BuffKind[] = [];
  for (const [re, k] of [...OFFENSE, ...DEFENSE, ...OTHER]) if (re.test(eff) && !effects.includes(k)) effects.push(k);
  // "re-roll the hit roll" also matches inside "re-roll a hit roll of 1" phrasing variants; keep the stronger one only
  if (effects.includes('rerollHits') && effects.includes('rerollHits1')) effects.splice(effects.indexOf('rerollHits1'), 1);
  if (effects.includes('rerollWounds') && effects.includes('rerollWounds1')) effects.splice(effects.indexOf('rerollWounds1'), 1);
  const until = /end of the turn|start of your next/.test(eff) ? 'turn' : 'phase';
  const sentences = eff.split(/(?<=\.)\s+/).filter((x) => x.length > 3);
  const full = effects.length > 0 && sentences.length <= 2 && !/select|instead|mortal wound|d6|roll one|set up|move/.test(eff);
  return { phases, turn, target, effects, until, full };
}

/** Why the stratagem cannot be used right now (timing / CP / once per phase), or null. */
export function stratagemBlock(s: GameState, p: PlayerId, st: StratagemData, unit?: UnitState): string | null {
  const plan = planStratagem(st);
  if (s.phase === 'deploy' || s.phase === 'scouts' || s.phase === 'gameover') return 'ยังไม่เริ่ม battle round';
  if (plan.turn === 'your' && s.active !== p) return 'ใช้ได้เฉพาะเทิร์นของคุณ';
  if (plan.turn === 'opponent' && s.active === p) return 'ใช้ได้เฉพาะเทิร์นศัตรู';
  if (plan.phases !== 'any' && plan.phases.length && !plan.phases.includes(s.phase)) return `ใช้ได้ใน ${plan.phases.join(' / ')} phase`;
  if (plan.target === 'own' && !unit) return 'เลือกหน่วยเป้าหมายก่อน';
  if (unit && plan.target === 'own' && unit.owner !== p) return 'ต้องเป็นหน่วยของคุณ';
  if (unit && plan.target === 'enemy' && unit.owner === p) return 'ต้องเลือกหน่วยศัตรู';
  return canUseStratagem(s, p, st.id, plan.target === 'own' ? unit : undefined, st.cp);
}

/** Spend CP, log, and apply what the effect text says to the target unit. Returns the effects applied. */
export function applyDetachmentStratagem(s: GameState, p: PlayerId, st: StratagemData, unitId?: string): BuffKind[] {
  const plan = planStratagem(st);
  const u = unitId ? unitById(s, unitId) : undefined;
  const cp = stratCost(s, st.id, plan.target === 'own' ? u : undefined, st.cp);
  spendStratagem(s, p, st.id, plan.target === 'own' ? u : undefined, st.cp);
  if (u && plan.target === 'own') for (const k of plan.effects) u.buffs.push({ kind: k, until: plan.until, label: st.name });
  const what = plan.effects.map((k) => EFFECT_LABEL[k] ?? k).join(', ');
  log(s, `${s.players[p].name} ใช้ ${st.name} (${cp}CP)${u ? ` → ${u.name}` : ''}${what ? `: ${what}` : ''}${plan.full ? '' : ' — ส่วนที่เหลือทำตามข้อความ'}`, 'cp', p);
  return plan.effects;
}

/** Stratagems of a player's detachments that could be used now, with the reason when not. */
export function stratagemsNow(s: GameState, p: PlayerId) {
  return s.players[p].detachments.flatMap((d) => d.stratagems.map((st) => ({ st, plan: planStratagem(st), detachment: d.name })));
}

