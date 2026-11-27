import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGET, summarize, participantsTotal, occupied, mondayOf, addDays, dateKey, timestamp, assignmentProblems, validateShoot, scriptUrl, normalizeShoot, isWorkday, isBlankDateRow, shouldKeepDateRow } from '../schedule-core.mjs';
import { ScheduleStore, readPages } from '../schedule-data.mjs';
import { previewSdk } from './preview-sdk.mjs';

const monday = mondayOf();
async function setup(opts) { const sdk = previewSdk(opts); const store = await new ScheduleStore(sdk).init(); return { sdk, store, data:await store.loadWeek(monday) }; }
test('dated blank rows stay editable without counting or occupying a shoot; filling updates the same row', async () => {
  const { sdk, store } = await setup();
  const fields = TARGET.fields.week;
  sdk.fixture.rows.week.push({ recordId:'blank-monday', fields:{ [fields.date]:timestamp(monday) } });
  sdk.fixture.rows.week.push({ recordId:'undated', fields:{} });
  let data = await store.loadWeek(monday);
  const blank = data.shoots.find(s => s.id === 'blank-monday');
  assert.ok(blank);
  assert.equal(blank.host, '');
  assert.equal(data.shoots.length, 5);
  assert.ok(!data.shoots.some(s => s.id === 'undated'));
  assert.deepEqual(summarize(data.shoots), { sessions:4, count:59, unreported:0 });
  assert.deepEqual(occupied(data.shoots, '摄影师甲', monday, '上午'), []);
  assert.equal(sdk.fixture.writes.length, 0);
  await assert.rejects(store.saveShoot({...blank, periods:['上午']}, blank), /请选择主播/);
  await assert.rejects(store.saveShoot({...blank, host:'主播A'}, blank), /请选择上午或下午/);
  const id = await store.saveShoot({...blank, host:'主播A', periods:['上午'], script:'待审核脚本'}, blank);
  assert.equal(id, 'blank-monday');
  assert.equal(sdk.fixture.rows.week.length, 6);
  assert.equal(sdk.fixture.writes.length, 1);
  assert.equal(sdk.fixture.writes[0].id, 'blank-monday');
  assert.ok(!Object.hasOwn(sdk.fixture.writes[0].value.fields, fields.count));
  data = await store.loadWeek(monday);
  assert.deepEqual(summarize(data.shoots), { sessions:5, count:59, unreported:1 });
  assert.equal(data.shoots.find(s => s.id === id).script, '待审核脚本');
});
test('new shoots reuse untouched date templates and allow different photographers in the same half-day', async () => {
  const { sdk, store } = await setup();
  const fields = TARGET.fields.week;
  sdk.fixture.rows.week.length = 0;
  sdk.fixture.rows.week.push({ recordId:'template', fields:{ [fields.date]:timestamp(monday) } });
  const draft = { id:'', date:monday, host:'主播A', periods:['上午'], photographers:['摄影师丁'], script:'第一场脚本', count:null };
  assert.equal(await store.saveShoot(draft), 'template');
  assert.equal(sdk.fixture.rows.week.length, 1);
  const second = { ...draft, host:'主播B', photographers:['摄影师丙'], script:'第二场脚本' };
  const secondId = await store.saveShoot(second);
  assert.notEqual(secondId, 'template');
  assert.equal(sdk.fixture.rows.week.length, 2);
  const data = await store.loadWeek(monday);
  assert.equal(data.shoots.filter(s => s.date === monday && s.periods.includes('上午')).length, 2);
  assert.equal(data.shoots.find(s => s.id === 'template').script, '第一场脚本');
  assert.equal(data.shoots.find(s => s.id === secondId).script, '第二场脚本');
  await assert.rejects(store.saveShoot({...draft, host:'主播B'}), /已安排/);
  assert.equal(sdk.fixture.writes.length, 2);
});
test('creating never consumes partial drafts or records the user cannot edit', async () => {
  const { sdk, store } = await setup();
  const fields = TARGET.fields.week;
  const noted = { recordId:'noted', fields:{ [fields.date]:timestamp(monday), [fields.script]:[{ type:'text', text:'保留的准备资料' }] } };
  sdk.fixture.rows.week.push(noted, { recordId:'protected-template', fields:{ [fields.date]:timestamp(monday) } });
  sdk.base.getPermission = async ({param}) => param.recordId !== 'protected-template';
  const id = await store.saveShoot({ id:'', date:monday, host:'主播A', periods:['上午'], photographers:[], script:'新场次', count:null });
  assert.ok(!['noted','protected-template'].includes(id));
  assert.equal(sdk.fixture.rows.week.length, 7);
  assert.equal(sdk.fixture.writes.length, 1);
  assert.equal(sdk.fixture.writes[0].id, id);
  assert.equal(noted.fields[fields.script][0].text, '保留的准备资料');
});
test('opening and refreshing only read; weekly count deduplicates shared photographers', async () => {
  const {sdk,store,data} = await setup();
  assert.deepEqual(summarize([...data.shoots, data.shoots[0]]),{sessions:4,count:59,unreported:0});
  assert.equal(participantsTotal(data.shoots,'摄影师乙'),33);
  assert.equal(occupied(data.shoots,'摄影师甲',addDays(monday,3),'下午')[0].host,'主播B');
  await store.loadWeek(monday); assert.equal(sdk.fixture.writes.length,0);
  assert.ok(sdk.fixture.calls.filter(c=>c.key!=='photo').every(c=>c.params.filter));
});
test('one count edit changes only master count; concurrent untouched script survives', async () => {
  const {sdk,store,data} = await setup(); const original = data.shoots[0];
  sdk.fixture.rows.week[0].fields[TARGET.fields.week.script] = [{type:'text',text:'另一位摄影师已更新'}];
  await store.saveShoot({...original,count:20},original);
  assert.equal(sdk.fixture.writes.length,1); assert.equal(sdk.fixture.writes[0].key,'week');
  assert.deepEqual(Object.keys(sdk.fixture.writes[0].value.fields),[TARGET.fields.week.count]);
  const next = await store.loadWeek(monday); assert.equal(summarize(next.shoots).count,63);
  assert.equal(next.shoots.find(s=>s.id===original.id).script,'另一位摄影师已更新');
});
test('same half-day permits different photographers; collaboration creates one shared record', async () => {
  const {sdk,store,data} = await setup();
  const draft = {id:'',date:monday,periods:['上午'],host:'主播A',photographers:['摄影师丁'],script:'专属脚本',count:null};
  const id = await store.saveShoot(draft); assert.equal(typeof id,'string');
  assert.equal(sdk.fixture.writes.filter(w=>w.key==='slots').length,0);
  const saved = await store.getShoot(id); assert.equal(saved.script,'专属脚本');
  const other = {...draft,id:'',host:'主播B',photographers:[]}; await store.saveShoot(other);
  const conflict = assignmentProblems({...draft,id:'new'},(await store.loadWeek(monday)).shoots,data.photographers,new Set());
  assert.ok(conflict.some(e=>e.includes('已安排')));
});
test('editing same field concurrently is rejected before writing', async () => {
  const {sdk,store,data} = await setup(); sdk.fixture.rows.week[0].fields[TARGET.fields.week.count]=99;
  await assert.rejects(store.saveShoot({...data.shoots[0],count:20},data.shoots[0]),/其他摄影师修改/);
  assert.equal(sdk.fixture.writes.length,0);
});
test('permissions and exact Base identity fail closed', async () => {
  await assert.rejects(new ScheduleStore(previewSdk({baseId:'old-base'})).init(),/v2 Base/);
  const {sdk,store,data} = await setup({writable:false});
  assert.equal(data.canEdit,false); assert.equal(data.canAdd,false);
  await assert.rejects(store.saveShoot({...data.shoots[0],count:20},data.shoots[0]),/权限/);
  assert.equal(sdk.fixture.writes.length,0);
});
test('full pagination and malformed repeated cursor', async () => {
  const records = Array.from({length:415},(_,recordId)=>({recordId}));
  const rows = await readPages({async getRecordsByPage({pageToken=0,pageSize}) { const end = pageToken+pageSize; return {records:records.slice(pageToken,end),hasMore:end<records.length,pageToken:end}; }});
  assert.equal(rows.length,415);
  await assert.rejects(readPages({async getRecordsByPage(){return {records:[],hasMore:true,pageToken:0};}}),/分页/);
});
test('empty and zero counts differ; multi-period records counted once', () => {
  assert.deepEqual(summarize([{id:'a',host:'A',date:monday,count:0},{id:'b',host:'B',date:monday,count:null}]),{sessions:2,count:0,unreported:1});
  const d={date:monday,host:'A',periods:['上午','下午'],photographers:[],count:1}; validateShoot(d);
  for (const count of [-1,1.5,NaN]) assert.throws(()=>validateShoot({...d,count}));
  assert.throws(()=>validateShoot({...d,date:'2026-02-31'}));
  assert.equal(dateKey(timestamp('2026-11-16')),'2026-11-16');
  assert.equal(scriptUrl('javascript:alert(1)'),'');
});
test('uncertain readback retains created ID; no accidental duplicate retry', async () => {
  const {sdk,store} = await setup(); const table=sdk.fixture.tables[TARGET.week]; const add=table.addRecord;
  table.addRecord=async value=>{const id=await add(value); table.getRecordById=async()=>{throw new Error('network');};return id;};
  await assert.rejects(store.saveShoot({id:'',date:monday,periods:['上午'],host:'主播A',photographers:[],script:'',count:null}),e=>e.recordId==='created1');
  assert.equal(sdk.fixture.writes.length,1);
});
test('reported shoots cannot be deleted and leave cannot erase reservations', async () => {
  const {sdk,store,data} = await setup();
  await assert.rejects(store.removeShoot(data.shoots[0]),/不能取消/);
  await assert.rejects(store.setLeave('摄影师甲',addDays(monday,1),'下午',true),/已有拍摄/);
  assert.equal(sdk.fixture.writes.length,0);
});
test('creating two-photographer shoot writes one master row and one count', async () => {
  const {sdk,store} = await setup(); const past=addDays(monday,-7);
  const draft={id:'',date:past,periods:['下午'],host:'主播A',photographers:['摄影师甲','摄影师乙'],script:'该场唯一脚本',count:12};
  await store.saveShoot(draft);
  const result=await store.loadWeek(past);
  assert.equal(result.shoots.length,1);assert.equal(summarize(result.shoots).count,12);
  assert.equal(participantsTotal(result.shoots,'摄影师甲'),12);assert.equal(participantsTotal(result.shoots,'摄影师乙'),12);
  assert.equal(sdk.fixture.writes.length,1);assert.equal(sdk.fixture.writes[0].key,'week');
});
test('assignment validation uses concurrent date changes instead of stale form date', async () => {
  const {sdk,store,data} = await setup(); const original=data.shoots.find(s=>s.id==='shoot1');
  sdk.fixture.rows.week[0].fields[TARGET.fields.week.date]=timestamp(addDays(monday,3));
  await assert.rejects(store.saveShoot({...original,photographers:['摄影师甲']},original),/已安排/);
  assert.equal(sdk.fixture.writes.length,0);
});
test('leave writes only availability fields and never copies host or scripts', async () => {
  const {sdk,store} = await setup();await store.setLeave('摄影师甲',monday,'上午',true);
  assert.equal(sdk.fixture.writes.length,1);const write=sdk.fixture.writes[0];assert.equal(write.key,'slots');
  assert.deepEqual(Object.keys(write.value.fields).sort(),Object.values(TARGET.fields.slots).sort());
});
test('new leave links the roster row and all seven weekdays; cancel and repeat preserve the same slot', async () => {
  const {sdk,store} = await setup();
  const fields = TARGET.fields.slots, future = addDays(monday,7);
  const shootsBefore = structuredClone(sdk.fixture.rows.week);
  const days = ['周一','周二','周三','周四','周五','周六','周日'];
  for (const [i,weekday] of days.entries()) {
    const date = addDays(future,i);
    await store.setLeave('摄影师丁',date,'上午',true);
    const row = sdk.fixture.rows.slots.at(-1);
    assert.deepEqual(row.fields[fields.photographerRow],{recordIds:['photo3'],tableId:TARGET.photo,text:'摄影师丁',type:'text'});
    assert.equal(row.fields[fields.weekday].text,weekday);
    assert.equal(dateKey(row.fields[fields.date]),date);
    assert.ok((await store.loadWeek(future)).leaves.has(`摄影师丁|${date}|上午`));
  }
  const sunday = addDays(future,6), before = structuredClone(sdk.fixture.rows.slots.at(-1));
  await store.setLeave('摄影师丁',sunday,'上午',false);
  assert.deepEqual(Object.keys(sdk.fixture.writes.at(-1).value.fields),[fields.leave]);
  assert.deepEqual(sdk.fixture.rows.slots.at(-1),{...before,fields:{...before.fields,[fields.leave]:false}});
  await store.setLeave('摄影师丁',sunday,'上午',true);
  assert.equal(sdk.fixture.rows.slots.length,7);
  assert.deepEqual(sdk.fixture.rows.week,shootsBefore);
  assert.equal(summarize((await store.loadWeek(monday)).shoots).count,59);
});
test('new leave fails before writing when its linked roster or weekday field is not editable', async () => {
  for (const field of [TARGET.fields.slots.photographerRow,TARGET.fields.slots.weekday]) {
    const {sdk,store} = await setup();
    sdk.base.getPermission = async ({param}) => param.fieldId !== field;
    await assert.rejects(store.setLeave('摄影师丁',addDays(monday,7),'上午',true),/权限/);
    assert.equal(sdk.fixture.writes.length,0);
  }
});
test('joining an existing shoot only changes participants and keeps one shared count', async () => {
  const {sdk,store} = await setup();
  await store.joinShoot('shoot1','摄影师丁',addDays(monday,1),'下午');
  const data=await store.loadWeek(monday), shoot=data.shoots.find(s=>s.id==='shoot1');
  assert.deepEqual(shoot.photographers,['摄影师甲','摄影师乙','摄影师丁']);
  assert.equal(shoot.count,16); assert.equal(summarize(data.shoots).count,59); assert.equal(data.shoots.length,4);
  assert.equal(sdk.fixture.writes.length,1);
  assert.deepEqual(Object.keys(sdk.fixture.writes[0].value.fields),[TARGET.fields.week.photographers]);
  await store.joinShoot('shoot1','摄影师丁',addDays(monday,1),'下午');
  assert.equal(sdk.fixture.writes.length,1);
});
test('joining rejects a different date or half-day, including a move during saving', async () => {
  const {sdk,store}=await setup();
  await assert.rejects(store.joinShoot('shoot1','摄影师丁',monday,'下午'),/已调整时段/);
  await assert.rejects(store.joinShoot('shoot1','摄影师丁',addDays(monday,1),'上午'),/已调整时段/);
  const table=sdk.fixture.tables[TARGET.week],get=table.getRecordById;let reads=0;
  table.getRecordById=async id=>{ if(++reads===2) sdk.fixture.rows.week[0].fields[TARGET.fields.week.date]=timestamp(addDays(monday,2));return get(id); };
  await assert.rejects(store.joinShoot('shoot1','摄影师丁',addDays(monday,1),'下午'),/已调整时段/);
  assert.equal(sdk.fixture.writes.length,0);
});
test('roster choices come from photographer records, never legacy select options', async () => {
  const {sdk,store}=await setup();
  sdk.fixture.meta.week.find(f=>f.id===TARGET.fields.week.photographers).property.options.push({id:'orphan',name:'旧名单孤立姓名'});
  sdk.fixture.rows.photo.push({recordId:'newphoto',fields:{[TARGET.fields.photo.name]:[{type:'text',text:'新增摄影师'}],[TARGET.fields.photo.onDuty]:true}});
  const data=await store.loadWeek(monday);
  assert.ok(data.photographers.some(p=>p.name==='新增摄影师'));
  assert.ok(!data.photographers.some(p=>p.name==='旧名单孤立姓名'));
  await assert.rejects(store.joinShoot('shoot1','旧名单孤立姓名',addDays(monday,1),'下午'),/须来自摄影师表/);
  sdk.fixture.meta.week.find(f=>f.id===TARGET.fields.week.photographers).property.options.push({id:'newopt',name:'新增摄影师'});
  await store.joinShoot('shoot1','新增摄影师',addDays(monday,1),'下午');
  assert.ok((await store.getShoot('shoot1')).photographers.includes('新增摄影师'));
});
test('join respects per-cell permission and independent roster/leave permissions', async () => {
  const {sdk,store}=await setup();
  sdk.base.getPermission=async p=>p.param.tableId!==TARGET.week;
  const data=await store.loadWeek(monday);assert.equal(data.canEdit,false);assert.equal(data.canEditRoster,true);assert.equal(data.canEditLeave,true);
  sdk.base.getPermission=async p=>p.param.fieldId!==TARGET.fields.week.photographers;
  await assert.rejects(store.joinShoot('shoot1','摄影师丁',addDays(monday,1),'下午'),/权限/);
  assert.equal(sdk.fixture.writes.length,0);
});
test('leave can be canceled without changing shoots; missing or ambiguous roster is rejected', async () => {
  const {sdk,store}=await setup();
  await store.setLeave('摄影师丁',monday,'上午',true);
  assert.ok((await store.loadWeek(monday)).leaves.has(`摄影师丁|${monday}|上午`));
  await store.setLeave('摄影师丁',monday,'上午',false);
  assert.equal((await store.loadWeek(monday)).leaves.size,0);
  assert.equal(summarize((await store.loadWeek(monday)).shoots).count,59);
  assert.ok(sdk.fixture.writes.every(w=>w.key==='slots'));
  await assert.rejects(store.setLeave('不存在',monday,'上午',true),/不在摄影师表/);
  sdk.fixture.rows.photo.push(structuredClone(sdk.fixture.rows.photo[0]));
  await assert.rejects(store.loadWeek(monday),/重名/);
});

test('Feishu document mentions retain their link when viewing and editing another field', async () => {
  const {sdk,store}=await setup(), field=TARGET.fields.week.script;
  const segments=[{type:'mention',mentionType:'Docx',text:'本场脚本',token:'synthetic',link:'https://example.com/script'}];
  sdk.fixture.rows.week[0].fields[field]=segments;
  const shoot=await store.getShoot('shoot1');
  assert.equal(shoot.script,'[本场脚本](https://example.com/script)');
  assert.equal(scriptUrl(shoot.script),'https://example.com/script');
  await store.saveShoot({...shoot,count:20},shoot);
  assert.deepEqual(sdk.fixture.rows.week[0].fields[field],segments);
  assert.deepEqual(Object.keys(sdk.fixture.writes[0].value.fields),[TARGET.fields.week.count]);
  const updated=await store.getShoot('shoot1');
  await store.saveShoot({...updated,script:'[新版脚本](https://example.com/new)'},updated);
  assert.deepEqual(sdk.fixture.rows.week[0].fields[field],[{type:'url',text:'新版脚本',link:'https://example.com/new'}]);
  assert.equal(scriptUrl((await store.getShoot('shoot1')).script),'https://example.com/new');
  assert.equal(scriptUrl('[脚本](javascript:alert(1))'),'');
  assert.equal(scriptUrl('[脚本](data:text/html,bad)'),'');
  assert.equal(normalizeShoot({recordId:'url',fields:{[field]:[{type:'url',text:'脚本文档',link:'https://example.com/doc'}]}}).script,'[脚本文档](https://example.com/doc)');
});

test('new shoots query only the master for templates and preserve each write permission check', async () => {
  for (const reuse of [true,false]) {
    const {sdk,store} = await setup(), fields = TARGET.fields.week, permissions = [];
    sdk.fixture.rows.week.length = 0;
    if (reuse) sdk.fixture.rows.week.push({recordId:'template',fields:{[fields.date]:timestamp(monday)}});
    sdk.base.getPermission = async value => {permissions.push(value);return true;};
    sdk.fixture.calls.length = 0;
    await store.saveShoot({id:'',date:monday,host:'主播A',periods:['上午'],photographers:['摄影师丁'],script:'synthetic',count:null});
    assert.deepEqual(sdk.fixture.calls.map(c=>c.key).sort(),['photo','slots','week','week']);
    assert.equal(permissions.length,reuse ? 6 : 7);
    const editableFields = permissions.filter(p=>p.param.fieldId).map(p=>p.param.fieldId).sort();
    assert.deepEqual(editableFields,(reuse ? [fields.host,fields.periods,fields.photographers,fields.script] : Object.values(fields)).sort());
    assert.equal(sdk.fixture.writes.length,1);
  }
});

test('template lookup never replaces the fresh conflict check before writing', async () => {
  const {sdk,store} = await setup(), fields = TARGET.fields.week;
  sdk.fixture.rows.week.length = 0;
  sdk.fixture.rows.week.push({recordId:'template',fields:{[fields.date]:timestamp(monday)}});
  const table = sdk.fixture.tables[TARGET.week], read = table.getRecordById;
  table.getRecordById = async id => {
    const result = await read(id);
    sdk.fixture.rows.week.push({recordId:'concurrent',fields:{[fields.date]:timestamp(monday),[fields.host]:{text:'主播B'},[fields.periods]:[{text:'上午'}],[fields.photographers]:[{text:'摄影师丁'}]}});
    return result;
  };
  await assert.rejects(store.saveShoot({id:'',date:monday,host:'主播A',periods:['上午'],photographers:['摄影师丁'],script:'',count:null}),/已安排/);
  assert.equal(sdk.fixture.writes.length,0);
});

test('count-only updates keep their narrow read path and leave still checks its cell permission', async () => {
  const {sdk,store,data} = await setup();
  sdk.fixture.calls.length = 0;
  await store.saveShoot({...data.shoots[0],count:20},data.shoots[0]);
  assert.equal(sdk.fixture.calls.length,0);
  await store.setLeave('摄影师丁',monday,'上午',true);
  sdk.base.getPermission = async ({param}) => param.fieldId !== TARGET.fields.slots.leave;
  const before = sdk.fixture.writes.length;
  await assert.rejects(store.setLeave('摄影师丁',monday,'上午',false),/权限/);
  assert.equal(sdk.fixture.writes.length,before);
});

test('deleting the only shoot on a workday clears shoot fields and preserves the date slot row', async () => {
  const {sdk,store} = await setup();
  const fields = TARGET.fields.week;
  sdk.fixture.rows.week.length = 0;
  sdk.fixture.rows.week.push({
    recordId:'only-monday',
    fields:{
      [fields.date]:timestamp(monday),
      [fields.host]:{text:'主播A'},
      [fields.periods]:[{text:'上午'}],
      [fields.photographers]:[{text:'摄影师丁'}],
      [fields.script]:[{type:'text',text:'原脚本'}],
      [fields.count]:null
    }
  });
  // Clearing the last workday row only needs editable permission, not deletable.
  sdk.base.getPermission = async ({type}) => type !== 'deletable';
  let data = await store.loadWeek(monday);
  assert.equal(data.canEdit, true);
  assert.equal(data.canDelete, false);
  const shoot = data.shoots[0];
  assert.equal(shouldKeepDateRow(shoot, data.shoots), true);
  const result = await store.removeShoot(shoot);
  assert.deepEqual(result, { mode:'cleared', id:'only-monday' });
  assert.equal(sdk.fixture.rows.week.length, 1);
  assert.equal(sdk.fixture.writes.length, 1);
  assert.equal(sdk.fixture.writes[0].deleted, undefined);
  data = await store.loadWeek(monday);
  assert.equal(data.shoots.length, 1);
  assert.equal(data.shoots[0].id, 'only-monday');
  assert.equal(data.shoots[0].date, monday);
  assert.equal(data.shoots[0].host, '');
  assert.deepEqual(data.shoots[0].periods, []);
  assert.deepEqual(data.shoots[0].photographers, []);
  assert.equal(data.shoots[0].script, '');
  assert.equal(data.shoots[0].count, null);
  assert.equal(isBlankDateRow(data.shoots[0]), true);
  assert.equal(isBlankDateRow({ ...data.shoots[0], script:'准备草稿' }), false);
  assert.equal(isBlankDateRow({ ...data.shoots[0], host:'主播A' }), false);
  assert.deepEqual(summarize(data.shoots), { sessions:0, count:0, unreported:0 });
  assert.deepEqual(occupied(data.shoots, '摄影师丁', monday, '上午'), []);
  // A subsequent new shoot on that workday reuses the preserved blank row.
  const reusedId = await store.saveShoot({ id:'', date:monday, host:'主播B', periods:['下午'], photographers:['摄影师丙'], script:'新场次', count:null });
  assert.equal(reusedId, 'only-monday');
  assert.equal(sdk.fixture.rows.week.length, 1);
});

test('deleting one of multiple shoots on a workday or a weekend shoot deletes the record directly', async () => {
  const {sdk,store} = await setup();
  const fields = TARGET.fields.week;
  const saturday = addDays(monday, 5);
  assert.equal(isWorkday(monday), true);
  assert.equal(isWorkday(saturday), false);
  sdk.fixture.rows.week.push(
    { recordId:'mon-1', fields:{ [fields.date]:timestamp(monday), [fields.host]:{text:'主播A'}, [fields.periods]:[{text:'上午'}], [fields.photographers]:[{text:'摄影师甲'}], [fields.script]:[{type:'text',text:'s1'}], [fields.count]:null } },
    { recordId:'mon-2', fields:{ [fields.date]:timestamp(monday), [fields.host]:{text:'主播B'}, [fields.periods]:[{text:'下午'}], [fields.photographers]:[{text:'摄影师丙'}], [fields.script]:[{type:'text',text:'s2'}], [fields.count]:null } },
    { recordId:'sat-1', fields:{ [fields.date]:timestamp(saturday), [fields.host]:{text:'主播A'}, [fields.periods]:[{text:'上午'}], [fields.photographers]:[{text:'摄影师丁'}], [fields.script]:null, [fields.count]:null } }
  );
  let data = await store.loadWeek(monday);
  const mon1 = data.shoots.find(s => s.id === 'mon-1');
  const sat1 = data.shoots.find(s => s.id === 'sat-1');
  assert.equal(shouldKeepDateRow(mon1, data.shoots), false);
  assert.equal(shouldKeepDateRow(sat1, data.shoots), false);
  assert.deepEqual(await store.removeShoot(mon1), { mode:'deleted', id:'mon-1' });
  assert.deepEqual(await store.removeShoot(sat1), { mode:'deleted', id:'sat-1' });
  data = await store.loadWeek(monday);
  assert.ok(!data.shoots.some(s => s.id === 'mon-1'));
  assert.ok(!data.shoots.some(s => s.id === 'sat-1'));
  assert.ok(data.shoots.some(s => s.id === 'mon-2'));
  // Now mon-2 is the sole row on Monday, so deleting it preserves the Monday date row.
  const mon2 = data.shoots.find(s => s.id === 'mon-2');
  assert.deepEqual(await store.removeShoot(mon2), { mode:'cleared', id:'mon-2' });
  data = await store.loadWeek(monday);
  const preserved = data.shoots.find(s => s.id === 'mon-2');
  assert.ok(preserved);
  assert.equal(preserved.date, monday);
  assert.equal(preserved.host, '');
});

test('zero-count shoots, blank rows, and field-locked clears are rejected without writing', async () => {
  const {sdk,store} = await setup();
  const fields = TARGET.fields.week;
  sdk.fixture.rows.week.length = 0;
  sdk.fixture.rows.week.push(
    { recordId:'zero-count', fields:{ [fields.date]:timestamp(monday), [fields.host]:{text:'主播A'}, [fields.periods]:[{text:'上午'}], [fields.count]:0 } },
    { recordId:'blank-row', fields:{ [fields.date]:timestamp(addDays(monday,1)) } },
    { recordId:'unreported-wed', fields:{ [fields.date]:timestamp(addDays(monday,2)), [fields.host]:{text:'主播B'}, [fields.periods]:[{text:'下午'}], [fields.script]:[{type:'text',text:'脚本'}], [fields.count]:null } }
  );
  const data = await store.loadWeek(monday);
  await assert.rejects(store.removeShoot(data.shoots.find(s => s.id === 'zero-count')), /不能取消/);
  await assert.rejects(store.removeShoot(data.shoots.find(s => s.id === 'blank-row')), /尚未安排/);
  sdk.base.getPermission = async ({param}) => param.fieldId !== fields.script;
  await assert.rejects(store.removeShoot(data.shoots.find(s => s.id === 'unreported-wed')), /权限/);
  assert.equal(sdk.fixture.writes.length, 0);
});
