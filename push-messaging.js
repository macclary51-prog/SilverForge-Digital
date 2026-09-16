import { app } from './firebase-config.js';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging.js';
export { isSupported };
export const registerToken = options => getToken(getMessaging(app), options);
export const removeToken = () => deleteToken(getMessaging(app));
export const listenForPush = callback => onMessage(getMessaging(app), callback);
