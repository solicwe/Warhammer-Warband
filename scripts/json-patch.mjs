// A small JSON patch for the game data: `diff(a, b)` gives the patch that turns `a` into `b`, `applyPatch(a, p)` applies it.
// Objects are patched key by key (`_remove`: keys to drop); arrays of objects with unique names are patched item by item,
// matched by `name` (`_delete: true` drops one, new ones are added at the end); anything else is replaced, and
// `{ "_replace": value }` replaces a value outright (an array whose order changed, or names that repeat).
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const namedUnique = (arr) => arr.every((x) => isObj(x) && typeof x.name === 'string') && new Set(arr.map((x) => x.name)).size === arr.length;

export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

export function applyPatch(target, patch) {
  if (isObj(patch) && '_replace' in patch) return patch._replace;
  if (Array.isArray(target) && Array.isArray(patch) && patch.length && patch.every((p) => isObj(p) && 'name' in p)) {
    const out = [...target];
    for (const p of patch) {
      const i = out.findIndex((t) => isObj(t) && t.name === p.name);
      if (p._delete) { if (i >= 0) out.splice(i, 1); continue; }
      if (i >= 0) out[i] = applyPatch(out[i], p); else out.push(p);
    }
    return out;
  }
  if (isObj(target) && isObj(patch)) {
    const out = { ...target };
    for (const [k, v] of Object.entries(patch)) if (k !== '_remove') out[k] = k in out ? applyPatch(out[k], v) : v;
    for (const k of patch._remove ?? []) delete out[k];
    return out;
  }
  return patch;
}

export function diff(a, b) {
  if (deepEqual(a, b)) return undefined;
  if (isObj(a) && isObj(b)) {
    const p = {};
    for (const k of Object.keys(b)) {
      if (!(k in a)) { p[k] = b[k]; continue; }
      const d = diff(a[k], b[k]);
      if (d !== undefined) p[k] = d;
    }
    const gone = Object.keys(a).filter((k) => !(k in b));
    if (gone.length) p._remove = gone;
    return deepEqual(applyPatch(a, p), b) ? p : { _replace: b };
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length && b.length && namedUnique(a) && namedUnique(b)) {
    const p = [];
    for (const x of a) if (!b.some((y) => y.name === x.name)) p.push({ name: x.name, _delete: true });
    for (const y of b) {
      const x = a.find((z) => z.name === y.name);
      if (!x) { p.push(y); continue; }
      const d = diff(x, y);
      if (d !== undefined) p.push(isObj(d) && '_replace' in d ? { name: y.name, _replace: y } : { name: y.name, ...d });
    }
    if (p.length && deepEqual(applyPatch(a, p), b)) return p;
  }
  return isObj(b) || Array.isArray(b) ? { _replace: b } : b;
}
