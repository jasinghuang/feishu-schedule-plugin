// 给档期预约.日期批量补上 09:00(上午)/14:00(下午) 时间，供日历周视图分行
import { execFile } from 'node:child_process';
const LARK = String.raw`C:/Users/jasing/AppData/Roaming/npm/node_modules/@lark-codem/lark-cli/node_modules/@lark-codem/lark-cli-win32-x64/lark-cli.exe`;
const BT = 'C8nFbCrrGakSVFs3QBecsTDwnkg';
const TS = 'tblxcERlCVZwaOhR';
const run = (a) => new Promise((res, rej) => execFile(LARK, a, { maxBuffer: 64 << 20 }, (e, so) => {
  let o; try { o = JSON.parse(so); } catch { return rej(new Error(so.slice(0, 300))); }
  o?.ok ? res(o) : rej(new Error(o?.error?.hint || o?.error?.message || so.slice(0, 150)));
}));

const rows = [], recIds = [];
let fields = null;
for (let off = 0; ; off += 200) {
  const r = await run(['base', '+record-list', '--as', 'user', '--base-token', BT, '--table-id', TS,
    '--field-id', '时段', '--field-id', '日期', '--offset', String(off), '--limit', '200', '--format', 'json']);
  fields = r.data.fields;
  rows.push(...r.data.data);
  recIds.push(...r.data.record_id_list);
  if (rows.length >= r.data.total || r.data.data.length === 0) break;
}
const data = rows, record_id_list = recIds;
const ip = fields.indexOf('时段'), idd = fields.indexOf('日期');
const upd = {};
data.forEach((row, i) => {
  const period = Array.isArray(row[ip]) ? row[ip][0] : row[ip];
  let ts = row[idd];
  if (typeof ts !== 'number' && ts) ts = new Date(ts).getTime();
  if (typeof ts !== 'number' || isNaN(ts)) return;
  const d = new Date(ts + 8 * 3600000); // 对齐东八区日历日
  const hour = period === '下午' ? 14 : 9;
  upd[record_id_list[i]] = { 日期: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 8, 0, 0) };
});
console.log('更新条数:', Object.keys(upd).length);
for (const ids of [Object.keys(upd)]) {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = Object.fromEntries(ids.slice(i, i + 100).map((id) => [id, upd[id]]));
    await run(['base', '+record-batch-update', '--as', 'user', '--base-token', BT, '--table-id', TS,
      '--json', JSON.stringify({ update_records: chunk })]);
  }
}
console.log('✅ 日期已带上 09:00/14:00');
