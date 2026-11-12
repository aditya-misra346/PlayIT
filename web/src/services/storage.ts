import type { LibraryItem, TrackMatch } from '../types';

const STORAGE_KEYS = {
  INSTALL_ID: 'auralis.installId.v1',
  LIBRARY: 'auralis.library.v1',
  AUTH_TOKEN: 'auralis.authToken.v1',
  AUTH_USER: 'auralis.authUser.v1',
  MIC_CONSENT: 'auralis.micConsentShown.v1',
  PREFERRED_DEVICE: 'auralis.preferredDevice.v1',
  API_BASE: 'auralis.apiBase.v1',
};

export function getInstallId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEYS.INSTALL_ID);
    if (!id) {
      id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `inst-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(STORAGE_KEYS.INSTALL_ID, id);
    }
    return id;
  } catch {
    return 'anonymous-web-client';
  }
}

export function getApiBaseUrl(): string {
  try {
    const custom = localStorage.getItem(STORAGE_KEYS.API_BASE);
    if (custom) return custom.replace(/\/$/, '');
  } catch {
    // ignore
  }
  return (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';
}

export function setApiBaseUrl(url: string): void {
  try {
    if (!url.trim()) localStorage.removeItem(STORAGE_KEYS.API_BASE);
    else localStorage.setItem(STORAGE_KEYS.API_BASE, url.trim().replace(/\/$/, ''));
  } catch {
    // ignore
  }
}

/**
 * Loads saved recognition history & library from versioned local storage.
 * Stores metadata only — raw microphone recordings are never persisted.
 */
export function loadLibraryItems(): LibraryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LIBRARY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list: LibraryItem[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
    return list
      .filter((item) => item && !item.deleted && item.track && typeof item.track.title === 'string')
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export function loadAllLibraryItemsWithTombstones(): LibraryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LIBRARY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRawLibraryItems(items: LibraryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify({ version: 1, items }));
  } catch {
    // ignore quota error
  }
}

export function addTrackToLibrary(track: TrackMatch): { item: LibraryItem; all: LibraryItem[] } {
  const existing = loadAllLibraryItemsWithTombstones();
  const now = new Date().toISOString();
  const item: LibraryItem = {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `trk-${Date.now()}`,
    track,
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
  const updated = [item, ...existing];
  saveRawLibraryItems(updated);
  return { item, all: updated.filter((i) => !i.deleted) };
}

export function toggleLibraryFavorite(itemId: string): LibraryItem[] {
  const all = loadAllLibraryItemsWithTombstones();
  const now = new Date().toISOString();
  for (const item of all) {
    if (item.id === itemId) {
      item.favorite = !item.favorite;
      item.updatedAt = now;
    }
  }
  saveRawLibraryItems(all);
  return all.filter((i) => !i.deleted);
}

export function deleteLibraryEntry(itemId: string): LibraryItem[] {
  const all = loadAllLibraryItemsWithTombstones();
  const now = new Date().toISOString();
  for (const item of all) {
    if (item.id === itemId) {
      item.deleted = true;
      item.updatedAt = now;
    }
  }
  saveRawLibraryItems(all);
  return all.filter((i) => !i.deleted);
}

export function replaceLibraryFromSync(items: LibraryItem[]): LibraryItem[] {
  saveRawLibraryItems(items);
  return items.filter((i) => !i.deleted).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function clearLocalLibrary(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.LIBRARY);
  } catch {
    // ignore
  }
}

export function exportLibraryAsJsonFile(items: LibraryItem[]): void {
  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      product: 'Auralis Music Recognition',
      count: items.length,
      items,
    },
    null,
    2,
  );
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `auralis-recognition-history-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function hasShownMicConsent(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.MIC_CONSENT) === '1';
  } catch {
    return false;
  }
}

export function markMicConsentShown(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MIC_CONSENT, '1');
  } catch {
    // ignore
  }
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  } catch {
    return null;
  }
}

export function getAuthUser(): { id: string; email: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTH_USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string | null, user: { id: string; email: string } | null): void {
  try {
    if (token && user) {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
      localStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
    }
  } catch {
    // ignore
  }
}
