import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLocalAndCloudOrders, patchOrderUpdate, patchOrderItem } from './orderPatching.js';

test('mergeLocalAndCloudOrders merges without dropping cloud orders', () => {
  const cloudOrders = [
    { id: 'cloud-1', table_no: 'T1', created_at: '2026-11-05T10:00:00Z' },
    { id: 'cloud-2', table_no: 'T2', created_at: '2026-11-05T09:00:00Z' },
  ];
  const localOrders = [
    { id: 'local-new', table_no: 'T3', created_at: '2026-11-05T11:00:00Z' },
    { id: 'cloud-1', table_no: 'T1', status: 'paid', created_at: '2026-11-05T10:00:00Z' },
  ];

  const merged = mergeLocalAndCloudOrders(cloudOrders, localOrders);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, 'local-new');
  assert.equal(merged[1].id, 'cloud-1');
  assert.equal(merged[1].status, 'paid');
  assert.equal(merged[2].id, 'cloud-2');
});

test('patchOrderUpdate preserves existing nested order_items', () => {
  const orders = [
    {
      id: 'ord-1',
      status: 'pending',
      order_items: [{ id: 'item-1', name: 'Burger', quantity: 1 }]
    }
  ];

  const updated = patchOrderUpdate(orders, { id: 'ord-1', status: 'done' });
  assert.equal(updated[0].status, 'done');
  assert.equal(updated[0].order_items.length, 1);
  assert.equal(updated[0].order_items[0].name, 'Burger');
});

test('patchOrderItem handles INSERT and UPDATE correctly', () => {
  const orders = [
    {
      id: 'ord-1',
      order_items: [{ id: 'item-1', order_id: 'ord-1', custom_name: 'Burger', batch: 1, prepared: false }]
    }
  ];

  // INSERT new item
  const withNewItem = patchOrderItem(orders, { id: 'item-2', order_id: 'ord-1', custom_name: 'Fries', batch: 2, prepared: false }, 'INSERT');
  assert.equal(withNewItem[0].order_items.length, 2);
  assert.equal(withNewItem[0].order_items[1].custom_name, 'Fries');

  // UPDATE existing item (e.g. prepared checkbox)
  const prepared = patchOrderItem(withNewItem, { id: 'item-1', order_id: 'ord-1', prepared: true }, 'UPDATE');
  assert.equal(prepared[0].order_items[0].prepared, true);

  // DELETE item
  const deleted = patchOrderItem(prepared, { id: 'item-2', order_id: 'ord-1' }, 'DELETE');
  assert.equal(deleted[0].order_items.length, 1);
  assert.equal(deleted[0].order_items[0].id, 'item-1');
});
