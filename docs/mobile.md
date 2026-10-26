# Mobile app (install, and Google Play)

DOA is an installable web app (PWA). Anyone can add it to their phone's home screen from the browser; the same app can be listed on Google Play as a
Trusted Web Activity (TWA): a thin Android shell that opens the live site full screen. There is one codebase and every website update reaches phones at once.

## What is in the repository

| Piece | Where | What it does |
|---|---|---|
| Web app manifest | `public/manifest.webmanifest` | Name, colours, icons, standalone display, start page `/businesses`, shortcuts |
| Icons | `public/icons/*.png` (made by `node scripts/make-icons.mjs`) | 192, 512, maskable 512 and the iPhone home-screen icon, drawn from the DOA mark |
| Service worker | `public/sw.js` | Keeps the app's own files so it opens fast and without a signal; pages load from the network first. It never stores business data: the database, sign-in and every write go straight to the network |
| Offline page | `public/offline.html` | Shown when the app cannot load at all |
| Registration | `src/shared/utilities/registerServiceWorker.ts` | Registers the worker in the built app only (not in development, the demo or tests) |
| Install prompt and offline bar | `src/app/layouts/InstallPrompt.tsx` | Offers "Install DOA on your phone" (the browser prompt on Android and Chrome; a how-to on iPhone) and shows a bar while offline |
| Tests | `tests/integration/pwa.test.ts` | Checks the manifest, the icons and that the worker stores no data |

The service worker version is `VERSION` in `public/sw.js`; change it to clear the saved files on every phone.

## Trying it on a phone

1. Open the live site in Chrome on Android. After a moment (and a second visit) Chrome offers "Install app", or use menu → Install app. The in-app banner offers it too.
2. On an iPhone, open it in Safari, tap Share, then Add to Home Screen.
3. Check: it opens full screen with the DOA icon, signs in, and shows the offline page with the airplane mode on.

## Publishing on Google Play (Trusted Web Activity)

You need:

* **A domain of your own.** The `vercel.app` address works for testing, but a Play Store app is tied to one domain for good. Buy the domain first, add it in Vercel, and use it as the site address everywhere.
* **A Google Play developer account** (one-time fee, about USD 25). A new personal account must run a **closed test with at least 12 testers for 14 days** before it can publish to production; an organisation account does not.
* **A privacy policy page** on the site (the app handles students, parents and staff). It must say what is collected, why, who can see it, how long it is kept and how to ask for deletion. Google also asks for the Data safety form and a content rating.
* Store listing: app name, short and full description, the 512 px icon, a feature graphic (1024 x 500) and at least 2 phone screenshots.

Build steps (once the domain is live):

1. Install Bubblewrap: `npm i -g @bubblewrap/cli` (needs JDK 17 and the Android SDK; Bubblewrap offers to download them).
2. `bubblewrap init --manifest https://YOUR-DOMAIN/manifest.webmanifest` and answer the questions (package id such as `com.cloudtech.doa`, signing key). Keep the signing key file and its passwords safe: losing them means you can never update the app. Play App Signing is recommended.
3. `bubblewrap build` produces the `.aab` file to upload in the Play Console.
4. Tie the app to the domain: take the SHA-256 fingerprint shown in Play Console (App integrity, App signing) and publish `https://YOUR-DOMAIN/.well-known/assetlinks.json` (put the file in `public/.well-known/`):

```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "com.cloudtech.doa", "sha256_cert_fingerprints": ["AA:BB:...:FF"] } }]
```

   Without it the app shows a browser address bar at the top.
5. Upload the `.aab` to a closed test, invite the testers, then promote to production after the test period.

## Limits

* Data needs a connection. Offline, the app shell opens but records cannot be read or saved, by design: nothing sensitive is stored by the worker.
* No push notifications yet. If parents should get notices on their phones, the next step is a Capacitor wrapper (or web push) with a notification service; the web code stays the same.
* Phone layouts: on a phone every table becomes a list of small cards (each line labelled from the column heading), the top bar keeps only what is used all the time, and no page scrolls sideways at 320, 360 or 390 px wide (checked by loading every main page at those widths in a real browser). The timetable is the one grid that still scrolls sideways inside its own box, on purpose.
