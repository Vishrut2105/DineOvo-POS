const path = require('path');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development';
const envFile = isDev ? '.env.development' : '.env';
const envPath = path.join(__dirname, '..', envFile);

if (isDev && !fs.existsSync(envPath)) {
  console.error(`[Sync] NODE_ENV=development but ${envFile} is missing — refusing to fall back to .env, which would push local test orders into the live cafe database. Create ${envFile} with a separate Supabase project's VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.`);
  process.exit(1);
}

require('dotenv').config({ path: envPath });
const { createClient } = require('@supabase/supabase-js');
const db = require('./db');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let isSyncing = false;
let syncTimeout = null;

// ─── Helper: Promisify db.all ───
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// ─── Helper: Promisify db.run ───
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ─── Sync a single order + its items ───
async function syncSingleOrder(order) {
  const { data: syncedOrder, error: orderError } = await supabase
    .from('orders')
    .upsert({
      id: order.id,
      table_no: order.table_no,
      customer_name: order.customer_name,
      mobile_no: order.mobile_no,
      status: order.status,
      notes: order.notes,
      payment_method: order.payment_method,
      created_at: order.created_at
      // order_number is intentionally omitted: on INSERT the Postgres sequence default
      // assigns it, and on a later UPDATE the existing number is left untouched.
    })
    .select('order_number')
    .single();

  if (orderError) throw orderError;

  // Copy the number Postgres assigned back into the local mirror. App.jsx uses local rows
  // as the base set when rendering, so without this the KDS/KOT would keep showing the old
  // hash-derived fallback for every order that originated offline.
  if (syncedOrder?.order_number != null) {
    await dbRun('UPDATE orders SET order_number = ? WHERE id = ?', [syncedOrder.order_number, order.id]);
  }

  // Sync order items
  const items = await dbAll(
    'SELECT * FROM order_items WHERE order_id = ? AND synced = 0',
    [order.id]
  );

  if (items.length > 0) {
    const { error: itemsError } = await supabase
      .from('order_items')
      .upsert(items.map(item => ({
        id: item.id,
        order_id: item.order_id,
        item_id: item.item_id,
        quantity: item.quantity,
        custom_name: item.custom_name,
        price: item.price,
        status: item.status,
        batch: item.batch || 1,
        created_at: item.created_at,
        prepared: !!item.prepared
      })));

    if (itemsError) throw itemsError;

    // Mark items as synced
    await dbRun('UPDATE order_items SET synced = 1 WHERE order_id = ?', [order.id]);
  }

  // Mark order as synced
  await dbRun('UPDATE orders SET synced = 1 WHERE id = ?', [order.id]);
  console.log(`Synced order ${order.id.substring(0, 8)}...`);
}

// ─── Main sync loop ───
async function syncOrders() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const orders = await dbAll('SELECT * FROM orders WHERE synced = 0');

    if (orders.length > 0) {
      console.log(`Found ${orders.length} unsynced order(s). Syncing...`);

      // Batch-parallel with concurrency limit of 5
      const BATCH_SIZE = 5;
      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(order => syncSingleOrder(order))
        );

        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.error(
              `Failed to sync order ${batch[idx].id.substring(0, 8)}...:`,
              result.reason?.message || result.reason
            );
          }
        });
      }
    }
  } catch (err) {
    console.error('Error in sync cycle:', err.message || err);
  } finally {
    isSyncing = false;
    syncTimeout = setTimeout(syncOrders, 15000);
  }
}

// ─── Graceful shutdown ───
function cleanup() {
  console.log('Sync process shutting down...');
  if (syncTimeout) clearTimeout(syncTimeout);
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Start first sync
syncOrders();
