import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Receipt, User, Utensils, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { PAYMENT_METHODS } from '../lib/dayReport';

// Read-only view of a past bill, opened from the Revenue page.
//
// Deliberately NOT the POS BillModal: that one collects payment and mutates the order.
// Looking up what a customer was charged last Tuesday must not be able to re-settle the
// bill, so this component only renders the row that src/lib/dayReport.js produced — the
// same stored breakdown that was printed at the time, to the rupee.

const rupees = (n) => `₹${Number(n || 0).toFixed(2)}`;

export default function BillDetailModal({ row, itemName, onClose }) {
  // Escape closes, matching every other modal in the app.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!row) return null;

  const paidMethods = PAYMENT_METHODS.filter(m => row.payments[m] > 0);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-brand-card border border-brand-glass-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Bill details"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-brand-glass-border">
          <div>
            <div className="flex items-center gap-2">
              <Receipt size={16} className="text-brand-primary" />
              <h3 className="text-base font-black text-brand-text">
                {row.invoiceNumber != null
                  ? `Invoice INV-${String(row.invoiceNumber).padStart(4, '0')}`
                  : `Bill ${row.orderNumber != null ? `#${row.orderNumber}` : `#${String(row.id).split('-')[0].toUpperCase()}`}`}
              </h3>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                row.status === 'paid' ? 'bg-blue-500/10 text-blue-500'
                  : row.status === 'done' ? 'bg-green-500/10 text-green-500'
                  : 'bg-amber-500/10 text-amber-600'
              }`}>
                {row.status}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] font-medium text-brand-text/50">
              {row.createdAt && (
                <span className="flex items-center gap-1">
                  <Clock size={11} /> {format(new Date(row.createdAt), 'dd MMM yyyy, h:mm a')}
                </span>
              )}
              {row.tableNo && (
                <span className="flex items-center gap-1"><Utensils size={11} /> Table {row.tableNo}</span>
              )}
              {row.customerName && (
                <span className="flex items-center gap-1"><User size={11} /> {row.customerName}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close bill details"
            className="text-brand-text/40 hover:text-brand-text transition-colors shrink-0 ml-3"
          >
            <X size={18} />
          </button>
        </div>

        {/* Line items */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          <div className="flex flex-col gap-1.5">
            {row.items.length === 0 ? (
              <p className="text-xs text-brand-text/40 text-center py-4">No items on this bill.</p>
            ) : row.items.map(item => (
              <div key={item.id} className="flex items-center gap-3 text-sm">
                <span className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg bg-brand-secondary/40 text-xs font-bold text-brand-text">
                  {item.quantity}
                </span>
                <span className="flex-1 font-semibold text-brand-text/90 truncate">{itemName(item)}</span>
                <span className="text-brand-text/50 text-xs whitespace-nowrap">{rupees(item.price)}</span>
                <span className="font-bold text-brand-text w-20 text-right whitespace-nowrap">
                  {rupees(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          {/* Breakdown — exactly the figures stored on the order. */}
          <div className="mt-5 pt-4 border-t border-brand-glass-border flex flex-col gap-1.5 text-sm">
            <Line label="Subtotal" value={rupees(row.subtotal)} />
            {row.discountAmount > 0 && (
              <Line
                label={`Discount${row.discountLabel ? ` (${row.discountLabel})` : ''}`}
                value={`− ${rupees(row.discountAmount)}`}
                tone="text-red-500"
              />
            )}
            {row.gstAmount > 0 && (
              <>
                <Line label={`CGST (${(row.taxRatePercent / 2).toFixed(2)}%)`} value={rupees(row.gstAmount / 2)} muted />
                <Line label={`SGST (${(row.taxRatePercent / 2).toFixed(2)}%)`} value={rupees(row.gstAmount / 2)} muted />
              </>
            )}
            {row.roundOff !== 0 && <Line label="Round Off" value={rupees(row.roundOff)} muted />}

            <div className="flex items-center justify-between pt-3 mt-1 border-t border-brand-glass-border">
              <span className="font-bold text-brand-text">Final Amount</span>
              <span className="font-black text-brand-primary text-2xl">{rupees(row.finalAmount)}</span>
            </div>

            {row.isEstimate && (
              <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-1">
                Not settled yet — this is the amount currently payable, not money collected.
              </p>
            )}
          </div>

          {/* How it was paid */}
          {paidMethods.length > 0 && (
            <div className="mt-5 pt-4 border-t border-brand-glass-border">
              <div className="text-[10px] font-bold uppercase tracking-widest text-brand-text/40 mb-2">Paid By</div>
              <div className="flex flex-col gap-1.5">
                {paidMethods.map(m => (
                  <div key={m} className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-brand-text/70">{m}</span>
                    <span className="font-bold text-brand-text">{rupees(row.payments[m])}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Line({ label, value, tone = 'text-brand-text', muted = false }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${muted ? 'text-xs' : ''} text-brand-text/60 font-medium`}>{label}</span>
      <span className={`font-bold ${muted ? 'text-xs' : ''} ${tone}`}>{value}</span>
    </div>
  );
}
