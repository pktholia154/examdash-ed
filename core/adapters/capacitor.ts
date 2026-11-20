'use client';

/**
 * Lazy, zero-overhead Capacitor native bridge.
 * Never statically imports @capacitor/* plugins so public Web/SEO bundles
 * pay zero bytes and Googlebot WRS never hits native bridge errors.
 */

interface CapacitorGlobal {
  readonly isNativePlatform?: () => boolean;
  readonly getPlatform?: () => 'ios' | 'android' | 'web' | string;
  readonly Plugins?: {
    readonly Haptics?: {
      impact?: (opts: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }) => Promise<void>;
    };
    readonly Browser?: {
      open?: (opts: { url: string }) => Promise<void>;
    };
  };
}

function getCapacitorGlobal(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

export function isNativeCapacitorPlatform(): boolean {
  const cap = getCapacitorGlobal();
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === 'function') {
      return cap.isNativePlatform() === true;
    }
    if (typeof cap.getPlatform === 'function') {
      const platform = cap.getPlatform();
      return platform === 'ios' || platform === 'android';
    }
  } catch {
    return false;
  }
  return false;
}

export function getCapacitorPlatform(): 'ios' | 'android' | 'web' {
  const cap = getCapacitorGlobal();
  if (!cap || typeof cap.getPlatform !== 'function') return 'web';
  try {
    const platform = cap.getPlatform();
    if (platform === 'ios' || platform === 'android') return platform;
  } catch {
    return 'web';
  }
  return 'web';
}

export async function triggerNativeHaptic(
  style: 'LIGHT' | 'MEDIUM' | 'HEAVY' = 'LIGHT'
): Promise<void> {
  if (!isNativeCapacitorPlatform()) return;
  try {
    await getCapacitorGlobal()?.Plugins?.Haptics?.impact?.({ style });
  } catch {
    // Gracefully ignore when plugin is unavailable
  }
}

export async function openCapacitorOrWebUrl(url: string): Promise<void> {
  if (isNativeCapacitorPlatform()) {
    const nativeOpen = getCapacitorGlobal()?.Plugins?.Browser?.open;
    if (typeof nativeOpen === 'function') {
      try {
        await nativeOpen({ url });
        return;
      } catch {
        // Fall through to standard anchor open
      }
    }
  }
  if (typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
