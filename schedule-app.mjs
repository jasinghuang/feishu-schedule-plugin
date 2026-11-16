import { TARGET, PERIODS, addDays, dateKey, mondayOf, weekLabel, dayName, summarize, participantsTotal, occupied, halfDayCount, leaveKey, sortShoots, scriptUrl } from './schedule-core.mjs';
import { ScheduleStore } from './schedule-data.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('preview');
let store, sdk, data, monday = mondayOf(), baseline, slot, loading = 0, unsubscribe;
let timer, saving = false, uncertain = false, metadataDirty = false;
let selectedPhotographer = '';
const showError = (id, message = '') => { $(id).textContent = message; $(id).hidden = !message; };
const notice = message => showError('notice', message);
const copy = object => structuredClone(object);

function render() {
  const totals = summarize(data.shoots);
  $('week-label').textContent = weekLabel(monday);
  $('week-date').value = monday;
  $('total-label').textContent = monday === mondayOf() ? '当周完成拍摄' : '该周完成拍摄';
  $('total').textContent = totals.count;
  $('total-meta').textContent = `条 · ${totals.sessions}场${totals.unreported ? ` · ${totals.unreported}场未填报` : ''}`;
  $('connection').textContent = preview ? '本地演示 · 不写入飞书' : `已连接 v2 · ${data.canEdit ? '与每周排期同步' : '只读'}`;
  $('export').disabled = false;
  $('week-range').textContent = `${monday.replaceAll('-', '/')} — ${addDays(monday, 6).replaceAll('-', '/')}`;
  renderShoots(); renderRoster();
}
function renderShoots() {
  if (!data.shoots.length) { $('shoot-list').className = 'empty'; $('shoot-list').textContent = '该周暂无拍摄安排'; return; }
  $('shoot-list').className = '';
  const dates = [...new Set(data.shoots.map(s => s.date))];
  $('shoot-list').innerHTML = dates.map(date => {
    const shoots = data.shoots.filter(s => s.date === date);
    return `<section class="day-group"><header class="day-heading"><h3>${dayName(date)} · ${date.slice(5).replace('-', '/')}</h3><span>${shoots.length}场</span></header><div class="shoot-heading" aria-hidden="true"><span>主播</span><span>时段</span><span>参与摄影师</span><span>脚本</span><span class="count">实拍条数</span><span></span></div>${shoots.map(s => {
      const url = scriptUrl(s.script);
      const script = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.script)}">打开脚本 ↗</a>` : `<span title="${esc(s.script)}">${esc(s.script || '未提供')}</span>`;
      return `<article class="shoot-row"><button class="host-button" data-shoot="${esc(s.id)}">${esc(s.host)}</button><span class="period-cell">${esc(s.periods.join('、'))}</span><span class="photos"><span class="mobile-label">摄影师</span>${esc(s.photographers.join('、') || '待安排')}</span><span class="script-cell"><span class="mobile-label">脚本</span>${script}</span><span class="count"><span class="mobile-label">实拍</span>${s.count == null ? '<span class="muted">未填报</span>' : `${s.count}条`}</span><span class="row-action"><button data-shoot="${esc(s.id)}" aria-label="${data.canEdit ? '编辑' : '查看'}${esc(s.host)}${esc(date)}拍摄">${data.canEdit ? '编辑' : '查看'}</button></span></article>`;
    }).join('')}</section>`;
  }).join('');
}
function renderRoster() {
  if (!data.photographers.some(p => p.id === selectedPhotographer)) selectedPhotographer = data.photographers[0]?.id || '';
  const currentWeek = monday === mondayOf();
  $('duty-label').textContent = currentWeek ? '本周上岗' : '上岗设置请切回本周';
  $('roster').innerHTML = data.photographers.map(p => `<div class="roster-person ${p.id === selectedPhotographer ? 'selected' : ''}"><input type="checkbox" data-duty="${esc(p.id)}" aria-label="${esc(p.name)}本周上岗" ${p.onDuty ? 'checked' : ''} ${!currentWeek || !data.canEditRoster ? 'disabled' : ''}><button data-photographer="${esc(p.id)}" aria-pressed="${p.id === selectedPhotographer}">${esc(p.name)}</button></div>`).join('');
  const person = data.photographers.find(p => p.id === selectedPhotographer);
  $('photographer-name').textContent = person?.name || '暂无摄影师';
  $('photographer-total').textContent = person ? `已约 ${halfDayCount(data.shoots, person.name)} 个半天 · 参与拍摄 ${participantsTotal(data.shoots, person.name)} 条` : '';
  if (!person) { $('day-grid').replaceChildren(); return; }
  const name = person.name, rest = currentWeek && !person.onDuty;
  // Existing weekend shoots and leave must remain reachable in both views.
  const weekend = data.shoots.some(s => s.date >= addDays(monday, 5)) || [...data.slotRecords.keys()].some(key => key.split('|')[1] >= addDays(monday, 5));
  const days = Array.from({ length: weekend ? 7 : 5 }, (_, i) => addDays(monday, i));
  $('day-grid').innerHTML = days.map(date => `<section class="schedule-day"><h3>${dayName(date)}<small>${date.slice(5).replace('-', '/')}</small></h3>${PERIODS.map(period => {
    const shoots = occupied(data.shoots, name, date, period), leave = data.leaves.has(leaveKey(name, date, period));
    const clash = shoots.length > 1 || (shoots.length && (leave || rest));
    if (shoots.length) return `<div class="schedule-slot booked ${clash ? 'conflict' : ''}"><small>${period}${clash ? ' · 冲突' : ''}</small>${shoots.map(shoot => `<button data-shoot="${esc(shoot.id)}" aria-label="${esc(name)} ${date}${period} ${esc(shoot.host)}拍摄">${esc(shoot.host)}<small>${shoot.count == null ? '未填报' : shoot.count + '条'}</small></button>`).join('')}</div>`;
    const disabled = leave ? !data.canEditLeave : rest || (!data.canEdit && !data.canEditLeave && !data.canAddLeave);
    return `<button class="schedule-slot ${leave || rest ? 'leave' : 'open'}" data-slot-name="${esc(name)}" data-slot-date="${date}" data-slot-period="${period}" ${disabled ? 'disabled' : ''} aria-label="${esc(name)} ${date}${period} ${leave ? '取消请假' : rest ? '本周轮休' : '加入已有场次或请假'}"><small>${period}</small><span class="${leave || rest ? '' : 'plus'}">${leave ? '请假' : rest ? '轮休' : '＋'}</span></button>`;
  }).join('')}</section>`).join('');
}
async function refresh({ metadata = false } = {}) {
  if (!store) return;
  const version = ++loading;
  $('refresh').disabled = true;
  try {
    if (metadata) await store.init();
    const next = await store.loadWeek(monday);
    if (version !== loading) return;
    data = next; render(); showError('error');
  } catch (e) {
    if (version === loading) {
      data = undefined;
      showError('error', `读取失败：${e.message}。请刷新重试。`);
      $('export').disabled = true;
      $('shoot-list').className = 'empty'; $('shoot-list').textContent = '排期暂不可用'; $('roster').replaceChildren(); $('day-grid').replaceChildren(); $('photographer-name').textContent = ''; $('photographer-total').textContent = '';
      $('total').textContent = '—'; $('total-meta').textContent = '条';
    }
  } finally { if (version === loading) $('refresh').disabled = false; }
}
async function changeWeek(date) { if (!date || saving) return; monday = mondayOf(date); await refresh(); }
function switchView(roster) {
  $('shoot-panel').hidden = roster; $('roster-panel').hidden = !roster;
  for (const [id, selected] of [['shoot-tab', !roster], ['roster-tab', roster]]) {
    $(id).classList.toggle('selected', selected); $(id).setAttribute('aria-selected', selected); $(id).tabIndex = selected ? 0 : -1;
  }
}
function openEditor(shoot) {
  if (!data || !shoot || saving) return;
  baseline = copy(shoot); uncertain = false;
  const draft = shoot, editable = data.canEdit;
  $('editor-title').textContent = `${draft.host} · 拍摄记录`;
  $('shoot-date').value = draft.date;
  const hosts = [...new Set([...data.hosts.map(h => h.name), draft.host].filter(Boolean))];
  $('shoot-host').innerHTML = hosts.map(h => `<option>${esc(h)}</option>`).join(''); $('shoot-host').value = draft.host;
  $('period-choices').innerHTML = PERIODS.map(p => `<label><input type="checkbox" name="period" value="${p}" ${draft.periods.includes(p) ? 'checked' : ''}>${p}</label>`).join('');
  const names = [...new Set([...data.photographers.map(p => p.name), ...draft.photographers])];
  $('photo-choices').innerHTML = names.map(name => `<label><input type="checkbox" name="photographer" value="${esc(name)}" ${draft.photographers.includes(name) ? 'checked' : ''}>${esc(name)}</label>`).join('');
  $('shoot-script').value = draft.script; $('shoot-count').value = draft.count ?? '';
  for (const input of $('shoot-form').querySelectorAll('input,select,textarea')) input.disabled = !editable;
  $('save-shoot').hidden = !editable; $('save-shoot').disabled = false;
  $('cancel-shoot').hidden = !editable || shoot.count != null;
  $('open-base').hidden = preview;
  showError('editor-error'); $('editor').showModal();
}
function draftFromForm() {
  return { id: baseline?.id || '', date: $('shoot-date').value, host: $('shoot-host').value,
    periods: [...document.querySelectorAll('[name=period]:checked')].map(i => i.value),
    photographers: [...document.querySelectorAll('[name=photographer]:checked')].map(i => i.value),
    script: $('shoot-script').value, count: $('shoot-count').value === '' ? null : Number($('shoot-count').value) };
}
async function save(event) {
  event.preventDefault(); if (saving || uncertain) return;
  saving = true; $('save-shoot').disabled = true; showError('editor-error');
  const draft = draftFromForm();
  try {
    await store.saveShoot(draft, baseline);
    $('editor').close(); monday = mondayOf(draft.date);
    await refresh(); notice(preview ? '演示记录已保存' : '已保存到每周排期');
  } catch (e) {
    uncertain = Boolean(e.recordId);
    showError('editor-error', e.message);
  } finally { saving = false; $('save-shoot').disabled = uncertain; }
}
function openSlot(name, date, period) {
  if (!data || saving) return;
  slot = { name, date, period }; $('slot-title').textContent = `${name} · ${date.slice(5)}${period}`;
  const leave = data.leaves.has(leaveKey(name, date, period));
  const candidates = data.shoots.filter(s => s.date === date && s.periods.includes(period));
  $('slot-existing-label').hidden = leave; $('slot-existing').hidden = leave;
  $('slot-existing').innerHTML = candidates.map(s => `<article class="existing-session"><div><strong>${esc(s.host)}</strong><small>${esc(s.photographers.join('、') || '待安排')} · ${s.count == null ? '未填报' : s.count + '条'}</small></div><button data-join="${esc(s.id)}" ${!data.canEdit ? 'disabled' : ''} aria-label="加入${esc(s.host)}${date}${period}拍摄">加入</button></article>`).join('') || '<p class="muted">该时段暂无已有拍摄场次</p>';
  $('slot-leave').textContent = leave ? '取消请假' : '该时段请假';
  $('slot-leave').disabled = leave ? !data.canEditLeave : data.slotRecords.has(leaveKey(name, date, period)) ? !data.canEditLeave : !data.canAddLeave;
  showError('slot-error'); $('slot-dialog').showModal();
}
async function join(id) {
  if (!slot || saving) return;
  saving = true;
  for (const button of $('slot-dialog').querySelectorAll('button')) button.disabled = true;
  try {
    await store.joinShoot(id, slot.name, slot.date, slot.period);
    $('slot-dialog').close(); await refresh(); notice('已加入该场拍摄，脚本与条数共用');
  } catch (error) {
    // An unconfirmed write must be checked before offering the join action again.
    await refresh(); $('slot-dialog').close(); notice(error.message);
  } finally { saving = false; for (const button of $('slot-dialog').querySelectorAll('button')) button.disabled = false; }
}
function exportWeek() {
  if (!data) return;
  const cell = value => '"' + String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
  const rows = [['日期','星期','时间段','主播','参与摄影师','脚本','实拍条数'], ...sortShoots(data.shoots).map(s => [s.date,dayName(s.date),s.periods.join('、'),s.host,s.photographers.join('、'),s.script,s.count])];
  const blob = new Blob(['\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `拍摄排期-${monday}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('previous-week').onclick = () => changeWeek(addDays(monday, -7)); $('next-week').onclick = () => changeWeek(addDays(monday, 7));
$('this-week').onclick = () => changeWeek(dateKey(Date.now())); $('week-date').onchange = e => changeWeek(e.target.value);
$('refresh').onclick = () => refresh({ metadata: true });
$('shoot-tab').onclick = () => switchView(false); $('roster-tab').onclick = () => switchView(true);
for (const id of ['shoot-tab','roster-tab']) $(id).onkeydown = e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); const roster = e.key === 'End' || (e.key !== 'Home' && id === 'shoot-tab'); switchView(roster); $(roster ? 'roster-tab' : 'shoot-tab').focus(); } };
$('shoot-form').onsubmit = save; $('export').onclick = exportWeek;
document.addEventListener('click', e => {
  if (saving) return;
  const person = e.target.closest('[data-photographer]'); if (person && data) { selectedPhotographer = person.dataset.photographer; renderRoster(); }
  const joining = e.target.closest('[data-join]'); if (joining) join(joining.dataset.join);
  const close = e.target.closest('[data-close]'); if (close && !saving) $(close.dataset.close).close();
  const shoot = e.target.closest('[data-shoot]'); if (shoot && data) openEditor(data.shoots.find(s => s.id === shoot.dataset.shoot));
  const cell = e.target.closest('[data-slot-name]'); if (cell && data) openSlot(cell.dataset.slotName, cell.dataset.slotDate, cell.dataset.slotPeriod);
});
$('editor').addEventListener('cancel', e => { if (saving) e.preventDefault(); });
$('open-base').onclick = async () => { try { await sdk.ui.showRecordDetailDialog({ tableId: TARGET.week, recordId: baseline.id }); } catch (e) { showError('editor-error', e.message); } };
$('cancel-shoot').onclick = () => $('cancel-dialog').showModal();
$('cancel-form').onsubmit = async e => {
  e.preventDefault(); if (saving) return; saving = true;
  try { await store.removeShoot(baseline); $('cancel-dialog').close(); $('editor').close(); await refresh(); notice('已取消这场拍摄'); }
  catch (error) { $('cancel-dialog').close(); showError('editor-error', error.message); }
  finally { saving = false; }
};
$('slot-dialog').addEventListener('cancel', e => { if (saving) e.preventDefault(); });
$('slot-leave').onclick = async () => {
  if (!slot || saving) return;
  const checked = !data.leaves.has(leaveKey(slot.name, slot.date, slot.period));
  saving = true; $('slot-leave').disabled = true;
  try { await store.setLeave(slot.name, slot.date, slot.period, checked); $('slot-dialog').close(); await refresh(); notice(checked ? '已标记该时段请假' : '已取消该时段请假'); }
  catch (error) { showError('slot-error', error.message); }
  finally { saving = false; $('slot-leave').disabled = false; }
};
$('roster').onchange = async e => {
  if (!e.target.dataset.duty || saving) return; const checked = e.target.checked; saving = true; e.target.disabled = true;
  try { await store.setDuty(e.target.dataset.duty, checked); await refresh(); notice('本周上岗名单已更新'); }
  catch (error) { e.target.checked = !checked; showError('error', error.message); }
  finally { saving = false; e.target.disabled = false; }
};
window.addEventListener('pagehide', () => { clearTimeout(timer); unsubscribe?.(); });
async function start() {
  try {
    if (preview) {
      const { previewSdk } = await import('./tests/preview-sdk.mjs'); sdk = previewSdk();
    } else {
      if (window.parent === window) throw new Error('请在飞书 v2 Base 的自定义插件内打开，独立网页无法读取或保存表格');
      sdk = (await import('./sdk/index.mjs')).bitable;
    }
    store = await new ScheduleStore(sdk).init();
    unsubscribe = store.subscribe(metadata => { metadataDirty ||= metadata; clearTimeout(timer); timer = setTimeout(() => { const dirty = metadataDirty; metadataDirty = false; refresh({ metadata:dirty }); }, 500); });
    await refresh();
  } catch (e) {
    $('connection').textContent = '尚未连接飞书'; $('shoot-list').textContent = '请从 v2 Base 的自定义插件打开'; showError('error', e.message); $('refresh').disabled = true;
  }
}
await start();
