/**
 * Lightweight web haptic feedback utility using navigator.vibrate
 * Gracefully silent on unsupported devices / iOS Safari
 */
export function triggerHaptic(type = 'light') {
  if (typeof window === 'undefined' || !('vibrate' in navigator)) return;

  try {
    switch (type) {
      case 'light':
        // Subtle micro-tap for tab gliding, stepper + / -
        navigator.vibrate(12);
        break;
      case 'medium':
        // Tactile button click / sheet open
        navigator.vibrate(22);
        break;
      case 'success':
        // Dual-pulse confirmation for order sent
        navigator.vibrate([25, 45, 30]);
        break;
      case 'warning':
        navigator.vibrate([40, 50, 40]);
        break;
      default:
        navigator.vibrate(15);
    }
  } catch (e) {
    // Ignore unsupported browser restrictions
  }
}
