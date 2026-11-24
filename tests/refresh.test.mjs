import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshQueue } from '../schedule-refresh.mjs';
import { ScheduleStore } from '../schedule-data.mjs';
import { previewSdk } from './preview-sdk.mjs';
import { mondayOf } from '../schedule-core.mjs';

const drain = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };

test('event bursts merge into one refresh without losing schema/permission changes', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const calls = [], queue = createRefreshQueue(async value => calls.push(value), () => false);
  t.after(() => queue.dispose());
  queue.notify(false); queue.notify(true); queue.notify(false);
  t.mock.timers.tick(499); assert.deepEqual(calls,[]);
  t.mock.timers.tick(1); await drain();
  assert.deepEqual(calls,[{metadata:true}]);
  t.mock.timers.tick(1000); await drain();
  assert.equal(calls.length,1);
});

test('a real synthetic save and its event share one post-save read without delaying field permissions', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const sdk = previewSdk(), store = await new ScheduleStore(sdk).init(), monday = mondayOf();
  const data = await store.loadWeek(monday);
  let saving = true, metadataReads = 0, renders = 0;
  const queue = createRefreshQueue(async ({metadata}) => {
    if (metadata) { metadataReads++; await store.init(); }
    await store.loadWeek(monday); renders++;
  }, () => saving);
  const stop = store.subscribe(metadata => queue.notify(metadata));
  t.after(() => {stop();queue.dispose();});
  sdk.fixture.calls.length = 0;
  await store.saveShoot({...data.shoots[0],count:20},data.shoots[0]);
  t.mock.timers.tick(1000); assert.equal(renders,0);
  await queue.request();
  saving = false; queue.settled();
  t.mock.timers.tick(1000); await drain();
  assert.equal(renders,1); assert.equal(metadataReads,0);
  assert.equal(sdk.fixture.calls.length,3);
  assert.equal(sdk.fixture.writes.length,1);
});

test('events deferred during a failed save resume afterward, including metadata', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let saving = true;
  const calls = [], queue = createRefreshQueue(async value => calls.push(value), () => saving);
  t.after(() => queue.dispose());
  queue.notify(false); queue.notify(true);
  t.mock.timers.tick(1000); assert.deepEqual(calls,[]);
  saving = false; queue.settled();
  t.mock.timers.tick(500); await drain();
  assert.deepEqual(calls,[{metadata:true}]);
});

test('an event timer that expires during saving does not read midway through the write', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let saving = false;
  const calls = [], queue = createRefreshQueue(async value => calls.push(value), () => saving);
  t.after(() => queue.dispose());
  queue.notify(false); saving = true;
  t.mock.timers.tick(500); await drain();
  assert.equal(calls.length,0);
  await queue.request(); saving = false; queue.settled();
  t.mock.timers.tick(1000); await drain();
  assert.deepEqual(calls,[{metadata:false}]);
});

test('reads are serial and a change arriving during a read causes one fresh pass', async t => {
  const gate = deferred(), calls = [];
  let active = 0, maxActive = 0, week = 'first';
  const queue = createRefreshQueue(async value => {
    active++; maxActive = Math.max(maxActive,active); calls.push({week,...value});
    if (calls.length === 1) await gate.promise;
    active--;
  }, () => false);
  t.after(() => queue.dispose());
  const first = queue.request();
  week = 'last'; queue.notify(true); queue.notify(false);
  const second = queue.request();
  gate.resolve(); await Promise.all([first,second]);
  assert.equal(maxActive,1);
  assert.deepEqual(calls,[{week:'first',metadata:false},{week:'last',metadata:true}]);
});

test('late external events after a completed save still refresh and disposal cancels pending work', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const calls = [], queue = createRefreshQueue(async value => calls.push(value), () => false);
  await queue.request();
  queue.notify(false); t.mock.timers.tick(500); await drain();
  assert.equal(calls.length,2);
  queue.notify(true); queue.dispose(); t.mock.timers.tick(1000); await queue.request();
  assert.equal(calls.length,2);
});
