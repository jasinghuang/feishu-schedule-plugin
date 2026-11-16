import { TARGET, PERIODS, addDays, dateKey, mondayOf, weekLabel, dayName, summarize, participantsTotal, occupied, halfDayCount, leaveKey, sortShoots, scriptUrl } from './schedule-core.mjs?v=20261116-links';
import { ScheduleStore } from './schedule-data.mjs?v=20261116-links';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('preview');
let store, sdk, data, monday = mondayOf(), baseline, slot, loading = 0, unsubscribe;
let timer, saving = false, uncertain = false, metadataDirty = false;
let selectedPhotographer = '', noticeTimer;
const showError = (id, message = '') => { $(id).textContent = message; $(id).hidden = !message; };
function notice(message) {
  clearTimeout(noticeTimer); $('notice-text').textContent = message; $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000);
}
function buttonBusy(button, busy, label) {
  button.classList.toggle('is-busy', busy); button.setAttribute('aria-busy', String(busy));
  button.setAttribute('aria-disabled', String(busy || button.disabled));
  if (label) button.textContent = label;
}
function focusedControl() {
  const element = document.activeElement;
  if (!$('roster-panel').contains(element) && !$('shoot-panel').contains(element)) return '';
  if (element.dataset.slotName) return ['name', 'date', 'period'].map(key => `[data-slot-${key}="${CSS.escape(element.dataset['slot' + key[0].toUpperCase() + key.slice(1)])}"]`).join('');
  for (const key of ['photographer', 'duty', 'shoot']) if (element.dataset[key]) return `[data-${key}="${CSS.escape(element.dataset[key])}"]`;
  return '';
}
function restoreFocus(selector) {
  // Live updates can replace the button that opened a dialog.
  if (selector && document.activeElement === document.body) {
    const panel = $('shoot-panel').hidden ? $('roster-panel') : $('shoot-panel');
    (panel.querySelector(selector) || $(panel.id === 'shoot-panel' ? 'shoot-tab' : 'roster-tab')).focus({ preventScroll:true });
  }
}
const copy = object => structuredClone(object);

function render() {
  const focused = focusedControl(), totals = summarize(data.shoots);
  $('week-label').textContent = weekLabel(monday);
  $('week-date').value = monday;
  $('total-label').textContent = monday === mondayOf() ? '本周实拍' : '该周实拍';
  $('export').textContent = monday === mondayOf() ? '导出本周' : '导出该周';
  $('this-week').hidden = monday === mondayOf();
  $('total').textContent = totals.count;
  $('total-meta').textContent = `${totals.sessions}场拍摄${totals.unreported ? ` · ${totals.unreported}场待填条数` : totals.sessions ? ' · 已全部填报' : ''}`;
  $('connection').textContent = preview ? '演示数据 · 不写入飞书' : `飞书已连接${data.canEdit ? '' : ' · 只读'}`;
  $('export').disabled = false;
  $('week-range').textContent = `${monday.replaceAll('-', '/')} — ${addDays(monday, 6).replaceAll('-', '/')}`;
  renderShoots(); renderRoster(); restoreFocus(focused);
}
function renderShoots() {
  if (!data.shoots.length) { $('shoot-list').className = 'empty'; $('shoot-list').textContent = '这一周还没有拍摄安排'; return; }
  $('shoot-list').className = '';
  const dates = [...new Set(data.shoots.map(s => s.date))];
  $('shoot-list').innerHTML = dates.map(date => {
    const shoots = data.shoots.filter(s => s.date === date);
    return `<section class="day-group"><header class="day-heading"><h3>${dayName(date)} · ${date.slice(5).replace('-', '/')}</h3><span>${shoots.length}场</span></header><div class="shoot-heading" aria-hidden="true"><span>主播</span><span>时段</span><span>参与摄影师</span><span>脚本</span><span class="count">实拍条数</span><span></span></div>${shoots.map(s => {
      const url = scriptUrl(s.script);
      const script = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.script)}">查看脚本 ↗</a>` : `<span title="${esc(s.script)}">${esc(s.script || '待提供')}</span>`;
      return `<article class="shoot-row"><button class="host-button" data-shoot="${esc(s.id)}">${esc(s.host)}</button><span class="period-cell"><span class="period-tag">${esc(s.periods.join('、'))}</span></span><span class="photos"><span class="mobile-label">摄影师</span>${s.photographers.length ? s.photographers.map(name => `<span class="person-chip">${esc(name)}</span>`).join('') : '<span class="muted">待安排</span>'}</span><span class="script-cell"><span class="mobile-label">脚本</span>${script}</span><span class="count"><span class="mobile-label">实拍</span>${s.count == null ? '<span class="pending-badge">待填条数</span>' : `${s.count}条`}</span><span class="row-action"><button data-shoot="${esc(s.id)}" aria-label="${data.canEdit ? '编辑' : '查看'}${esc(s.host)}${esc(date)}拍摄">${data.canEdit ? '编辑' : '查看'}</button></span></article>`;
    }).join('')}</section>`;
  }).join('');
}
function renderRoster() {
  const focused = focusedControl();
  if (!data.photographers.some(p => p.id === selectedPhotographer)) selectedPhotographer = data.photographers[0]?.id || '';
  const currentWeek = monday === mondayOf();
  $('duty-label').hidden = !currentWeek;
  $('roster').innerHTML = data.photographers.map(p => `<div class="roster-person ${p.id === selectedPhotographer ? 'selected' : ''}"><button class="person-select" data-photographer="${esc(p.id)}" aria-pressed="${p.id === selectedPhotographer}" aria-label="查看${esc(p.name)}的排班"><span class="person-avatar" aria-hidden="true">${esc(p.name.slice(0,1))}</span><span class="person-name">${esc(p.name)}</span></button>${currentWeek ? `<label class="duty-switch" title="${esc(p.name)}：${p.onDuty ? '本周上岗' : '本周轮休'}"><input type="checkbox" role="switch" data-duty="${esc(p.id)}" aria-label="${esc(p.name)}本周上岗" ${p.onDuty ? 'checked' : ''} ${!data.canEditRoster ? 'disabled' : ''}><span aria-hidden="true"></span></label>` : ''}</div>`).join('');
  const person = data.photographers.find(p => p.id === selectedPhotographer);
  $('photographer-name').innerHTML = person ? `${esc(person.name)}<span class="schedule-caption">的排班</span>` : '暂无摄影师';
  $('photographer-total').innerHTML = person ? `<span>已约 <strong>${halfDayCount(data.shoots, person.name)}</strong> 个半天</span><span>参与实拍 <strong>${participantsTotal(data.shoots, person.name)}</strong> 条</span>` : '';
  if (!person) { $('day-grid').replaceChildren(); return; }
  const name = person.name, rest = currentWeek && !person.onDuty;
  // Existing weekend shoots and leave must remain reachable in both views.
  const weekend = data.shoots.some(s => s.date >= addDays(monday, 5)) || [...data.slotRecords.keys()].some(key => key.split('|')[1] >= addDays(monday, 5));
  const days = Array.from({ length: weekend ? 7 : 5 }, (_, i) => addDays(monday, i));
  $('day-grid').innerHTML = days.map(date => `<section class="schedule-day ${date === dateKey(Date.now()) ? 'today' : ''}"><h3>${dayName(date)}<small>${date.slice(5).replace('-', '/')}</small></h3>${PERIODS.map(period => {
    const shoots = occupied(data.shoots, name, date, period), leave = data.leaves.has(leaveKey(name, date, period));
    const clash = shoots.length > 1 || (shoots.length && (leave || rest));
    if (shoots.length) return `<div class="schedule-slot booked ${clash ? 'conflict' : ''}"><small>${period}${clash ? ' · 冲突' : ''}</small>${shoots.map(shoot => `<button data-shoot="${esc(shoot.id)}" aria-label="${esc(name)} ${date}${period} ${esc(shoot.host)}拍摄">${esc(shoot.host)}<small>${shoot.count == null ? '待填条数' : shoot.count + '条'}</small></button>`).join('')}</div>`;
    const disabled = leave ? !data.canEditLeave : rest || (!data.canEdit && !data.canEditLeave && !data.canAddLeave);
    return `<button class="schedule-slot ${leave || rest ? 'leave' : 'open'}" data-slot-name="${esc(name)}" data-slot-date="${date}" data-slot-period="${period}" ${disabled ? 'disabled' : ''} aria-label="${esc(name)} ${date}${period} ${leave ? '取消请假' : rest ? '本周轮休' : '加入已有场次或请假'}"><small>${period}</small><span class="${leave || rest ? '' : 'plus'}">${leave ? '请假' : rest ? '轮休' : '＋'}</span></button>`;
  }).join('')}</section>`).join('');
  restoreFocus(focused);
}
async function refresh({ metadata = false } = {}) {
  if (!store) return;
  const version = ++loading;
  buttonBusy($('refresh'), true);
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
      $('total').textContent = '—'; $('total-meta').textContent = '暂不可用';
    }
  } finally { if (version === loading) buttonBusy($('refresh'), false); }
}
async function changeWeek(date) { if (!date || saving) return; clearTimeout(noticeTimer); $('notice').hidden = true; monday = mondayOf(date); await refresh(); }
function switchView(roster) {
  $('shoot-panel').hidden = roster; $('roster-panel').hidden = !roster;
  for (const [id, selected] of [['shoot-tab', !roster], ['roster-tab', roster]]) {
    $(id).classList.toggle('selected', selected); $(id).setAttribute('aria-selected', selected); $(id).tabIndex = selected ? 0 : -1;
  }
}
function openEditor(shoot) {
  if (!data || !shoot || saving) return;
  $('editor').dataset.returnFocus = focusedControl();
  baseline = copy(shoot); uncertain = false;
  const draft = shoot, editable = data.canEdit;
  $('editor-title').textContent = `${draft.host} · 拍摄记录`;
  $('shoot-date').value = draft.date;
  $('editor').querySelector('.form-grid').inert = false;
  const hosts = [...new Set([...data.hosts.map(h => h.name), draft.host].filter(Boolean))];
  $('shoot-host').innerHTML = hosts.map(h => `<option>${esc(h)}</option>`).join(''); $('shoot-host').value = draft.host;
  $('period-choices').innerHTML = PERIODS.map(p => `<label><input type="checkbox" name="period" value="${p}" ${draft.periods.includes(p) ? 'checked' : ''}>${p}</label>`).join('');
  const names = [...new Set([...data.photographers.map(p => p.name), ...draft.photographers])];
  $('photo-choices').innerHTML = names.map(name => `<label><input type="checkbox" name="photographer" value="${esc(name)}" ${draft.photographers.includes(name) ? 'checked' : ''}>${esc(name)}</label>`).join('');
  $('shoot-script').value = draft.script; $('shoot-count').value = draft.count ?? '';
  $('editor-subtitle').textContent = `${draft.date.slice(5).replace('-', '/')} ${dayName(draft.date)} · ${draft.periods.join('、')}`;
  for (const input of $('shoot-form').querySelectorAll('input,select,textarea')) input.disabled = !editable;
  $('save-shoot').hidden = !editable; $('save-shoot').disabled = false; buttonBusy($('save-shoot'), false, '保存修改');
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
  const draft = draftFromForm();
  saving = true; buttonBusy($('save-shoot'), true, '保存中…'); $('shoot-form').querySelector('.form-grid').inert = true; showError('editor-error');
  try {
    await store.saveShoot(draft, baseline);
    $('editor').close(); monday = mondayOf(draft.date);
    await refresh(); notice(preview ? '演示记录已保存' : '已保存到每周排期');
  } catch (e) {
    uncertain = Boolean(e.recordId);
    showError('editor-error', e.message);
  } finally { saving = false; $('save-shoot').disabled = uncertain; $('shoot-form').querySelector('.form-grid').inert = false; buttonBusy($('save-shoot'), false, uncertain ? '请刷新核对' : '保存修改'); }
}
function openSlot(name, date, period) {
  if (!data || saving) return;
  $('slot-dialog').dataset.returnFocus = focusedControl();
  slot = { name, date, period };
  $('slot-context').textContent = `${name} · ${date.slice(5).replace('-', '/')} ${dayName(date)} · ${period}`;
  const leave = data.leaves.has(leaveKey(name, date, period));
  const candidates = data.shoots.filter(s => s.date === date && s.periods.includes(period));
  $('slot-title').textContent = leave ? '取消这个时段的请假' : '安排这个时段';
  $('slot-existing-label').hidden = leave || !candidates.length; $('slot-existing').hidden = leave;
  $('slot-existing').innerHTML = candidates.map(s => `<article class="existing-session"><div><strong>${esc(s.host)}</strong><small>${esc(s.photographers.join('、') || '待安排')} · ${s.count == null ? '待填条数' : s.count + '条'}</small></div><button class="primary join-button" data-join="${esc(s.id)}" ${!data.canEdit ? 'disabled' : ''} aria-label="加入${esc(s.host)}${date}${period}拍摄">加入</button></article>`).join('') || '<div class="slot-empty"><span aria-hidden="true">＋</span><p>这个时段还没有拍摄场次</p><small>可在「每周排期」建立场次后加入</small></div>';
  $('slot-leave').textContent = leave ? '取消请假' : '设为请假';
  $('slot-leave').classList.toggle('primary', leave);
  $('slot-leave').disabled = leave ? !data.canEditLeave : data.slotRecords.has(leaveKey(name, date, period)) ? !data.canEditLeave : !data.canAddLeave;
  showError('slot-error'); $('slot-dialog').showModal();
}
async function join(id) {
  if (!slot || saving || !data?.canEdit) return;
  const button = $('slot-existing').querySelector(`[data-join="${CSS.escape(id)}"]`);
  saving = true; showError('slot-error'); buttonBusy(button, true, '加入中…');
  try {
    await store.joinShoot(id, slot.name, slot.date, slot.period);
    $('slot-dialog').dataset.returnFocus = `[data-shoot="${CSS.escape(id)}"]`;
    $('slot-dialog').close(); await refresh(); notice('已加入拍摄场次');
  } catch (error) {
    if (error.recordId) { $('slot-dialog').close(); await refresh(); showError('error', error.message); }
    else showError('slot-error', error.message);
  } finally { saving = false; buttonBusy(button, false, '加入'); }
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
$('week-date').onclick = e => { if (!saving) e.currentTarget.showPicker?.(); };
$('week-date').onkeydown = e => { if (!saving && ['Enter', ' '].includes(e.key)) { e.preventDefault(); e.currentTarget.showPicker?.(); } };
$('refresh').onclick = () => { if (!saving && $('refresh').getAttribute('aria-busy') !== 'true') refresh({ metadata: true }); };
$('dismiss-notice').onclick = () => { clearTimeout(noticeTimer); $('notice').hidden = true; };
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
for (const id of ['editor', 'slot-dialog']) $(id).addEventListener('close', () => restoreFocus($(id).dataset.returnFocus));
$('open-base').onclick = async () => { if (saving) return; try { await sdk.ui.showRecordDetailDialog({ tableId: TARGET.week, recordId: baseline.id }); } catch (e) { showError('editor-error', e.message); } };
$('cancel-shoot').onclick = () => { if (!saving) $('cancel-dialog').showModal(); };
$('cancel-dialog').addEventListener('cancel', e => { if (saving) e.preventDefault(); });
$('cancel-form').onsubmit = async e => {
  e.preventDefault(); if (saving) return; saving = true;
  const button = $('cancel-form').querySelector('[type=submit]'); buttonBusy(button, true, '取消中…');
  try { await store.removeShoot(baseline); $('cancel-dialog').close(); $('editor').close(); await refresh(); notice('已取消这场拍摄'); }
  catch (error) { $('cancel-dialog').close(); showError('editor-error', error.message); }
  finally { saving = false; buttonBusy(button, false, '确认取消'); }
};
$('slot-dialog').addEventListener('cancel', e => { if (saving) e.preventDefault(); });
$('slot-leave').onclick = async () => {
  if (!slot || !data || saving) return;
  const checked = !data.leaves.has(leaveKey(slot.name, slot.date, slot.period));
  saving = true; showError('slot-error'); buttonBusy($('slot-leave'), true, checked ? '设置中…' : '取消中…');
  try { await store.setLeave(slot.name, slot.date, slot.period, checked); $('slot-dialog').close(); await refresh(); notice(checked ? '已标记该时段请假' : '已取消该时段请假'); }
  catch (error) { showError('slot-error', error.message); }
  finally { saving = false; buttonBusy($('slot-leave'), false, checked ? '设为请假' : '取消请假'); }
};
$('roster').onchange = async e => {
  const input = e.target, id = input.dataset.duty;
  if (!id || !data) return;
  const person = data.photographers.find(p => p.id === id);
  if (saving) { input.checked = person.onDuty; return; }
  const checked = input.checked; saving = true;
  input.setAttribute('aria-disabled', 'true'); input.closest('.roster-person').setAttribute('aria-busy', 'true');
  try { await store.setDuty(id, checked); await refresh(); notice(`${person.name}已设为${checked ? '本周上岗' : '本周轮休'}`); }
  catch (error) { input.checked = !checked; showError('error', error.message); }
  finally { saving = false; input.removeAttribute('aria-disabled'); input.closest('.roster-person')?.removeAttribute('aria-busy'); }
};
window.addEventListener('pagehide', () => { clearTimeout(timer); clearTimeout(noticeTimer); unsubscribe?.(); });
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
