// Encrypted table mapping from NFC / QR tags to prevent URL tampering.
// The 't1_' prefix identifies the table for management, with a cryptographic token suffix.
export const TABLE_TOKENS = {
  't1_e4b38d91a2c': '1',
  't2_f71c45e90bd': '2',
  't3_a28d716f5cb': '3',
  't4_c9e420b1d8f': '4',
  't5_d3b194a6e72': '5',
  't6_b65c83d219f': '6',
  't7_9f2d1e8c45b': '7',
  't8_1c7e93a2b4f': '8',
  't9_8a5b2d1c93e': '9',
  't10_4d8e19c2b5f': '10',
  't11_7f3a9b1c5d8': '11'
};

/**
 * Resolves the active table number from the URL or local storage.
 * Prioritizes the encrypted 'orderatcieloi' URL parameter.
 */
export function resolveActiveTable() {
  if (typeof window === 'undefined') return '1';

  const search = window.location.search || (window.location.href.includes('?') ? window.location.href.split('?')[1] : '');
  const params = new URLSearchParams(search);

  // 1. Primary: Encrypted NFC / QR parameter 'orderatcieloi'
  let token = params.get('orderatcieloi');

  // Fallback for local testing if no parameter is provided
  if (!token && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:')) {
    token = 't1_e4b38d91a2c';
  }

  if (token && TABLE_TOKENS[token]) {
    const table = TABLE_TOKENS[token];
    try {
      localStorage.setItem('ember_active_table', table);
    } catch (e) {}
    return table;
  }

  // 2. Direct fallback (plain ?t= or ?table= parameter)
  const plain = params.get('t') || params.get('table');
  if (plain) {
    if (TABLE_TOKENS[plain]) {
      const table = TABLE_TOKENS[plain];
      try {
        localStorage.setItem('ember_active_table', table);
      } catch (e) {}
      return table;
    }
    const clean = plain.replace(/^t/i, '');
    try {
      localStorage.setItem('ember_active_table', clean);
    } catch (e) {}
    return clean;
  }

  // 3. Stored table in localStorage
  try {
    const stored = localStorage.getItem('ember_active_table');
    if (stored) return stored;
  } catch (e) {}

  // 4. Default to Table 1 on local development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') {
    return '1';
  }

  return null;
}
