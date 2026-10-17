// One detachment stratagem, ready to use: pick the unit, the option ("select either …"), the enemy unit, then use it.
// Shared by the Stratagem tray and the prompt the game opens at a stratagem's moment ("just after an enemy unit has shot").
import { useState, type ReactNode } from 'react';
import { alive, onBoard, stratCost, type ReactCtx } from '../engine/state';
import { EFFECT_LABEL, stratagemBlock, stratChoices, stratEnemies, type StratRule, type StratUse as Use } from '../engine/stratagems';
import type { GameState, PlayerId, StratagemData, UnitState } from '../engine/types';
import { Icon } from './Icon';

const short = (n: string) => (n.length > 22 ? n.slice(0, 21) + '…' : n);

interface StratSection {
  label?: string;
  text: string;
}

/** Parses raw Warhammer 40k stratagem rules text into WHEN / TARGET / EFFECT / RESTRICTIONS blocks */
function parseStratagemSections(rawText: string): StratSection[] {
  if (!rawText) return [];
  const parts = rawText
    .split(/(?=(?:^|\s)(?:WHEN|TARGET|EFFECT|RESTRICTIONS):)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!parts.length) return [{ text: rawText }];

  return parts.map((part) => {
    const match = part.match(/^(WHEN|TARGET|EFFECT|RESTRICTIONS):\s*([\s\S]*)$/i);
    if (match) {
      return {
        label: match[1].toUpperCase(),
        text: match[2].trim(),
      };
    }
    return { text: part };
  });
}

const EXCLUDED_KW = new Set([
  'WHEN', 'TARGET', 'EFFECT', 'RESTRICTIONS', 'OR', 'AND', 'THE', 'A', 'IN', 'ON', 'AT',
  'TO', 'FOR', 'OF', 'WITH', 'BY', 'AS', 'IF', 'NOT', 'NO', 'CP', 'VP', 'D6', 'D3'
]);

/** Tokenizes rule text to highlight numeric distances (amber/gold), keywords (mini-badges), and key terms */
function highlightRuleTokens(text: string): ReactNode[] {
  const pattern = /(\b(?:D\d(?:\+\d+)?|\d+(?:\.\d+)?)(?:"|”))|(\b[A-Z]{2,}(?:[/\\-][A-Z]{2,})*(?:\s+[A-Z]{2,}(?:[/\\-][A-Z]{2,})*)*\b)|(\b(?:normal move|fall(?:s)? back|advance(?:d|s)?|tactical doctrine|devastator doctrine|assault doctrine|benefit of cover|feel no pain \d\+|invulnerable save of \d\+|\d\+ invulnerable save|critical hit(?:s)?|critical wound(?:s)?|battle-shock(?:ed)?|mortal wound(?:s)?|deadly demise|rapid fire|sustained hits|lethal hits|devastating wounds)\b)/gi;

  const out: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }

    const [full, dist, kw, term] = match;
    const key = `${match.index}-${full}`;

    if (dist) {
      out.push(<span key={key} className="strat-dist">{dist}</span>);
    } else if (kw) {
      if (EXCLUDED_KW.has(kw.toUpperCase())) {
        out.push(kw);
      } else {
        out.push(<b key={key} className="strat-kw">{kw}</b>);
      }
    } else if (term) {
      out.push(<b key={key} className="strat-term">{term}</b>);
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }

  return out;
}

export function StratUseCard({ s, p, st, rule, detachment, units, ctx, react, bot, auto, onAuto, onUse }: {
  s: GameState; p: PlayerId; st: StratagemData; rule: StratRule; detachment: string;
  /** units it can be used on (own units, or units in Reserves / just destroyed) */
  units: UnitState[];
  ctx?: ReactCtx; react?: boolean; bot?: boolean;
  auto?: boolean; onAuto?: () => void;
  onUse: (unitId: string | undefined, use: Use) => void;
}) {
  const [unitId, setUnitId] = useState<string>(units.length === 1 ? units[0].id : '');
  const [choice, setChoice] = useState<number | undefined>(undefined);
  const [enemyId, setEnemyId] = useState<string>('');
  const [extra, setExtra] = useState<string[]>([]);
  const [fullTextOpen, setFullTextOpen] = useState(false);

  const unit = units.find((u) => u.id === unitId);
  const why = stratagemBlock(s, p, st, unit, { react, ctx });
  const timingOk = !why || /Select a target|Must be one of your units|Select an enemy unit|Not enough CP|TARGET|does not qualify|No enemy unit/.test(why);
  const cost = stratCost(s, st.id, unit?.owner === p && onBoard(unit) ? unit : undefined, st.cp);
  const choices = stratChoices(s, rule, unit);
  const enemies = rule.enemy && !rule.enemy.all ? stratEnemies(s, p, rule, unit, ctx) : [];
  const pickedChoice = choice ?? (choices.length === 1 ? choices[0].i : undefined);
  const needChoice = choices.length > 1 && pickedChoice === undefined;
  const pickedEnemy = enemies.find((e) => e.id === enemyId) ?? (enemies.length === 1 ? enemies[0] : undefined);
  const needEnemy = enemies.length > 1 && !pickedEnemy;

  // Guerrilla Tactics: "up to two PHOBOS and/or SCOUT SQUAD units"
  const extraOk = (u: UnitState) => !!rule.extraTargets && u.id !== unitId
    && (!rule.extraTargets.kw || [unit, u].every((x) => x && rule.extraTargets!.kw!.some((k) => x.keywords.includes(k) || (x.sources ?? [x.name]).some((n) => n.toUpperCase() === k))))
    && [unit, u].every((x) => x && !rule.extraTargets!.notKw?.some((k) => x.keywords.includes(k)));

  const sections = parseStratagemSections(st.text);

  // Construct structured CTA labels
  let ctaPrimary = `Use ${st.name}`;
  let ctaSecondary: ReactNode = null;

  if (why) {
    ctaPrimary = 'Unavailable';
    ctaSecondary = <span className="strat-cta-msg">{why}</span>;
  } else if (needChoice) {
    ctaPrimary = `Use ${st.name}`;
    ctaSecondary = <span className="strat-cta-msg">Select an option above</span>;
  } else if (needEnemy) {
    ctaPrimary = `Use ${st.name}`;
    ctaSecondary = <span className="strat-cta-msg">Select an enemy target above</span>;
  } else if (unit) {
    ctaPrimary = `Use ${st.name}`;
    ctaSecondary = (
      <span className="strat-cta-target" title={unit.name}>
        <Icon name="next" size={11} className="strat-cta-arrow" />
        <span>Target: <b>{unit.name}</b></span>
        {unit.status === 'reserves' && <span className="strat-cta-sub">(Reserves)</span>}
        {!alive(unit).length && <span className="strat-cta-sub">(Destroyed)</span>}
        {extra.length > 0 && <span className="strat-cta-sub">(+{extra.length} more)</span>}
        {pickedEnemy && <span className="strat-cta-sub">• vs {pickedEnemy.name}</span>}
      </span>
    );
  } else {
    ctaPrimary = `Use ${st.name}`;
    ctaSecondary = (
      <span className="strat-cta-target">
        <Icon name="next" size={11} className="strat-cta-arrow" />
        <span>Activate Stratagem</span>
      </span>
    );
  }

  return (
    <div className={`strat-card ${timingOk ? '' : 'off'}`}>
      {/* 1. Header & Metadata Section */}
      <div className="strat-head">
        <div className="strat-title-row">
          <div className="strat-title" title={st.name}>
            {st.name}
          </div>
          <div className="strat-cp-badge">
            {cost !== st.cp && <span className="strat-cp-orig">{st.cp}</span>}
            <span>{cost}CP</span>
          </div>
        </div>

        <div className="strat-meta-row">
          <div className="strat-meta-info">
            <span>{detachment}</span>
            <span className="strat-meta-dot">•</span>
            <span>{st.turn}</span>
            <span className="strat-meta-dot">•</span>
            <span>{st.phase}</span>
          </div>

          <div className="strat-badges-wrap">
            <span className={`strat-pill ${rule.status === 'auto' || !rule.status ? 'auto' : rule.status === 'partial' ? 'partial' : 'manual'}`}>
              {rule.status === 'auto' || !rule.status ? (
                'Automated'
              ) : rule.status === 'partial' ? (
                <><Icon name="partial" size={11} /> Mostly automated</>
              ) : (
                'Resolve as written'
              )}
            </span>
            {(rule.buffs ?? []).map((k) => (
              <span key={k} className="strat-pill buff">{EFFECT_LABEL[k] ?? k}</span>
            ))}
          </div>
        </div>

        {rule.note && <div className="strat-note">{rule.note}</div>}
      </div>

      {/* 2. Collapsible "Full text" Rules Section */}
      <div className="strat-accordion-wrap">
        <button
          type="button"
          className="strat-accordion-btn"
          onClick={() => setFullTextOpen((o) => !o)}
          aria-expanded={fullTextOpen}
        >
          <span className="strat-accordion-line" />
          <span className="strat-accordion-label">
            <Icon name="down" size={13} className={`strat-accordion-icon ${fullTextOpen ? 'open' : ''}`} />
            <span>{fullTextOpen ? 'Hide full text' : 'Full text'}</span>
          </span>
          <span className="strat-accordion-line" />
        </button>

        {fullTextOpen && (
          <div className="strat-rules-inset">
            {sections.map((sec, idx) => (
              <div key={idx} className="strat-rule-block">
                {sec.label && <span className="strat-rule-tag">{sec.label}:</span>}{' '}
                <span className="strat-rule-body">{highlightRuleTokens(sec.text)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bot notification */}
      {timingOk && bot && (
        <div className="strat-bot-hint">
          <Icon name="bot" size={14} />
          <span>The bot decides when to use this Stratagem</span>
        </div>
      )}

      {/* Interactive Selection & Primary Action Button */}
      {timingOk && !bot && (
        <>
          {units.length > 1 && (
            <div className="strat-pick-group">
              <div className="strat-pick-label">Select friendly target unit:</div>
              <div className="unit-strip">
                {units.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`unit-pill ${unitId === u.id ? 'sel' : extra.includes(u.id) ? 'sel2' : ''}`}
                    onClick={() => {
                      if (unitId && unitId !== u.id && extraOk(u) && extra.length < (rule.extraTargets?.count ?? 1) - 1) {
                        setExtra(extra.includes(u.id) ? extra.filter((x) => x !== u.id) : [...extra, u.id]);
                        return;
                      }
                      setUnitId(unitId === u.id ? '' : u.id);
                      setExtra([]);
                      setChoice(undefined);
                      setEnemyId('');
                    }}
                  >
                    <span className={`side-dot s${u.owner}`} aria-hidden="true" /> {short(u.name)}
                    {u.status === 'reserves' ? ' (Reserves)' : !alive(u).length ? ' (destroyed)' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {rule.extraTargets && unit && (
            <div className="tiny muted">
              You can select {rule.extraTargets.count - 1 - extra.length} more unit(s) (tap another unit)
            </div>
          )}

          {choices.length > 1 && (
            <div className="strat-pick-group">
              <div className="strat-pick-label">Select mode:</div>
              <div className="wg-chips">
                {choices.map(({ o, i }) => (
                  <button
                    key={i}
                    type="button"
                    className={pickedChoice === i ? 'on' : ''}
                    onClick={() => setChoice(i)}
                  >
                    {pickedChoice === i && <Icon name="check" size={14} />}{o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {enemies.length > 1 && (
            <div className="strat-pick-group">
              <div className="strat-pick-label">Select enemy unit:</div>
              <div className="unit-strip">
                {enemies.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`unit-pill ${pickedEnemy?.id === e.id ? 'sel' : ''}`}
                    onClick={() => setEnemyId(e.id)}
                  >
                    <span className={`side-dot s${e.owner}`} aria-hidden="true" /> {short(e.name)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {enemies.length === 1 && (
            <div className="tiny muted">Enemy: <b>{enemies[0].name}</b></div>
          )}

          {/* 3. Primary Action Button (CTA) */}
          <button
            type="button"
            className="strat-cta-btn"
            disabled={!timingOk || !!why || needChoice || needEnemy}
            onClick={() => onUse(unit?.id, { choice: pickedChoice, enemyId: pickedEnemy?.id, extraIds: extra })}
          >
            <span className="strat-cta-primary">{ctaPrimary}</span>
            <span className="strat-cta-secondary">{ctaSecondary}</span>
          </button>

          {/* 4. Footer Auto-Use Setting */}
          {onAuto && (
            <div className="strat-footer-auto">
              <label className="strat-auto-label">
                <span className="strat-auto-text">Use automatically when it comes up (don't ask)</span>
                <div className="strat-switch-wrap">
                  <input
                    type="checkbox"
                    className="strat-switch-input"
                    checked={!!auto}
                    onChange={onAuto}
                  />
                  <span className={`strat-switch-track ${auto ? 'checked' : ''}`}>
                    <span className="strat-switch-thumb" />
                  </span>
                </div>
              </label>
            </div>
          )}
        </>
      )}

      {!timingOk && <div className="tiny muted">{why}</div>}
    </div>
  );
}
