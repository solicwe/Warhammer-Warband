// Relics as tokens (brass for the player's, red for the enemy's special rules): on the campaign screen and in the
// corner of the battlefield during a campaign battle. Tapping one says what it does.
import { useEffect, useState } from 'react';
import { bossRuleById, relicById } from '../engine/campaign';
import { Icon, type IconName } from './Icon';

const RELIC_ICON: Record<string, IconName> = {
  litany: 'reroll', stimms: 'plus', plating: 'hold', smoke: 'cloud', blade: 'fight', overdrive: 'shoot', sandals: 'move', banner: 'objective',
  ledger: 'reroll', barrels: 'ruler', zeal: 'charge', relentless: 'advance', lethal: 'target', fury: 'fight', iron: 'hold', cache: 'strat',
};
const RULE_ICON: Record<string, IconName> = { 'iron-will': 'hold', deadeye: 'target', warlord: 'leader', numbers: 'objective', armour: 'hold', savage: 'charge' };

export function RelicToken({ id, enemy, big, onInfo }: { id: string; enemy?: boolean; big?: boolean; onInfo?: (text: string) => void }) {
  const r = enemy ? bossRuleById(id) : relicById(id);
  if (!r) return null;
  const rare = !enemy && relicById(id)?.rare;
  const cls = `relic ${enemy ? 'enemy' : ''} ${rare ? 'rare' : ''} ${big ? 'big' : ''}`;
  const icon = <Icon name={(enemy ? RULE_ICON[id] : RELIC_ICON[id]) ?? 'enhancement'} size={big ? 22 : 16} />;
  // inside another button (a reward card) it is only a picture
  if (!onInfo) return <span className={cls} title={`${r.name}: ${r.text}`} aria-hidden="true">{icon}</span>;
  return (
    <button type="button" className={cls} title={`${r.name}: ${r.text}`} aria-label={`${r.name}: ${r.text}`}
      onClick={(e) => { e.stopPropagation(); onInfo(`${r.name}: ${r.text}`); }}>
      {icon}
    </button>
  );
}

/** The player's relics and the enemy's rules: one small badge in the board's corner (it never covers the models);
 *  tapping it opens them for a few seconds, tapping a token says what it does. */
export function RelicStrip({ relics, rules, onInfo }: { relics: string[]; rules: string[]; onInfo: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const t = window.setTimeout(() => setOpen(false), 6000); return () => window.clearTimeout(t); }, [open]);
  if (!relics.length && !rules.length) return null;
  if (!open) {
    return (
      <button type="button" className="relic-badge" aria-label={`${relics.length} relics, ${rules.length} enemy rules: show`} onClick={() => setOpen(true)}>
        <span className="relic small" aria-hidden="true"><Icon name="enhancement" size={12} /></span><b>{relics.length}</b>
        {rules.length > 0 && <><span className="relic small enemy" aria-hidden="true"><Icon name="skull" size={12} /></span><b>{rules.length}</b></>}
      </button>
    );
  }
  return (
    <div className="relic-strip" aria-label="Relics and enemy rules">
      {relics.map((id) => <RelicToken key={id} id={id} onInfo={onInfo} />)}
      {rules.length > 0 && relics.length > 0 && <span className="relic-sep" aria-hidden="true" />}
      {rules.map((id) => <RelicToken key={id} id={id} enemy onInfo={onInfo} />)}
      <button type="button" className="relic-close" aria-label="Hide" onClick={() => setOpen(false)}><Icon name="close" size={14} /></button>
    </div>
  );
}
