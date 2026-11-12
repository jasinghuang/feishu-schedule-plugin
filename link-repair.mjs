// 给档期预约的 200 条记录设置 摄影师行 关联（按摄影师名字匹配摄影师表记录）
import { execFile } from 'node:child_process';
const LARK = String.raw`C:/Users/jasing/AppData/Roaming/npm/node_modules/@lark-codem/lark-cli/node_modules/@lark-codem/lark-cli-win32-x64/lark-cli.exe`;
const BT = 'C8nFbCrrGakSVFs3QBecsTDwnkg';
const TS = 'tblxcERlCVZwaOhR', TP = 'tbl9ycC1uWUWBYxx';
const run = (a) => new Promise((res, rej) => execFile(LARK, a, { maxBuffer: 64 << 20 }, (e, so) => {
  let o; try { o = JSON.parse(so); } catch { return rej(new Error(String(so).slice(0, 300))); }
  o?.ok ? res(o) : rej(new Error(o?.error?.hint || o?.error?.message || String(so).slice(0, 150)));
}));

// 1. 摄影师表: 名字 → recordId
const pr = await run(['base', '+record-list', '--as', 'user', '--base-token', BT, '--table-id', TP,
  '--field-id', '摄影师', '--limit', '50', '--format', 'json']);
const nameToId = {};
pr.data.data.forEach((r, i) => { const n = Array.isArray(r[0]) ? r[0][0] : r[0]; nameToId[n] = pr.data.record_id_list[i]; });
console.log('名单:', JSON.stringify(nameToId));

// 2. 档期预约全表: 摄影师 → link
const all = [], ids = [];
for (let off = 0; ; off += 200) {
  const r = await run(['base', '+record-list', '--as', 'user', '--base-token', BT, '--table-id', TS,
    '--field-id', '摄影师', '--offset', String(off), '--limit', '200', '--format', 'json']);
  all.push(...r.data.data); ids.push(...r.data.record_id_list);
  if (all.length >= r.data.total || r.data.data.length === 0) break;
}
const upd = {};
let miss = 0;
all.forEach((row, i) => {
  const n = Array.isArray(row[0]) ? row[0][0] : row[0];
  const rid = nameToId[n];
  if (!rid) { miss++; return; }
  upd[ids[i]] = { 摄影师行: [{ id: rid }] };
});
console.log('关联条数:', Object.keys(upd).length, '未匹配:', miss);
const keys = Object.keys(upd);
for (let i = 0; i < keys.length; i += 100) {
  const chunk = Object.fromEntries(keys.slice(i, i + 100).map((k) => [k, upd[k]]));
  await run(['base', '+record-batch-update', '--as', 'user', '--base-token', BT, '--table-id', TS,
    '--json', JSON.stringify({ update_records: chunk })]);
}
console.log('✅ 关联完成');
