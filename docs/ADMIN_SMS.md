# Administrator SMS alerts

The owner reports that `silverforge-digital` is now on Blaze. This change adds real Twilio Programmable Messaging transport to five Firebase Functions v2 create triggers using the existing Node 22 `admin-alerts` codebase. Secrets and live deployment are still required. No real SMS or production deployment was performed during implementation.

| Export | Document creation | SMS summary |
| --- | --- | --- |
| `notifyNewQuote` | `leads/{leadId}` | Name, business, service; anonymous and signed-in submissions |
| `notifyNewContact` | `contactMessages/{messageId}` | Name, category, short subject |
| `notifyNewSupportTicket` | `supportTickets/{ticketId}` | Owner name, request type, project name |
| `notifyNewClientMessage` | `clientConversations/{clientUid}/messages/{messageId}` | Customer sender name and at most 42 characters of preview |
| `notifyNewSupportReply` | `supportTickets/{ticketId}/messages/{messageId}` | Customer sender name and the parent ticket's short title |

Messages/replies require exactly `senderRole == "customer"`. Trusted admin actors, system and service-account writes are skipped using the existing role checker and event authentication context. Updates, read receipts, conversation parent writes and quote-summary projections do not send SMS. Ticket creation does not create an extra message. Existing FCM/history functions stay unchanged; SMS operates independently of the push/dashboard category preferences. There is no public HTTP/callable SMS endpoint or browser SMS setting.

## Twilio setup

1. Use a Twilio account with an SMS-capable Twilio number and sufficient account balance. Use the **live** Account SID and Auth Token from that account; test credentials cannot deliver real messages.
2. Complete the sender's required registration: for a US local number, register [A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc) and associate the number with the approved campaign/Messaging Service. For a US/Canada toll-free sender, complete [toll-free verification](https://www.twilio.com/docs/messaging/compliance/toll-free/api-onboarding). This integration uses the registered number as `from`; it does not need another Messaging Service SID secret.
3. Enable the administrator's destination country in Messaging Geographic Permissions. If using a trial, verify the recipient and satisfy [trial restrictions](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account).
4. Format both numbers as E.164 (`+` followed by country code and number, without spaces). `TWILIO_FROM_NUMBER` is the Twilio sender; `ADMIN_SMS_NUMBER` is the administrator's receiving phone. Neither belongs in Firestore or website configuration.

## Configure and deploy only Functions

From the repository root, on Node 22 with the Firebase CLI installed:

```powershell
npm ci
npm --prefix functions ci
firebase login
firebase use silverforge-digital
firebase functions:list --project silverforge-digital

firebase functions:secrets:set TWILIO_ACCOUNT_SID --project silverforge-digital
firebase functions:secrets:set TWILIO_AUTH_TOKEN --project silverforge-digital
firebase functions:secrets:set TWILIO_FROM_NUMBER --project silverforge-digital
firebase functions:secrets:set ADMIN_SMS_NUMBER --project silverforge-digital

npm --prefix functions run build
firebase deploy --only functions --project silverforge-digital
```

Enter each secret only into the CLI's interactive prompt. Do not pass values as shell arguments, paste them into chat, save them in GitHub, put them in Firestore, commit `.env` files, or download service-account credentials. The four `defineSecret()` parameters are bound only to the five SMS functions and read only at invocation time. Firebase provisions their Secret Manager access during deployment. After changing a secret version, redeploy Functions.

`.firebaserc` pins the default project, and the existing predeploy script rejects another `GCLOUD_PROJECT`. Explicit `--project silverforge-digital` remains recommended. The existing `firebase.json` already specifies `functions`, codebase `admin-alerts`, Node 22, and build/project checks; no hosting change is needed. The command above deploys the five new SMS exports **and the six existing FCM exports**. Inspect the function inventory for any independently deployed legacy SMS sender on these paths before deployment; this implementation cannot deduplicate sends from unrelated old code. No unrelated resources should be removed.

The unchanged Firestore rules already deny client access to `_smsDeliveries` via their default-deny rule. No rules or hosting deployment is required for this change. Existing public Firebase configuration is preserved; it contains no Twilio secrets.

## Duplicate prevention and failure behavior

[Firestore events can arrive more than once](https://firebase.google.com/docs/functions/firestore-events). Before contacting Twilio, a transaction creates `_smsDeliveries/{sha256}` using the event kind, source document path and immutable snapshot creation timestamp. This handles concurrent delivery, process restarts and different event IDs for the same creation. A later deletion/recreation is a different creation. The record stores event/document IDs, timestamps, attempt status, and (on acceptance) the Twilio message SID. It stores no message body, credentials or phone numbers. No trigger watches this collection, and reservations must not be deleted or assigned a TTL.

This implements **at most one application send attempt**, not guaranteed exactly-once delivery. Event retries and Twilio SDK retries are disabled. A crash after reservation but before sending can lose an alert; a timeout may mean Twilio accepted it. Neither case is automatically resent. A failed status write leaves the reservation intact. Carrier delivery itself is outside this application's control. Do not delete a reservation to retry an uncertain send.

Statuses: `attempting` (reserved or interrupted), `accepted` (Twilio accepted; not proof of delivery), `failed` (explicit 4xx rejection), `unknown` (timeout/5xx/configuration or other ambiguous failure), and `simulated` (emulator only). Check Twilio Messaging Logs using the message SID to confirm delivery or diagnose carrier errors. There is no webhook or callback in this change.

```powershell
firebase functions:log --only notifyNewQuote,notifyNewContact,notifyNewSupportTicket,notifyNewClientMessage,notifyNewSupportReply --project silverforge-digital
```

Cloud logs identify event type, source document ID and event ID; Twilio failures include numeric error code and HTTP status when available. Raw exceptions, request objects, credentials, phone numbers and message bodies are never logged by this code. Missing secrets are handled by Firebase at deployment/startup; malformed configured values or preparation failures require checking the secret configuration and corresponding event log. Website writes commit before the trigger runs, so an SMS failure cannot roll them back or block submission success.

Messages use fixed field budgets and a conservative GSM character set, at most 160 characters before any provider-added trial prefix. Accents are transliterated and unsupported characters replaced. Full quote/contact/support bodies and private notes are excluded. A direct-message preview is omitted when common credential, token or URL patterns are detected; this is best-effort detection, not a guarantee that arbitrary customer prose contains no sensitive information.

The current Firestore validation and authentication remain in force. Only server event handlers read secrets. `maxInstances: 3` limits simultaneous workers, **not total SMS spending**. Public, rule-valid quote/contact submissions can still generate alerts; this change does not claim to introduce a spam filter or per-user rate limiter. Monitor Twilio usage and Firebase billing.

## Automated and live checks

```powershell
npm run check
npm --prefix functions run build
npm --prefix functions test
# Java 21+ on PATH; these use only demo-silverforge emulators.
npm test
npm run test:notifications
```

The emulator bypasses secret reads and the Twilio network transport. Automated tests cover real create triggers, signed-in and anonymous quote writes, contact/support/customer messages, zero sends for admin messages/replies, existing rules, concurrent deduplication against real Firestore transactions, restart behavior, safe error logging, persistence failures and injected Twilio rejections/timeouts. The full existing website, CRM, customer-dashboard and push/PWA regression suite runs separately with isolated demo data.

After deploying, perform these checks on the real website using non-sensitive test content:

| Action | Expected administrator SMS |
| --- | --- |
| Submit one anonymous quote | 1 |
| Submit one signed-in quote | 1 |
| Submit one general contact | 1 |
| Create one support ticket | 1 |
| Send one customer direct message | 1 |
| Send one admin direct message | 0 |
| Send one customer support reply | 1 |
| Send one admin support reply | 0 |
| Update status/read receipts, refresh, reopen conversations | 0 additional |

For each positive check, match the source document to a single reservation and Twilio message SID; confirm actual receipt on the administrator phone. Verify original website records after every action. Automated tests inject provider failures without touching live secrets; do not deliberately break production credentials to repeat them. Until these live checks pass, report SMS as implemented and locally tested, not verified delivered.

Implementation references: [Firebase secret configuration](https://firebase.google.com/docs/functions/config-env), [supported Node runtimes](https://firebase.google.com/docs/functions/manage-functions), [Twilio Node SDK and retry options](https://github.com/twilio/twilio-node).
