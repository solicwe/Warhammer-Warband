// Turns every PDF in data/official/ into text: <name>.txt (pdftotext -layout) and <name>.json ({ source, pages: [{ page, text }] })
// so `npm run rule` and scripts can search the official wording. Games Workshop material: local only, git-ignored.
//   npm run rules:text            (needs pdftotext: Poppler; it comes with Git for Windows' MSYS or `choco install poppler`)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data/official');
const pdfs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.pdf$/i.test(f)) : [];
if (!pdfs.length) {
  console.log('No PDF in data/official/. Run npm run rules:fetch (or download them from');
  console.log('https://www.warhammer-community.com/en-gb/downloads/warhammer-40000/ yourself). They are never committed.');
  process.exit(0);
}
for (const f of pdfs) {
  const base = f.replace(/\.pdf$/i, '');
  const txt = path.join(DIR, `${base}.txt`);
  const json = path.join(DIR, `${base}.json`);
  if (fs.existsSync(json) && fs.statSync(json).mtimeMs > fs.statSync(path.join(DIR, f)).mtimeMs) continue;
  try {
    execFileSync('pdftotext', ['-layout', path.join(DIR, f), txt], { stdio: 'pipe' });
    const pages = fs.readFileSync(txt, 'utf8').split('\f').map((t, i) => ({ page: i + 1, text: t.replace(/[ \t]+$/gm, '').trim() })).filter((p) => p.text);
    fs.writeFileSync(json, JSON.stringify({ source: f, pages }));
    console.log(`${f}: ${pages.length} pages`);
  } catch (e) {
    console.error(`${f}: pdftotext failed (${e.code === 'ENOENT' ? 'not installed' : e.message.split('\n')[0]})`);
    process.exitCode = 1;
  }
}
