import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mondayOf, timestamp, addDays } from '../schedule-core.mjs';

const definitions = JSON.parse(await readFile(new URL('../base-week-markers.json',import.meta.url),'utf8'));
for (const {table_id,field} of definitions) {
  test(`${table_id}: deployed week formula includes Sunday through 23:59:59 and excludes next Monday`, () => {
    // Interpret the formula's actual two date boundaries, including its offset values.
    const match = field.expression.match(/^IF\(\[日期\]<TODAY\(\)-WEEKDAY\(TODAY\(\),2\)\+(\d+),"过去",IF\(\[日期\]<TODAY\(\)-WEEKDAY\(TODAY\(\),2\)\+(\d+),"本周","未来"\)\)$/);
    assert.ok(match);
    for (const today of ['2026-11-23','2026-11-29','2026-12-31','2027-01-03']) {
      const monday = mondayOf(today), day = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
      const start = timestamp(today)+(Number(match[1])-day)*86400000;
      const end = timestamp(today)+(Number(match[2])-day)*86400000;
      const mark = value => value < start ? '过去' : value < end ? '本周' : '未来';
      assert.equal(mark(timestamp(monday)-1),'过去');
      assert.equal(mark(timestamp(monday)),'本周');
      assert.equal(mark(timestamp(addDays(monday,6))),'本周');
      assert.equal(mark(timestamp(addDays(monday,7))-1),'本周');
      assert.equal(mark(timestamp(addDays(monday,7))),'未来');
    }
  });
}
