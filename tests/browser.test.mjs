import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
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
