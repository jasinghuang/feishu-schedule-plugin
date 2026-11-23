import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGET, summarize, participantsTotal, occupied, mondayOf, addDays, dateKey, timestamp, assignmentProblems, validateShoot, scriptUrl, normalizeShoot } from '../schedule-core.mjs';
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
