import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

import {
    getAuth
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// Firebase web configuration identifies the public SilverForge Firebase project.
// It is not an administrator password and must never be replaced with
// service-account or private-key data.
import { firebaseConfig } from "./firebase-public-config.js";
export { firebaseConfig };

const requiredConfigKeys = [
    "apiKey",
    "authDomain",
    "projectId",
    "appId"
];

export const isFirebaseConfigured =
    requiredConfigKeys.every(function (key) {
        const value = String(
            firebaseConfig[key] || ""
        ).trim();

        return (
            value &&
            !value.startsWith("REPLACE_WITH_")
        );
    });

export const app =
    isFirebaseConfigured
        ? initializeApp(firebaseConfig)
        : null;

export const auth =
    app ? getAuth(app) : null;

export const db =
    app ? getFirestore(app) : null;

import { protectPushSession } from './push-auth-state.js';
if (auth) protectPushSession(auth);
