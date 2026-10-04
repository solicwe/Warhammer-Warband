// Army rule text laid out: bullet lists (nested after a "…:" bullet), named options (Mission Tactics, Templar Vows …)
// as boxed rows with their flavour text in italics, and Designer's Notes / Examples set apart.
import type { ReactNode } from 'react';

type Bullet = { text: string; sub: string[] };
type Block = { kind: 'p'; text: string } | { kind: 'ul'; items: Bullet[] } | { kind: 'note'; label: string; text: string };

const isBullet = (l: string) => /^[•●▪-]\s*/.test(l);
const strip = (l: string) => l.replace(/^[•●▪-]\s*/, '');
const isHeading = (l: string, next?: string) => !!next && !isBullet(l) && l.length <= 60 && !/[.:;!?"”]$/.test(l) && !/^(Designer|Example)/.test(l);

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  for (const l of lines) {
    const note = /^(Designer[’']s Note|Example):\s*/.exec(l);
    if (note) { out.push({ kind: 'note', label: note[1], text: l.slice(note[0].length) }); continue; }
    if (isBullet(l)) {
      let ul = out[out.length - 1];
      if (ul?.kind !== 'ul') { ul = { kind: 'ul', items: [] }; out.push(ul); }
      const last = ul.items[ul.items.length - 1];
      if (last && /:$/.test(last.text) && !/:$/.test(strip(l))) last.sub.push(strip(l));
      else ul.items.push({ text: strip(l), sub: [] });
      continue;
    }
    out.push({ kind: 'p', text: l });
  }
  return out;
}

function renderBlocks(bs: Block[], flavourFirst: boolean): ReactNode[] {
  return bs.map((b, i) => {
    if (b.kind === 'note') return <div key={i} className="rt-note"><b>{b.label}</b> {b.text}</div>;
    if (b.kind === 'ul') {
      return (
        <ul key={i} className="rt-ul">
          {b.items.map((it, j) => (
            <li key={j}>{it.text}{it.sub.length > 0 && <ul className="rt-ul">{it.sub.map((x, k) => <li key={k}>{x}</li>)}</ul>}</li>
          ))}
        </ul>
      );
    }
    return <p key={i} className={flavourFirst && i === 0 ? 'rt-p rt-flavour' : 'rt-p'}>{b.text}</p>;
  });
}

export function RuleText({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // named options: a short title line followed by its body, repeated (at least two of them)
  const heads = lines.map((l, i) => (isHeading(l, lines[i + 1]) ? i : -1)).filter((i) => i >= 0);
  if (heads.length < 2) return <div className="rt">{renderBlocks(blocks(lines), false)}</div>;
  const intro = lines.slice(0, heads[0]);
  return (
    <div className="rt">
      {renderBlocks(blocks(intro), false)}
      <div className="rt-opts">
        {heads.map((h, k) => {
          const body = blocks(lines.slice(h + 1, heads[k + 1] ?? lines.length));
          const paras = body.filter((b) => b.kind === 'p').length;
          return (
            <div key={h} className="rt-opt">
              <div className="rt-opt-head">{lines[h]}</div>
              <div className="rt-opt-body">{renderBlocks(body, paras >= 2 && body[0].kind === 'p')}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
