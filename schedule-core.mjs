export const TARGET = Object.freeze({
  base: 'DI51bcg1raS4hasSykacHyRQnrd',
  week: 'tblVKEyGgtUq89li', photo: 'tblWYTg0umDwNBB7', slots: 'tblYWtknjmuLaNYQ',
  fields: {
    week: { date: 'fldMDbn9uW', periods: 'fldQodLQC5', photographers: 'fldST5qxfL', host: 'fld06KZr2B', script: 'fldaLtDhUT', count: 'fld8r4f6j5' },
    photo: { name: 'fldZrcZnOs', onDuty: 'fld9GlbeYn' },
    slots: { date: 'fldZ37LyUk', period: 'fldicwmqdm', photographer: 'fldFFvcJz8', leave: 'fldvRCZrde' }
  }
});
export const PERIODS = ['上午', '下午'];
export const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function text(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).join('');
  if (typeof value === 'object') return String(value.text ?? value.name ?? value.value ?? '');
  return String(value);
}
export function options(value) {
  if (value == null) return [];
  return [...new Set((Array.isArray(value) ? value : [value]).map(text).map(s => s.trim()).filter(Boolean))];
}
export function dateKey(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const timestamp = date => Date.parse(`${date}T00:00:00+08:00`);
export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function mondayOf(date = dateKey(Date.now())) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return addDays(date, 1 - day);
}
export function weekLabel(monday) {
  // Match the Base's WEEKNUM(date, 2), including its calendar-year boundary.
  const year = Number(monday.slice(0, 4));
  const jan1 = `${year}-01-01`;
  const offset = (new Date(`${jan1}T12:00:00Z`).getUTCDay() + 6) % 7;
  const elapsed = Math.round((timestamp(monday) - timestamp(jan1)) / 86400000);
  return `${year}年第${Math.floor((elapsed + offset) / 7) + 1}周`;
}
export const dayName = date => DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()];
export function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(text(value));
  return Number.isFinite(n) ? n : null;
}
function scriptText(value) {
  if (Array.isArray(value)) return value.map(scriptText).join('');
  // Feishu document mentions carry their URL separately from the visible title.
  if (value?.link && /^https?:\/\/\S+$/.test(value.link)) {
    const title = text(value);
    return title === value.link ? title : `[${title}](${value.link})`;
  }
  return text(value);
}
export function normalizeShoot(record, fields = TARGET.fields.week) {
  const f = record.fields || {};
  return {
    id: record.recordId, date: dateKey(f[fields.date]),
    periods: options(f[fields.periods]), photographers: options(f[fields.photographers]),
    host: text(f[fields.host]).trim(), script: scriptText(f[fields.script]), count: numberOrNull(f[fields.count])
  };
}
export function inWeek(shoot, monday) { return !!shoot.date && shoot.date >= monday && shoot.date < addDays(monday, 7); }
export function sortShoots(shoots) {
  return [...shoots].sort((a, b) => a.date.localeCompare(b.date) || PERIODS.indexOf(a.periods[0]) - PERIODS.indexOf(b.periods[0]) || a.host.localeCompare(b.host, 'zh-CN') || a.id.localeCompare(b.id));
}
export function summarize(shoots) {
  const unique = [...new Map(shoots.filter(s => s.host && s.date).map(s => [s.id, s])).values()];
  return { sessions: unique.length, count: unique.reduce((n, s) => n + (s.count ?? 0), 0), unreported: unique.filter(s => s.count == null).length };
}
export function participantsTotal(shoots, photographer) {
  return summarize(shoots.filter(s => s.photographers.includes(photographer))).count;
}
export function occupied(shoots, photographer, date, period, exceptId = '') {
  return shoots.filter(s => s.id !== exceptId && s.host && s.date === date && s.periods.includes(period) && s.photographers.includes(photographer));
}
export function halfDayCount(shoots, photographer, exceptId = '') {
  const keys = new Set();
  shoots.filter(s => s.id !== exceptId && s.host && s.photographers.includes(photographer)).forEach(s => s.periods.forEach(p => keys.add(`${s.date}|${p}`)));
  return keys.size;
}
export const leaveKey = (name, date, period) => `${name}|${date}|${period}`;
export function assignmentProblems(draft, shoots, photos, leaves, currentMonday = mondayOf()) {
  const errors = [];
  for (const name of draft.photographers) {
    const p = photos.find(p => p.name === name);
    const assignmentIsCurrent = mondayOf(draft.date) === currentMonday;
    if (assignmentIsCurrent && p && !p.onDuty) errors.push(`${name}本周轮休`);
    for (const period of draft.periods) {
      if (leaves.has(leaveKey(name, draft.date, period))) errors.push(`${name}在${draft.date}${period}请假`);
      const conflicts = occupied(shoots, name, draft.date, period, draft.id);
      if (conflicts.length) errors.push(`${name}在${draft.date}${period}已安排${conflicts.map(s => s.host).join('、')}`);
    }
    if (mondayOf(draft.date) >= currentMonday && halfDayCount(shoots, name, draft.id) + draft.periods.length > 2) errors.push(`${name}该周将超过2个半天`);
  }
  return [...new Set(errors)];
}
export function validateShoot(draft) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(timestamp(draft.date)) || dateKey(timestamp(draft.date)) !== draft.date) throw new Error('请选择有效拍摄日期');
  if (!draft.host.trim()) throw new Error('请选择主播');
  if (!draft.periods.length || draft.periods.some(p => !PERIODS.includes(p))) throw new Error('请选择上午或下午');
  if (draft.count != null && (!Number.isSafeInteger(draft.count) || draft.count < 0)) throw new Error('实拍条数须为非负整数，未填报请留空');
}
export function sameValue(a, b) {
  const canonical = v => Array.isArray(v) ? [...v].sort() : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function changedKeys(draft, baseline) {
  return Object.keys(TARGET.fields.week).filter(key => !baseline || !sameValue(draft[key], baseline[key]));
}
export function scriptUrl(script) {
  const value = script.trim();
  const markdown = value.match(/^\[[\s\S]*\]\((https?:\/\/\S+)\)$/);
  const url = markdown ? markdown[1] : value;
  return /^https?:\/\/\S+$/.test(url) ? url : '';
}
