const TOKEN_STORAGE_KEY = 'boardsight_session_token';

export function getStoredAuthToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota / restricted iframe storage errors
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getStoredAuthToken();
  const headers = new Headers(init.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  });
}
