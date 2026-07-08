// Cookie-based customer_ref — a SHA-256 hash of a random client-side value.
// Matches the privacy posture from PAW-BAR-MVP.md: no email, no IP, just a
// stable anonymous handle so rate limiting + session stitching work on the
// server without storing PII. Falls back to a memory-only ref when
// localStorage is blocked (Safari private mode, embedded in iframes).

const STORAGE_KEY = 'pawbar.customer_ref';
let memoryRef: string | null = null;

export async function getCustomerRef(): Promise<string> {
  if (memoryRef) return memoryRef;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      memoryRef = stored;
      return stored;
    }
  } catch {
    // localStorage blocked — fall through to mint a memory-only ref.
  }
  const seed = await mintSeed();
  const hashed = await sha256Hex(seed);
  memoryRef = hashed;
  try {
    window.localStorage.setItem(STORAGE_KEY, hashed);
  } catch {
    // Best-effort persistence; the ref still works for the session.
  }
  return hashed;
}

async function mintSeed(): Promise<string> {
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  if (window.crypto?.subtle) {
    const buf = new TextEncoder().encode(input);
    const hashed = await window.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashed), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // No WebCrypto — fall back to a deterministic FNV-1a 32-bit hash repeated
  // out to 64 hex chars. Good enough for a non-cryptographic anonymous ref.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const base = (h >>> 0).toString(16).padStart(8, '0');
  return base.repeat(8);
}
