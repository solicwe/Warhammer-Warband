// Relics as tokens (brass for the player's, red for the enemy's special rules): on the campaign screen and in the
// corner of the battlefield during a campaign battle. Tapping one says what it does.

import { bossRuleById, relicById } from '../engine/campaign';
import { Icon, type IconName } from './Icon';

const RELIC_ICON: Record<string, IconName> = {
  litany: 'reroll', stimms: 'plus', plating: 'hold', smoke: 'cloud', blade: 'fight', overdrive: 'shoot', sandals: 'move', banner: 'objective',
  ledger: 'reroll', barrels: 'ruler', zeal: 'charge', relentless: 'advance', lethal: 'target', fury: 'fight', iron: 'hold', cache: 'strat',
  auspex: 'shoot', chains: 'fight', hymn: 'shock', servo: 'wargear', jump: 'advance', bulwark: 'hold', veterans: 'target', brutes: 'skull',
  mantle: 'leader', rounds: 'shoot', firstblow: 'charge', reaper: 'fight', shield: 'hold', devastate: 'target', grip: 'objective',
};
const RULE_ICON: Record<string, IconName> = { 'iron-will': 'hold', deadeye: 'target', warlord: 'leader', numbers: 'objective', armour: 'hold', savage: 'charge' };

export function RelicToken({ id, enemy, big, lvl, onInfo }: { id: string; enemy?: boolean; big?: boolean; lvl?: number; onInfo?: (text: string) => void }) {
  const r = enemy ? bossRuleById(id) : relicById(id);
  if (!r) return null;
  const rare = !enemy && relicById(id)?.rare;
  const cls = `relic ${enemy ? 'enemy' : ''} ${rare ? 'rare' : ''} ${big ? 'big' : ''} ${lvl && lvl > 1 ? 'upgraded' : ''}`;
  const icon = <Icon name={(enemy ? RULE_ICON[id] : RELIC_ICON[id]) ?? 'enhancement'} size={big ? 22 : 16} />;
  const badge = lvl && lvl > 1 ? <span className="relic-lvl-badge">Lv.{lvl}</span> : null;
  const title = `${r.name}${lvl && lvl > 1 ? ` (Lv.${lvl})` : ''}: ${r.text}`;
  // inside another button (a reward card) it is only a picture
  if (!onInfo) return (
    <span className={`relic-wrap ${big ? 'big' : ''}`} title={title} aria-hidden="true">
      <span className={cls}>{icon}</span>
      {badge}
    </span>
  );
  return (
    <button
      type="button"
      className={`relic-wrap ${big ? 'big' : ''}`}
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onInfo(title); }}
    >
      <span className={cls}>{icon}</span>
      {badge}
    </button>
  );
}
