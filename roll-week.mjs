// 「归档并生成下周」— 复刻 code_artifact.html 的周滚动功能
// 用法:
//   node roll-week.mjs                 # 自动: 生成"下一周"档期, 摄影师自动轮换(本周轮休者上岗)
//   node roll-week.mjs --keep          # 生成下一周, 沿用本周 4 位摄影师阵容
//   node roll-week.mjs --week 2026年第49周 --monday 2026-11-30 --keep
//   node roll-week.mjs --photographers "陈默(摄影B),苏菲(摄影C),周凯(摄影D),张涛(摄影E)"
// 前提: lark-cli 已安装并 auth login (本机已配置)
import { execFile } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const LARK = String.raw`C:/Users/jasing/AppData/Roaming/npm/node_modules/@lark-codem/lark-cli/node_modules/@lark-codem/lark-cli-win32-x64/lark-cli.exe`;
const BT = 'C8nFbCrrGakSVFs3QBecsTDwnkg';
const T_SCHEDULE = 'tblxcERlCVZwaOhR'; // 档期预约
const T_PHOTO = 'tbl9ycC1uWUWBYxx';    // 摄影师
const T_WEEKLY = 'tbl7i5DTLdodqhBe';   // 周汇总

const DAYS = ['周一', '周二', '周三', '周四', '周五'];

// ── CLI 封装 ──
const run = (args) => new Promise((resolve) => {
  execFile(LARK, args, { maxBuffer: 64 << 20 }, (err, stdout) => {
    let out;
    try { out = JSON.parse(stdout); } catch { out = { ok: false, error: { message: stdout.slice(0, 500) } }; }
    if (err && !out?.ok) out = out?.ok ? out : { ...out, _exit: err.code };
    resolve(out);
  });
});
const tmpFile = (name, obj) => {
  const p = join(dirname(fileURLToPath(import.meta.url)), name);
  writeFileSync(p, JSON.stringify(obj), 'utf8');
  return p;
};

// ── ISO 周计算 ──
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}
const nextMonday = () => {
  const d = new Date();
  const day = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() + (8 - day));
  return d;
};
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ── 参数 ──
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const KEEP = argv.includes('--keep');
const NO_DUTY = argv.includes('--no-duty-update'); // 只生成记录, 不改"本周上岗"勾选(用于提前铺数)
const mondayRaw = argOf('--monday');
const mondayDate = mondayRaw ? new Date(`${mondayRaw}T00:00:00+08:00`) : nextMonday();
if (isNaN(mondayDate)) { console.error('--monday 日期无效, 例: 2026-11-30'); process.exit(1); }
const monday = fmt(mondayDate);
const { year, week } = isoWeek(mondayDate);
const WEEK_LABEL = argOf('--week') || `${year}年第${week}周`;
const EXPLICIT = argOf('--photographers')?.split(',').map((s) => s.trim()).filter(Boolean) || null;

const main = async () => {
  console.log(`▶ 目标周: ${WEEK_LABEL} (周一 ${monday})  策略: ${EXPLICIT ? '指定名单' : KEEP ? '沿用本周阵容' : '自动轮换'}`);

  // 1. 读取摄影师表现状
  const photoRes = await run(['base', '+record-list', '--as', 'user', '--base-token', BT,
    '--table-id', T_PHOTO, '--field-id', '姓名', '--field-id', '本周上岗', '--limit', '50', '--format', 'json']);
  if (!photoRes.ok) throw new Error(`读取摄影师表失败: ${photoRes.error?.message}`);
  const rows = photoRes.data.data.map((v) => ({ name: v[0], onDuty: v[1] === true }));
  const records = photoRes.data.record_id_list;
  if (rows.length < 5) throw new Error(`摄影师表应有 5 人, 实际 ${rows.length} 人`);

  // 2. 计算下周上岗名单 (4 位)
  let active;
  if (EXPLICIT) {
    active = EXPLICIT;
  } else {
    const current = rows.filter((r) => r.onDuty).map((r) => r.name);
    const resting = rows.filter((r) => !r.onDuty).map((r) => r.name);
    if (KEEP || resting.length === 0) {
      active = current.slice(0, 4);
    } else {
      active = [...current.slice(1), resting[0]]; // 轮换: 本周轮休者上岗, 队首摄影师轮休
    }
  }
  if (active.length !== 4) throw new Error(`上岗名单必须 4 人, 当前 ${active.length}: ${active.join(',')}`);
  console.log(`▶ 下周上岗: ${active.join('、')}`);
  console.log(`▶ 轮休: ${rows.filter((r) => !active.includes(r.name)).map((r) => r.name).join('、') || '无'}`);

  // 2.5 重复周护栏: 若该周档期已存在则中止
  const dup = await run(['base', '+record-list', '--as', 'user', '--base-token', BT,
    '--table-id', T_SCHEDULE, '--field-id', '周次', '--limit', '1', '--format', 'json',
    '--filter-json', JSON.stringify({ logic: 'and', conditions: [['周次', 'intersects', [WEEK_LABEL]]] })]);
  if (dup.ok && dup.data?.record_id_list?.length > 0) {
    throw new Error(`${WEEK_LABEL} 的档期记录已存在 (${dup.data.record_id_list.length}+ 条), 如需重建请先手动删除`);
  }

  // 3. 给两张表的"周次"字段追加新选项 (PUT 语义, 先读后写)
  for (const table of [T_SCHEDULE, T_WEEKLY]) {
    const cur = await run(['base', '+field-get', '--as', 'user', '--base-token', BT, '--table-id', table, '--field-id', '周次', '--format', 'json']);
    if (!cur.ok) throw new Error(`读取周次字段失败: ${cur.error?.message}`);
    const options = cur.data.field.options.map((o) => ({ name: o.name }));
    if (options.some((o) => o.name === WEEK_LABEL)) continue;
    const upd = await run(['base', '+field-update', '--as', 'user', '--base-token', BT, '--table-id', table,
      '--field-id', '周次', '--yes', '--json', JSON.stringify({ name: '周次', type: 'select', multiple: false, options: [...options, { name: WEEK_LABEL }] })]);
    if (!upd.ok) throw new Error(`追加周次选项失败: ${upd.error?.message}`);
  }
  console.log('▶ 周次选项已更新');

  // 4. 生成 40 条档期记录（含 摄影师行 关联，供摄影师表矩阵公式使用）
  const rosterRows = photoRes.data.data.map((v, i) => ({ name: v[0], id: records[i] }));
  const schedule = { create_records: [] };
  for (const name of active) {
    const rosterId = rosterRows.find((r) => r.name === name)?.id;
    for (let d = 0; d < 5; d++) {
      const dt = new Date(`${monday}T00:00:00+08:00`);
      dt.setDate(dt.getDate() + d);
      for (const period of ['上午', '下午']) {
        const rec = {
          周次: [WEEK_LABEL], 摄影师: [name], 星期: [DAYS[d]], 时段: [period],
          日期: `${fmt(dt)} ${period === '上午' ? '09:00' : '14:00'}`, 请假: false,
        };
        if (rosterId) rec.摄影师行 = [{ id: rosterId }];
        schedule.create_records.push(rec);
      }
    }
  }
  const f1 = tmpFile('.roll-schedule.json', schedule);
  const r1 = await run(['base', '+record-batch-create', '--as', 'user', '--base-token', BT, '--table-id', T_SCHEDULE, '--json', `@${f1}`]);
  rmSync(f1);
  if (!r1.ok) throw new Error(`写入档期失败: ${r1.error?.message}`);
  console.log(`▶ 已生成 ${WEEK_LABEL} 档期 40 条 (4位摄影师 × 10个半天)`);

  // 5. 周汇总新行 (完成视频数留空, 由摄影师本周内填写)
  const weekly = { create_records: active.map((name) => ({ 周次: [WEEK_LABEL], 摄影师: [name], 上岗: true })) };
  const f2 = tmpFile('.roll-weekly.json', weekly);
  const r2 = await run(['base', '+record-batch-create', '--as', 'user', '--base-token', BT, '--table-id', T_WEEKLY, '--json', `@${f2}`]);
  rmSync(f2);
  if (!r2.ok) throw new Error(`写入周汇总失败: ${r2.error?.message}`);
  console.log(`▶ 已创建周汇总行 4 条 (请摄影师在本周结束时填写完成视频数)`);

  // 6. 更新摄影师表"本周上岗"
  if (NO_DUTY) { console.log('▶ 跳过上岗勾选更新 (--no-duty-update)'); return; }
  const updates = {};
  rows.forEach((r, i) => { updates[records[i]] = { 本周上岗: active.includes(r.name) }; });
  const r3 = await run(['base', '+record-batch-update', '--as', 'user', '--base-token', BT, '--table-id', T_PHOTO, '--json', JSON.stringify({ update_records: updates })]);
  if (!r3.ok) throw new Error(`更新上岗勾选失败: ${r3.error?.message}`);
  console.log('✅ 完成! 打开「本周预约看板」视图, 下周一将自动展示新档期');
};

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
