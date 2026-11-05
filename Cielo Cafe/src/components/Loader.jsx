import React, { useState, useEffect, useCallback } from 'react';
import { RESTAURANT_CONFIG } from '../lib/config';
import { verifyUserLocation } from '../lib/geolocation';
import { resolveActiveTable } from '../lib/tableTokens';
import { MapPin, RotateCcw, AlertCircle, Compass, Utensils, ExternalLink } from 'lucide-react';

export default function Loader({ onFinished }) {
  const [isHiding, setIsHiding] = useState(false);
  const [isMounted, setIsMounted] = useState(true);
  const [logoError, setLogoError] = useState(false);
  const [statusText, setStatusText] = useState('Loading Menu...');
  const [isVerifying, setIsVerifying] = useState(true);
  const [errorState, setErrorState] = useState(null);

  // Check if a table was detected in the URL query string (encrypted or fallback)
  const [urlTable] = useState(() => resolveActiveTable());

  const runLocationCheck = useCallback(async () => {
    setIsVerifying(true);
    setErrorState(null);
    setStatusText('Loading Menu...');

    // Guarantee minimum branded display time (900ms) for smooth entrance
    const [result] = await Promise.all([
      verifyUserLocation(),
      new Promise((resolve) => setTimeout(resolve, 900))
    ]);

    setIsVerifying(false);

    if (result.success) {
      const tableLabel = urlTable ? (urlTable.toUpperCase().startsWith('T') ? urlTable.toUpperCase() : `Table ${urlTable}`) : 'Cielo Cafe';
      setStatusText(`Welcome to ${tableLabel}`);

      setTimeout(() => {
        setIsHiding(true);
      }, 500);

      setTimeout(() => {
        setIsMounted(false);
        if (typeof onFinished === 'function') onFinished();
      }, 1300);
    } else {
      const isiOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

      let title = 'Location Required';
      let message = result.message;

      if (result.errorType === 'PERMISSION_DENIED') {
        title = 'Location Access Required';
        message = 'Please allow location access to verify you are dining at Cielo Cafe.';
      } else if (result.errorType === 'OUT_OF_RANGE') {
        title = 'Outside Cafe Area';
        message = 'Online ordering is only accessible when you are dining at or visiting Cielo Cafe.';
      } else if (result.errorType === 'TIMEOUT') {
        title = 'Weak Indoor Signal';
        message = 'Indoor GPS reception on the 6th floor is taking longer to respond.';
      } else if (result.errorType === 'UNAVAILABLE') {
        title = 'Location Unavailable';
        message = 'Could not detect your position. Please ensure Location Services are turned on.';
      }

      setErrorState({
        type: result.errorType,
        title,
        message,
        isiOS
      });
    }
  }, [urlTable, onFinished]);

  useEffect(() => {
    runLocationCheck();
  }, [runLocationCheck]);

  // Seated diner override when table QR code is present
  const handleTableConfirm = () => {
    try {
      sessionStorage.setItem('cielo_location_verified', 'true');
    } catch (e) {}
    const label = urlTable ? (urlTable.toUpperCase().startsWith('T') ? urlTable.toUpperCase() : `Table ${urlTable}`) : 'Table';
    setStatusText(`Confirmed at ${label}`);
    setIsHiding(true);
    setTimeout(() => {
      setIsMounted(false);
      if (typeof onFinished === 'function') onFinished();
    }, 800);
  };

  if (!isMounted) return null;

  return (
    <div id="loader" className={isHiding ? 'hide' : ''}>
      <div className="ldr-ring">
        {!logoError ? (
          <img
            src="/Logo.jpg"
            alt="The Cielo Cafe"
            style={{ width: '84px', height: '84px', objectFit: 'cover', borderRadius: '50%' }}
            onError={(e) => {
              if (e.target.src.indexOf('logo.png') === -1) {
                e.target.src = '/logo.png';
              } else {
                setLogoError(true);
              }
            }}
          />
        ) : (
          <span className="ldr-fb">C</span>
        )}
      </div>

      <div className="ldr-brand">
        {RESTAURANT_CONFIG.name}
      </div>

      {!errorState ? (
        <>
          <div className="ldr-sub" style={{ marginBottom: '6px' }}>
            {statusText}
          </div>

          <div
            style={{
              fontSize: '10px',
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              color: 'var(--rose)',
              fontWeight: 700,
              marginBottom: '26px'
            }}
          >
            powered by {RESTAURANT_CONFIG.poweredBy || 'DINEOVO'}
          </div>

          <div className="ldr-bar-wrap">
            <div className="ldr-bar" />
          </div>
        </>
      ) : (
        <div
          style={{
            maxWidth: '340px',
            margin: '8px 20px 0',
            padding: '20px 18px',
            background: 'rgba(255, 255, 255, 0.95)',
            borderRadius: '20px',
            border: '1px solid var(--gborder)',
            boxShadow: 'var(--shadow-md)',
            textAlign: 'center',
            animation: 'fadeUp 0.4s ease-out both'
          }}
        >
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              background: 'rgba(139, 94, 52, 0.10)',
              color: 'var(--rose)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px'
            }}
          >
            {errorState.type === 'OUT_OF_RANGE' ? (
              <Compass size={22} />
            ) : errorState.type === 'PERMISSION_DENIED' ? (
              <MapPin size={22} />
            ) : (
              <AlertCircle size={22} />
            )}
          </div>

          <h3
            style={{
              fontSize: '17px',
              fontWeight: 700,
              color: 'var(--ink)',
              marginBottom: '6px',
              fontFamily: "'Cormorant Garamond', serif"
            }}
          >
            {errorState.title}
          </h3>

          <p
            style={{
              fontSize: '12.5px',
              lineHeight: '1.5',
              color: 'var(--ink2)',
              marginBottom: '14px'
            }}
          >
            {errorState.message}
          </p>

          {/* iOS Safari Tip */}
          {errorState.isiOS && errorState.type === 'PERMISSION_DENIED' && (
            <div
              style={{
                fontSize: '11px',
                lineHeight: '1.4',
                color: 'var(--ink3)',
                background: 'rgba(242, 228, 216, 0.5)',
                padding: '8px 10px',
                borderRadius: '10px',
                marginBottom: '14px',
                textAlign: 'left'
              }}
            >
              <strong>iPhone Tip:</strong> Tap the <em>aA</em> or settings icon in Safari&apos;s address bar &gt; <em>Website Settings</em> &gt; <em>Location</em> &gt; <em>Allow</em>.
            </div>
          )}

          {errorState.isiOS && errorState.type === 'OUT_OF_RANGE' && (
            <div
              style={{
                fontSize: '11px',
                lineHeight: '1.4',
                color: 'var(--ink3)',
                background: 'rgba(242, 228, 216, 0.5)',
                padding: '8px 10px',
                borderRadius: '10px',
                marginBottom: '14px',
                textAlign: 'left'
              }}
            >
              <strong>Seated at the cafe?</strong> Make sure <em>Precise Location</em> is turned ON in your iPhone Safari settings.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              onClick={runLocationCheck}
              disabled={isVerifying}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '11px 18px',
                borderRadius: '25px',
                background: 'var(--rose-dark)',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <RotateCcw size={14} className={isVerifying ? 'spin-icon' : ''} />
              {isVerifying ? 'Checking...' : 'Try Again'}
            </button>

            {/* Table QR fallback for seated customers */}
            {urlTable && (
              <button
                type="button"
                onClick={handleTableConfirm}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 18px',
                  borderRadius: '25px',
                  background: 'transparent',
                  color: 'var(--rose-deep)',
                  border: '1px solid var(--gborder)',
                  fontWeight: 600,
                  fontSize: '12.5px',
                  cursor: 'pointer'
                }}
              >
                <Utensils size={14} />
                I am seated at {urlTable.toUpperCase().startsWith('T') ? urlTable.toUpperCase() : `Table ${urlTable}`}
              </button>
            )}

            <a
              href={RESTAURANT_CONFIG.maps}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                marginTop: '4px',
                fontSize: '11.5px',
                color: 'var(--ink3)',
                textDecoration: 'none'
              }}
            >
              <span>View cafe directions</span>
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
