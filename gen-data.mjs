// 生成"主播×摄影师 智能档期预约表"演示数据（与 code_artifact.html 一致）
// 输出三个 JSON payload，供 lark-cli base +record-batch-create --json @file 使用
import { writeFileSync } from 'node:fs';

const PHOTOGRAPHERS = {
  p1: { name: '林宇(摄影A)', specialty: '棚拍/人像' },
  p2: { name: '陈默(摄影B)', specialty: '外景/Vlog' },
  p3: { name: '苏菲(摄影C)', specialty: '美妆/静物' },
  p4: { name: '周凯(摄影D)', specialty: '口播/快剪' },
  p5: { name: '张涛(摄影E)', specialty: '全能机动' },
};

// 每周上岗的 4 位（复刻原应用：46周 p1-p4 上岗、张涛轮休；归档时轮换 shift）
const WEEKS = [
  { label: '2026年第45周', monday: '2026-11-02', active: ['p1', 'p2', 'p3', 'p5'] }, // 归档演示周
  { label: '2026年第46周', monday: '2026-11-09', active: ['p1', 'p2', 'p3', 'p4'] }, // 当前周
  { label: '2026年第47周', monday: '2026-11-16', active: ['p2', 'p3', 'p4', 'p5'] }, // 轮换：张涛上岗、林宇轮休
  { label: '2026年第48周', monday: '2026-11-23', active: ['p3', 'p4', 'p5', 'p1'] },
];

const DAY_KEYS = ['周一', '周二', '周三', '周四', '周五'];
const PERIODS = ['上午', '下午'];

// 与网页版一致的预约: `${weekLabel}|${pid}|${dayIdx}_${period}` -> 主播名
const BOOKINGS = {
  '2026年第45周|p1|0_上午': '小鹿', '2026年第45周|p1|0_下午': '七七',
  '2026年第45周|p2|1_上午': '阿泽',
  '2026年第45周|p3|2_上午': 'Mia', '2026年第45周|p3|2_下午': '小鹿',
  '2026年第45周|p5|4_下午': '阿泽',
  '2026年第46周|p1|0_上午': '小鹿',
  '2026年第46周|p2|1_上午': '阿泽',
  '2026年第46周|p3|2_下午': 'Mia',
};

// 周汇总：完成视频数（45周=已归档快照，46周=本周进行中），47/48 留空待填
const WEEKLY = {
  '2026年第45周': { p1: 6, p2: 3, p3: 5, p5: 2 },
  '2026年第46周': { p1: 4, p2: 2, p3: 0, p4: 0 },
};

const pad = (n) => String(n).padStart(2, '0');
const dateOf = (monday, dayIdx) => {
  const d = new Date(`${monday}T00:00:00+08:00`);
  d.setDate(d.getDate() + dayIdx);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ── 摄影师表 ──
const photographers = {
  create_records: Object.values(PHOTOGRAPHERS).map((p, i) => ({
    姓名: p.name,
    擅长方向: p.specialty,
    本周上岗: i < 4, // 46周：p1-p4 上岗，张涛轮休
  })),
};

// ── 档期预约表：4周 × 4人 × 10时段 ──
const schedule = { create_records: [] };
for (const w of WEEKS) {
  for (const pid of w.active) {
    for (let d = 0; d < 5; d++) {
      for (const period of PERIODS) {
        const host = BOOKINGS[`${w.label}|${pid}|${d}_${period}`] || '';
        schedule.create_records.push({
          周次: [w.label],
          摄影师: [PHOTOGRAPHERS[pid].name],
          星期: [DAY_KEYS[d]],
          时段: [period],
          日期: dateOf(w.monday, d),
          请假: false,
          ...(host ? { 预约主播: host } : {}),
        });
      }
    }
  }
}

// ── 周汇总表 ──
const weekly = { create_records: [] };
for (const w of WEEKS) {
  for (const pid of w.active) {
    const rec = {
      周次: [w.label],
      摄影师: [PHOTOGRAPHERS[pid].name],
      上岗: true,
    };
    const cnt = WEEKLY[w.label]?.[pid];
    if (cnt !== undefined) rec.完成视频数 = cnt;
    if (w.label === '2026年第45周') rec.归档时间 = '2026-11-07 18:00';
    weekly.create_records.push(rec);
  }
}

const out = (name, data) => {
  writeFileSync(new URL(`./${name}`, import.meta.url), JSON.stringify(data, null, 1), 'utf8');
  console.log(`${name}: ${data.create_records.length} records`);
};
out('photographers.json', photographers);
out('schedule.json', schedule);
out('weekly.json', weekly);
