import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSdk } from './preview-sdk.mjs';
import { ScheduleStore } from '../schedule-data.mjs';
import { TARGET } from '../schedule-core.mjs';

test('fixture notifications belong to one table and one event, with SDK-shaped payloads', async () => {
  const sdk = previewSdk(), events = [];
  for (const key of ['week','photo','slots']) {
    const table = sdk.fixture.tables[TARGET[key]];
    for (const event of ['onRecordAdd','onRecordModify','onRecordDelete','onFieldModify']) table[event](value => events.push({key,event,value}));
  }
  sdk.base.onPermissionChange(value => events.push({key:'base',event:'onPermissionChange',value}));
  const table = sdk.fixture.tables[TARGET.week], field = TARGET.fields.week.count;
  await table.setRecord('shoot1',{fields:{[field]:20}});
  assert.deepEqual(events.splice(0),[{key:'week',event:'onRecordModify',value:{data:{recordId:'shoot1',fieldIds:[field]}}}]);
  const id = await table.addRecord({fields:{}});
  assert.deepEqual(events.splice(0),[{key:'week',event:'onRecordAdd',value:{data:[id]}}]);
  await table.deleteRecord(id);
  assert.deepEqual(events.splice(0),[{key:'week',event:'onRecordDelete',value:{data:[id]}}]);
  sdk.fixture.emit('photo','onFieldModify',{fieldId:TARGET.fields.photo.onDuty});
  assert.deepEqual(events.splice(0),[{key:'photo',event:'onFieldModify',value:{data:{fieldId:TARGET.fields.photo.onDuty}}}]);
  sdk.fixture.emit('base','onPermissionChange',{});
  assert.equal(events.length,1);
  assert.equal(events[0].key,'base');
});

test('store receives one record notification, marks only schema/permission changes dirty, and unsubscribes', async () => {
  const sdk = previewSdk(), store = await new ScheduleStore(sdk).init(), events = [];
  const stop = store.subscribe(metadata => events.push(metadata));
  await sdk.fixture.tables[TARGET.photo].setRecord('photo0',{fields:{[TARGET.fields.photo.onDuty]:false}});
  assert.deepEqual(events.splice(0),[false]);
  sdk.fixture.emit('slots','onFieldModify',{});
  sdk.fixture.emit('base','onPermissionChange',{});
  assert.deepEqual(events.splice(0),[true,true]);
  stop();
  await sdk.fixture.tables[TARGET.week].setRecord('shoot1',{fields:{[TARGET.fields.week.count]:21}});
  sdk.fixture.emit('base','onPermissionChange',{});
  assert.deepEqual(events,[]);
});
