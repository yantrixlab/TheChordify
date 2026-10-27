import { request } from './client';

export { ApiError, errorMessage, setToken, setSignedOutHandler } from './client';

// ---- songs -----------------------------------------------------------------------------------------------------------

export async function searchSongs(query, signal) {
  const data = await request(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  return data.results || [];
}

export async function suggestSongs(query, signal) {
  const data = await request(`/api/suggest?q=${encodeURIComponent(query)}`, { signal });
  return { songs: data.songs || [], queries: data.queries || [] };
}

export async function getTrending() {
  try {
    return (await request('/api/trending')).shelves || [];
  } catch {
    return [];
  }
}

export async function getPopular() {
  try {
    return (await request('/api/popular')).results || [];
  } catch {
    return [];
  }
}

export async function getSimilar(sessionId) {
  try {
    return (await request(`/api/similar/${encodeURIComponent(sessionId)}`)).songs || [];
  } catch {
    return [];
  }
}

/** Starts the chords of a YouTube song (or finds them if somebody has already had them made); returns { sessionId }. */
export function startExtract(song) {
  return request('/api/extract/youtube', {
    method: 'POST',
    body: {
      url: `https://www.youtube.com/watch?v=${song.videoId}`,
      title: song.title || '',
      artist: song.artist || '',
      album: song.album || '',
      thumbnail: song.thumbnail || '',
      duration: song.duration || 0,
    },
  });
}

export const getJob = (sessionId) => request(`/api/job/${sessionId}`);
export const getResult = (sessionId) => request(`/api/result/${sessionId}`);

// ---- the person ------------------------------------------------------------------------------------------------------

/** What the person's plan includes: { entitlements: { instruments_more: true, ... } } (Free for somebody signed out). */
export const getMyPlan = () => request('/api/me/plan');
/** Every plan on sale, its prices and what it includes. */
export const getPricing = () => request('/api/pricing');
export const getAuthConfig = () => request('/api/auth/config');
export const getProfile = () => request('/api/me/profile');
export const getMe = () => request('/api/auth/me');
export const signInWithGoogle = (credential) => request('/api/auth/google', { method: 'POST', body: { credential, mobile: true } });
export const signInAsReviewer = (email, password) => request('/api/auth/reviewer', { method: 'POST', body: { email, password, mobile: true } });
export const signOut = () => request('/api/auth/logout', { method: 'POST' });
export const deleteMyAccount = () => request('/api/me', { method: 'DELETE' });

export async function getLibrary(tab, offset = 0, limit = 48) {
  return request(`/api/me/library?tab=${tab}&limit=${limit}&offset=${offset}`);
}

export async function getFavoriteKeys() {
  return (await request('/api/me/favorites')).keys || [];
}

export const addFavorite = (sessionId, meta) => request(`/api/me/favorites/${sessionId}`, { method: 'PUT', body: meta || {} });
export const removeFavorite = (sessionId) => request(`/api/me/favorites/${sessionId}`, { method: 'DELETE' });
export const recordPlayed = (sessionId) => request('/api/me/played', { method: 'POST', body: { sessionId } }).catch(() => null);

// ---- the app ---------------------------------------------------------------------------------------------------------

export const getAppConfig = () => request('/api/app/config', { timeout: 8000 });
