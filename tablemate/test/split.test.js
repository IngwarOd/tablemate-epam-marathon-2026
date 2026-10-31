import test from 'node:test';
import assert from 'node:assert/strict';
import { splitBill } from '../public/split.js';

test('splits rounded tips deterministically and preserves the exact total', () => {
  const people = [
    { id: 'a', name: 'Олена', total: 101 },
    { id: 'b', name: 'Марко', total: 101 },
    { id: 'c', name: 'Ігор', total: 101 }
  ];
  const bill = splitBill(people, 10);
  assert.equal(bill.tip, 30);
  assert.deepEqual(bill.rows.map(person => person.tip), [10, 10, 10]);
  assert.equal(bill.rows.reduce((sum, person) => sum + person.total, 0), bill.total);
  assert.deepEqual(splitBill([{ id: 'a', name: 'А', total: 5 }, { id: 'b', name: 'Б', total: 5 }], 10).rows.map(person => person.tip), [1, 0]);
  assert.deepEqual(splitBill([{ id: 'a', name: 'А', total: 0 }], 10).rows, []);
});
