// Debug builds talk to the backend on this computer: run `adb reverse tcp:8000 tcp:8000` once per connection, and the phone's (or
// emulator's) 127.0.0.1:8000 is the computer's port 8000. Release builds talk to the live site.
export const API_BASE = __DEV__ ? 'http://127.0.0.1:8000' : 'https://chordsuno.com';

export const SITE = 'https://chordsuno.com';
export const LINKS = {
  privacy: `${SITE}/privacy/`,
  terms: `${SITE}/terms/`,
  deleteAccount: `${SITE}/delete-account/`,
  support: 'mailto:yantrixlab@gmail.com',
  youtubeTerms: 'https://www.youtube.com/t/terms',
  googlePrivacy: 'https://policies.google.com/privacy',
};

// The version the store listing carries; the server's /api/app/config can ask older ones to update.
export const VERSION_CODE = 1;
export const VERSION_NAME = '1.0.0';
