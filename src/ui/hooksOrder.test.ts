// A component that returns early before one of its hooks crashes the screen when the early return starts or stops
// happening (React error #300, "rendered fewer hooks than expected"): DiceTray did it when an attack finished.
// shortcut: reads the source line by line (top-level `if (...) return` before a top-level hook), not a full parser;
// enough for this codebase's two-space style.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const HOOK = /^ {2}\S.*\buse(State|Effect|LayoutEffect|Memo|Ref|Callback|Reducer|Context)\(/;
const EARLY = /^ {2}(if \(.*\) )?return\b/;
const COMPONENT = /^(export )?(function [A-Z]\w*\(|const [A-Z]\w* = memo\(function )/;

describe('hooks before early returns', () => {
  it('no component in src/ui calls a hook after an early return', () => {
    const bad: string[] = [];
    for (const f of fs.readdirSync('src/ui').filter((x) => x.endsWith('.tsx'))) {
      const lines = fs.readFileSync(path.join('src/ui', f), 'utf8').split('\n');
      let inComponent = false, returnedAt = 0;
      lines.forEach((l, i) => {
        if (/^\S/.test(l)) { inComponent = COMPONENT.test(l); returnedAt = 0; return; }
        if (!inComponent) return;
        if (!returnedAt && EARLY.test(l)) returnedAt = i + 1;
        else if (returnedAt && HOOK.test(l)) { bad.push(`${f}: return at line ${returnedAt}, hook at line ${i + 1}`); returnedAt = 0; }
      });
    }
    expect(bad).toEqual([]);
  });
});
