// 29 Oct (solidity): what grew between two heap snapshots, by class (count, self size). node heap-diff.mjs A B
import { readFileSync } from 'node:fs';
// Snapshots over 512 MB cannot be one JS string: read the header, the "nodes" numbers and the "strings" array apart.
const load = (f) => {
  const buf = readFileSync(f);
  const at = (needle, from = 0) => buf.indexOf(Buffer.from(needle), from);
  const nodesAt = at('"nodes":[');
  const header = JSON.parse(`${buf.subarray(0, nodesAt).toString('utf8').replace(/,\s*$/u, '')}}`);
  const end = at(']', nodesAt);
  const nums = [];
  let v = 0;
  let inNum = false;
  for (let i = nodesAt + 9; i < end; i++) {
    const c = buf[i];
    if (c >= 48 && c <= 57) { v = v * 10 + (c - 48); inNum = true; } else if (inNum) { nums.push(v); v = 0; inNum = false; }
  }
  if (inNum) nums.push(v);
  const strAt = at('"strings":[');
  const strEnd = buf.lastIndexOf(Buffer.from(']'));
  const strings = JSON.parse(buf.subarray(strAt + 10, strEnd + 1).toString('utf8'));
  const s = { snapshot: header.snapshot, nodes: nums, strings };
  const m = s.snapshot.meta;
  const NF = m.node_fields.length;
  const T = m.node_types[0];
  const iS = m.node_fields.indexOf('self_size');
  const agg = new Map();
  for (let i = 0; i < s.nodes.length; i += NF) {
    const t = T[s.nodes[i]];
    const n = t === 'object' || t === 'native' || t === 'closure' ? `${t}:${s.strings[s.nodes[i + 1]].slice(0, 70)}` : `(${t})`;
    const a = agg.get(n) ?? [0, 0];
    a[0]++;
    a[1] += s.nodes[i + iS];
    agg.set(n, a);
  }
  return agg;
};
const [a, b] = process.argv.slice(2).map(load);
const rows = [];
for (const [n, [c, sz]] of b) {
  const [c0, sz0] = a.get(n) ?? [0, 0];
  if (c !== c0 || sz !== sz0) rows.push({ n, dc: c - c0, dkb: Math.round((sz - sz0) / 1024) });
}
rows.sort((x, y) => y.dkb - x.dkb);
for (const r of rows.slice(0, 30)) console.log(String(r.dkb).padStart(8), 'Ko', String(r.dc).padStart(8), r.n);
