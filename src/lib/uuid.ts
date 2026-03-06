/**
 * Generate a UUID v4 compatible with all browsers and devices
 * Falls back to client-side generation for browsers that don't support crypto.randomUUID()
 * 
 * This is especially important for mobile browsers and PWAs over HTTP
 * @returns A UUID v4 string
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && 
      typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback: client-side UUID v4 generation
  // Works in all browsers including older mobile browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
}
