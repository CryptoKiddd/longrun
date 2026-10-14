/**
 * Defensive key/value persistence. Any failure (private mode, quota, disabled
 * storage, malformed JSON) degrades to "no saved data" instead of throwing.
 */
export class SafeStorage {
  /**
   * @param {string} key
   * @param {{ getItem(k:string): string|null, setItem(k:string, v:string): void } | null} [backend]
   */
  constructor(key, backend = SafeStorage.defaultBackend()) {
    this.key = key;
    this.backend = backend;
  }

  static defaultBackend() {
    try {
      const ls = globalThis.localStorage;
      if (!ls) return null;
      const probe = '__pulse_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch {
      return null;
    }
  }

  get available() {
    return !!this.backend;
  }

  /** @returns {any|null} parsed object, or null if missing/corrupt/unavailable */
  load() {
    if (!this.backend) return null;
    try {
      const raw = this.backend.getItem(this.key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    } catch {
      return null;
    }
  }

  /** @returns {boolean} whether the write succeeded */
  save(data) {
    if (!this.backend) return false;
    try {
      this.backend.setItem(this.key, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }
}

/** In-memory backend for tests and as a fallback. */
export class MemoryBackend {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}
