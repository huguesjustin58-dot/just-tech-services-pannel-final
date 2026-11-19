import { AuthenticatedUser } from '../types/panel';

const AUTH_TOKEN_STORAGE_KEY = 'jts_signed_session_token';

export function getStoredAuthToken(): string | null {
  try {
    return window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage unavailability
  }
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getStoredAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  });
}

export async function fetchCurrentSession(): Promise<AuthenticatedUser | null> {
  try {
    const res = await authFetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { authenticated: boolean; user: AuthenticatedUser | null };
    if (!data.authenticated || !data.user) {
      setStoredAuthToken(null);
      return null;
    }
    return data.user;
  } catch {
    return null;
  }
}

export async function loginWithCredentials(
  email: string,
  password: string,
  zone?: 'admin' | 'reseller' | 'client'
): Promise<{ ok: true; user: AuthenticatedUser } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, zone }),
    });
    const data = (await res.json()) as {
      authenticated?: boolean;
      user?: AuthenticatedUser;
      token?: string;
      error?: string;
    };
    if (!res.ok || !data.authenticated || !data.user) {
      return { ok: false, error: data.error || 'Identifiants invalides.' };
    }
    if (data.token) {
      setStoredAuthToken(data.token);
    }
    return { ok: true, user: data.user };
  } catch {
    return { ok: false, error: 'Impossible de joindre le serveur d’authentification.' };
  }
}

export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
): Promise<{ ok: true; user: AuthenticatedUser } | { ok: false; error: string }> {
  try {
    const res = await authFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      user?: AuthenticatedUser;
      token?: string;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.user) {
      return { ok: false, error: data.error || 'Impossible de modifier le mot de passe.' };
    }
    if (data.token) {
      setStoredAuthToken(data.token);
    }
    return { ok: true, user: data.user };
  } catch {
    return { ok: false, error: 'Impossible de joindre le serveur pour mettre à jour le mot de passe.' };
  }
}

export async function logoutSession(): Promise<void> {
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Ignore transient network errors
  } finally {
    setStoredAuthToken(null);
  }
}
