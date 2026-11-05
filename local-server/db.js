const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const userDataPath = process.env.USER_DATA_PATH || __dirname;
const dbPath = path.resolve(userDataPath, 'dineovo_local.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
db.serialize(() => {
  // Orders table
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      table_no TEXT,
      customer_name TEXT,
      mobile_no TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      payment_method TEXT,
      created_at TEXT,
      synced INTEGER DEFAULT 0,
      order_number INTEGER
    )
  `);

  // Adds order_number to installs that had the orders table before this column existed.
  db.run('ALTER TABLE orders ADD COLUMN order_number INTEGER', () => {});

  // Order numbers come from the Postgres sequence `orders_order_number_seq` (see
  // database_scripts/2026-08-19_billing_and_order_number.sql), assigned when a row syncs
  // up. The per-machine SQLite counter that used to live here numbered orders
  // independently on every terminal, so a second terminal would have handed out duplicate
  // order IDs. The old order_counter table is left in place on existing installs — it is
  // simply no longer read or written.

  // Order Items table
  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      item_id TEXT,
      quantity INTEGER,
      custom_name TEXT,
      price REAL,
      status TEXT DEFAULT 'pending',
      batch INTEGER DEFAULT 1,
      created_at TEXT,
      synced INTEGER DEFAULT 0,
      prepared INTEGER DEFAULT 0
    )
  `);

  // Existing installs predate this column. Without it, local rows came back with no
  // `prepared` field and — because App.jsx uses local orders as the base set on refresh —
  // every refresh wiped the KDS checkmarks the user had just ticked.
  db.run('ALTER TABLE order_items ADD COLUMN prepared INTEGER DEFAULT 0', () => {});

  // Performance indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_orders_synced ON orders(synced)');
  db.run('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_orders_table_no ON orders(table_no)');
  db.run('CREATE INDEX IF NOT EXISTS idx_orders_table_phone_status ON orders(table_no, mobile_no, status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)');

  // Requests table (water, waiter, clean)
  db.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      table_no TEXT,
      type TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT,
      synced INTEGER DEFAULT 0
    )
  `);
});

module.exports = db;
