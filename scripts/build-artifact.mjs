// Packs dist/ into a single self-contained page (artifact/index.html) + data files, for publishing as a web link.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'artifact');
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const read = (rel) => fs.readFileSync(path.join(DIST, rel.replace(/^\.\//, '')), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="(?!https?:)([^"]+)"[^>]*>/g)].map((m) => read(m[1])).join('\n');
const js = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => read(m[1])).join('\n');
const icon = /<link rel="icon"[^>]*>/.exec(html)?.[0] ?? '';
const fonts = [...html.matchAll(/<link rel="(?:stylesheet|preconnect)" href="https:\/\/fonts\.[^>]*>/g)].map((m) => m[0]).join('\n');
const page = `<title>40K 11th Tabletop</title>
${icon}
${fonts}
<style>
html, body { height: 100%; background: #3f3f3f; color-scheme: dark; }
${css}
</style>
<div id="root"></div>
<script type="module">
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data/factions'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), page);
fs.copyFileSync(path.join(ROOT, 'public/data/index.json'), path.join(OUT, 'data/index.json'));
for (const f of fs.readdirSync(path.join(ROOT, 'public/data/factions'))) fs.copyFileSync(path.join(ROOT, 'public/data/factions', f), path.join(OUT, 'data/factions', f));
console.log(`artifact/index.html ${(page.length / 1024).toFixed(0)} KB + ${fs.readdirSync(path.join(OUT, 'data/factions')).length} faction files`);
