import { API_BASE } from '../config';

let token = '';
let onSignedOut = null;

/** The sign-in token the server gave this phone; sent with every request as "Authorization: Bearer". */
export function setToken(value) {
  token = value || '';
}

/** Called when the server says the saved sign-in is no longer good (it expired, or the account was removed). */
export function setSignedOutHandler(handler) {
  onSignedOut = handler;
}

export class ApiError extends Error {
  /** HTTP status when the server answered; 0 when it could not be reached. */
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const UNREACHABLE = 'Could not reach Chord Suno. Please check your connection and try again.';

export async function request(path, { method = 'GET', body, form, signal, timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abandon = () => controller.abort();
  if (signal) signal.addEventListener('abort', abandon);
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: form || (body === undefined ? undefined : JSON.stringify(body)),
      signal: controller.signal,
    });
  } catch (err) {
    if (signal && signal.aborted) throw err; // a search that was replaced, not a failure
    throw new ApiError(UNREACHABLE);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abandon);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && token && onSignedOut) onSignedOut();
    const detail = data && typeof data.detail === 'string' ? data.detail : '';
    throw new ApiError(detail || `Something went wrong (${res.status}).`, res.status);
  }
  return data;
}

export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
  return err instanceof Error && err.message ? err.message : fallback;
}
