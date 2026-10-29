// 29 Oct (solidity): who keeps objects of a class alive in a heap snapshot (node tools/solidite-29oct/heap-retainers.mjs
// <file.heapsnapshot> <ClassName> [paths=3]). Prints the count, the objects' own fields, and the shortest retaining
// paths from a GC root (weak edges ignored), so a retainer can be traced to src/, IWSDK or the emulator.
import { readFileSync } from 'node:fs';
const [file, cls, nPaths = '3'] = process.argv.slice(2);
const snap = JSON.parse(readFileSync(file, 'utf8'));
const m = snap.snapshot.meta;
const NF = m.node_fields.length;
const EF = m.edge_fields.length;
const nodeTypes = m.node_types[0];
const edgeTypes = m.edge_types[0];
const { nodes, edges, strings } = snap;
const N = nodes.length / NF;
const iType = m.node_fields.indexOf('type'), iName = m.node_fields.indexOf('name'), iEC = m.node_fields.indexOf('edge_count'), iSize = m.node_fields.indexOf('self_size');
const eType = m.edge_fields.indexOf('type'), eName = m.edge_fields.indexOf('name_or_index'), eTo = m.edge_fields.indexOf('to_node');
const first = new Uint32Array(N + 1);
for (let i = 0, e = 0; i < N; i++) { first[i] = e; e += nodes[i * NF + iEC] * EF; }
first[N] = edges.length;
const name = (i) => strings[nodes[i * NF + iName]];
const type = (i) => nodeTypes[nodes[i * NF + iType]];
const edgeLabel = (e) => { const t = edgeTypes[edges[e + eType]]; const n = edges[e + eName]; return t === 'element' || t === 'hidden' ? `[${n}]` : strings[n]; };
// Reverse edges (skip weak).
const revCount = new Uint32Array(N);
for (let i = 0; i < N; i++) for (let e = first[i]; e < first[i + 1]; e += EF) { if (edgeTypes[edges[e + eType]] === 'weak') continue; revCount[edges[e + eTo] / NF]++; }
const revStart = new Uint32Array(N + 1);
for (let i = 0; i < N; i++) revStart[i + 1] = revStart[i] + revCount[i];
const revFrom = new Uint32Array(revStart[N]);
const revEdge = new Uint32Array(revStart[N]);
const fill = revStart.slice(0, N);
for (let i = 0; i < N; i++) for (let e = first[i]; e < first[i + 1]; e += EF) { if (edgeTypes[edges[e + eType]] === 'weak') continue; const t = edges[e + eTo] / NF; revFrom[fill[t]] = i; revEdge[fill[t]] = e; fill[t]++; }
const targets = [];
for (let i = 0; i < N; i++) if (type(i) === 'object' && name(i) === cls) targets.push(i);
console.log(`${targets.length} objects "${cls}"`);
if (targets.length === 0) process.exit(0);
const t0 = targets[0];
const fields = [];
for (let e = first[t0]; e < first[t0 + 1]; e += EF) fields.push(`${edgeLabel(e)}→${name(edges[e + eTo] / NF).slice(0, 40)}`);
console.log('fields of the first:', fields.slice(0, 40).join(' | '));
// Shortest path to the synthetic root (node 0) by BFS over reverse edges.
const pathFor = (start) => {
  const prev = new Int32Array(N).fill(-1);
  const prevEdge = new Int32Array(N).fill(-1);
  const q = [start];
  prev[start] = start;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (i === 0) break;
    for (let k = revStart[i]; k < revStart[i + 1]; k++) {
      const from = revFrom[k];
      if (prev[from] !== -1) continue;
      prev[from] = i;
      prevEdge[from] = revEdge[k];
      q.push(from);
    }
  }
  if (prev[0] === -1) return null;
  const out = [];
  for (let i = 0; i !== start; i = prev[i]) out.push(`${type(i)}:${name(i).slice(0, 50)} .${edgeLabel(prevEdge[i])}`);
  out.push(`${cls}`);
  return out;
};
for (const t of targets.slice(-Number(nPaths))) {
  const p = pathFor(t);
  console.log('\n--- retained by:');
  console.log(p == null ? '(no path to a root)' : p.join('\n   → '));
}
