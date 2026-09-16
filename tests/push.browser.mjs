import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocs,setDoc,Timestamp} from 'firebase/firestore';
import {buildWorker} from '../scripts/build-worker.mjs';
import {startPreview} from './preview.mjs';
import {defaultNotificationSettings} from '../notification-shared.js';

// Auth/Firestore and the actual bundled worker run locally. Only the FCM token transport
// and permission prompt response are injected; these are not production FCM credentials.
const config=`
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {getAuth,connectAuthEmulator} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {getFirestore,connectFirestoreEmulator} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {protectPushSession} from './push-auth-state.js';
export const app=initializeApp({projectId:'demo-silverforge',apiKey:'demo-key',authDomain:'demo-silverforge.firebaseapp.com'});
export const auth=getAuth(app),db=getFirestore(app),isFirebaseConfigured=true;
connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true}); connectFirestoreEmulator(db,'127.0.0.1',8080); protectPushSession(auth);`;
const sdk=`
export const isSupported=async()=>true;
export async function registerToken(options){
 if(Notification.permission!=='granted'||options.serviceWorkerRegistration.scope!==location.origin+'/')throw new Error('Invalid registration flow');
 window.__registerCount=(window.__registerCount||0)+1;
 return 'emulator-only-fcm-token-'+crypto.randomUUID();
}
export async function removeToken(){window.__removeCount=(window.__removeCount||0)+1;return true;}
export function listenForPush(callback){window.__receivePush=callback;return ()=>{delete window.__receivePush;};}`;
const env=await initializeTestEnvironment({projectId:'demo-silverforge',firestore:{host:'127.0.0.1',port:8080,rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
await env.clearFirestore();
const email='push-admin@example.com',password='Emulator-push-password-42';
const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
const account=await response.json(); assert.ok(account.localId,JSON.stringify(account)); const uid=account.localId;
await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'roles',uid),{role:'admin',active:true});
  await setDoc(doc(ctx.firestore(),'adminSettings','notifications'),{...defaultNotificationSettings(),webPushPublicKey:'A'.repeat(87),updatedAt:Timestamp.now(),updatedBy:uid});
  await setDoc(doc(ctx.firestore(),'contactMessages','push-contact'),{name:'Push Test Contact',subject:'Push route test',email:'test@example.com',category:'Other',message:'Emulator push destination',status:'new',createdAt:Timestamp.now(),updatedAt:Timestamp.now()});
  for(const id of ['first','second']) await setDoc(doc(ctx.firestore(),'adminNotifications',id),{title:'Test contact',message:'Emulator history',category:'contacts',read:false,dashboardEnabled:true,pushStatus:'simulated',createdAt:Timestamp.now()});
});
const adminDb=env.authenticatedContext(uid,{email}).firestore();
const devices=async()=> (await getDocs(collection(adminDb,'users',uid,'notificationDevices'))).docs;
async function deviceCount(expected){const deadline=Date.now()+10000;while(Date.now()<deadline){if((await devices()).length===expected)return;await new Promise(resolve=>setTimeout(resolve,100));}assert.equal((await devices()).length,expected);}
const base='http://127.0.0.1:4175';
const server=await startPreview(4175,new Map([['/firebase-config.js',config],['/push-messaging.js',sdk],['/firebase-messaging-sw.js',(await buildWorker({test:true,write:false})).outputFiles[0].text]]));
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true}); const failures=[];
const responseChecks=[], expectedConflicts=new Map(); let pageNumber=0;
async function pageFor(platform='Desktop',permission='default'){
  const context=await browser.newContext({viewport:platform==='Android'?{width:390,height:844}:{width:1440,height:1000},...(platform==='Android'?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'}:{})});
  await context.grantPermissions(['notifications'],{origin:base});
  await context.route('https://www.googletagmanager.com/**',route=>route.fulfill({body:''}));
  await context.route(/https:\/\/(firestore|identitytoolkit|securetoken|fcmregistrations|firebaseinstallations)\.googleapis\.com\//,route=>{failures.push('Unexpected production request');return route.abort();});
  await context.addInitScript(initial=>{
    window.__permissionCalls=0;
    Object.defineProperty(Notification,'permission',{get:()=>sessionStorage.getItem('testPermission')||initial});
    Notification.requestPermission=async()=>{window.__permissionCalls++;sessionStorage.setItem('testPermission','granted');return 'granted';};
  },permission);
  const page=await context.newPage(), pageId=++pageNumber;
  page.on('pageerror',error=>failures.push({message:error.message}));
  page.on('console',event=>{if(event.type()==='error')failures.push({message:event.text(),key:`${pageId}:${event.location().url || ''}`});});
  page.on('response',response=>{if(response.status()>=400&&response.url().startsWith('http://127.0.0.1:'))responseChecks.push((async()=>{
    const body=await response.text().catch(()=>'');
    // The invalidation fixture intentionally races a token refresh. Firestore retries
    // version conflicts; allow only this exact response, never unrelated 400 errors.
    if(response.status()===400&&new URL(response.url()).pathname.endsWith('/documents:commit')&&body.includes('FAILED_PRECONDITION')&&/stored version.*required base version/.test(body)){
      const key=`${pageId}:${response.url()}`;expectedConflicts.set(key,(expectedConflicts.get(key)||0)+1);
    }else console.log('UNEXPECTED LOCAL RESPONSE',response.status(),new URL(response.url()).pathname,body.slice(0,300));
  })());});
  return page;
}
async function text(page,selector,expected){try{await page.waitForFunction(({selector,expected})=>document.querySelector(selector)?.textContent.includes(expected),{selector,expected},{timeout:25000});}catch(error){throw new Error(`${selector}: expected ${expected}; found ${await page.locator(selector).textContent()}`,{cause:error});}}
async function login(page,path='crm-notifications.html'){
  await page.goto(base+'/'+path); await page.waitForURL('**/crm-login.html*');
  await page.locator('#loginEmail').fill(email);await page.locator('#loginPassword').fill(password);await page.locator('#loginButton').click();
  await page.waitForURL(url=>!url.pathname.includes('login'));
}
async function noticeCount(page,expected){await page.waitForFunction(async count=>(await (await navigator.serviceWorker.ready).getNotifications()).length===count,expected);}
async function emit(page,data){await page.evaluate(data=>window.__receivePush({data}),data);}
async function eventInWorker(worker,type,data){
  await worker.evaluate(async({type,data})=>{
    const waits=[]; let event; const original=self.clients.matchAll.bind(self.clients);
    if(type==='push'){
      // Exercise the real Firebase background listener with no visible clients.
      self.clients.matchAll=async()=>[];
      event=new PushEvent('push',{data:JSON.stringify({from:'1234567890',fcmMessageId:'test-'+data.notificationId,data})});
    }else{
      const notification=(await self.registration.getNotifications())[0];
      event=new NotificationEvent('notificationclick',{notification});
    }
    event.waitUntil=promise=>waits.push(promise.catch(error=>{if(type!=='click'||!/focus|user activation|InvalidAccessError/i.test(String(error)))throw error;}));
    try{self.dispatchEvent(event);await Promise.all(waits);}finally{self.clients.matchAll=original;}
  },{type,data});
}
try{
  const desktop=await pageFor(); await login(desktop);
  await desktop.goto(base+'/crm-notifications.html');await text(desktop,'#pushDeviceStatus','Enable notifications');
  assert.equal(await desktop.evaluate(()=>window.__permissionCalls),0);assert.equal((await devices()).length,0);
  const scope=await desktop.evaluate(async()=>(await navigator.serviceWorker.ready).scope);assert.equal(scope,base+'/');
  await desktop.locator('#enablePushNotifications').click();await text(desktop,'#pushDeviceStatus','This device is enabled');
  assert.equal(await desktop.evaluate(()=>window.__permissionCalls),1);
  let saved=(await devices())[0];assert.match(saved.id,/^[\w-]{20,128}$/);assert.notEqual(saved.id,saved.data().token);assert.equal(saved.data().platform,'Desktop');
  assert.deepEqual(Object.keys(saved.data()).sort(),['createdAt','enabled','lastUsedAt','platform','token','updatedAt'].sort());
  await text(desktop,'#notificationUnread','2 unread');await desktop.locator('#markAllNotificationsRead').click();await text(desktop,'#notificationActionStatus','2 notifications marked as read');await text(desktop,'#notificationUnread','0 unread');
  const created=saved.data().createdAt,desktopId=saved.id;
  await desktop.reload();await text(desktop,'#pushDeviceStatus','This device is enabled');await desktop.waitForFunction(()=>window.__registerCount===1);
  assert.equal(await desktop.evaluate(()=>window.__permissionCalls),0);assert.ok((await getDoc(saved.ref)).data().createdAt.isEqual(created));
  console.log('PASS Explicit permission gesture, token persistence under owning admin, generated ID, root service worker and opt-in refresh. FCM token transport is mocked.');

  const android=await pageFor('Android');await login(android);await android.goto(base+'/crm-notifications.html');await text(android,'#pushDeviceStatus','Enable notifications');
  await android.locator('#enablePushNotifications').click();await text(android,'#pushDeviceStatus','This device is enabled');
  assert.equal((await devices()).length,2);assert.ok((await devices()).some(item=>item.data().platform==='Android'));
  assert.ok(await android.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});await android.screenshot({path:'test-results/push-android.png',fullPage:true});
  const manifest=await (await fetch(base+'/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'/');
  for(const icon of manifest.icons){const bytes=Buffer.from(await(await fetch(base+icon.src)).arrayBuffer());assert.equal(bytes.readUInt32BE(16),Number(icon.sizes.split('x')[0]));assert.equal(bytes.readUInt32BE(20),Number(icon.sizes.split('x')[1]));}
  console.log('PASS Independent desktop/Android device registrations, responsive settings, manifest and square branded PWA icons.');

  const payload={notificationId:'a'.repeat(64),recipientUid:uid,deviceId:desktopId,title:'SilverForge — Test Contact',body:'Emulator notification',target:'contact',recordId:'push-contact',clientId:''};
  await emit(desktop,payload);await noticeCount(desktop,1);
  await emit(desktop,payload);await noticeCount(desktop,1);
  const worker=desktop.context().serviceWorkers()[0];assert.ok(worker);
  await eventInWorker(worker,'click');await desktop.waitForURL('**/crm-support.html?contact=push-contact');await text(desktop,'#contactBody','Emulator push destination');
  await eventInWorker(worker,'push',{...payload,notificationId:'b'.repeat(64)});await noticeCount(desktop,1);
  await eventInWorker(worker,'click');await desktop.waitForURL('**/crm-support.html?contact=push-contact');
  await desktop.goto(base+'/index.html');await desktop.waitForFunction(()=>typeof window.__receivePush==='function');
  await emit(desktop,{...payload,notificationId:'c'.repeat(64)});await noticeCount(desktop,1);
  await desktop.evaluate(async()=>{for(const n of await(await navigator.serviceWorker.ready).getNotifications())n.close();});
  console.log('PASS Foreground/public-tab and real bundled background-worker handlers display notifications; duplicate event suppressed; synthetic clicks open the correct contact.');

  const cached=await desktop.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())result.push(new URL(req.url).pathname);return result.sort();});
  assert.deepEqual(cached,['/icons/icon-192.png','/offline.html']);
  // Isolate offline asset checks from intentionally broken Firestore streaming connections.
  const offline=await pageFor();await offline.goto(base+'/crm-login.html');await offline.evaluate(()=>navigator.serviceWorker.ready);
  await offline.context().setOffline(true);await offline.goto(base+'/crm-notifications.html');await text(offline,'body','Reconnect');
  assert.ok(await offline.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),'Offline branding loads from the public cache');
  await offline.context().close();
  await desktop.goto(base+'/crm-notifications.html');await text(desktop,'#pushDeviceStatus','This device is enabled');
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'users',uid,'notificationDevices',desktopId),{enabled:false},{merge:true}));
  await text(desktop,'#pushDeviceStatus','Enable notifications');await desktop.locator('#enablePushNotifications').click();await text(desktop,'#pushDeviceStatus','This device is enabled');
  assert.equal(await desktop.evaluate(()=>window.__removeCount),1);
  const ownRow=desktop.locator('#notificationDeviceList article').filter({hasText:'This device'});await ownRow.getByRole('button',{name:'Remove Device'}).click();await text(desktop,'#pushDeviceStatus','Enable notifications');
  await deviceCount(1);
  await desktop.locator('#enablePushNotifications').click();await text(desktop,'#pushDeviceStatus','This device is enabled');
  await desktop.locator('#signOutButton').click();await desktop.waitForURL('**/crm-login.html');
  assert.equal((await getDoc(doc(adminDb,'users',uid,'notificationDevices',desktopId))).data().enabled,false);
  await eventInWorker(worker,'push',{...payload,notificationId:'d'.repeat(64)});await noticeCount(desktop,0);
  console.log('PASS Offline fallback caches only public assets; invalid-token re-enable, own-device removal and sign-out mute work.');

  const linked=await pageFor();await login(linked,'crm-support.html?contact=push-contact');await text(linked,'#contactBody','Emulator push destination');
  const denied=await pageFor('Desktop','denied');await login(denied);await denied.goto(base+'/crm-notifications.html');await text(denied,'#pushDeviceStatus','Notifications are blocked');assert.ok(await denied.locator('#enablePushNotifications').isDisabled());
  assert.equal(await denied.evaluate(()=>window.__permissionCalls),0);
  const unsafe=await linked.evaluate(async()=>{const {safeAdminReturn}=await import('./push-routing.js');return safeAdminReturn('https://example.com/steal');});assert.equal(unsafe,'crm.html');
  await Promise.all(responseChecks);
  const unexpected=failures.filter(error=>{const count=expectedConflicts.get(error.key)||0;if(count&&error.message==='Failed to load resource: the server responded with a status of 400 (Bad Request)'){expectedConflicts.set(error.key,count-1);return false;}return true;});
  assert.deepEqual(unexpected,[]);console.log('PASS Login preserves the requested contact; external redirects rejected; denied permission gives actionable UI; no unexpected browser errors (only explicit token-version conflict retries allowed).');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await env.cleanup();}
