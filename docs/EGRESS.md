# DineOvo POS — Supabase Egress Architecture & Rules

This project operates on the **Supabase Free Tier (5 GB monthly egress limit)**.
To ensure the restaurant can run all day across multiple PC terminals without ever exceeding the quota, the following rules **must always be followed**.

---

## The 6 Golden Rules of Egress

### 1. Never Poll Supabase on a Timer
- **Banned:** `setInterval(() => supabase.from(...), ms)`.
- The local Express/SQLite server handles offline polling (`http://localhost:3000/api/orders`).
- Cloud syncing runs only on startup, login, network reconnection (`online`), or after prolonged idle focus (> 5 minutes).

### 2. Never Use `select('*')` on List Queries
- Always specify the exact columns needed by the view or calculation:
  ```javascript
  // Bad:
  .select('*, order_items(*)')
  // Good:
  .select('id, table_no, status, grand_total, order_items(id, custom_name, price, quantity)')
  ```

### 3. Use Realtime Row Patches, Not Full Refetches
- When an `INSERT`, `UPDATE`, or `DELETE` payload arrives via Supabase Realtime:
  - **Orders INSERT:** Fetch only that single order (`.eq('id', new.id).single()`) with its items and prepend to state.
  - **Orders UPDATE:** Merge the updated columns into state without re-fetching nested items.
  - **Orders DELETE:** Filter out the deleted ID from state.
  - **Order Items INSERT/UPDATE/DELETE:** Patch the nested `order_items` array in state.
  - **Static tables (`menu_items`, `tables`, `reservations`, etc.):** Patch state directly from the payload.
- Fallback full refetches must be debounced by at least **2000–3000 ms**.

### 4. Debounce Page-Level Realtime Subscriptions
- On pages like `Dashboard.jsx` and `Revenue.jsx`, wrap data fetch calls with a trailing debounce (~3000 ms) and cancel on unmount.
- Skip background queries when `document.hidden === true`.

### 5. Always Bound Date Ranges
- Queries for orders or expenses must always carry `.gte('created_at', fromUtc).lt('created_at', toUtc)` or `.limit(...)`.
- Never run unbounded `.select(...)` on tables that accumulate rows over time.

### 6. Keep Media in Storage, Not Table Columns
- Never store base64 or binary data in Postgres columns.
- Store media in Supabase Storage buckets (`avatars`, `restaurant-assets`) and store only the public URL in table columns.
