import React, { useEffect } from 'react';
import { useSession } from '../context/SessionContext';

export default function Toast() {
  const { toastMessage, showToast } = useSession();

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        showToast(null);
      }, 2300);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, showToast]);

  return (
    <div className={`toast-glass ${toastMessage ? 'show' : ''}`}>
      {toastMessage}
    </div>
  );
}
