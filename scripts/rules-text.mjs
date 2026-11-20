// Turns every PDF in data/official/ into a .txt (pdftotext -layout) so `npm run rule` can search the official wording.
//   npm run rules:text            (needs pdftotext: Poppler; on Windows it comes with Git for Windows' MSYS or `choco install poppler`)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data/official');
const pdfs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.pdf$/i.test(f)) : [];
if (!pdfs.length) {
  console.log('No PDF in data/official/. Download the rules documents from');
  console.log('https://www.warhammer-community.com/en-gb/downloads/warhammer-40000/ and put them there (they are never committed).');
  process.exit(0);
}
for (const f of pdfs) {
  const out = path.join(DIR, f.replace(/\.pdf$/i, '.txt'));
  try {
    execFileSync('pdftotext', ['-layout', path.join(DIR, f), out], { stdio: 'pipe' });
    console.log(`${f} -> ${path.basename(out)} (${fs.readFileSync(out, 'utf8').split('\n').length} lines)`);
  } catch (e) {
    console.error(`${f}: pdftotext failed (${e.code === 'ENOENT' ? 'not installed' : e.message.split('\n')[0]})`);
    process.exitCode = 1;
  }
}
