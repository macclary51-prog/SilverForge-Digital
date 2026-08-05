import {
    auth,
    db,
    isFirebaseConfigured
} from "./firebase-config.js";

import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const loginForm =
    document.getElementById("loginForm");

const loginButton =
    document.getElementById("loginButton");

const loginStatus =
    document.getElementById("loginStatus");

const requestedReturnPath = new URLSearchParams(
    window.location.search
).get("return") || "";


function getSafeReturnPath() {
    if (requestedReturnPath === "crm.html") {
        return requestedReturnPath;
    }

    if (
        /^proposal[.]html[?]lead=[A-Za-z0-9_-]{1,128}$/
            .test(requestedReturnPath)
    ) {
        return requestedReturnPath;
    }

    return "crm.html";
}


function setStatus(message, state = "") {
    loginStatus.textContent = message;
    loginStatus.dataset.state = state;
}


function setLoginBusy(isBusy) {
    loginButton.disabled = isBusy;
    loginButton.textContent =
        isBusy ? "Signing in..." : "Sign in";
}


async function userIsActiveAdmin(user) {
    const roleSnapshot = await getDoc(
        doc(db, "roles", user.uid)
    );

    if (!roleSnapshot.exists()) {
        return false;
    }

    const role = roleSnapshot.data();

    return (
        role.role === "admin" &&
        role.active === true
    );
}


async function authorizeUser(user) {
    setStatus(
        "Verifying administrator access..."
    );

    const authorized =
        await userIsActiveAdmin(user);

    if (!authorized) {
        await signOut(auth);

        setLoginBusy(false);

        setStatus(
            "This account is not authorized to use the CRM.",
            "error"
        );

        return;
    }

    window.location.replace(getSafeReturnPath());
}


function waitForInitialAuthState() {
    return new Promise(function (resolve, reject) {
        let unsubscribe = function () {};

        unsubscribe = onAuthStateChanged(
            auth,
            function (user) {
                unsubscribe();
                resolve(user);
            },
            function (error) {
                unsubscribe();
                reject(error);
            }
        );
    });
}


async function initializeLogin() {
    if (
        !isFirebaseConfigured ||
        !auth ||
        !db
    ) {
        setStatus(
            "Firebase is not configured yet. Update firebase-config.js before signing in.",
            "error"
        );

        loginButton.textContent =
            "Firebase setup required";

        return;
    }

    const reason = new URLSearchParams(
        window.location.search
    ).get("reason");

    try {
        const currentUser =
            await waitForInitialAuthState();

        if (currentUser) {
            await authorizeUser(currentUser);
            return;
        }

        setLoginBusy(false);

        setStatus(
            reason === "unauthorized"
                ? "Your account does not have active administrator access."
                : "Enter your administrator credentials.",
            reason === "unauthorized" ? "error" : ""
        );
    } catch (error) {
        console.error(
            "CRM authentication check failed:",
            error
        );

        if (auth.currentUser) {
            await signOut(auth);
        }

        setLoginBusy(false);

        setStatus(
            "The sign-in service could not be reached. Try again.",
            "error"
        );
    }
}


loginForm.addEventListener(
    "submit",
    async function (event) {
        event.preventDefault();

        if (!loginForm.checkValidity()) {
            loginForm.reportValidity();
            return;
        }

        const formData =
            new FormData(loginForm);

        const email = String(
            formData.get("email") || ""
        ).trim();

        const password = String(
            formData.get("password") || ""
        );

        setLoginBusy(true);
        setStatus("Signing in...");

        try {
            const credential =
                await signInWithEmailAndPassword(
                    auth,
                    email,
                    password
                );

            await authorizeUser(
                credential.user
            );
        } catch (error) {
            console.error(
                "CRM sign-in failed:",
                error
            );

            if (auth.currentUser) {
                await signOut(auth);
            }

            setLoginBusy(false);

            setStatus(
                "Sign-in failed. Check your credentials and administrator access.",
                "error"
            );
        }
    }
);


initializeLogin();
