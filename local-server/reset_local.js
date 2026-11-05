const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'dineovo_local.db');
const db = new sqlite3.Database(dbPath);

console.log('Connecting to local SQLite database...');

db.serialize(() => {
  console.log('Wiping fake testing data from local tables...');

  // Delete all rows from local tables
  const tables = ['order_items', 'orders', 'requests', 'reservations'];
  
  tables.forEach(table => {
    db.run(`DELETE FROM ${table}`, function(err) {
      if (err) {
        console.error(`Error clearing ${table}:`, err.message);
      } else {
        console.log(`Successfully cleared ${table}. Rows deleted: ${this.changes}`);
      }
    });
  });

  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Local database reset complete!');
    }
  });
});
