import { GEOLOCATION_CONFIG } from './config';

/**
 * Calculates distance between two coordinates in kilometers using Haversine formula
 */
export function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Verifies if the customer is at the cafe using an iOS-optimized, multi-stage strategy:
 * 1. Fast Wi-Fi / Cell coarse reading (enableHighAccuracy: false, maximumAge: 300000)
 *    - Works indoors on multi-story buildings (6th floor) without GPS satellite line-of-sight
 *    - Instant (<200ms) when cached by iOS
 * 2. High-accuracy GPS fallback if coarse is insufficient or unavailable
 * 3. Graceful categorization of errors with customer-friendly messages
 */
export async function verifyUserLocation() {
  if (!GEOLOCATION_CONFIG.enabled) {
    return { success: true, bypassed: true };
  }

  // Bypass on local development / file protocols
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.protocol === 'file:')
  ) {
    return { success: true, bypassed: true };
  }

  // Check if session was already verified during this browser tab session
  try {
    if (sessionStorage.getItem('cielo_location_verified') === 'true') {
      return { success: true, cachedSession: true };
    }
  } catch (e) {}

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return {
      success: false,
      errorType: 'UNSUPPORTED',
      message: 'Geolocation is not supported by your browser.'
    };
  }

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return {
      success: false,
      errorType: 'INSECURE',
      message: 'Location access requires a secure HTTPS connection.'
    };
  }

  const evaluatePosition = (pos) => {
    const { latitude, longitude, accuracy } = pos.coords;
    const dist = getDistanceFromLatLonInKm(
      GEOLOCATION_CONFIG.lat,
      GEOLOCATION_CONFIG.lng,
      latitude,
      longitude
    );

    // Treat device accuracy uncertainty as slop (capped at maxSlopKm)
    const slop = Math.min((accuracy || 0) / 1000, GEOLOCATION_CONFIG.maxSlopKm);
    const effectiveDistance = dist - slop;

    if (effectiveDistance <= GEOLOCATION_CONFIG.maxDistanceKm) {
      try {
        sessionStorage.setItem('cielo_location_verified', 'true');
      } catch (e) {}
      return { success: true, dist, accuracy };
    }

    return {
      success: false,
      errorType: 'OUT_OF_RANGE',
      dist,
      accuracy,
      message: 'You must be at Cielo Cafe to place an order.'
    };
  };

  const getPos = (options) => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  };

  // STAGE 1: Fast / Indoor Coarse Reading
  // Uses Wi-Fi and cell triangulation. Works reliably indoors on the 6th floor.
  try {
    const coarsePos = await getPos({
      enableHighAccuracy: false,
      timeout: 6000,
      maximumAge: 300000 // Allow up to 5 min old cached fix for instant load
    });

    const res = evaluatePosition(coarsePos);
    if (res.success) {
      return res;
    }
    // If coarse reading reports out of range, fall through to high accuracy check
  } catch (err) {
    // If the user tapped "Don't Allow" (code 1), stop immediately
    if (err && err.code === 1) {
      return {
        success: false,
        errorType: 'PERMISSION_DENIED',
        message: 'Location access is required to verify you are at the cafe.'
      };
    }
    // Otherwise (TIMEOUT or POSITION_UNAVAILABLE), fall through to Stage 2
  }

  // STAGE 2: High Accuracy (GPS) Check
  try {
    const finePos = await getPos({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    });

    return evaluatePosition(finePos);
  } catch (err) {
    if (err && err.code === 1) {
      return {
        success: false,
        errorType: 'PERMISSION_DENIED',
        message: 'Location access is required to verify you are at the cafe.'
      };
    } else if (err && err.code === 3) {
      return {
        success: false,
        errorType: 'TIMEOUT',
        message: 'Indoor GPS signal is weak on the 6th floor.'
      };
    }
    return {
      success: false,
      errorType: 'UNAVAILABLE',
      message: 'Unable to determine your location. Please check your device location settings.'
    };
  }
}
