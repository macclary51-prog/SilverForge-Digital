import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import { startPreview } from './preview.mjs';

// Test-only server replacement. The production config is never edited or loaded.
const config = `
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
export const app = initializeApp({ projectId: 'demo-silverforge', apiKey: 'demo-key', authDomain: 'demo-silverforge.firebaseapp.com' });
export const auth = getAuth(app); export const db = getFirestore(app); export const isFirebaseConfigured = true;
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectFirestoreEmulator(db, '127.0.0.1', 8080);
`;
const base = 'http://127.0.0.1:4174';
const env = await initializeTestEnvironment({ projectId: 'demo-silverforge', firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-silverforge/accounts', { method: 'DELETE' });
const password = 'Local-Test-Password-42';
const adminEmail = 'admin-browser@example.com';
const signUpResult = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: adminEmail, password, returnSecureToken: true }) });
const seededAdmin = await signUpResult.json(); assert.ok(seededAdmin.localId, JSON.stringify(seededAdmin));
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'roles', seededAdmin.localId), { role: 'admin', active: true });
  await setDoc(doc(db, 'leads', 'legacy-browser'), { name: 'Legacy Fixture', business: 'Legacy Business', email: 'legacy@example.com', phone: '7025550100', service: 'Website Development', message: 'Legacy project', status: 'new', quoteAmount: null, followUpDate: '', internalNotes: 'Private legacy note', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
});
const adminDb = env.authenticatedContext(seededAdmin.localId, { email: adminEmail }).firestore();
const server = await startPreview(4174, new Map([['/firebase-config.js', config]]));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const failures = [];
const successes = [];
successes.push = function (...items) { items.forEach(item => console.log(`PASS ${item}`)); return Array.prototype.push.apply(this, items); };
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
async function pageFor(viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  await context.route('https://www.googletagmanager.com/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  // Any accidental production data/auth request is rejected, never sent.
  await context.route(/https:\/\/(firestore|identitytoolkit|securetoken)\.googleapis\.com\//, route => { failures.push(`Production endpoint requested: ${route.request().url()}`); return route.abort(); });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', event => { if (event.type() === 'error') failures.push(event.text()); });
  return page;
}
async function hasText(page, selector, text) {
  try {
    await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text }, { timeout: 25000 });
  } catch (error) {
    await page.screenshot({ path: 'test-results/failure.png', fullPage: true });
    throw new Error(`${selector}: expected ${JSON.stringify(text)}, got ${JSON.stringify(await page.locator(selector).textContent())}`, { cause: error });
  }
}
async function signup(page, name, email) {
  await page.goto(`${base}/customer-signup.html`);
  await page.locator('[name="name"]').fill(name); await page.locator('[name="business"]').fill(`${name} Business`);
  await page.locator('[name="email"]').fill(email); await page.locator('[name="password"]').fill(password); await page.locator('[name="passwordConfirm"]').fill(password);
  await page.locator('#customerSignupButton').click(); await page.waitForURL('**/customer-account.html'); await page.locator('#customerAccountApp').waitFor({ state: 'visible' });
}
async function quoteForm(page, who) {
  await page.goto(`${base}/quote.html`);
  await page.locator('#name').fill(who); await page.locator('#business').fill(`${who} Business`);
  if (!(await page.locator('#email').getAttribute('readonly'))) {
    if (!(await page.locator('#email').evaluate(el => el.readOnly))) await page.locator('#email').fill(`${who.toLowerCase()}@example.com`);
  }
  await page.locator('#phone').fill('7025550100'); await page.locator('#service').selectOption('Website Development'); await page.locator('#message').fill('A brand-new website project.');
  await page.locator('#quoteForm button[type="submit"]').click(); await hasText(page, '#formMessage', 'sent successfully');
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${page.url()}`);
}
try {
  const publicPage = await pageFor();
  await publicPage.goto(base); await publicPage.locator('.home-hero').waitFor();
  assert.deepEqual(await publicPage.locator('#navigation a').allTextContents().then(items => items.map(x => x.trim())), ['Home','Development','Social Media','Portfolio','Our Apps','About','Contact','Client Login','Request a Quote']);
  assert.equal(await publicPage.locator('#navigation .quote-button').getAttribute('href'), 'quote.html'); await noOverflow(publicPage);
  await publicPage.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.locator('#menuButton').click(); assert.equal(await publicPage.locator('#menuButton').getAttribute('aria-expanded'), 'true');
  await publicPage.locator('#navigation a[href="contact.html"]').click(); await publicPage.waitForURL('**/contact.html'); await noOverflow(publicPage);
  successes.push('Homepage preserved; exact navigation and mobile menu work without overflow.');

  const beforeContacts = (await getDocs(collection(adminDb, 'leads'))).size;
  await publicPage.locator('#name').fill('General Visitor'); await publicPage.locator('#email').fill('visitor@example.com');
  await publicPage.locator('#category').selectOption('Billing Question'); await publicPage.locator('#subject').fill('Billing question'); await publicPage.locator('#message').fill('Please explain my service invoice.');
  await publicPage.locator('#generalContactForm button[type="submit"]').click(); await hasText(publicPage, '#formMessage', 'has been sent');
  assert.equal((await getDocs(collection(adminDb, 'contactMessages'))).size, 1);
  assert.equal((await getDocs(collection(adminDb, 'leads'))).size, beforeContacts);
  await quoteForm(publicPage, 'Visitor');
  const anonymousLead = (await getDocs(collection(adminDb, 'leads'))).docs.find(d => d.data().name === 'Visitor').data(); assert.equal(anonymousLead.customerId, null);
  successes.push('General contact creates contactMessages only; anonymous quote creates an unowned lead.');

  const client = await pageFor(); await signup(client, 'Alice', 'alice-browser@example.com');
  await hasText(client, '#myTicketsStatus', 'No support requests');
  await client.locator('#accountName').fill('Alice Updated'); await client.locator('#updateProfileButton').click(); await hasText(client, '#customerProfileStatus', 'Profile updated');
  await client.locator('#customerSignOutButton').click(); await client.waitForURL('**/customer-login.html');
  await client.locator('[name="email"]').fill('alice-browser@example.com'); await client.locator('[name="password"]').fill(password); await client.locator('#customerLoginButton').click();
  await client.waitForURL('**/customer-account.html'); await client.locator('#customerAccountApp').waitFor({ state: 'visible' });
  successes.push('Customer signup, profile update, sign-out and password sign-in still work.');

  await quoteForm(client, 'Alice');
  assert.equal(await client.locator('#email').inputValue(), 'alice-browser@example.com'); assert.ok(await client.locator('#email').evaluate(el => el.readOnly));
  const aliceLead = (await getDocs(collection(adminDb, 'leads'))).docs.find(d => d.data().name === 'Alice'); assert.ok(aliceLead.data().customerId);
  await client.goto(`${base}/customer-account.html`); await hasText(client, '#myQuotes', 'Alice Business'); assert.equal(await client.locator('#myQuotesCount').textContent(), '1');
  await client.locator('#type').selectOption('bug-fix'); await client.locator('#projectName').fill('Alice Website'); await client.locator('#title').fill('Save button is broken'); await client.locator('#details').fill('Clicking Save has no effect.');
  await client.locator('#newTicketForm button[type="submit"]').click(); await hasText(client, '#newTicketStatus', 'Support request created');
  await client.locator('#ticketDetail').waitFor({ state: 'visible' }); await client.locator('#ticketReply').fill('It fails on the contact screen.'); await client.locator('#ticketReplyForm button').click(); await hasText(client, '#ticketMessageStatus', 'Message sent');
  successes.push('Signed-in quote uses account UID/email and appears in dashboard; Bug Fix request and customer message work.');

  const other = await pageFor(); await signup(other, 'Bob', 'bob-browser@example.com'); await hasText(other, '#myTicketsStatus', 'No support requests'); await hasText(other, '#myQuotesStatus', 'No quotes yet');
  assert.equal(await other.locator('#myTickets .portal-record').count(), 0); assert.equal(await other.locator('#myQuotes .portal-record').count(), 0);

  const admin = await pageFor(); await admin.goto(`${base}/customer-login.html`); await admin.locator('[name="email"]').fill(adminEmail); await admin.locator('[name="password"]').fill(password); await admin.locator('#customerLoginButton').click();
  await admin.waitForURL('**/crm.html'); await hasText(admin, '#leadList', 'Legacy Fixture');
  await admin.locator('#leadSearch').fill('Alice'); await admin.locator('#leadList button').first().click();
  await admin.locator('#leadStatus').selectOption('quote-sent'); await admin.locator('#quoteAmount').fill('2400'); await admin.locator('#internalNotes').fill('Private admin note never visible to customer.'); await admin.locator('#updateLeadButton').click(); await hasText(admin, '#leadFormStatus', 'updated successfully');
  await hasText(client, '#myQuotes', '$2,400.00'); assert.ok(!(await client.locator('body').textContent()).includes('Private admin note'));
  // Exercise existing template and immutable email history without opening an email client.
  await admin.locator('#emailTemplate').selectOption('initial-response'); await admin.locator('#generateEmailButton').click();
  admin.once('dialog', dialog => dialog.accept());
  await admin.locator('#markEmailSentButton').click(); await hasText(admin, '#communicationHistory', 'Initial Response');
  await admin.locator('#closeLeadDialog').click(); await admin.locator('a[href="crm-support.html"]').click(); await admin.locator('#supportApp').waitFor({ state: 'visible' });
  await hasText(admin, '#supportList', 'Save button is broken'); await admin.locator('#ticketSearch').fill('Alice Website'); await admin.locator('#supportList button').click();
  await admin.locator('#ticketStatus').selectOption('working'); await admin.locator('#ticketPriority').selectOption('high'); await admin.locator('#ticketAdminForm button').click(); await hasText(admin, '#ticketAdminStatus', 'Request updated');
  await admin.locator('#ticketReply').fill('SilverForge: We are working on your fix. <script>alert("x")</script>'); await admin.locator('#ticketReplyForm button').click(); await hasText(admin, '#ticketMessageStatus', 'Message sent');
  await hasText(client, '#ticketMessages', 'We are working on your fix.'); await hasText(client, '#ticketDetailMeta', 'Working');
  assert.equal(await client.locator('#ticketMessages script').count(), 0);
  await client.locator('#ticketReply').fill('Thank you. It also happens on mobile.'); await client.locator('#ticketReplyForm button').click(); await hasText(admin, '#ticketMessages', 'also happens on mobile');
  successes.push('Admin redirects to Lead CRM; legacy lead, quote updates, template/history and private-note protection pass.');
  successes.push('Admin finds ticket, changes status/priority and replies; customer sees reply and admin receives follow-up in real time.');

  await admin.locator('#ticketStatus').selectOption('resolved'); await admin.locator('#ticketAdminForm button').click(); await hasText(client, '#resolvedTicketsCount', '1');
  await client.reload(); await hasText(client, '#myTickets', 'Save button is broken'); await client.locator('#myTickets button').click(); await hasText(client, '#ticketMessages', 'also happens on mobile');
  await client.locator('#ticketReply').fill('I reopened this conversation later.'); await client.locator('#ticketReplyForm button').click(); await hasText(admin, '#ticketMessages', 'reopened this conversation later');
  await noOverflow(client); await client.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await client.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await client.setViewportSize({ width: 390, height: 844 }); await noOverflow(client); await client.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await client.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await admin.locator('#contactList button').click(); await hasText(admin, '#contactBody', 'explain my service invoice'); assert.ok((await admin.locator('#contactEmail').getAttribute('href')).startsWith('mailto:visitor%40example.com?subject='));
  await admin.locator('#closeContactMessage').click(); await hasText(admin, '#contactActionStatus', 'marked closed');
  await admin.locator('#ticketFilter').selectOption('open'); await hasText(admin, '#supportListStatus', 'No support requests match');
  await admin.locator('#ticketFilter').selectOption('resolved'); await hasText(admin, '#supportList', 'Save button is broken');
  await admin.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await admin.screenshot({ path: 'test-results/admin-support.png', fullPage: true });
  await admin.setViewportSize({ width: 390, height: 844 }); await noOverflow(admin);
  successes.push('Resolved counts, reopening conversations, mailto replies, closing contacts and responsive dashboards pass.');

  await other.locator('#projectName').fill('Bob Website'); await other.locator('#title').fill('Bob private support'); await other.locator('#details').fill('Only Bob can see this ticket.');
  await other.locator('#newTicketForm button[type="submit"]').click(); await hasText(other, '#newTicketStatus', 'Support request created');
  await quoteForm(other, 'Bob');
  await admin.setViewportSize({ width: 1440, height: 1000 }); await admin.goto(`${base}/crm.html`);
  await hasText(admin, '#accountTableBody', 'Alice Updated');
  await admin.locator('#accountSearch').fill('Alice'); await admin.locator('#accountRoleFilter').selectOption('customer');
  assert.equal(await admin.locator('#accountTableBody tr').count(), 1);
  await admin.locator('#accountTableBody button').click(); await admin.locator('#clientWorkspace').waitFor({ state: 'visible' });
  await hasText(admin, '#clientWorkspaceTitle', 'Alice Updated'); await hasText(admin, '#clientProfile', aliceLead.data().customerId);
  await admin.locator('#clientTab-projects').click(); await hasText(admin, '#clientPanel-projects', 'Alice Business');
  assert.ok(!(await admin.locator('#clientPanel-projects').textContent()).includes('Bob Business'));
  assert.equal(await admin.locator('#clientPanel-projects .client-project').count(), 1);
  await admin.locator('#clientPanel-projects button').click(); await hasText(admin, '#leadDialogTitle', 'Alice');
  await admin.locator('#closeLeadDialog').click(); assert.ok(await admin.locator('#clientWorkspace').isVisible());
  await admin.locator('#clientTab-support').click(); await hasText(admin, '#clientPanel-support', 'Save button is broken');
  await hasText(admin, '#clientPanel-support', 'I reopened this conversation later.');
  assert.ok(!(await admin.locator('#clientPanel-support').textContent()).includes('Bob private support'));
  await admin.locator('#clientPanel-support a').click(); await hasText(admin, '#ticketDetailTitle', 'Save button is broken');
  await admin.getByRole('link', { name: 'Back to Client Workspace' }).click(); await hasText(admin, '#clientWorkspaceTitle', 'Alice Updated');
  successes.push('Created Accounts search/filter and Open Client use the correct UID; project editor and support conversation reuse existing views with return navigation.');

  await admin.locator('#clientTab-messages').click(); await admin.locator('#clientMessageText').fill('Your homepage is ready for review.');
  await admin.locator('#clientMessageForm button[type="submit"]').click(); await hasText(admin, '#clientSendStatus', 'Website message sent');
  await hasText(client, '#clientUnreadCount', '1'); await client.locator('#toggleClientMessages').click();
  await hasText(client, '#dashboardMessageList', 'Your homepage is ready for review.'); await hasText(client, '#clientUnreadCount', '0'); await hasText(admin, '#clientMessages', 'Read');
  await admin.locator('#clientTab-overview').click();
  await client.locator('#dashboardMessageText').fill('Can we update the homepage heading? <script>alert("x")</script>');
  await client.locator('#dashboardMessageForm button[type="submit"]').click(); await hasText(client, '#dashboardSendStatus', 'Website message sent');
  await hasText(admin, '#accountTableBody', 'New'); await hasText(admin, '#clientTabUnread', '1 unread');
  await admin.locator('#clientTab-messages').click(); await hasText(admin, '#clientMessages', 'update the homepage heading');
  await admin.waitForFunction(() => !document.querySelector('#clientTabUnread').textContent.includes('unread'));
  assert.equal(await admin.locator('#clientMessages script').count(), 0); await hasText(client, '#dashboardMessageList', 'Read');
  assert.ok(!(await other.locator('body').textContent()).includes('homepage heading'));
  successes.push('Website messages and replies arrive live; dashboard, account list and workspace unread indicators clear on opening, with safe text rendering and read receipts.');

  await admin.evaluate(() => {
    window.testMailDrafts = [];
    document.addEventListener('click', event => { const link = event.target.closest('a[href^="mailto:"]'); if (link) { event.preventDefault(); window.testMailDrafts.push(link.href); } }, true);
  });
  const directPath = ['clientConversations', aliceLead.data().customerId, 'messages'];
  const messageCount = (await getDocs(collection(adminDb, ...directPath))).size;
  const emailText = 'Review notes & next steps\nUse our current homepage.';
  await admin.locator('#clientMessageText').fill(emailText); await admin.locator('#clientSendEmail').click(); await hasText(admin, '#clientSendStatus', 'Email draft opened');
  assert.equal((await getDocs(collection(adminDb, ...directPath))).size, messageCount);
  let mail = new URL(await admin.evaluate(() => window.testMailDrafts.at(-1)));
  assert.equal(decodeURIComponent(mail.pathname), 'alice-browser@example.com'); assert.equal(mail.searchParams.get('body'), emailText);
  await admin.locator('#clientSendBoth').click(); await hasText(admin, '#clientSendStatus', 'Website message saved');
  assert.equal((await getDocs(collection(adminDb, ...directPath))).size, messageCount + 1);
  assert.equal(new URL(await admin.evaluate(() => window.testMailDrafts.at(-1))).searchParams.get('body'), emailText);
  await hasText(client, '#dashboardMessageList', 'Review notes & next steps');
  // Inject a denied commit at the emulator boundary; no email draft may open after failure.
  const mailCount = await admin.evaluate(() => window.testMailDrafts.length);
  const beforeExpectedFailure = failures.length;
  let deniedCommits = 0;
  const commitUrl = /127\.0\.0\.1:8080\/.*documents:commit/;
  await admin.route(commitUrl, route => {
    deniedCommits++;
    return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Test-only denied message save' } }) });
  });
  await admin.locator('#clientMessageText').fill('Preserve this text after a failed save.'); await admin.locator('#clientSendBoth').click(); await hasText(admin, '#clientSendStatus', 'Message could not be sent');
  assert.equal(await admin.evaluate(() => window.testMailDrafts.length), mailCount); assert.equal(await admin.locator('#clientMessageText').inputValue(), 'Preserve this text after a failed save.');
  assert.ok(deniedCommits > 0, 'The test must actually deny a website commit');
  const expectedErrors = failures.splice(beforeExpectedFailure);
  assert.ok(expectedErrors.some(text => text.startsWith('Client message action failed:')));
  assert.ok(expectedErrors.every(text => text.startsWith('Client message action failed:') || text.includes('403') || text.includes('Test-only denied message save')), JSON.stringify(expectedErrors));
  await admin.unroute(commitUrl);
  successes.push('Email-only opens an encoded account-email draft without writing a website message; Website + Email saves the same text first; failed website saves retain text and never open email.');

  await admin.locator('#clientTab-notes').click(); await admin.locator('#clientNoteText').fill('PRIVATE: Prefers a callback Friday.'); await admin.locator('#clientSaveNote').click(); await hasText(admin, '#clientNoteStatus', 'Private note saved');
  await hasText(admin, '#clientNotesList', 'callback Friday');
  assert.ok(!(await client.locator('body').textContent()).includes('PRIVATE:')); assert.ok(!(await admin.locator('#clientMessages').textContent()).includes('PRIVATE:'));
  await admin.locator('#clientNotesList').getByRole('button', { name: 'Edit Note' }).click(); await admin.locator('#clientNoteText').fill('PRIVATE: Callback moved to Monday.'); await admin.locator('#clientSaveNote').click(); await hasText(admin, '#clientNotesList', 'moved to Monday');
  await admin.locator('#clientTab-activity').click(); await hasText(admin, '#clientPanel-activity', 'Private note added'); await hasText(admin, '#clientPanel-activity', 'Website message received');
  await admin.screenshot({ path: 'test-results/client-workspace-activity.png', fullPage: true });
  await admin.locator('#clientTab-notes').click(); admin.once('dialog', dialog => dialog.accept()); await admin.locator('#clientNotesList').getByRole('button', { name: 'Delete Note' }).click(); await hasText(admin, '#clientNoteStatus', 'Note deleted');
  assert.equal((await getDocs(collection(adminDb, 'users', aliceLead.data().customerId, 'adminNotes'))).size, 0);
  successes.push('Private notes can be added, edited and deleted with attribution; private notes never enter customer HTML or portal messages; activity shows available account/project/support/message/note events.');

  await admin.locator('#closeClientWorkspace').click(); await admin.locator('#leadSearch').fill('Legacy Fixture'); await admin.locator('#leadList button').click();
  await hasText(admin, '#leadClientCurrent', 'No client account linked');
  await admin.locator('#leadClientSelect').selectOption(aliceLead.data().customerId);
  admin.once('dialog', dialog => dialog.dismiss()); await admin.locator('#linkLeadClient').click();
  assert.ok(!(await getDoc(doc(adminDb, 'leads', 'legacy-browser'))).data().customerId);
  admin.once('dialog', dialog => dialog.accept()); await admin.locator('#linkLeadClient').click(); await hasText(admin, '#leadClientStatus', 'Project linked');
  await hasText(client, '#myQuotes', 'Legacy Business'); assert.ok(!(await client.locator('body').textContent()).includes('Private legacy note'));
  admin.once('dialog', dialog => dialog.accept()); await admin.locator('#unlinkLeadClient').click(); await hasText(admin, '#leadClientStatus', 'Client unlinked');
  await client.waitForFunction(() => !document.querySelector('#myQuotes').textContent.includes('Legacy Business'));
  assert.equal((await getDoc(doc(adminDb, 'leads', 'legacy-browser'))).data().internalNotes, 'Private legacy note');
  await admin.locator('#closeLeadDialog').click();
  successes.push('Legacy leads are never matched by email; Link Project requires confirmation and atomically publishes a safe summary; Unlink removes client visibility and preserves the original lead.');

  await admin.locator('#accountSearch').fill('Alice'); await admin.locator('#accountTableBody button').click(); await admin.locator('#clientTab-overview').click(); await noOverflow(admin);
  await admin.screenshot({ path: 'test-results/client-workspace-desktop.png', fullPage: true });
  await admin.setViewportSize({ width: 390, height: 844 }); await noOverflow(admin);
  assert.ok(await admin.locator('#clientWorkspace').evaluate(node => node.scrollWidth <= node.clientWidth));
  await admin.screenshot({ path: 'test-results/client-workspace-mobile.png', fullPage: true });
  await admin.locator('#closeClientWorkspace').click(); await admin.locator('#accountCardList button').click(); await hasText(admin, '#clientWorkspaceTitle', 'Alice Updated');
  await admin.locator('#closeClientWorkspace').click();
  // Missing account email must never be guessed from a lead or another account.
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users', 'missing-email'), { uid: 'missing-email', name: 'Missing Email', business: '', email: '', role: 'customer', status: 'active', createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
  await admin.locator('#accountSearch').fill('Missing Email'); await hasText(admin, '#accountCardList', 'Missing Email'); await admin.locator('#accountCardList button').click();
  await hasText(admin, '#clientEmailWarning', 'No valid customer email is available.'); await admin.locator('#clientTab-messages').click();
  assert.ok(await admin.locator('#clientSendEmail').isDisabled()); assert.ok(await admin.locator('#clientSendBoth').isDisabled());
  await admin.locator('#closeClientWorkspace').click();
  successes.push('Desktop table and 390px mobile cards/workspace fit their viewports; missing-email clients have disabled email actions with the required explanation.');

  await other.goto(`${base}/crm-support.html`); await other.waitForURL('**/crm-login.html?reason=unauthorized');
  const signedOut = await pageFor(); await signedOut.goto(`${base}/customer-account.html`); await signedOut.waitForURL('**/customer-login.html');
  successes.push('Customer support inbox access and unauthenticated dashboard access are blocked.');
  const directAdmin = await pageFor(); await directAdmin.goto(`${base}/crm-login.html`);
  await directAdmin.locator('#loginEmail').fill(adminEmail); await directAdmin.locator('#loginPassword').fill(password); await directAdmin.locator('#loginButton').click();
  await directAdmin.waitForURL('**/crm.html'); await directAdmin.locator('#crmApp').waitFor({ state: 'visible' });
  await directAdmin.locator('a[href="crm-support.html"]').click(); await directAdmin.locator('#supportApp').waitFor({ state: 'visible' });
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'roles', seededAdmin.localId), { role: 'admin', active: false }));
  await directAdmin.waitForURL('**/crm-login.html?reason=unauthorized');
  successes.push('Original admin login and status filters work; revoking the admin role removes inbox access.');
  assert.deepEqual(failures, [], 'Unexpected browser errors or production requests');
  successes.push('No JavaScript console errors, uncaught errors or production data requests in tested flows.');
  console.log(successes.map(x => `PASS ${x}`).join('\n'));
} finally {
  if (failures.length) console.error(failures);
  await browser.close(); await new Promise(resolve => server.close(resolve)); await env.cleanup();
}
