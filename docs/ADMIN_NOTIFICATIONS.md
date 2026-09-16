# Admin push notifications

SilverForge keeps the existing CRM, customer dashboard, quotes, general contact, projects, support requests and conversations. Six Firestore create triggers save admin history and then send Firebase Cloud Messaging (FCM) data messages to enabled admin devices. A send failure cannot roll back the customer's original document.

## Billing and current deployment prerequisites

**FCM is a no-cost product. The secure Cloud Functions background sender requires the Firebase Blaze plan.** Functions, Eventarc, builds, artifact storage and Firestore usage can have charges beyond their applicable allowances. Removing an external messaging provider does not remove those backend requirements. Firebase Spark does not provide a secure always-on Firestore trigger sender; browser-only sending would expose privileged credentials or stop working when the admin closes the website. This implementation keeps credentials on the managed backend. See [Firebase pricing](https://firebase.google.com/pricing) and [Cloud Functions setup](https://firebase.google.com/docs/functions/get-started).

Read-only checks on September 15, 2026 verified project **silverforge-digital**, project number **684696359962**, with billing disabled. The Cloud Functions and Secret Manager APIs returned `SERVICE_DISABLED`; existing remote resources could not be inventoried through those APIs. No billing change, function deployment or secret deletion was performed. No legacy notification functions or secrets had been deployed by the preceding implementation. If anything was added independently, inspect that project's function/secret inventory after enabling the required access and remove only obsolete notification resources. Do not remove unrelated functions or secrets.

This branch has not been published to the production website. Real token issuance, FCM acceptance, Android installation and operating-system delivery require the setup and live checklist below. Automated token tests use an explicit mock because FCM has no emulator.

## Files and architecture

| Files | Purpose |
| --- | --- |
| `functions/src/index.js`, `actor.js`, `config.js` | Six trusted create triggers with authentication context; skip admin, system and service-account actions; fixed project/region guard |
| `functions/src/notifications.js`, `store.js`, `push.js` | Event mapping, transactional history/reservation, active-admin device discovery, FCM batches, invalid-token cleanup |
| `push-client.js`, `push-messaging.js`, `push-session.js`, `push-auth-state.js`, `push-state.js` | Explicit opt-in, SDK 12.16.0 token registration, own-device list/removal, refresh, local session protection and sign-out cleanup |
| `push-foreground.js`, `script.js` | Foreground delivery while an opted-in admin browses public pages; no permission request or token creation there |
| `push-routing.js`, `crm-login.js`, `crm.js`, `crm-support.js`, `customer-auth.js` | Allowlisted ID-based navigation, preserved login destination and sign-out cleanup |
| `crm-notifications.*`, `notification-shared.js` | Push/dashboard/category settings, public VAPID configuration, history, filters, read receipts and mark-all-read |
| `firebase-public-config.js`, `firebase-config.js` | The unchanged project's public configuration, shared by browser and worker build; no server credentials |
| `push-worker/service-worker.js`, `scripts/build-worker.mjs`, `firebase-messaging-sw.js` | Source, esbuild build and checked-in modular Firebase worker bundle |
| `manifest.webmanifest`, `pwa.js`, `offline.html`, `icons/icon-192.png`, `icons/icon-512.png` | Root-scope standalone PWA and branded public offline fallback |
| `scripts/build-icons.ps1` | Reproducible square icons from the existing unchanged logo |
| `firestore.rules`, tests, package manifests/locks | Strict permissions, reproducible dependencies and local validation |

The previous provider adapter, callback, dependency, secret declarations and configuration UI were removed. There is no outbound provider callback or phone-number setting. `firebase.json` still defines only the existing `admin-alerts` function codebase and Firestore rules; the website remains on its existing GitHub Pages hosting.

### Events and routes

| Create event | Category | Destination |
| --- | --- | --- |
| `leads/{leadId}` | New Quotes | `crm.html?lead=ID` |
| `contactMessages/{contactId}` | New Contact Messages | `crm-support.html?contact=ID` |
| `users/{userUid}` customer profile | New Client Accounts | `crm.html?client=UID` |
| `supportTickets/{ticketId}` | Bug Fix, Redesign, Feature, Project or Other Support | `crm-support.html?ticket=ID` |
| `clientConversations/{clientUid}/messages/{messageId}` customer message/reply | New Client Messages | `crm.html?client=UID&tab=messages` |
| `supportTickets/{ticketId}/messages/{messageId}` customer reply | Client Replies to Requests | `crm-support.html?ticket=ID` |

Updates do not create new-event alerts. Active admin actors are checked using Firestore event authentication context and existing sender/owner IDs. Admin messages, imports and system/service-account writes are skipped. Notification data contains target type, record/client IDs and the intended recipient/device IDs. Display text is bounded. URLs contain IDs, not tokens, contact text, private notes or credentials. Login accepts only same-origin CRM destinations and known query parameters.

## Firestore schema and access

| Path | Data and access |
| --- | --- |
| `users/{adminUid}/notificationDevices/{generatedId}` | `token`, `platform` (`Android`, `iOS`, `Desktop`), `enabled`, `createdAt`, `updatedAt`, `lastUsedAt`. Only that authenticated active admin can read/list/create/update/delete. Even another admin cannot access these browser documents. IDs are random UUIDs, never raw tokens. Creation time is immutable; client update/last-use times must equal request time. |
| `adminSettings/notifications` | `schemaVersion: 2`, `channels: {push, dashboard, email:false}`, ten boolean `categories`, `webPushPublicKey`, `updatedAt`, `updatedBy`. Active admins only; exact keys/types. The VAPID **public** key is not a server credential. |
| `adminNotifications/{sha256(kind:eventId)}` | Existing title/message/category/type/client/project/request/link metadata, plus `target`, `recordId`, `read`, `createdAt`, `dashboardEnabled`, `pushStatus`, `pushAccepted`, `pushFailed`. Active admins read and update only `read`, `readAt`, `readBy`. Server creates and updates delivery status. No token is copied here. |
| `_notificationDeliveries/{sameHash}` | Server-only event reservation/status/timestamps and aggregate accepted/failed/invalid counts. No browser, including admins, can read or write it. |

No additional composite indexes are required: role, enabled-device, unread and timestamp queries use single-field indexes. Existing quote/contact/support/customer security is unchanged. General Contact remains a separate collection and form from Request a Quote.

Missing settings default to push/dashboard and all categories enabled, with email disabled. Devices still require individual explicit opt-in. Existing version-1 category and dashboard choices are preserved; saving settings replaces the old channel schema with version 2. Existing historical documents are retained and show “No push attempt recorded” where appropriate.

The sender reads only active admin roles and enabled devices, deduplicates repeated tokens, and sends in batches of at most 500. Permanent `messaging/registration-token-not-registered` and `messaging/invalid-registration-token` failures disable the matching device. A late failure cannot disable an already rotated token. Other failures retain devices for future events. Automatic browser refresh cannot re-enable an invalidated/removed device; the admin must explicitly enable it again. [FCM error guidance](https://firebase.google.com/docs/cloud-messaging/error-codes)

History and the delivery reservation commit before the external send. Duplicate/concurrent event invocations find that reservation and do not make another application send attempt. A crash between reservation and send can leave an `attempting` record; an ambiguous transport failure is `unknown` and is not automatically resent. The underlying SDK/transport may retry its own requests. This is not guaranteed exactly-once delivery. FCM `accepted` means accepted for transport, not proof that a person or phone saw it. [Firestore event semantics](https://firebase.google.com/docs/functions/firestore-events)

## Worker and session behavior

The generated `/firebase-messaging-sw.js` registers with scope `/` and `updateViaCache: none`. Rebuild it whenever its source, shared routing/state code, public configuration or Firebase dependency changes. Modular SDK 12.16.0 is bundled, matching the existing browser SDK. This version uses the requested `getToken` registration-token API; do not mix in newer installation-ID registration APIs without a coordinated SDK/server migration. [Web setup](https://firebase.google.com/docs/cloud-messaging/web/get-started)

Data-only pushes are displayed explicitly in both foreground and background. The worker validates local opt-in and recipient/device IDs, suppresses the most recent 100 duplicate event IDs, and uses a stable notification tag. A custom click handler is registered before Firebase's worker listeners. [Message handling](https://firebase.google.com/docs/cloud-messaging/web/receive-messages)

The worker caches **only** `/offline.html` and `/icons/icon-192.png`. It never stores dashboard pages, Firestore responses, messages or private CRM data in Cache Storage. Offline navigation displays a public reconnect page. A small IndexedDB record stores local opt-in/UID/device ID and recent notification IDs; the Firebase SDK manages its own token storage. Signing out mutes local display first, closes visible notifications, and attempts a bounded backend disable/token deletion. Offline cleanup cannot immediately update the server; local display remains muted. Authentication changes on customer/public pages also mute a previous account. Closing a tab does not sign out or disable background push.

## Firebase Console setup

1. Open [the SilverForge Firebase project](https://console.firebase.google.com/project/silverforge-digital/settings/general). Confirm project ID **silverforge-digital** and number **684696359962**. Keep its existing app/configuration.
2. Upgrade **this project** to Blaze to deploy the secure Cloud Functions sender. Set an appropriate budget alert; a budget alert does not cap spending. Do not change projects to bypass this prerequisite.
3. Project settings → **Cloud Messaging** → **Web Push certificates**: use the existing key pair, or choose **Generate key pair** if none exists. Copy only the public key. Do not rotate an existing key unnecessarily.
4. Confirm the Firebase Cloud Messaging API (HTTP v1) is enabled. For token registration errors, also check the **FCM Registration API** in Google Cloud APIs & Services for this same project, as described in Firebase's web setup guide. Do not enable the legacy messaging API.
5. Deploy the rules and six functions below, and publish the reviewed website branch through the existing GitHub Pages process.
6. Sign into **Notification Center → Notification Settings**, paste the public key, leave Push and desired categories enabled, and click **Save Notification Settings**. Existing admins are still authorized exclusively by `roles/{uid}` with `role:"admin", active:true`.

The deployed functions use the platform service account/Application Default Credentials through Firebase Admin. No service-account JSON, private VAPID key, provider secret or server key belongs in the browser, GitHub or Firestore settings. Standard Firebase deployment configures the managed runtime; if organization policy or custom IAM blocks FCM, grant only the necessary FCM send permissions to that runtime identity rather than supplying browser credentials.

## Exact local validation and deployment commands

Run from the repository root with Node 22 and Java 21 available. On this Windows machine Java 21 is at `C:\Program Files\Android\openjdk\jdk-21.0.8`.

```powershell
npm ci
npm --prefix functions ci
npm run build:worker
npm run check
npm test
npm run test:notifications
npm run preview
```

Open `http://127.0.0.1:4173` for a visual preview. **The ordinary preview uses the real project configuration**; use the automated emulator tests for isolated writes. Tests replace the config with `demo-silverforge` and block production data endpoints. Browser automation uses installed Edge on Windows; on other platforms install Playwright Chromium with `npx playwright install chromium`.

Verify the project before any deployment. There is no `.firebaserc`; explicitly pin it on every command:

```powershell
npx firebase login
npx firebase projects:list
# Stop unless the listed project ID and number are silverforge-digital / 684696359962.
npx firebase deploy --only firestore:rules --project silverforge-digital
npx firebase deploy --only functions:admin-alerts --project silverforge-digital
npx firebase functions:list --project silverforge-digital
```

The function predeploy guard rejects any other `GCLOUD_PROJECT`. Do not use an unscoped `firebase deploy`. No Firebase Hosting deployment is needed. If CLI sign-in is unavailable, publish the complete `firestore.rules` in **Firebase Console → Firestore Database → Rules → Publish**; function deployment still needs an authenticated CLI and Blaze.

Expected function exports in `us-central1`: `adminNotifyQuote`, `adminNotifyContact`, `adminNotifyAccount`, `adminNotifyRequest`, `adminNotifyClientMessage`, `adminNotifyRequestReply`. A codebase-scoped deployment may offer to delete an obsolete export if one was independently deployed earlier; inspect the name and delete only the obsolete notification callback. Do not bulk-delete unrelated resources.

```powershell
npx firebase functions:log --only adminNotifyQuote,adminNotifyContact,adminNotifyAccount,adminNotifyRequest,adminNotifyClientMessage,adminNotifyRequestReply --project silverforge-digital
```

Logs contain safe event IDs, aggregate counts and status, never raw token-bearing SDK errors or customer payloads. For `permission-denied`, verify active admin UID and published device rules; for `failed-precondition`, inspect the actual configuration/index error; for `unavailable`, check the connection; for `invalid-argument` or web-push authentication errors, verify the original app/project and public key. General Contact's detailed existing Firebase error logging remains intact.

## First Android device

1. Use Chrome on your Samsung/Android phone and open the production HTTPS admin login.
2. Sign in, open Notification Center, and verify the public-key setup has been saved.
3. Chrome menu → **Add to Home screen / Install app**. Open the installed **SilverForge** app and sign in there if needed.
4. Tap **Enable Notifications**, then **Allow** in the browser/Android prompt. Permission is never requested automatically. If blocked, enable this site's/app's notifications in Chrome and Android settings, then reload.
5. Confirm “This device is enabled” and an enabled **Android · This device** row. Keep the session signed in for background alerts. Closing the app is different from signing out.
6. Repeat on desktop or another phone for additional devices. Removing one device does not remove the others. Android notification/battery settings, network availability and force-stopping the browser can affect delivery timing.

## First live notification checklist

1. Confirm rules, all six functions and the website revision are published, and at least one enabled Android device is listed. Enable another device to verify fan-out.
2. From a separate logged-out browser, submit a clearly labeled test quote and general contact. Confirm the originals appear in their existing separate CRM views, an admin history entry exists for each, and each enabled device receives one alert.
3. From a customer test account, submit a bug request and another request category, send a direct message, and reply to a request. Confirm matching history, push status and phone notifications. Creating a new customer account should also alert.
4. Tap each phone notification. Check the exact quote/contact/client conversation/support request. Test after an expired login session to verify the destination survives sign-in. This is the physical-device check that automated synthetic click tests cannot replace.
5. Send admin replies and create an action while signed in as admin: there should be no self-notification. Edit existing profiles/requests: no new-create alert.
6. Disable one category, submit one labeled test, and verify original data/history still save with push disabled. Restore preferences. Mark all read and check badges clear.
7. Remove one test device, submit another event and verify only the remaining enabled device receives it. Sign out on a shared browser and verify it no longer displays alerts. Close/mark the test records through existing CRM controls.

Local validation covers strict device ownership/schema, all original security/browser regressions, all ten event categories, real Functions emulator dispatch, multi-device selection, invalid-token cleanup and rotation races, application event deduplication, permission timing, persisted opt-in, actual worker display/click handlers, public-tab foreground delivery, offline cache contents, login routing and responsive layouts. It does **not** prove a production token can be issued, deployed IAM permits FCM sending, or an actual phone displays an alert; complete the live checklist after setup.

The installed Firestore emulator 1.22.0 hardcodes `fake-auth-id@gmail.com` in its `FunctionsEmulatorEventPublisher`; it does not carry the actual admin UID for contact events. Admin quotes/messages are checked through real emulator writes using their existing actor fields. The exported quote/contact handlers are additionally invoked with explicit admin authentication context against real emulator role data. This validates the production suppression logic, but production contact-event identity still needs the live admin-action check above. The contact document's original eight-field schema is preserved.
