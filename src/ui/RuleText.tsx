// Army rule text laid out: bullet lists (nested after a "…:" bullet), named options (Mission Tactics, Templar Vows …)
// as boxed rows with their flavour text in italics, and Designer's Notes / Examples set apart.
import type { ReactNode } from 'react';
import { emph } from './Em';

type Bullet = { text: string; sub: string[] };
type Block = { kind: 'p'; text: string } | { kind: 'ul'; items: Bullet[] } | { kind: 'note'; label: string; text: string } | { kind: 'table'; rows: string[][] };

const isBullet = (l: string) => /^[•●\u25AA\u25AB\u25A0◦*-]\s*/.test(l);
const strip = (l: string) => l.replace(/^[•●\u25AA\u25AB\u25A0◦*-]\s*/, '');
const isHeading = (l: string, next?: string) => !!next && !isBullet(l) && !l.includes('¦') && !next.includes('¦') && l.length >= 3 && l.length <= 60 && !/[.:;?"”]$/.test(l) && !/^(Designer|Example)/.test(l);

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  for (const l of lines) {
    // a table row from the data ("Incursion ¦ Up to 2 units ¦ Up to 2 units")
    if (l.includes('¦')) {
      const prev = out[out.length - 1];
      const row = l.split('¦').map((c) => c.trim());
      if (prev?.kind === 'table') prev.rows.push(row); else out.push({ kind: 'table', rows: [row] });
      continue;
    }
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

function renderBlocks(bs: Block[], flavourFirst: boolean, names?: string[]): ReactNode[] {
  const e = (t: string) => emph(t, names);
  return bs.map((b, i) => {
    if (b.kind === 'table') {
      const n = Math.max(...b.rows.map((x) => x.length));
      const head = (row: string[]) => row.every((c) => !/[a-z]/.test(c));
      return (
        <div key={i} className="rt-table-wrap">
          <table className="rt-table">
            <tbody>
              {b.rows.map((row, j) => {
                // a short first row spans its last cell over the rest; a short later row sits under the spanned heading
                const cells = row.length < n && j > 0 ? [...Array(n - row.length).fill(''), ...row] : row;
                const Cell = head(row) ? 'th' : 'td';
                return <tr key={j}>{cells.map((c, k) => <Cell key={k} colSpan={k === cells.length - 1 && cells.length < n ? n - cells.length + 1 : undefined}>{c && e(c)}</Cell>)}</tr>;
              })}
            </tbody>
          </table>
        </div>
      );
    }
    if (b.kind === 'note') return <div key={i} className="rt-note"><b>{b.label}</b> {e(b.text)}</div>;
    if (b.kind === 'ul') {
      return (
        <ul key={i} className="rt-ul">
          {b.items.map((it, j) => (
            <li key={j}>{e(it.text)}{it.sub.length > 0 && <ul className="rt-ul">{it.sub.map((x, k) => <li key={k}>{e(x)}</li>)}</ul>}</li>
          ))}
        </ul>
      );
    }
    // "ASSAULT DOCTRINE: When this unit …": the capitalised name in bold
    const lead = /^([A-Z][A-Z' -]{3,}):\s*(.*)$/.exec(b.text);
    if (lead) return <p key={i} className="rt-p"><b>{lead[1]}</b> {e(lead[2])}</p>;
    return <p key={i} className={flavourFirst && i === 0 ? 'rt-p rt-flavour' : 'rt-p'}>{flavourFirst && i === 0 ? b.text : e(b.text)}</p>;
  });
}

const isCaps = (l: string) => l.length >= 3 && !/[a-z]/.test(l);

export function RuleText({ text, names }: { text: string; names?: string[] }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // CAPITALISED section titles (CONTAGION RANGE, AFFLICTED) above Title Case options (the Plagues): one section each
  const caps = lines.flatMap((l, i) => (isHeading(l, lines[i + 1]) && isCaps(l) ? [i] : []));
  if (caps.length && lines.some((l, i) => isHeading(l, lines[i + 1]) && !isCaps(l) && i > caps[0])) {
    return (
      <div className="rt">
        {caps[0] > 0 && <RuleText text={lines.slice(0, caps[0]).join('\n')} names={names} />}
        {caps.map((h, k) => (
          <div key={h}>
            <div className="rt-sec">{lines[h]}</div>
            <RuleText text={lines.slice(h + 1, caps[k + 1] ?? lines.length).join('\n')} names={names} />
          </div>
        ))}
      </div>
    );
  }
  // named options: a short title line followed by its body, repeated (at least two of them)
  // a title's body is never itself a title ("This unit has +1 to charge rolls" with its full stop missing)
  const heads: number[] = [];
  lines.forEach((l, i) => { if (isHeading(l, lines[i + 1]) && heads[heads.length - 1] !== i - 1) heads.push(i); });
  if (heads.length < 2) return <div className="rt">{renderBlocks(blocks(lines), false, names)}</div>;
  const intro = lines.slice(0, heads[0]);
  return (
    <div className="rt">
      {renderBlocks(blocks(intro), false, names)}
      <div className="rt-opts">
        {heads.map((h, k) => {
          const body = blocks(lines.slice(h + 1, heads[k + 1] ?? lines.length));
          const paras = body.filter((b) => b.kind === 'p').length;
          return (
            <div key={h} className="rt-opt">
              <div className="rt-opt-head">{lines[h]}</div>
              <div className="rt-opt-body">{renderBlocks(body, paras >= 2 && body[0].kind === 'p', names)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
