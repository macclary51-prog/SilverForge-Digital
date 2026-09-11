# SilverForge Digital Solutions

Official source repository for the SilverForge Digital Solutions website and private lead CRM.

## Website

The website is built with:

- HTML
- CSS
- JavaScript
- GitHub Pages
- Google Analytics
- Firebase Authentication
- Firebase Cloud Firestore

Custom domain:

`silverforgedigitalsolutions.com`

## Public pages

- `index.html` — Home
- `development.html` — App and website development
- `social-media.html` — Social media and content services
- `portfolio.html` — Selected work and future case studies
- `downloads.html` — SilverForge applications and software
- `about.html` — Business information
- `quote.html` — New-project quote form (public or signed in)
- `contact.html` — General contact form, separate from project quotes
- `support.html` — Support information
- `privacy.html` — Website and application privacy information
- `updates.html` — Development updates
- `screenshots.html` — Project visual previews

The old `projects.html` path redirects to `portfolio.html`.

## Client dashboard and support inbox

- `customer-account.html` retains profile, verification and password-reset controls and adds quote tracking, support requests and conversations.
- `crm-support.html` is the support/contact inbox. It checks the same `roles/{uid}` record as the Lead CRM: `role: "admin"` and `active: true`. Each CRM links to the other.
- Quotes write to `leads`; general messages write only to `contactMessages`; existing-client requests write to `supportTickets`, with immutable replies in each ticket's `messages` subcollection.
- Customer queries always include their authenticated UID. Public contact and quote records cannot be read by public visitors. Ticket ownership, status, priority and sender roles are enforced by rules, not just the interface.
- Ticket creation starts at `open` / `normal`. Only admins can set status and priority. Clients can reopen the conversation page and continue messaging even after resolution or closure; sending a message does not change ticket status.
- Message creation and ticket activity timestamps commit together. No support-message edits or deletions are allowed, including for administrators.
- General-contact email replies open the administrator's email app with `mailto:`. The administrator reviews and sends the email there.

### Quote privacy and compatibility

[Firestore reads return whole documents](https://firebase.google.com/docs/firestore/security/rules-fields). Existing leads contain private `internalNotes` and stored email drafts, so raw `leads` remain administrator-only. This intentionally uses a safer dashboard read path than direct customer access to `leads`.

`customerQuotes/{leadId}` is a customer-safe summary of the matching lead containing only `customerId`, `service`, `business`, `status`, `quoteAmount` and `createdAt`. The dashboard queries `customerId == auth.uid`. Rules verify each summary against the source lead using `getAfter`; the signed-in quote form and CRM commit the source and summary atomically. Customers cannot fabricate or alter summaries. Internal notes and communication history are never copied.

Signed-in quote submissions force `customerId` and email to the authenticated identity. Anonymous quotes store `customerId: null`. Previously stored leads without `customerId` remain visible and editable in the Lead CRM; no migration, deletion or email-based ownership assignment is performed. If an administrator later manually assigns an old lead to a client in the Firebase Console, create its matching safe summary too, or save that lead in the updated CRM to create the summary. Console edits bypass rules and must keep the summary synchronized.

### Firebase Console deployment steps

1. Open the existing **silverforge-digital** Firebase project. In **Firestore Database → Rules**, replace the rules with this repository's complete `firestore.rules` and publish. Alternatively, use `firebase deploy --only firestore:rules --project silverforge-digital` from this checkout after signing in to the Firebase CLI.
2. Release these website files through the existing GitHub Pages workflow together with the rules. Until the new rules are published, the new forms/dashboard cannot complete their Firestore operations. Old cached quote scripts may fail during the release; refresh the page. Do not leave the website and rules on different versions.
3. Retain the existing Email/Password sign-in provider, authorized website domains, Firebase config, customer profiles and active admin role. No new Firebase project, service account, password storage, Cloud Functions or billing-plan change is required.
4. Collections/subcollections are created automatically on the first valid submission. Queries use default single-field indexes (`customerId`, `ownerId`, and message `createdAt`); no composite indexes are required. Restore these default indexes if they were manually exempted.
5. After release, use two real client accounts and an admin account to repeat the smoke checks below. Emulator results do not establish that production rules or hosting have been deployed.

### Repeatable local checks

The site remains plain HTML/CSS/JS and needs no production build. The npm dependencies are development-only tests; browser code stays on Firebase **12.16.0**.

```sh
npm ci
# Java 21+ must be on PATH for the Firestore emulator.
# Tests use installed Microsoft Edge on Windows. Elsewhere, install Chromium:
# npx playwright install chromium
npm test
```

The test command uses the local `demo-silverforge` Auth/Firestore emulators. The browser test replaces Firebase config only in its test server and blocks production Auth/Firestore endpoints; it does not modify `firebase-config.js` or create production test users, quotes, contacts or tickets. Test accounts and email-verification links exist only inside the emulator. `npm run preview` starts a normal static preview on port 4173, which uses the existing production Firebase config; use `npm test` for isolated write testing.

Smoke checklist:

- Homepage, desktop/mobile navigation, quote/contact/support links and original branding.
- Customer signup, login, profile editing, sign-out, dashboard access gate and admin redirect to Lead CRM.
- Anonymous quote; signed-in quote with enforced UID/email; dashboard quote amount/status after an admin update.
- Bug Fix creation; client isolation; admin search/filter, status/priority changes and replies; client follow-up; reopen the conversation later.
- General contact creates no lead; admin reads it, opens its email link and closes it.
- Legacy leads without `customerId`, existing email templates/history, rules rejection of unauthorized access and message tampering, and no browser console/JS syntax errors.

## CRM

The website includes a private customer relationship management system for handling project inquiries.

CRM files:

- `crm-login.html`
- `crm-login.js`
- `crm.html`
- `crm.js`
- `crm.css`
- `firebase-config.js`
- `firestore.rules`

CRM features include:

- Email-and-password administrator sign-in
- Administrator role verification
- Real-time Firestore lead updates
- Lead search and status filtering
- Lead pipeline statuses
- Quote amounts
- Follow-up dates
- Internal notes
- Customer call and email links
- Lead deletion
- Summary statistics

## Lead pipeline

Supported lead statuses:

1. New
2. Contacted
3. Qualified
4. Quote Sent
5. Accepted
6. In Progress
7. Completed
8. Lost

## Firestore collections

### `leads`

Each project-request document contains:

```text
name
business
email
phone
service
message
status
quoteAmount
followUpDate
internalNotes
createdAt
updatedAt
customerId
```

`customerId` is the authenticated UID for signed-in submissions and `null` for anonymous submissions. Legacy leads may omit it. Existing administrator email fields and the `communications` subcollection are retained.

## Client workspaces and direct messages

In **Created accounts**, use **Open Client** to open the large workspace in the Lead CRM. Its Overview, Projects, Messages, Support, Private Notes and Activity tabs use the Firestore user document ID as the client UID. Search, role filtering, desktop tables and mobile cards remain available. Active project counts include accepted and in-progress work; open support includes open, in-review and working requests.

- `client-workspace.js` connects the existing accounts, leads, support inbox and private notes. Project cards open the existing lead editor. Support links open the existing conversation and provide a return link to the client workspace.
- `client-messages.js` provides direct website conversations, recipient read receipts and email drafts for the CRM and customer dashboard. This is separate from support tickets and general contact.
- `client-workspace.css` extends the current CRM and portal styling.

### Explicit project ownership

The lead editor offers **Link Project to Client** and **Unlink Client** with confirmation. No background matching by email occurs. Linking/relinking changes only `customerId` and `updatedAt`, and writes the exact `quote-summary.js` allowlist into `customerQuotes` in the same transaction. Unlinking deletes that projection in the transaction, revoking dashboard access while preserving the original lead and its private notes/email history. Customers still cannot read raw leads.

### Conversation storage and security

`clientConversations/{clientUid}` contains `clientId`, `clientName`, `clientEmail`, `createdAt`, `updatedAt`, `lastMessageAt`, `lastMessagePreview`, `lastSenderRole` and `lastMessageId`. It also stores `lastCustomerMessageAt`, `lastAdminMessageAt`, `adminReadAt` and `clientReadAt` for account-list unread indicators. The preview retains the message text, bounded to 5,000 characters; UI previews truncate it.

`clientConversations/{clientUid}/messages/{messageId}` contains `senderId`, `senderRole`, `senderName`, `message`, `createdAt`, `readByAdmin` and `readByClient`. Rules require messages and matching metadata to be written atomically. Transactions preserve concurrent messages and read state. Each customer can get only their own parent document and list only its messages; parent collection queries are admin-only. Sender ID/role/name are validated against Auth and the account profile. Message content and history cannot be edited or deleted. The recipient alone can change their read flag to true. Read timestamps move forward only as far as the latest incoming message; opening a conversation marks the loaded incoming messages read.

Unread counts in the selected workspace/dashboard are exact message counts. The Created Accounts list uses a **New** indicator derived from conversation timestamps. Direct message history is loaded only for the selected client; the CRM subscribes to conversation metadata for account indicators. No collection-group query, extra index, paid backend or migration is required. Very large histories may eventually benefit from pagination.

### Private notes and activity

`users/{clientUid}/adminNotes/{noteId}` contains `text`, `createdAt`, `updatedAt`, `createdBy` and `createdByEmail`. Only an active `roles/{uid}` administrator can read or perform CRUD. Edits preserve original author/time. These notes never enter customer messages, quotes, emails or the customer dashboard.

Activity is an admin-only view assembled from existing timestamps. It shows account creation, project submissions/latest updates, marked-sent lead emails, support creation/latest updates, website messages and note creation/edits. It does not claim historical status transitions or retain deleted-note events.

### Email behavior

**Send Email** opens a `mailto:` draft using the account profile email and current composer text. **Send Website + Email** first awaits the website message transaction, then opens an identical draft. A failed website save keeps the text and opens no email. Missing or invalid account email disables email actions and explains why. The email application must be configured on the administrator's device; the administrator sends the draft there. Email opening/delivery is not confirmed by the website, and no SMTP credentials, mail API secrets or server keys are used. Existing lead email templates and marked-sent history are unchanged.

### Validation and deployment

`npm test` includes 28 Firestore security tests and browser flows for the existing portal plus workspace selection, scoped projects/support, direct messaging, unread/read state, email-only and combined drafts, rejected-save handling, private note CRUD, confirmed legacy linking/unlinking and desktop/mobile layouts. Email-launch tests intercept `mailto:` links and inspect their contents without sending email or opening a real mail application. All test data stays in `demo-silverforge` emulators.

Verify the Firebase project is **silverforge-digital** (project number **684696359962**) before deploying rules. This checkout has no `.firebaserc`; explicitly pin the existing project:

```powershell
firebase deploy --only firestore:rules --project silverforge-digital --non-interactive
```

Deploy no other Firebase services for this feature. If CLI authentication is missing, publish the repository's complete `firestore.rules` in Firebase Console → Firestore Database → Rules instead. Website files use the existing GitHub Pages release process.

The atomic-write design follows Firebase's [transaction guidance](https://firebase.google.com/docs/firestore/manage-data/transactions) and [rule validation using getAfter](https://firebase.google.com/docs/firestore/security/rules-conditions).
