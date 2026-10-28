# Chord Suno on Google Play — release guide and checklist

App: **Chord Suno** · package `com.yantrixlab.chordsuno` · publisher Yantrix Labs · support yantrixlab@gmail.com

## 1. Before anything else (the long poles)

- [ ] **Play Console developer account** (https://play.google.com/console, one-time US$25).
  - *Personal* account: Google asks for identity verification, and **before you can publish to production you must run a closed test with at least 12 testers opted in for 14 days in a row**. Start this the day the account is approved: it is the longest wait, and no code can shorten it.
  - *Organisation* account (needs a D-U-N-S number): no closed-test wait, but verification takes longer. If Yantrix Labs is a registered business, this can be the faster route overall.
- [ ] **Deploy the backend first.** The app talks to https://chordsuno.com. The bearer-token sign-in, `/api/app/config` and the other changes must be live (push to `main`, let Coolify deploy) before any test of a release build works.
- [ ] Coolify environment variables to set (Application → Environment):
  - `GOOGLE_CLIENT_ID` — already set for the website; the app reuses it (see §3).
  - `REVIEWER_LOGIN=true`, `REVIEWER_EMAIL`, `REVIEWER_PASSWORD` — so Google's reviewers can sign in (see §6, *App access*).
  - `ANDROID_MIN_VERSION_CODE`, `ANDROID_LATEST_VERSION_CODE` (leave `0` until you need to retire a release).

## 2. Building the release

Signing key: `C:\Users\Admin\.chordsuno-keys\chordsuno-upload.jks` (alias `chordsuno-upload`). Its passwords are in `C:\Users\Admin\.gradle\gradle.properties` (`CHORDSUNO_UPLOAD_*`). Neither is in the repository.

> **Back up the `.jks` file and those four lines somewhere safe (a password manager, a private drive).** With Play App Signing (the default) a lost upload key can be reset through Play support, but it takes days.

This project sits in a deep folder, and the native code makes file paths longer than Windows' 260-character limit (`subst` does not help: Metro cannot follow it). Build from a copy at a short path, `C:\cs`, which `mobile\scripts\release-build.ps1` makes and builds, then copies the results to `mobile\release\`:

```powershell
.\mobile\scripts\release-build.ps1
```

If PowerShell's policy refuses to run the script, do its steps by hand: `robocopy` the `mobile` folder and `absolute-ablation\src\lib` to `C:\cs` (leave out `node_modules`, `build`, `.cxx`, `.gradle`, `release`), `npm ci` in `C:\cs\mobile` (this also applies the library patch in `mobile\patches`), put `C:\Program Files\Git\usr\bin` on `PATH` (the audio library's build needs `rm`), then in `C:\cs\mobile\android`:

```powershell
.\gradlew.bat bundleRelease assembleRelease
# the file you upload to Play: app\build\outputs\bundle\release\app-release.aab
# an installable APK for testing on a phone: app\build\outputs\apk\release\app-release.apk
```

Every upload needs a higher `versionCode`. Change it in `android/app/build.gradle` (`versionCode`, `versionName`) **and** in `src/config.js` (`VERSION_CODE`, `VERSION_NAME`).

Upload key fingerprints (public; used in §3):

- SHA-1 `BF:23:6C:C5:3E:05:9D:97:25:A0:90:28:7E:28:45:3C:65:16:A9:E3`
- SHA-256 `9D:89:62:67:04:30:9D:2A:EF:E2:0B:44:CC:33:A9:FB:A5:90:42:77:7A:6D:AE:46:ED:04:E3:DA:3B:2F:BF:40`

When you create the app in Play Console choose **Play App Signing** (default). Google then re-signs the app with its own key, which has a *different* SHA-1: copy it from Play Console → *Test and release → App integrity → App signing*, and add it in §3 as well.

## 3. Google Sign-In for the app

Google Cloud Console → *APIs & Services → Credentials* (the project that owns the website's sign-in):

1. **Create credentials → OAuth client ID → Android**, once per key:
   - Package name `com.yantrixlab.chordsuno`
   - SHA-1: the upload key above (for builds you install yourself), then another client with Play's app-signing SHA-1 (for what Play serves).
2. Keep the existing **Web** client as it is. The app asks Google for an ID token for that client (`webClientId` comes from `/api/auth/config`), and the server checks it against `GOOGLE_CLIENT_ID`.
3. *OAuth consent screen*: status **In production**, scopes only `email`, `profile`, `openid`; privacy policy `https://chordsuno.com/privacy/`.

The Android clients need no secret in the app or on the server; Google matches package name + SHA-1.

## 4. Store listing text

**App name** (max 30): `Chord Suno: Song Chords`

**Short description** (max 80): `Chords for any song, shown beat by beat with guitar and ukulele diagrams.`

**Full description** (max 4000):

```
Hear every chord. Play every song.

Chord Suno finds the chords of any song and shows them to you beat by beat, in time with the music, so you can pick up your guitar or ukulele and play along.

• Search any song or artist and get its chords. Songs other people have already played open at once.
• Follow along: a beat strip lights the playing beat, and a row of chord diagrams slides with the song, with the chord you should be playing enlarged.
• Guitar and ukulele diagrams for every chord, including barre chords and slash chords.
• A chord chart of the whole song, split into intro, verses and choruses, with the chord on the beat where it changes. Tap any beat to jump there.
• Tempo and key worked out for you, and you can change the key (Transpose), put a capo on, and set how many beats make a bar.
• A strumming view with the strumming pattern of the song, with an easier version to start with.
• Import your own song from your phone (MP3, WAV, FLAC or M4A) and get its chords, then play along with the file.
• Practice your chords: six drills, from exploring chords and following along to a one-minute chord-change test and a chord quiz.
• Tuner, metronome and live chord detection that listen through your microphone, for guitar, ukulele, bass and more.
• Share a song's chord sheet as a PDF, or as a MIDI file.
• Keep a library: the songs you played and the ones you favourited, on any device.
• Earn XP, levels and badges as you practise.

Some tools (the tuner, metronome, live chord detection and exports) are part of Chord Suno Premium. Plans you have on chordsuno.com carry over when you sign in.

Sign in with Google to keep your library. You can delete your account and all its data at any time, in the app.

Chord Suno plays songs through YouTube's own player. By using it you also agree to the YouTube Terms of Service.

Questions? yantrixlab@gmail.com
```

*(Every line above is in the 1.0 app. Describing features that are missing is a policy violation, so when something is added or removed, change this text with it. Do not say you can subscribe in the app until Play Billing is in.)*

**Category**: Music & Audio · **Tags**: music learning, guitar, ukulele · **Contact email**: yantrixlab@gmail.com · **Website**: https://chordsuno.com · **Privacy policy**: https://chordsuno.com/privacy/

## 5. Graphics

Ready in `mobile/store/`:

- [x] `play-icon-512.png` — app icon, 512×512.
- [x] `play-feature-graphic-1024x500.png` — feature graphic.
- [x] **Phone screenshots** (1080×2400, in `mobile/store/screenshots/`, taken from the OnePlus): Discover, a song's chord diagrams with the beat strip, the chord grid, the strumming view, the Toolkit, the tuner, My Library. Play accepts 2 to 8, PNG or JPEG, 16:9 or 9:16, each side 320–3840 px.
- [ ] 7-inch and 10-inch tablet screenshots: optional, but recommended; the app works on tablets.

## 6. App content (Play Console → Policy → App content)

| Item | Answer |
| --- | --- |
| **Privacy policy** | `https://chordsuno.com/privacy/` |
| **App access** | *All or some functionality is restricted.* Give the reviewer sign-in: the `REVIEWER_EMAIL` and `REVIEWER_PASSWORD` set in Coolify; the Account screen shows the "Reviewer sign-in" boxes while `REVIEWER_LOGIN=true`. Say that most of the app works without signing in. Switch `REVIEWER_LOGIN` off after the review. |
| **Ads** | No, the app contains no ads. |
| **Content rating** | Fill in the IARC questionnaire: category *Utility / reference* or *Music*; no violence, sexual content, gambling, drugs; **user-generated content: no** (ratings and comments are only about the chords); no sharing of location; no purchases in the app (1.0). Expected rating: Everyone. |
| **Target audience** | 13 and over (13–15, 16–17, 18+). Not for children; do not select anything under 13 (that adds the Families policy). |
| **News app / COVID / health / financial / government** | No to all. |
| **Account deletion** | Yes. In-app: Account → *Delete my account*. Web URL for the form: `https://chordsuno.com/delete-account/`. |
| **Advertising ID** | Not used (declare "No"). If Firebase/Google Analytics is added to the app later, this and the Data safety form change. |
| **Permissions** | `INTERNET`, `VIBRATE` (a short buzz when a string is in tune; needs no declaration), and `RECORD_AUDIO` (the tuner, the live chord detector and chord practice listen to the instrument). The permission is asked for when one of those is opened, never at start-up. In the Play Console's permissions declaration, say the microphone is used only while a tool is running, analysed on the device, and never recorded, stored or sent. |
| **Foreground service / background location / SMS / call log** | None. |

### Data safety form

Matches the Privacy Policy and what the app does now (no analytics SDK, no ads, no crash reporter in the app). Encrypted in transit: **Yes** (HTTPS). Users can request deletion: **Yes**, with the in-app and web routes above.

| Data type | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- |
| Name | Yes (Google sign-in) | No | Yes (sign-in is optional) | Account management |
| Email address | Yes | No | Yes | Account management |
| User IDs (account id, Google id) | Yes | No | Yes | Account management |
| Profile photo (*Personal info → Other info*) | Yes | No | Yes | Account management |
| App interactions (songs played, favourites, XP, ratings, comments) | Yes | No | Yes | App functionality, personalisation |
| Other user-generated content (comments about a song) | Yes | No | Yes | App functionality |
| Audio → *Music files* (a song you import from your phone) | Yes, only when you import one | No | Yes | App functionality (to work out its chords and play it back to you) |
| IP address (server logs) | Yes | No | No | Security, fraud prevention |
| Approximate/precise location, contacts, photos and videos, other files and documents, voice or sound recordings, financial info, health | **No** | | | |

"Shared": the YouTube player is Google's own embed and loads inside the app; list it as a **service provider** processing, not a sale. Declare nothing as "shared for advertising".

The tuner, chord detector and chord practice use the microphone: its sound is analysed on the device as it arrives and is not stored or sent anywhere, so it is *not* "collected" or "shared" (this matches the Privacy Policy). Say so in the form's microphone/audio answers.

## 7. YouTube rules the app must keep

The app uses the YouTube embedded player under the YouTube API Services Terms. Keep all of these true:

- [x] The player is YouTube's own and unmodified, with its controls visible and nothing covering it. It sits in the bottom panel, right of the controls, and its viewport is never smaller than 200 × 200 (the page is built inside the app, `useLocalHTML`, with a stylesheet patch in `mobile/patches/` so the viewport fills the box; YouTube centres the picture in it). Do not shrink it below that.
- [x] Links to the **YouTube Terms of Service** and **Google Privacy Policy** are in the Account screen (and in the Store description).
- [x] No background or audio-only playback; no downloading of video in the app.
- [ ] Never hide or cover the YouTube logo or the "Watch on YouTube" link.
- Videos whose owner blocks embedding show an "Open in YouTube" button instead.

## 8. Release checklist

1. [ ] Push to `main`; confirm the Coolify deploy is green.
2. [ ] Create the Play Console app (name, default language English, App, Free), turn on **Play App Signing**.
3. [ ] §3: Android OAuth clients for the upload SHA-1 and Play's SHA-1.
4. [ ] Build the AAB (§2), install the release APK on a real phone, and check: Home loads, search, play a song, Diagrams and Chart follow the video, sign in with Google, favourite, Library, delete account (use a throwaway Google account), sign out.
5. [ ] **Internal testing** track: upload the AAB, add yourself and a few testers, install from the Play link.
6. [ ] Fill §4–§6 (listing, graphics, App content, Data safety).
7. [ ] **Closed testing** track (personal accounts): add at least 12 testers by email or Google Group; they must opt in and stay in for 14 days.
8. [ ] Apply for production access once the closed test period is done; then create the production release, a staged roll-out (for example 20%) is sensible for the first version.
9. [ ] After approval: remove the reviewer login, keep `REVIEWER_LOGIN` off.

## 9. Known gaps in 1.0

- **No in-app purchases yet.** The tuner, metronome, live chord detector, ukulele diagrams and the PDF/MIDI exports are Premium on the website, so a free account sees a lock on them, and the Premium screen only lists the plans (it says subscribing in the app is coming). A plan someone bought on the website carries over when they sign in. Do not add a link or button there that sends people to the website's checkout: Google Play does not allow steering people to outside payments for digital features. Subscriptions inside the app need Play Billing (phase 7). Until then the app is honest about it, but a new free user cannot unlock those tools from the phone: consider doing the billing before the production release.
- The tuner, metronome, chord practice, live chord detector, importing a song and the exports are in the app. Offline mode and lyrics are not (they are "soon" on the website too).
- Imported songs play from the file on our server; the tuner, detector and practice listen on the device only.
- No crash reporting or analytics in the app. Consider adding crash reporting before wide release (and update the Data safety form and the Privacy Policy when you do).
- Not yet tried: a real guitar or ukulele into the tuner, detector and listening drills (only a generated tone and the speaker were), very low-end phones, and Google Sign-In (it needs the Android OAuth clients in §3 first).
