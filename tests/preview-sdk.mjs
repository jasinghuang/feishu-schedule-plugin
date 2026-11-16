import { TARGET, PERIODS, mondayOf, addDays, timestamp, dateKey } from '../schedule-core.mjs';

// Synthetic fixtures only: the public preview never contains Base records or credentials.
export function previewSdk({ writable = true, baseId = TARGET.base, now = mondayOf() } = {}) {
  const writes = [], calls = [], listeners = new Set();
  const wk = TARGET.fields.week, ph = TARGET.fields.photo, sl = TARGET.fields.slots;
  const select = names => names.map((name, i) => ({ name, id: `opt${i}` }));
  const meta = {
    week: Object.entries(wk).map(([key,id]) => ({ id, name:key, type: {date:5,periods:4,photographers:4,host:3,script:1,count:2}[key], property:{options:select(key === 'periods' ? PERIODS : key === 'host' ? ['主播A','主播B'] : ['摄影师甲','摄影师乙','摄影师丙','摄影师丁'])} })),
    photo: [{id:ph.name,type:1},{id:ph.onDuty,type:7}],
    slots: [{id:sl.date,type:5},{id:sl.period,type:3,property:{options:select(PERIODS)}},{id:sl.photographer,type:3,property:{options:select(['摄影师甲','摄影师乙','摄影师丙','摄影师丁'])}},{id:sl.leave,type:7}]
  };
  const option = name => ({ text:name, id:`fixture-${name}` });
  const makeShoot = (id, day, host, names, count) => ({ recordId:id, fields:{[wk.date]:timestamp(addDays(now,day)),[wk.periods]:[option('下午')],[wk.photographers]:names.map(option),[wk.host]:option(host),[wk.script]:[{type:'text',text:'https://example.com/script'}],[wk.count]:count} });
  const rows = {
    week:[makeShoot('shoot1',1,'主播A',['摄影师甲','摄影师乙'],16),makeShoot('shoot2',3,'主播A',['摄影师丁','摄影师乙'],17),makeShoot('shoot3',3,'主播B',['摄影师甲','摄影师丙'],10),makeShoot('shoot4',4,'主播B',['摄影师丙'],16)],
    photo:['摄影师甲','摄影师乙','摄影师丙','摄影师丁'].map((name,i)=>({recordId:`photo${i}`,fields:{[ph.name]:[{type:'text',text:name}],[ph.onDuty]:true}})), slots:[]
  };
  let serial = 0;
  const emit = () => listeners.forEach(fn => fn());
  const tables = Object.fromEntries(Object.keys(rows).map(key => [TARGET[key], {
    async getFieldMetaList() { return structuredClone(meta[key]); },
    async getRecordsByPage(params = {}) {
      calls.push({key,params:structuredClone(params)});
      let result = rows[key];
      if (params.filter) result = result.filter(row => params.filter.conditions.every(c => {
        const day = dateKey(row.fields[c.fieldId]), boundary = dateKey(c.value);
        return day && (c.operator === 'isGreater' ? day > boundary : day < boundary);
      }));
      const start = params.pageToken ?? 0, end = start + (params.pageSize ?? 200);
      return { records:structuredClone(result.slice(start,end)), hasMore:end < result.length, pageToken:end, total:result.length };
    },
    async getRecordById(id) { const row = rows[key].find(r=>r.recordId===id); if (!row) throw new Error('记录已被删除'); return structuredClone({fields:row.fields}); },
    async setRecord(id, value) { if (!writable) throw new Error('permission denied'); writes.push({key,id,value:structuredClone(value)}); Object.assign(rows[key].find(r=>r.recordId===id).fields,structuredClone(value.fields)); emit(); return true; },
    async addRecord(value) { if (!writable) throw new Error('permission denied'); const id = `created${++serial}`; writes.push({key,id,value:structuredClone(value)}); rows[key].push({recordId:id,...structuredClone(value)}); emit(); return id; },
    async deleteRecord(id) { writes.push({key,id,deleted:true}); rows[key] = rows[key].filter(r=>r.recordId!==id); emit(); return true; },
    ...Object.fromEntries(['onRecordAdd','onRecordModify','onRecordDelete','onFieldModify'].map(name => [name, fn => { listeners.add(fn); return ()=>listeners.delete(fn); }]))
  }]));
  return { base:{ async getSelection(){return {baseId};}, async getTableById(id){return tables[id];}, async getPermission(){return writable;}, onPermissionChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);} }, ui:{ async showRecordDetailDialog(){return true;} }, fixture:{rows,meta,writes,calls,tables} };
}
