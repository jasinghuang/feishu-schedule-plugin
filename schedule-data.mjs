import { TARGET, addDays, mondayOf, dayName, timestamp, text, options, normalizeShoot, sortShoots, inWeek, leaveKey, validateShoot, assignmentProblems, changedKeys, sameValue, isBlankDateRow, shouldKeepDateRow } from './schedule-core.mjs?v=20261127-blank-empty';

export async function readPages(table, filter) {
  const rows = [];
  let pageToken;
  const seen = new Set();
  do {
    const page = await table.getRecordsByPage({ pageSize: 200, ...(filter ? { filter } : {}), ...(pageToken !== undefined ? { pageToken } : {}) });
    rows.push(...(page.records || []));
    if (!page.hasMore) return rows;
    if (page.pageToken == null || seen.has(page.pageToken)) throw new Error('分页未完整返回，请刷新后重试');
    pageToken = page.pageToken;
    seen.add(pageToken);
  } while (pageToken !== undefined);
  return rows;
}

export class ScheduleStore {
  constructor(sdk) { this.sdk = sdk; this.tables = {}; this.meta = {}; }
  async init() {
    const selection = await this.sdk.base.getSelection();
    if (selection.baseId !== TARGET.base) throw new Error('请从当前 v2 Base 的自定义插件中打开此版本');
    await Promise.all(['week', 'photo', 'slots'].map(async key => {
      const table = await this.sdk.base.getTableById(TARGET[key]);
      this.tables[key] = table;
      this.meta[key] = Object.fromEntries((await table.getFieldMetaList()).map(f => [f.id, f]));
      for (const fieldId of Object.values(TARGET.fields[key])) {
        if (!this.meta[key][fieldId]) throw new Error(`v2 字段发生变化，缺少 ${key}/${fieldId}，请重新核对字段映射`);
      }
    }));
    const types = { date: 5, periods: 4, photographers: 4, host: 3, script: 1, count: 2 };
    for (const [key, type] of Object.entries(types)) {
      if (this.meta.week[TARGET.fields.week[key]].type !== type) throw new Error(`字段「${this.meta.week[TARGET.fields.week[key]].name}」类型已变化，请检查插件适配`);
    }
    return this;
  }
  async allowed(table, operation, recordId, fieldId) {
    let entity = 'Table';
    const param = { tableId: TARGET[table] };
    if (recordId) { entity = 'Record'; param.recordId = recordId; }
    if (fieldId) { entity = recordId ? 'Cell' : 'Field'; param.fieldId = fieldId; }
    return this.sdk.base.getPermission({ entity, type: operation, param });
  }
  async requirePermission(table, operation, recordId, fieldId) {
    if (!await this.allowed(table, operation, recordId, fieldId)) throw new Error('当前飞书账号没有此项编辑权限');
  }
  filterWeek(fieldId, monday) {
    // Date filters compare calendar days; Sunday < date < next Monday includes all seven days.
    return { conjunction: 'and', conditions: [
      { fieldId, fieldType: 5, operator: 'isGreater', value: timestamp(addDays(monday, -1)) },
      { fieldId, fieldType: 5, operator: 'isLess', value: timestamp(addDays(monday, 7)) }
    ] };
  }
  async readShoots(monday) {
    const rows = await readPages(this.tables.week, this.filterWeek(TARGET.fields.week.date, monday));
    return sortShoots(rows.map(r => normalizeShoot(r)).filter(s => inWeek(s, monday)));
  }
  async loadWeekData(monday) {
    const [shoots, photographerRows, slotRows] = await Promise.all([
      this.readShoots(monday),
      readPages(this.tables.photo),
      readPages(this.tables.slots, this.filterWeek(TARGET.fields.slots.date, monday))
    ]);
    const photographers = photographerRows.map(r => ({ id: r.recordId, name: text(r.fields[TARGET.fields.photo.name]).trim(), onDuty: r.fields[TARGET.fields.photo.onDuty] === true })).filter(p => p.name);
    if (new Set(photographers.map(p => p.name)).size !== photographers.length) throw new Error('摄影师表存在重名，请先为摄影师设置唯一姓名');
    const leaves = new Set();
    const slotRecords = new Map();
    slotRows.forEach(r => {
      const f = r.fields, s = TARGET.fields.slots;
      const names = options(f[s.photographer]), periods = options(f[s.period]);
      const date = normalizeShoot({ recordId: r.recordId, fields: { [TARGET.fields.week.date]: f[s.date] } }).date;
      names.forEach(name => periods.forEach(period => {
        const key = leaveKey(name, date, period);
        const list = slotRecords.get(key) || [];
        list.push(r.recordId); slotRecords.set(key, list);
        if (f[s.leave] === true) leaves.add(key);
      }));
    });
    return { monday, shoots, photographers, leaves, slotRecords };
  }
  async loadWeek(monday) {
    const [data, canEdit, canAdd, canDelete, canEditRoster, canEditLeave, canAddLeave] = await Promise.all([
      this.loadWeekData(monday),
      this.allowed('week', 'editable'), this.allowed('week', 'addable'), this.allowed('week', 'deletable'),
      this.allowed('photo', 'editable'), this.allowed('slots', 'editable'), this.allowed('slots', 'addable')
    ]);
    return { ...data, canEdit, canAdd, canDelete, canEditRoster, canEditLeave, canAddLeave, hosts: this.selectOptions('host') };
  }
  selectOptions(key) { return (this.meta.week[TARGET.fields.week[key]].property?.options || []).map(o => ({ id: o.id, name: o.name })).filter(o => o.name); }
  encode(key, value) {
    if (key === 'date') return timestamp(value);
    if (key === 'count') return value;
    if (key === 'script') {
      if (!value) return null;
      const link = value.match(/^\[([\s\S]*)\]\((https?:\/\/\S+)\)$/);
      return link ? [{ type:'url', text:link[1], link:link[2] }] : [{ type:'text', text:value }];
    }
    const encodeOption = name => {
      const found = this.selectOptions(key).find(o => o.name === name);
      if (!found) throw new Error(`字段「${this.meta.week[TARGET.fields.week[key]].name}」中没有选项「${name}」，请在飞书表中添加后刷新`);
      return { id: found.id, text: name };
    };
    return Array.isArray(value) ? (value.length ? value.map(encodeOption) : null) : encodeOption(value);
  }
  async getShoot(id) { return normalizeShoot({ ...(await this.tables.week.getRecordById(id)), recordId: id }); }
  async saveShoot(draft, baseline, expectedSlot) {
    validateShoot(draft);
    if (!draft.id) {
      const shoots = await this.readShoots(mondayOf(draft.date));
      const blank = shoots.find(s => s.date === draft.date && isBlankDateRow(s));
      // Consume an untouched date template before adding another row for that day.
      if (blank && await this.allowed('week', 'editable', blank.id)) return this.saveShoot({ ...draft, id: blank.id }, blank);
    }
    const keys = changedKeys(draft, baseline);
    if (!keys.length) return draft.id;
    if (draft.id) {
      await this.requirePermission('week', 'editable', draft.id);
      const latest = await this.getShoot(draft.id);
      if (expectedSlot && (!latest.host || latest.date !== expectedSlot.date || !latest.periods.includes(expectedSlot.period))) throw new Error('该拍摄场次已调整时段，请刷新后重新选择');
      if (keys.some(key => !sameValue(latest[key], baseline[key]))) throw new Error('这条记录刚被其他摄影师修改，请重新打开后编辑');
      // Validate against concurrent edits to fields this save does not replace.
      draft = { ...latest, ...Object.fromEntries(keys.map(key => [key, draft[key]])) };
    } else await this.requirePermission('week', 'addable');
    for (const key of keys) await this.requirePermission('week', 'editable', draft.id || undefined, TARGET.fields.week[key]);
    if (keys.some(key => ['date', 'periods', 'photographers', 'host'].includes(key))) {
      const current = await this.loadWeekData(mondayOf(draft.date));
      const addedNames = draft.photographers.filter(name => !baseline?.photographers.includes(name));
      if (addedNames.some(name => !current.photographers.some(p => p.name === name))) throw new Error('参与摄影师须来自摄影师表，请刷新名单后重试');
      const problems = assignmentProblems(draft, current.shoots, current.photographers, current.leaves);
      if (problems.length) throw new Error(problems.join('；'));
      this.meta.week = Object.fromEntries((await this.tables.week.getFieldMetaList()).map(f => [f.id, f]));
    }
    const fields = Object.fromEntries(keys.map(key => [TARGET.fields.week[key], this.encode(key, draft[key])]));
    const result = draft.id ? await this.tables.week.setRecord(draft.id, { fields }) : await this.tables.week.addRecord({ fields });
    const id = draft.id || result;
    if (!id) throw new Error('未取得保存记录的编号，请刷新核对，避免重复提交');
    try {
      const saved = await this.getShoot(id);
      if (keys.some(key => !sameValue(saved[key], draft[key]))) throw new Error('readback mismatch');
    } catch {
      const error = new Error('保存结果尚未确认，请刷新核对该记录');
      error.recordId = id; throw error;
    }
    return id;
  }
  async removeShoot(shoot) {
    if (!shoot?.host) throw new Error('该记录尚未安排拍摄场次');
    if (shoot.count != null) throw new Error('已有实拍条数的记录请保留，不能取消或删除该场拍摄');
    const current = await this.getShoot(shoot.id);
    if (!current.host) throw new Error('该拍摄场次已被清空，请刷新查看');
    if (current.count != null) throw new Error('这场拍摄已有人填报条数，不能取消或删除');
    if (changedKeys(current, shoot).length) throw new Error('记录已更新，请重新打开后操作');
    const weekShoots = await this.readShoots(mondayOf(current.date));
    if (shouldKeepDateRow(current, weekShoots)) {
      const clearKeys = ['host', 'periods', 'photographers', 'script'].filter(key =>
        Array.isArray(current[key]) ? current[key].length : Boolean(current[key])
      );
      await this.requirePermission('week', 'editable', current.id);
      for (const key of clearKeys) await this.requirePermission('week', 'editable', current.id, TARGET.fields.week[key]);
      const fields = Object.fromEntries(clearKeys.map(key => [TARGET.fields.week[key], null]));
      await this.tables.week.setRecord(current.id, { fields });
      try {
        const cleared = await this.getShoot(current.id);
        if (cleared.date !== current.date || cleared.host || cleared.periods.length || cleared.photographers.length || cleared.script || cleared.count != null) {
          throw new Error('readback mismatch');
        }
      } catch {
        const error = new Error('删除结果尚未确认，请刷新核对该记录');
        error.recordId = current.id;
        throw error;
      }
      return { mode: 'cleared', id: current.id };
    }
    await this.requirePermission('week', 'deletable', current.id);
    await this.tables.week.deleteRecord(current.id);
    return { mode: 'deleted', id: current.id };
  }
  async setDuty(id, checked) {
    const fieldId = TARGET.fields.photo.onDuty;
    await this.requirePermission('photo', 'editable', id, fieldId);
    await this.tables.photo.setRecord(id, { fields: { [fieldId]: checked } });
  }
  async joinShoot(id, name, date, period) {
    const shoot = await this.getShoot(id);
    if (!shoot.host || shoot.date !== date || !shoot.periods.includes(period)) throw new Error('该拍摄场次已调整时段，请刷新后重新选择');
    if (shoot.photographers.includes(name)) return id;
    return this.saveShoot({ ...shoot, photographers: [...shoot.photographers, name] }, shoot, { date, period });
  }
  async setLeave(name, date, period, checked) {
    const current = await this.loadWeekData(mondayOf(date));
    const photographer = current.photographers.find(p => p.name === name);
    if (!photographer) throw new Error('摄影师已不在摄影师表中，请刷新后重试');
    const conflicts = current.shoots.filter(s => s.date === date && s.periods.includes(period) && s.photographers.includes(name));
    if (checked && conflicts.length) throw new Error('该时段已有拍摄，请先调整参与摄影师，再标记请假');
    const ids = current.slotRecords.get(leaveKey(name, date, period)) || [];
    const fields = TARGET.fields.slots;
    if (ids.length) {
      for (const id of ids) {
        await this.requirePermission('slots', 'editable', id, fields.leave);
        await this.tables.slots.setRecord(id, { fields: { [fields.leave]: checked } });
      }
    } else if (checked) {
      await this.requirePermission('slots', 'addable');
      this.meta.slots = Object.fromEntries((await this.tables.slots.getFieldMetaList()).map(f => [f.id, f]));
      const field = this.meta.slots[fields.photographer];
      const option = field.property.options.find(o => o.name === name);
      const periodOption = this.meta.slots[fields.period].property.options.find(o => o.name === period);
      const weekdayOption = this.meta.slots[fields.weekday].property.options.find(o => o.name === dayName(date));
      if (!option || !periodOption || !weekdayOption) throw new Error('摄影师、时段或星期选项未找到，请刷新后重试');
      // Native roster formulas follow the linked photographer row and weekday.
      const values = {
        [fields.date]: timestamp(date), [fields.photographer]: { id: option.id, text: name },
        [fields.period]: { id: periodOption.id, text: period }, [fields.leave]: true,
        [fields.weekday]: { id: weekdayOption.id, text: weekdayOption.name },
        [fields.photographerRow]: { recordIds: [photographer.id], tableId: TARGET.photo, text: name, type: 'text' }
      };
      for (const fieldId of Object.keys(values)) await this.requirePermission('slots', 'editable', undefined, fieldId);
      await this.tables.slots.addRecord({ fields: values });
    }
  }
  subscribe(callback) {
    const off = [];
    for (const table of Object.values(this.tables)) {
      for (const method of ['onRecordAdd', 'onRecordModify', 'onRecordDelete']) off.push(table[method](() => callback(false)));
      off.push(table.onFieldModify(() => callback(true)));
    }
    off.push(this.sdk.base.onPermissionChange(() => callback(true)));
    return () => off.forEach(stop => stop());
  }
}
