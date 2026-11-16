import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGET, summarize, participantsTotal, occupied, mondayOf, addDays, dateKey, timestamp, assignmentProblems, validateShoot, scriptUrl } from '../schedule-core.mjs';
import { ScheduleStore, readPages } from '../schedule-data.mjs';
import { previewSdk } from './preview-sdk.mjs';

const monday = mondayOf();
async function setup(opts) { const sdk = previewSdk(opts); const store = await new ScheduleStore(sdk).init(); return { sdk, store, data:await store.loadWeek(monday) }; }
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
