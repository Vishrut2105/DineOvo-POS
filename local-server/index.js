const express = require('express');
const cors = require('cors');
const db = require('./db');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Set up rate limiter: maximum of 300 requests per minute
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, 
  message: { error: 'Too many requests from this IP, please try again after a minute.' },
  standardHeaders: true, 
  legacyHeaders: false, 
});

// Apply rate limiting to all requests
app.use(limiter);

// Security Middleware: Require LOCAL_API_KEY
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!process.env.LOCAL_API_KEY || apiKey !== process.env.LOCAL_API_KEY) {
    // Don't log the expected key — security risk
    console.error('[Auth Failed] Invalid or missing API key');
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
});

// ─── Helper: Build orders with items using Map-based O(n) grouping ───
function buildOrdersWithItems(orders, items) {
  const itemMap = new Map();
  for (const item of items) {
    if (!itemMap.has(item.order_id)) itemMap.set(item.order_id, []);
    itemMap.get(item.order_id).push(item);
  }
  return orders.map(o => ({
    ...o,
    order_items: itemMap.get(o.id) || []
  }));
}

// ─── GET all pending and recent orders ───
app.get('/api/orders', (req, res) => {
  db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200', [], (err, orders) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!orders || orders.length === 0) return res.json([]);
    
    const orderIds = orders.map(o => o.id);
    const placeholders = orderIds.map(() => '?').join(',');
    
    db.all(`SELECT * FROM order_items WHERE order_id IN (${placeholders})`, orderIds, (err, items) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(buildOrdersWithItems(orders, items || []));
    });
  });
});

// ─── GET active order for a table+phone (for merge detection) ───
app.get('/api/orders/active', (req, res) => {
  const { table_no, mobile_no } = req.query;
  if (!table_no || !mobile_no) {
    return res.status(400).json({ error: 'table_no and mobile_no are required' });
  }
  
  db.get(
    `SELECT * FROM orders WHERE table_no = ? AND mobile_no = ? AND status IN ('pending', 'done') AND date(created_at) >= date('now', 'localtime') ORDER BY created_at DESC LIMIT 1`,
    [table_no, mobile_no],
    (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: 'No active order found' });
      
      db.all('SELECT * FROM order_items WHERE order_id = ?', [order.id], (err, items) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ...order, order_items: items || [] });
      });
    }
  );
});

// ─── POST create a new order ───
app.post('/api/orders', (req, res) => {
  const { table_no, customer_name, mobile_no, notes, items } = req.body;
  const orderId = uuidv4();
  const createdAt = new Date().toISOString();

  // order_number is deliberately NOT set here — it comes from the Postgres sequence
  // `orders_order_number_seq` when this row syncs up (see sync.js and
  // database_scripts/2026-08-19_billing_and_order_number.sql). The old per-machine SQLite
  // counter that used to run here numbered orders independently on every terminal, so a
  // second terminal would have issued duplicate order IDs.
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run(
      `INSERT INTO orders (id, table_no, customer_name, mobile_no, status, notes, created_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, table_no, customer_name, mobile_no, 'pending', notes, createdAt, 0],
      (err) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: err.message });
        }

        if (items && items.length > 0) {
          const stmt = db.prepare(`
            INSERT INTO order_items (id, order_id, item_id, quantity, custom_name, price, status, batch, created_at, synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          let hasError = false;
          items.forEach(item => {
            stmt.run([
              uuidv4(), orderId, item.item_id, item.quantity,
              item.custom_name, item.price, 'pending', item.batch || 1, createdAt, 0
            ], (itemErr) => {
              if (itemErr) hasError = true;
            });
          });

          stmt.finalize((finalizeErr) => {
            if (hasError || finalizeErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to insert order items' });
            } else {
              db.run('COMMIT');
              res.status(201).json({ success: true, orderId });
            }
          });
        } else {
          db.run('COMMIT');
          res.status(201).json({ success: true, orderId });
        }
      }
    );
  });
});

// ─── PATCH mark an item prepared/unprepared (KDS checkbox) ───
// Mirrors the Supabase write so the local base set doesn't overwrite the tick on refresh.
app.patch('/api/order-items/:id/prepared', (req, res) => {
  const { prepared } = req.body;
  db.run(
    'UPDATE order_items SET prepared = ? WHERE id = ?',
    [prepared ? 1 : 0, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, updated: this.changes });
    }
  );
});

// ─── POST merge items into an existing order ───
app.post('/api/orders/:id/merge', (req, res) => {
  const { id } = req.params;
  const { items } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items provided for merge' });
  }

  // First, find the max batch number for this order
  db.get('SELECT COALESCE(MAX(batch), 0) as max_batch FROM order_items WHERE order_id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const nextBatch = (row?.max_batch || 0) + 1;
    const createdAt = new Date().toISOString();
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      const stmt = db.prepare(`
        INSERT INTO order_items (id, order_id, item_id, quantity, custom_name, price, status, batch, created_at, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      let hasError = false;
      items.forEach(item => {
        stmt.run([
          uuidv4(), id, item.item_id || null, item.quantity,
          item.custom_name || null, item.price, 'pending', nextBatch, createdAt, 0
        ], (itemErr) => {
          if (itemErr) hasError = true;
        });
      });
      
      stmt.finalize((finalizeErr) => {
        if (hasError || finalizeErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to merge items' });
        }
        
        // Mark order as unsynced so it gets pushed to Supabase
        db.run('UPDATE orders SET synced = 0, status = ? WHERE id = ?', ['pending', id], (updateErr) => {
          if (updateErr) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Failed to update order sync status' });
          }
          db.run('COMMIT');
          res.json({ success: true, batch: nextBatch, itemsAdded: items.length });
        });
      });
    });
  });
});

// ─── POST manual merge orders ───
app.post('/api/orders/manual-merge', (req, res) => {
  const { targetOrderId, sourceOrderId } = req.body;
  
  if (!targetOrderId || !sourceOrderId) {
    return res.status(400).json({ error: 'targetOrderId and sourceOrderId are required' });
  }

  // 1. Get max batch
  db.get('SELECT COALESCE(MAX(batch), 0) as max_batch FROM order_items WHERE order_id = ?', [targetOrderId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const maxBatch = row.max_batch || 0;
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // 2. Update order_items
      db.run(
        'UPDATE order_items SET order_id = ?, batch = COALESCE(batch, 1) + ? WHERE order_id = ?',
        [targetOrderId, maxBatch, sourceOrderId]
      );
      
      // 3. Status is preserved, no update needed
      
      // 4. Delete source order
      db.run('DELETE FROM orders WHERE id = ?', [sourceOrderId], (err) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: err.message });
        }
        db.run('COMMIT');
        res.json({ success: true });
      });
    });
  });
});

// ─── PUT update order status ───
app.put('/api/orders/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, payment_method } = req.body;
  
  db.run(
    'UPDATE orders SET status = ?, payment_method = ?, synced = 0 WHERE id = ?',
    [status, payment_method || null, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    }
  );
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Local Cafe Server running at http://127.0.0.1:${port}`);
  console.log('Server is locked to localhost and protected by LOCAL_API_KEY.');
});
