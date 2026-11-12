// 修复：用户把档期预约.摄影师改为动态单选后，200条记录的摄影师格子被清空
// 按每周4人×(星期,时段)各1坑位回填真实班底；同步修复周汇总表
import { execFile } from 'node:child_process';

const LARK = String.raw`C:/Users/jasing/AppData/Roaming/npm/node_modules/@lark-codem/lark-cli/node_modules/@lark-codem/lark-cli-win32-x64/lark-cli.exe`;
const BT = 'C8nFbCrrGakSVFs3QBecsTDwnkg';
const T_SCHEDULE = 'tblxcERlCVZwaOhR'; // 档期预约
const T_WEEKLY = 'tbl7i5DTLdodqhBe';   // 周汇总

// 真实班底（摄影师表当前数据），上岗顺序 = 用户勾选现状
const ROSTER = ['王智彦', '黄健清', '陈贵锋', '伍珂', '蔡受多'];

// 每周上岗4人（46周=用户当前勾选；47-49按轮换：队首轮休、轮休者上岗）
const WEEK_ACTIVE = {
  '2026年第45周': ['王智彦', '黄健清', '陈贵锋', '蔡受多'],
  '2026年第46周': ['王智彦', '黄健清', '陈贵锋', '伍珂'],
  '2026年第47周': ['黄健清', '陈贵锋', '伍珂', '蔡受多'],
  '2026年第48周': ['陈贵锋', '伍珂', '蔡受多', '王智彦'],
  '2026年第49周': ['伍珂', '蔡受多', '王智彦', '黄健清'],
};

const run = (args) => new Promise((resolve, reject) => {
  execFile(LARK, args, { maxBuffer: 64 << 20 }, (err, stdout) => {
    let out; try { out = JSON.parse(stdout); } catch { return reject(new Error(stdout.slice(0, 400))); }
    out?.ok ? resolve(out) : reject(new Error(out?.error?.hint || out?.error?.message || stdout.slice(0, 200)));
  });
});

const main = async () => {
  // 1. 读档期预约全部记录（分页）
  const all = [];
  for (let off = 0; ; off += 200) {
    const r = await run(['base', '+record-list', '--as', 'user', '--base-token', BT, '--table-id', T_SCHEDULE,
      '--field-id', '周次', '--field-id', '星期', '--field-id', '时段', '--offset', String(off), '--limit', '200', '--format', 'json']);
    const { data, record_id_list, fields } = r.data;
    const iWeek = fields.indexOf('周次'), iDay = fields.indexOf('星期'), iPeriod = fields.indexOf('时段');
    data.forEach((row, i) => all.push({ id: record_id_list[i], week: row[iWeek]?.[0], day: row[iDay]?.[0], period: row[iPeriod]?.[0] }));
    if (all.length >= r.data.total || data.length === 0) break;
  }
  console.log(`档期记录: ${all.length} 条`);

  // 2. 每周按(星期,时段)分组，组内4条依次分配该周上岗4人
  const updates = {};
  const byWeekDay = {};
  all.forEach((r) => { const k = `${r.week}|${r.day}|${r.period}`; (byWeekDay[k] ||= []).push(r); });
  for (const [k, group] of Object.entries(byWeekDay)) {
    const [week] = k.split('|');
    const active = WEEK_ACTIVE[week];
    if (!active) { console.warn(`跳过未知周: ${week}`); continue; }
    if (group.length !== 4) console.warn(`${k} 坑位数=${group.length} (预期4)`);
    group.forEach((r, i) => { updates[r.id] = { 摄影师: [active[i % 4]] }; });
  }
  const ids = Object.keys(updates);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = Object.fromEntries(ids.slice(i, i + 200).map((id) => [id, updates[id]]));
    await run(['base', '+record-batch-update', '--as', 'user', '--base-token', BT, '--table-id', T_SCHEDULE,
      '--json', JSON.stringify({ update_records: chunk })]);
  }
  console.log(`✅ 档期预约已回填 ${ids.length} 条摄影师`);

  // 3. 周汇总：读出后按 位置映射 旧名→新名
  const wk = [];
  for (let off = 0; ; off += 200) {
    const r = await run(['base', '+record-list', '--as', 'user', '--base-token', BT, '--table-id', T_WEEKLY,
      '--field-id', '周次', '--field-id', '摄影师', '--offset', String(off), '--limit', '200', '--format', 'json']);
    const { data, record_id_list, fields } = r.data;
    const iWeek = fields.indexOf('周次'), iPhoto = fields.indexOf('摄影师');
    data.forEach((row, i) => wk.push({ id: record_id_list[i], week: row[iWeek]?.[0], photo: Array.isArray(row[iPhoto]) ? row[iPhoto][0] : row[iPhoto] }));
    if (wk.length >= r.data.total || data.length === 0) break;
  }
  const OLD2NEW = { '林宇(摄影A)': '王智彦', '陈默(摄影B)': '黄健清', '苏菲(摄影C)': '陈贵锋', '周凯(摄影D)': '伍珂', '张涛(摄影E)': '蔡受多' };
  const wkUpdates = {};
  let fixed = 0;
  wk.forEach((r) => {
    const target = WEEK_ACTIVE[r.week];
    if (!target) return;
    const mapped = OLD2NEW[r.photo];
    if (target.includes(mapped) && mapped !== r.photo) { wkUpdates[r.id] = { 摄影师: [mapped] }; fixed++; }
    else if (!r.photo || !target.includes(mapped || r.photo)) {
      // 空值或不在该周名单：按该周名单中尚未使用的名字补
      const used = new Set(wk.filter((x) => x.week === r.week && x.id !== r.id).map((x) => OLD2NEW[x.photo] || x.photo).filter((n) => target.includes(n)));
      const free = target.find((n) => !used.has(n)) || target[0];
      wkUpdates[r.id] = { 摄影师: [free] }; fixed++;
    }
  });
  if (Object.keys(wkUpdates).length) {
    // 周汇总.摄影师 是普通单选，先补选项再更新
    const fld = await run(['base', '+field-get', '--as', 'user', '--base-token', BT, '--table-id', T_WEEKLY, '--field-id', '摄影师', '--format', 'json']);
    const opts = fld.data.field.options.map((o) => ({ name: o.name }));
    for (const n of ROSTER) if (!opts.some((o) => o.name === n)) opts.push({ name: n });
    await run(['base', '+field-update', '--as', 'user', '--base-token', BT, '--table-id', T_WEEKLY, '--field-id', '摄影师',
      '--yes', '--json', JSON.stringify({ name: '摄影师', type: 'select', multiple: false, options: opts })]);
    await run(['base', '+record-batch-update', '--as', 'user', '--base-token', BT, '--table-id', T_WEEKLY,
      '--json', JSON.stringify({ update_records: wkUpdates })]);
  }
  console.log(`✅ 周汇总已修正 ${fixed} 行摄影师`);
};

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
