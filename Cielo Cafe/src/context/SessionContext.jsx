import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { resolveActiveTable } from '../lib/tableTokens';

const SessionContext = createContext(null);

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function SessionProvider({ children }) {
  // 1. Table Detection via encrypted 'orderatcieloi' URL param or fallback
  const [activeTable, setActiveTable] = useState(() => resolveActiveTable());

  const formattedTable = useMemo(() => {
    const raw = String(activeTable || '').trim();
    if (!raw || raw.toLowerCase() === 'takeaway') return 'Takeaway';
    return raw.replace(/^(\d+)$/, 'T$1').toUpperCase();
  }, [activeTable]);

  // Toast State
  const [toastMessage, setToastMessage] = useState(null);
  const showToast = useCallback((msg) => {
    setToastMessage(msg);
  }, []);

  // 2. Dining Session State
  const [session, setSession] = useState(() => {
    const storageKey = `ember_session_${formattedTable}`;
    try {
      const sess = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (sess && sess.created_at) {
        const ageHours = (Date.now() - new Date(sess.created_at).getTime()) / (1000 * 60 * 60);
        if (ageHours <= 6) return sess;
      }
    } catch (e) {}
    const newSess = {
      id: generateUUID(),
      table_no: formattedTable,
      created_at: new Date().toISOString(),
      order_ids: [],
      status: 'active'
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(newSess));
    } catch (e) {}
    return newSess;
  });

  // Keep session in sync with active table changes
  useEffect(() => {
    const storageKey = `ember_session_${formattedTable}`;
    try {
      const sess = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (sess && sess.created_at) {
        const ageHours = (Date.now() - new Date(sess.created_at).getTime()) / (1000 * 60 * 60);
        if (ageHours <= 6) {
          setSession(sess);
          return;
        }
      }
    } catch (e) {}
    const newSess = {
      id: generateUUID(),
      table_no: formattedTable,
      created_at: new Date().toISOString(),
      order_ids: [],
      status: 'active'
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(newSess));
    } catch (e) {}
    setSession(newSess);
  }, [formattedTable]);

  const saveSession = useCallback((updatedSess) => {
    setSession(updatedSess);
    try {
      localStorage.setItem(`ember_session_${formattedTable}`, JSON.stringify(updatedSess));
    } catch (e) {}
  }, [formattedTable]);

  const resetDiningSession = useCallback((skipConfirm = false) => {
    if (!skipConfirm && !window.confirm(`Start a fresh dining session for Table ${activeTable}? This will reset active tickets on this device.`)) {
      return;
    }
    const storageKey = `ember_session_${formattedTable}`;
    localStorage.removeItem(storageKey);

    // Clean out local orders for this table
    try {
      const raw = JSON.parse(localStorage.getItem('ember_orders_history') || '[]');
      const remaining = raw.filter(o => {
        const tNo = String(o.table_no || '').trim().toUpperCase();
        return tNo !== formattedTable;
      });
      localStorage.setItem('ember_orders_history', JSON.stringify(remaining));
    } catch (e) {}

    const fresh = {
      id: generateUUID(),
      table_no: formattedTable,
      created_at: new Date().toISOString(),
      order_ids: [],
      status: 'active'
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(fresh));
    } catch (e) {}
    setSession(fresh);
    setCart({});
    setOrders([]);
    showToast(`Started fresh session for Table ${activeTable}`);
  }, [activeTable, formattedTable, showToast]);

  // 3. Orders State (Scoped to current session)
  const [orders, setOrders] = useState([]);

  const refreshLocalOrders = useCallback(() => {
    try {
      const sessionOrderIds = new Set(session?.order_ids || []);
      const raw = JSON.parse(localStorage.getItem('ember_orders_history') || '[]');
      const now = Date.now();

      const filtered = raw.filter(o => {
        if (!sessionOrderIds.has(o.id)) return false;
        const tNo = String(o.table_no || '').trim().toUpperCase();
        return tNo === formattedTable || tNo === String(activeTable || '').trim().toUpperCase();
      }).map(o => {
        if (o.created_at) {
          const ageHours = (now - new Date(o.created_at).getTime()) / (1000 * 60 * 60);
          if (ageHours > 6 && ['pending', 'preparing', 'served'].includes(o.status)) {
            o.status = 'completed';
          }
        }
        return o;
      });
      setOrders(filtered);
    } catch (e) {
      setOrders([]);
    }
  }, [session, formattedTable, activeTable]);

  useEffect(() => {
    refreshLocalOrders();
  }, [refreshLocalOrders]);

  // Sync orders from Supabase cloud
  const syncCloudOrders = useCallback(async () => {
    try {
      const sessionOrderIds = session?.order_ids || [];
      const hasSessionIds = sessionOrderIds.length > 0;
      const isTableKnown = formattedTable && formattedTable !== 'Takeaway';

      if (!hasSessionIds && !isTableKnown) return;

      let query = supabase
        .from('orders')
        .select('id, table_no, customer_name, mobile_no, status, created_at, order_items(id, item_id, custom_name, quantity, price, prepared, batch)')
        .order('created_at', { ascending: false });

      if (hasSessionIds && isTableKnown) {
        query = query.or(`id.in.(${sessionOrderIds.join(',')}),and(table_no.eq.${formattedTable},status.in.(pending,done))`);
      } else if (hasSessionIds) {
        query = query.in('id', sessionOrderIds);
      } else {
        const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
        query = query.eq('table_no', formattedTable).in('status', ['pending', 'done']).gte('created_at', sixHoursAgo);
      }

      const res = await query;

      if (!res.error && Array.isArray(res.data)) {
        // Collect any newly discovered order IDs for this table
        const fetchedIds = res.data.map(o => o.id);
        const mergedIds = Array.from(new Set([...sessionOrderIds, ...fetchedIds]));
        if (mergedIds.length > sessionOrderIds.length) {
          saveSession({
            ...session,
            order_ids: mergedIds
          });
        }

        const cloudData = res.data.map(order => {
          const items = (order.order_items || []).map(it => ({
            id: it.id,
            item_id: it.item_id,
            name: it.custom_name || 'Item',
            price: Number(it.price) || 0,
            quantity: Number(it.quantity) || 1,
            prepared: Boolean(it.prepared),
            batch: it.batch || 1
          }));
          const total = items.reduce((sum, it) => sum + (it.price * it.quantity), 0);
          const rawStatus = String(order.status || 'pending').toLowerCase();
          
          let normStatus = rawStatus;
          if (rawStatus === 'done') {
            normStatus = 'served';
          } else if (rawStatus === 'paid') {
            normStatus = 'completed';
          } else if (rawStatus === 'pending') {
            const hasPrepared = items.some(it => it.prepared);
            if (hasPrepared) {
              normStatus = 'preparing';
            }
          }

          return {
            id: order.id,
            table_no: order.table_no,
            customer_name: order.customer_name,
            phone: order.mobile_no,
            status: normStatus,
            created_at: order.created_at,
            items,
            total
          };
        });

        // Merge with existing local orders
        const rawLocal = JSON.parse(localStorage.getItem('ember_orders_history') || '[]');
        const idMap = new Set(cloudData.map(c => c.id));
        const merged = [...cloudData];
        rawLocal.forEach(l => {
          if (!idMap.has(l.id)) merged.push(l);
        });

        localStorage.setItem('ember_orders_history', JSON.stringify(merged.slice(0, 30)));
        refreshLocalOrders();
      }
    } catch (e) {
      console.warn('Sync orders notice:', e);
    }
  }, [session, formattedTable, saveSession, refreshLocalOrders]);

  // Realtime subscription on orders & order_items
  useEffect(() => {
    if (!formattedTable) return;
    const channel = supabase
      .channel(`rt_table_orders_${formattedTable}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `table_no=eq.${formattedTable}`
      }, () => {
        syncCloudOrders();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'order_items'
      }, () => {
        syncCloudOrders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [formattedTable, syncCloudOrders]);

  // 4. Menu State & Realtime
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(true);

  const fetchMenu = useCallback(async () => {
    try {
      const res = await supabase
        .from('menu_items')
        .select('*')
        .eq('is_available', true)
        .order('category')
        .order('name');

      if (!res.error && res.data) {
        setMenuItems(res.data);
      }
    } catch (err) {
      console.warn('Menu fetch error:', err);
    } finally {
      setMenuLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMenu();
    const channel = supabase
      .channel('rt_menu_items_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => {
        fetchMenu();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMenu]);

  // 5. Cart Management
  const [cart, setCart] = useState({}); // { [itemKey]: quantity }
  const [mergeOrderId, setMergeOrderId] = useState(() => {
    if (typeof window !== 'undefined') {
      const search = window.location.search || (window.location.href.includes('?') ? window.location.href.split('?')[1] : '');
      const params = new URLSearchParams(search);
      return params.get('mergeOrderId') || null;
    }
    return null;
  });

  const getItemKey = (item) => `${item.category || 'Other'}||${item.name}`;

  const setItemQuantity = useCallback((item, quantity) => {
    const key = getItemKey(item);
    setCart(prev => {
      const next = { ...prev };
      if (quantity <= 0) {
        delete next[key];
      } else {
        next[key] = quantity;
      }
      return next;
    });
  }, []);

  const addToCart = useCallback((item) => {
    const key = getItemKey(item);
    setCart(prev => ({
      ...prev,
      [key]: (prev[key] || 0) + 1
    }));
  }, []);

  const removeFromCart = useCallback((item) => {
    const key = getItemKey(item);
    setCart(prev => {
      const next = { ...prev };
      const current = next[key] || 0;
      if (current <= 1) {
        delete next[key];
      } else {
        next[key] = current - 1;
      }
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    setCart({});
    setMergeOrderId(null);
  }, []);

  // Detailed Cart breakdown
  const cartDetails = useMemo(() => {
    const items = [];
    let total = 0;
    let count = 0;

    Object.entries(cart).forEach(([key, qty]) => {
      if (qty <= 0) return;
      const [category, name] = key.split('||');
      const menuItem = menuItems.find(m => m.name === name && (m.category === category || !m.category));
      const price = menuItem ? Number(menuItem.price) || 0 : 0;
      const subtotal = price * qty;
      total += subtotal;
      count += qty;

      items.push({
        id: menuItem?.id || null,
        name,
        category,
        price,
        quantity: qty,
        description: menuItem?.description || '',
        subtotal
      });
    });

    return { items, total, count };
  }, [cart, menuItems]);

  // 6. Dismiss Order
  const dismissOrder = useCallback((orderId) => {
    try {
      const updatedSess = {
        ...session,
        order_ids: (session?.order_ids || []).filter(id => String(id) !== String(orderId))
      };
      saveSession(updatedSess);

      const raw = JSON.parse(localStorage.getItem('ember_orders_history') || '[]');
      const remaining = raw.filter(o => String(o.id) !== String(orderId));
      localStorage.setItem('ember_orders_history', JSON.stringify(remaining));

      refreshLocalOrders();
      showToast('Ticket dismissed');
    } catch (e) {
      console.warn('Dismiss error:', e);
    }
  }, [session, saveSession, refreshLocalOrders, showToast]);

  // Cancel order (misclicked cancellation system)
  const cancelOrder = useCallback(async (orderId) => {
    try {
      // 1. Update Supabase
      const { error } = await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId);

      if (error) {
        console.warn('Supabase cancel order notice:', error);
      }

      // 2. Update local storage history
      const raw = JSON.parse(localStorage.getItem('ember_orders_history') || '[]');
      const updated = raw.map(o => {
        if (String(o.id) === String(orderId)) {
          return { ...o, status: 'cancelled' };
        }
        return o;
      });
      localStorage.setItem('ember_orders_history', JSON.stringify(updated));

      refreshLocalOrders();
      syncCloudOrders();
      showToast('Order cancelled');
      return true;
    } catch (err) {
      console.error('Cancel order error:', err);
      showToast('Failed to cancel order');
      return false;
    }
  }, [refreshLocalOrders, syncCloudOrders, showToast]);

  // 7. Send Staff Quick Request
  const sendStaffRequest = useCallback(async (type) => {
    if (!activeTable || activeTable === 'Takeaway') {
      showToast('Please scan a Table NFC Tag first!');
      return false;
    }
    try {
      const directRes = await supabase.from('requests').insert([{
        table_no: formattedTable,
        type,
        status: 'pending'
      }]);

      if (directRes.error) {
        // Fallback to SECURITY DEFINER RPC
        const rpcRes = await supabase.rpc('create_staff_request', {
          p_table_no: formattedTable,
          p_type: type
        });
        if (rpcRes.error) {
          console.error('Staff request blocked by RLS:', directRes.error, rpcRes.error);
          showToast('Database permission notice: Please run the SQL migration in Supabase');
          return false;
        }
      }

      const msgs = {
        waiter: `Staff notified. A waiter is on the way to Table ${activeTable}!`,
        clean: 'Staff notified for table cleaning.',
        bill: 'Staff notified. Your bill is on the way!'
      };
      showToast(msgs[type] || `Staff notified for Table ${activeTable}`);
      return true;
    } catch (err) {
      console.warn('Request failed:', err);
      showToast(`Request failed: ${err.message || 'Permission denied'}`);
      return false;
    }
  }, [formattedTable, activeTable, showToast]);

  // 8. Submit Order
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitOrder = useCallback(async ({ name, phone, notes }) => {
    if (cartDetails.items.length === 0) {
      showToast('Cart is empty');
      return null;
    }

    if (!mergeOrderId && !activeTable) {
      showToast('Please scan a Table NFC Tag to order!');
      return null;
    }

    setIsSubmitting(true);
    const orderId = generateUUID();
    const targetOrderId = mergeOrderId || orderId;

    try {
      // Optimistic local update
      const updatedOrderIds = session?.order_ids?.includes(targetOrderId)
        ? session.order_ids
        : [...(session?.order_ids || []), targetOrderId];

      saveSession({
        ...session,
        order_ids: updatedOrderIds
      });

      const raw = JSON.parse(localStorage.getItem('ember_orders_history') || '[]');
      let localOrder;

      if (mergeOrderId) {
        const existing = raw.find(o => o.id === mergeOrderId);
        if (existing) {
          existing.items = [...(existing.items || []), ...cartDetails.items];
          existing.total = (existing.total || 0) + cartDetails.total;
          existing.status = 'pending';
          localOrder = existing;
        }
      }

      if (!localOrder) {
        localOrder = {
          id: orderId,
          table_no: formattedTable,
          customer_name: name,
          phone,
          items: cartDetails.items,
          total: cartDetails.total,
          status: 'pending',
          created_at: new Date().toISOString()
        };
        raw.unshift(localOrder);
      }

      localStorage.setItem('ember_orders_history', JSON.stringify(raw.slice(0, 30)));
      refreshLocalOrders();

      // Send to Supabase with 10s timeout guard
      try {
        const writePromise = (async () => {
          if (mergeOrderId) {
            const existingOrder = orders.find(o => o.id === mergeOrderId);
            const maxBatch = (existingOrder?.items || []).reduce((max, it) => Math.max(max, it.batch || 1), 1);
            const nextBatch = maxBatch + 1;

            const { error: updErr } = await supabase.from('orders').update({ status: 'pending' }).eq('id', mergeOrderId);
            if (updErr) console.warn('Update order status notice:', updErr);

            const itemsPayload = cartDetails.items.map(item => {
              const row = {
                order_id: mergeOrderId,
                custom_name: item.name,
                quantity: item.quantity,
                price: item.price,
                status: 'active',
                batch: nextBatch
              };
              if (item.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) {
                row.item_id = item.id;
              }
              return row;
            });
            let { error: insErr } = await supabase.from('order_items').insert(itemsPayload);
            if (insErr && insErr.code === '23503') {
              const fallbackPayload = itemsPayload.map(({ item_id, ...rest }) => rest);
              const retryRes = await supabase.from('order_items').insert(fallbackPayload);
              insErr = retryRes.error;
            }
            if (insErr) throw insErr;
          } else {
            const orderPayload = {
              id: orderId,
              table_no: formattedTable,
              customer_name: name,
              mobile_no: phone,
              notes: notes || null,
              status: 'pending',
              payment_method: 'Pay at Counter'
            };
            const { error: ordErr } = await supabase.from('orders').insert([orderPayload]);
            if (ordErr) throw ordErr;

            const itemsPayload = cartDetails.items.map(item => {
              const row = {
                order_id: orderId,
                custom_name: item.name,
                quantity: item.quantity,
                price: item.price,
                status: 'active',
                batch: 1
              };
              if (item.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) {
                row.item_id = item.id;
              }
              return row;
            });
            let { error: itmErr } = await supabase.from('order_items').insert(itemsPayload);
            if (itmErr && itmErr.code === '23503') {
              const fallbackPayload = itemsPayload.map(({ item_id, ...rest }) => rest);
              const retryRes = await supabase.from('order_items').insert(fallbackPayload);
              itmErr = retryRes.error;
            }
            if (itmErr) throw itmErr;
          }
        })();

        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout: order queued locally')), 10000));
        await Promise.race([writePromise, timeoutPromise]);
      } catch (cloudErr) {
        console.warn('Supabase order sync notice:', cloudErr);
      }

      clearCart();
      syncCloudOrders();
      return targetOrderId;
    } catch (err) {
      console.error('Order submission error:', err);
      showToast('Order recorded locally and queued!');
      clearCart();
      return targetOrderId;
    } finally {
      setIsSubmitting(false);
    }
  }, [cartDetails, mergeOrderId, session, formattedTable, saveSession, refreshLocalOrders, clearCart, syncCloudOrders, showToast]);

  const value = {
    activeTable,
    formattedTable,
    setActiveTable,
    session,
    resetDiningSession,
    orders,
    refreshLocalOrders,
    syncCloudOrders,
    dismissOrder,
    cancelOrder,
    menuItems,
    menuLoading,
    cart,
    cartDetails,
    addToCart,
    removeFromCart,
    setItemQuantity,
    clearCart,
    mergeOrderId,
    setMergeOrderId,
    isSubmitting,
    submitOrder,
    sendStaffRequest,
    toastMessage,
    showToast
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
