/**
 * Pure helpers for merging and patching orders and order items in React state.
 * These allow row-level Realtime and local-server updates with zero cloud egress.
 */

/**
 * Merges local SQLite orders with Supabase cloud orders.
 * Keeps local-only orders (e.g. offline orders created on this POS machine)
 * while ensuring cloud orders aren't lost when local SQLite only returns recent orders.
 */
export function mergeLocalAndCloudOrders(prevOrders = [], localOrders = []) {
  if (!localOrders || localOrders.length === 0) return prevOrders;

  const localMap = new Map(localOrders.map(o => [o.id, o]));
  const result = [];
  const seenIds = new Set();

  // First include all local orders
  for (const local of localOrders) {
    seenIds.add(local.id);
    result.push(local);
  }

  // Then retain any previous cloud orders that local SQLite didn't return
  for (const prev of prevOrders) {
    if (!seenIds.has(prev.id)) {
      seenIds.add(prev.id);
      result.push(prev);
    }
  }

  // Sort descending by created_at
  return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * Patches a single order update into the orders list.
 * Preserves existing order_items since orders UPDATE payload doesn't contain nested items.
 */
export function patchOrderUpdate(orders = [], updatedOrder) {
  if (!updatedOrder?.id) return orders;
  return orders.map(o => {
    if (o.id !== updatedOrder.id) return o;
    return {
      ...o,
      ...updatedOrder,
      // Preserve nested order_items array from previous state
      order_items: o.order_items || updatedOrder.order_items || []
    };
  });
}

/**
 * Patches a single order item INSERT/UPDATE into the orders list.
 */
export function patchOrderItem(orders = [], itemPayload, eventType = 'INSERT') {
  if (!itemPayload?.order_id || !itemPayload?.id) return orders;

  return orders.map(order => {
    if (order.id !== itemPayload.order_id) return order;

    const items = order.order_items || [];
    const exists = items.some(i => i.id === itemPayload.id);

    let nextItems;
    if (eventType === 'DELETE') {
      nextItems = items.filter(i => i.id !== itemPayload.id);
    } else if (exists) {
      // UPDATE or duplicate INSERT
      nextItems = items.map(i => i.id === itemPayload.id ? { ...i, ...itemPayload } : i);
    } else {
      // INSERT
      nextItems = [...items, itemPayload];
    }

    // Stable sorting of items (batch, created_at, id)
    nextItems.sort((a, b) => 
      (a.batch || 1) - (b.batch || 1) ||
      String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
      String(a.id).localeCompare(String(b.id))
    );

    return { ...order, order_items: nextItems };
  });
}
