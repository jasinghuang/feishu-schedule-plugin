import { TARGET, PERIODS, addDays, dateKey, mondayOf, weekLabel, dayName, summarize, participantsTotal, occupied, halfDayCount, leaveKey, sortShoots, scriptUrl } from './schedule-core.mjs';
import { ScheduleStore } from './schedule-data.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('preview');
let store, sdk, data, monday = mondayOf(), baseline, slot, loading = 0, unsubscribe;
let timer, saving = false, uncertain = false, metadataDirty = false;
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
  $('new-shoot').hidden = !data.canAdd;
  $('settings').hidden = !data.canEdit || monday !== mondayOf();
  $('export').disabled = false;
  $('week-range').textContent = `${monday.replaceAll('-', '/')} — ${addDays(monday, 6).replaceAll('-', '/')}`;
  renderShoots(); renderMatrix();
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
function renderMatrix() {
  // Include weekend records so switching views never hides an existing shoot.
  const days = Array.from({ length: data.shoots.some(s => s.date >= addDays(monday, 5)) ? 7 : 5 }, (_, i) => addDays(monday, i));
  const names = [...new Set([...data.photographers.map(p => p.name), ...data.shoots.flatMap(s => s.photographers)])];
  $('matrix').innerHTML = `<div class="table-wrap"><table><caption class="sr-only">${esc(weekLabel(monday))}摄影师矩阵</caption><thead><tr><th rowspan="2" scope="col">摄影师</th>${days.map(d => `<th colspan="2" scope="colgroup">${dayName(d)}<small>${d.slice(5).replace('-', '/')}</small></th>`).join('')}<th rowspan="2" scope="col">参与拍摄<small>实拍条数</small></th></tr><tr>${days.map(() => PERIODS.map(p => `<th scope="col">${p}</th>`).join('')).join('')}</tr></thead><tbody>${names.map(name => {
    const photo = data.photographers.find(p => p.name === name);
    const rest = monday === mondayOf() && photo && !photo.onDuty;
    return `<tr><th scope="row">${esc(name)}<small>${rest ? '本周轮休' : `已约${halfDayCount(data.shoots, name)}个半天`}</small></th>${days.map(date => PERIODS.map(period => {
      const shoots = occupied(data.shoots, name, date, period);
      const leave = data.leaves.has(leaveKey(name, date, period));
      const clash = shoots.length > 1 || (shoots.length && (leave || rest));
      const content = shoots.length ? shoots.map(s => `<button class="cell-button" data-shoot="${esc(s.id)}" aria-label="${esc(name)} ${esc(date)}${period} ${esc(s.host)}拍摄">${esc(s.host)}${clash ? ' · 冲突' : ''}</button>`).join('') : `<button class="cell-button ${leave || rest ? '' : 'matrix-empty'}" data-slot-name="${esc(name)}" data-slot-date="${date}" data-slot-period="${period}" ${!data.canEdit && !data.canAdd ? 'disabled' : ''} aria-label="${esc(name)} ${date}${period} ${leave ? '请假' : rest ? '轮休' : '安排拍摄'}">${leave ? '请假' : rest ? '轮休' : '＋'}</button>`;
      return `<td class="${clash ? 'conflict' : shoots.length ? 'booked' : leave || rest ? 'leave' : ''}">${content}</td>`;
    }).join('')).join('')}<td>${participantsTotal(data.shoots, name)}条</td></tr>`;
  }).join('')}</tbody></table></div><p class="matrix-note">协作拍摄会出现在每位参与摄影师的格子里，编辑的是同一条记录；团队合计按拍摄去重。</p>`;
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
      $('new-shoot').hidden = true; $('settings').hidden = true; $('export').disabled = true;
      $('shoot-list').className = 'empty'; $('shoot-list').textContent = '排期暂不可用'; $('matrix').replaceChildren();
      $('total').textContent = '—'; $('total-meta').textContent = '条';
    }
  } finally { if (version === loading) $('refresh').disabled = false; }
}
async function changeWeek(date) { if (!date || saving) return; monday = mondayOf(date); await refresh(); }
function switchView(matrix) {
  $('shoot-panel').hidden = matrix; $('matrix-panel').hidden = !matrix;
  for (const [id, selected] of [['shoot-tab', !matrix], ['matrix-tab', matrix]]) {
    $(id).classList.toggle('selected', selected); $(id).setAttribute('aria-selected', selected); $(id).tabIndex = selected ? 0 : -1;
  }
}
function openEditor(shoot, preset = {}) {
  if (!data) return;
  baseline = shoot ? copy(shoot) : undefined; uncertain = false;
  const draft = shoot || { id: '', date: preset.date || monday, periods: [preset.period || '下午'], photographers: preset.photographer ? [preset.photographer] : [], host: '', script: '', count: null };
  const editable = shoot ? data.canEdit : data.canAdd;
  $('editor-title').textContent = shoot ? `${draft.host} · 拍摄记录` : '新增拍摄';
  $('shoot-date').value = draft.date;
  const hosts = [...new Set([...data.hosts.map(h => h.name), draft.host].filter(Boolean))];
  $('shoot-host').innerHTML = '<option value="">请选择主播</option>' + hosts.map(h => `<option>${esc(h)}</option>`).join(''); $('shoot-host').value = draft.host;
  $('period-choices').innerHTML = PERIODS.map(p => `<label><input type="checkbox" name="period" value="${p}" ${draft.periods.includes(p) ? 'checked' : ''}>${p}</label>`).join('');
  const names = [...new Set([...data.photographers.map(p => p.name), ...draft.photographers])];
  $('photo-choices').innerHTML = names.map(name => `<label><input type="checkbox" name="photographer" value="${esc(name)}" ${draft.photographers.includes(name) ? 'checked' : ''}>${esc(name)}</label>`).join('');
  $('shoot-script').value = draft.script; $('shoot-count').value = draft.count ?? '';
  for (const input of $('shoot-form').querySelectorAll('input,select,textarea')) input.disabled = !editable;
  $('save-shoot').hidden = !editable; $('save-shoot').disabled = false;
  $('cancel-shoot').hidden = !shoot || !editable || shoot.count != null;
  $('open-base').hidden = !shoot || preview;
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
  slot = { name, date, period }; $('slot-title').textContent = `${name} · ${date.slice(5)}${period}`;
  const candidates = data.shoots.filter(s => s.date === date && s.periods.includes(period));
  $('slot-existing').innerHTML = candidates.map(s => `<option value="${esc(s.id)}">${esc(s.host)} · ${esc(s.photographers.join('、') || '待安排')}</option>`).join('') || '<option>该时段暂无拍摄</option>';
  $('slot-new').disabled = !data.canAdd; $('slot-join').disabled = !data.canEdit || !candidates.length;
  $('slot-leave').checked = data.leaves.has(leaveKey(name, date, period)); $('slot-leave').disabled = !data.canEdit;
  showError('slot-error'); $('slot-dialog').showModal();
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
$('shoot-tab').onclick = () => switchView(false); $('matrix-tab').onclick = () => switchView(true);
for (const id of ['shoot-tab','matrix-tab']) $(id).onkeydown = e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); const matrix = e.key === 'End' || (e.key !== 'Home' && id === 'shoot-tab'); switchView(matrix); $(matrix ? 'matrix-tab' : 'shoot-tab').focus(); } };
$('new-shoot').onclick = () => openEditor(); $('shoot-form').onsubmit = save; $('export').onclick = exportWeek;
document.addEventListener('click', e => {
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
$('slot-new').onclick = () => { $('slot-dialog').close(); openEditor(undefined, { date: slot.date, period: slot.period, photographer: slot.name }); };
$('slot-join').onclick = async () => {
  const shoot = data.shoots.find(s => s.id === $('slot-existing').value); if (!shoot || saving) return;
  saving = true; $('slot-join').disabled = true;
  try { await store.saveShoot({ ...shoot, photographers: [...new Set([...shoot.photographers, slot.name])] }, shoot); $('slot-dialog').close(); await refresh(); notice('已加入同一场拍摄，脚本与条数保持共用'); }
  catch (e) { showError('slot-error', e.message); }
  finally { saving = false; $('slot-join').disabled = !data?.canEdit; }
};
$('slot-leave').onchange = async e => {
  const checked = e.target.checked; e.target.disabled = true;
  try { await store.setLeave(slot.name, slot.date, slot.period, checked); await refresh(); showError('slot-error'); }
  catch (error) { e.target.checked = !checked; showError('slot-error', error.message); }
  finally { e.target.disabled = !data?.canEdit; }
};
$('settings').onclick = () => {
  if (!data) return;
  $('roster').innerHTML = data.photographers.map(p => `<label><input type="checkbox" data-duty="${esc(p.id)}" ${p.onDuty ? 'checked' : ''}>${esc(p.name)}</label>`).join('');
  $('settings-dialog').showModal();
};
$('roster').onchange = async e => {
  if (!e.target.dataset.duty) return; const checked = e.target.checked; e.target.disabled = true;
  try { await store.setDuty(e.target.dataset.duty, checked); await refresh(); notice('本周上岗名单已更新'); }
  catch (error) { e.target.checked = !checked; showError('error', error.message); }
  finally { e.target.disabled = false; }
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
