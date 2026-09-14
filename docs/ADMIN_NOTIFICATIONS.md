# Admin notifications and SMS setup

This extends the existing SilverForge CRM and customer portal. Quotes still save to `leads`, general contact to `contactMessages`, and customer communication to the existing support tickets and direct conversations. Cloud Functions process new documents after those saves. A Twilio failure cannot roll back the customer's submission.

## Current release status

Publishing the website, deploying the rules/functions, and verifying a real SMS are separate release steps. Development tests cannot send real texts.

Read-only checks on September 14, 2026 verified Firebase project **silverforge-digital**, project number **684696359962**, and the existing `(default)` Firestore database in **nam5**. Billing was disabled. Cloud Functions and Secret Manager APIs returned `403` because they were disabled or had not been used. Secret values were not requested. Check these settings again during deployment.

Production Cloud Functions requires the **Blaze** plan. Enable billing yourself in [this project's usage settings](https://console.firebase.google.com/project/silverforge-digital/usage/details). The CLI enables required service APIs during setup/deployment with an appropriately authorized account. [Firebase deployment prerequisites](https://firebase.google.com/docs/functions/get-started)

## Changed files

| Files | Purpose |
| --- | --- |
| `functions/src/index.js` | Six Firestore create triggers and the SMS status callback |
| `functions/src/notifications.js` | Event/category mapping, concise summaries, shared send logic and safe errors |
| `functions/src/store.js` | Transactional history, durable deduplication and delivery-status ordering |
| `functions/src/sms.js`, `functions/src/status.js` | Server-only Twilio client, project/config checks and signed callbacks |
| `functions/scripts/verify-project.js`, `functions/package*.json` | Deployment guard, Node 22 runtime, locked Firebase/Twilio dependencies |
| `crm-notifications.html`, `.css`, `.js` | Responsive admin notification center, filters, pagination, read receipts and settings |
| `notification-shared.js`, `notification-badge.js` | Category labels, delivery labels and unread subscriptions |
| `crm.html`, `crm.js`, `crm-support.html`, `crm-support.js`, `client-workspace.js` | Navigation, badges and links to existing lead/contact/client/thread views |
| `customer-account.html`, `customer-auth.js`, `customer-dashboard.js`, `portal-shared.js` | Dashboard section navigation, General Project Request, assigned project selector, Waiting on Client |
| `firestore.rules`, `firebase.json`, `.gitignore` | New access rules, isolated Functions codebase, emulator config and secret exclusions |
| `functions/test/notifications.test.js`, `tests/notifications.integration.mjs`, `tests/run-notifications.mjs`, existing rule/browser tests, root `package.json` | Unit, rules, UI and actual emulator trigger coverage |

Existing client workspaces retain account selection, projects, status editing, direct messages/read receipts, support threads, private notes and email drafts. Existing request types/statuses remain compatible. No duplicate `projects` or `clientRequests` collections are created. General Contact remains separate from Request a Quote.

## Firestore schema and indexes

| New path | Fields and access |
| --- | --- |
| `adminNotifications/{sha256(kind:eventId)}` | `type`, `category`, `title`, `message`, `clientId`, `projectId`, `requestId`, `clientName`, `projectName`, `subject`, `link`, `read`, `createdAt`, `dashboardEnabled`, `smsStatus`, `smsErrorCode`; optional `readAt`, `readBy`. Server creates; active admins read and mark read. No browser can change delivery state. |
| `adminSettings/notifications` | `schemaVersion: 1`, `channels: {sms, dashboard, email}`, `categories`, `updatedAt`, `updatedBy`. Active admins only, exact allowed keys/types. No phone numbers or credentials. |
| `_notificationDeliveries/{same hash}` | `status`, `providerId`, `startedAt`, `updatedAt`. Server-only reservation/provider metadata; even admin browser access is denied. |

Category keys: `quotes`, `contacts`, `accounts`, `clientMessages`, `bugFix`, `redesign`, `feature`, `projectRequests`, `otherRequests`, `replies`.

Defaults: SMS and Dashboard on; all ten categories on. Missing settings use these defaults. Invalid settings fail closed. **Email is visibly disabled** because no email provider was specified. Existing manual email drafts still work. History is always saved, even when a channel/category is disabled. Unread badges count unread events whose Dashboard/category preference was enabled when created; the current global Dashboard switch can hide badges.

Existing `supportTickets` gain optional `projectId` (an assigned `customerQuotes` document ID, or `null`). Older tickets may omit it. `ownerId`/`ownerName`/`ownerEmail` remain the client identity; `details` remains the description. Added values are `type: "project-request"` and `status: "waiting-on-client"`. Customers can select only their own assigned projects and create requests with existing `open`/`normal` defaults; admins change status/priority. `supportTickets/{id}/messages` remains the thread.

**No new composite indexes or migration are required.** History uses the automatic single-field `createdAt` descending index with pages of 50. Unread subscriptions use the automatic single-field `read` index. Keep these indexes enabled. Category/status filters apply to loaded history. The badge reads all unread documents; very large backlogs may eventually need a server-side counter.

The complete updated policy is [`firestore.rules`](../firestore.rules). New matches default to deny except the stated active-admin access. Existing UID scoping, public valid quote/contact creates, safe quote projections, immutable messages and private notes are preserved. Backend Admin SDK actions use the function service identity rather than browser security rules.

## Obtain your Twilio configuration

Use a Twilio account suitable for production custom SMS. Current trials can restrict messages to predefined templates and verified recipients, so a trial is not a reliable test of these custom notifications. For US recipients, complete the registration required for your sender: A2P 10DLC for applicable local numbers, or toll-free verification. [Twilio account and number setup](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account)

| Secret | Where to obtain it |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio Console account dashboard / Account Info. Use the `AC` Account SID for the account that owns the sender. |
| `TWILIO_AUTH_TOKEN` | That account's Auth Token in Account Info / API credentials. Use live credentials, not test credentials. |
| `TWILIO_PHONE_NUMBER` | Twilio Console → Phone Numbers → Manage → Active Numbers. Obtain an SMS-capable number and complete required registration. Use full `+` country-code format. |
| `ADMIN_PHONE_NUMBER` | Your destination mobile number in full `+` country-code format. Verify it with Twilio if your account requires verified recipients. |

Start at [Twilio Console](https://console.twilio.com/); menu names differ between current and legacy Console. Store all four values in Firebase Secret Manager. Do not put them in GitHub, browser code, Firestore preferences, command arguments, screenshots, or chat.

## Exact setup and deployment commands

Run from the repository root with Node **22**. Java **21** is required for emulator tests. Keep the existing Firebase project/configuration; do not run `firebase init` or create a project.

```powershell
npm ci
npm --prefix functions ci
npx firebase login
npx firebase projects:list
npx firebase firestore:databases:list --project silverforge-digital
```

Verify **silverforge-digital / 684696359962** before continuing. This checkout has no `.firebaserc`; every production command below explicitly pins the project. The Functions predeploy guard rejects any other `GCLOUD_PROJECT`.

After enabling Blaze, set each secret at its interactive prompt. Do not append secret values to commands:

```powershell
npx firebase functions:secrets:set TWILIO_ACCOUNT_SID --project silverforge-digital
npx firebase functions:secrets:set TWILIO_AUTH_TOKEN --project silverforge-digital
npx firebase functions:secrets:set TWILIO_PHONE_NUMBER --project silverforge-digital
npx firebase functions:secrets:set ADMIN_PHONE_NUMBER --project silverforge-digital
```

The code uses `defineSecret()` and binds all four secrets to the create triggers. The callback needs only the Auth Token. Redeploy referencing functions after changing a secret. [Firebase secret configuration](https://firebase.google.com/docs/functions/config-env)

Validate before release:

```powershell
npm --prefix functions run build
npm test
npm run test:notifications
npm audit --prefix functions
```

On this Windows computer, if Java is not on PATH, use its existing installation before emulator commands:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
```

Deploy the complete rules first, then only this Functions codebase:

```powershell
npx firebase deploy --only firestore:rules --project silverforge-digital
npx firebase deploy --only functions:admin-alerts --project silverforge-digital
npx firebase functions:list --project silverforge-digital
```

These commands do not deploy Hosting, unrelated Functions codebases or other Firebase services. If CLI authentication is unavailable, publish the complete `firestore.rules` in Firebase Console → Firestore Database → Rules; Functions deployment still requires the CLI. Website changes publish through the existing GitHub Pages process after merge. Deploy rules before publishing the new project selector. [Codebase-scoped deployment](https://firebase.google.com/docs/functions/organize-functions)

Seven exports should appear in `us-central1`: `adminNotifyQuote`, `adminNotifyContact`, `adminNotifyAccount`, `adminNotifyRequest`, `adminNotifyClientMessage`, `adminNotifyRequestReply`, `adminSmsStatus`.

The sender supplies this callback automatically:
`https://us-central1-silverforge-digital.cloudfunctions.net/adminSmsStatus?notificationId=<event-hash>`.
No manual outbound status-webhook setting is needed. Its HTTPS endpoint must be reachable by Twilio; the handler validates `X-Twilio-Signature` against that exact URL and the Auth Token before updating state. [Twilio webhook validation](https://www.twilio.com/docs/usage/webhooks/webhooks-security)

## Failure behavior and duplicate protection

History and a delivery reservation commit atomically before the external call. Twilio SDK retries are disabled. Repeated/concurrent processing of the same event finds the reservation and skips sending. Admin-origin messages are skipped before history/Twilio. Existing profile/quote updates do not trigger “new” alerts.

This provides **at most one provider attempt per event**, not guaranteed exactly-once delivery. A crash after reservation but before sending can leave history without SMS. A timeout may happen after Twilio accepted a text. Neither is automatically resent because that risks duplication. Inspect Twilio's logs before manual follow-up. Do not delete reservations as a retry mechanism. Firestore events may themselves arrive multiple times or out of order. [Firebase event semantics](https://firebase.google.com/docs/functions/firestore-events)

Delivery labels distinguish `attempting`, `accepted`, `queued`, `sending`, `sent` (to carrier), `delivered`, `undelivered`, `failed`, `canceled`, `unknown`, `not-configured`, `disabled`, and `simulated`. Accepted is not proof of handset delivery. Signed callbacks preserve terminal outcomes and reject mismatched message SIDs; old unfinished attempts display “Outcome unknown.”

Application failure logs contain only the notification ID, safe state and numeric Twilio error code. Raw Twilio exceptions, credentials, phone numbers and bodies are not logged or sent to public clients. A private delivery record stores the provider SID for troubleshooting.

```powershell
npx firebase functions:log --only adminNotifyQuote,adminNotifyContact,adminNotifyAccount,adminNotifyRequest,adminNotifyClientMessage,adminNotifyRequestReply,adminSmsStatus --project silverforge-digital
```

Check Twilio Console → Monitor / Logs → Messaging for actual delivery results. For browser `permission-denied`, check active admin role and published rules. For `failed-precondition`, inspect the actual index/configuration error. For `unavailable`, check connectivity; for `invalid-argument`, inspect schema/project settings. General Contact's existing detailed Firebase console diagnostics remain intact.

## Tests and first live SMS checklist

Validation covers 32 Firestore rule tests; desktop/mobile browser flows; server unit tests; and actual Functions/Firestore emulators for every event category. The emulator cannot invoke Twilio or read production secrets. Its runner creates inert ignored `.secret.local` overrides only if absent, then removes only that temporary file. Test submissions stay in `demo-silverforge`. A scoped `gaxios` → `uuid` override resolves the transitive UUID advisory while retaining the CommonJS API that gaxios uses.

After deploying rules/functions and publishing the website:

1. Sign in as the existing active admin. In **Notifications**, enable Text Message, Dashboard and New Contact Messages; save.
2. Submit one clearly labeled General Contact test with an address you control. Confirm the friendly success message and one saved contact in the support inbox.
3. Confirm one notification, its unread badge, and one SMS on your phone. Wait for the callback and compare status with Twilio Messaging Logs. Mark read and verify the badge decreases.
4. Submit a quote and a signed-in client request/message to check other routes. Choose an assigned project where applicable. Confirm activity links open the correct CRM record.
5. Reply as admin: no new admin SMS. Reply as client: an alert. Disable a category and submit one test: history remains with SMS disabled. Restore your settings.
6. For `unknown`, check Twilio before a new test; repeated submissions are not retries. Mark test history read and close test contacts as appropriate.

Real Twilio acceptance, carrier delivery, callback reachability and production IAM remain unverified until this checklist is completed with configured credentials.
