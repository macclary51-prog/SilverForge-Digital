import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { startCustomerDashboard } from "./customer-dashboard.js";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const page = document.body.dataset.customerPage || "";
let stopDashboard = () => {};

function setMessage(element, message, state = "") {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

function setButtonBusy(button, busy, busyText, idleText) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

function friendlyAuthError(error) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "An account already exists for that email. Sign in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Choose a stronger password with at least 8 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "The email or password is incorrect.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a little while and try again.";
    case "auth/network-request-failed":
      return "A network error occurred. Check your connection and try again.";
    default:
      return "The account request could not be completed. Please try again.";
  }
}

function profileReference(uid) {
  return doc(db, "users", uid);
}

async function getAdminRole(user) {
  try {
    const snapshot = await getDoc(doc(db, "roles", user.uid));
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    console.error("Role lookup failed:", error);
    return null;
  }
}

async function ensureCustomerProfile(user, fallback = {}) {
  const ref = profileReference(user.uid);
  const snapshot = await getDoc(ref);

  if (snapshot.exists()) return snapshot;

  const name =
    String(fallback.name || user.displayName || "").trim().slice(0, 120) ||
    String(user.email || "Customer").split("@")[0].slice(0, 120);

  const business = String(fallback.business || "").trim().slice(0, 160);

  await setDoc(ref, {
    uid: user.uid,
    name,
    business,
    email: String(user.email || "").trim(),
    role: "customer",
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return getDoc(ref);
}

async function routeSignedInUser(user) {
  const role = await getAdminRole(user);

  if (role?.role === "admin" && role?.active === true) {
    window.location.replace("crm.html");
    return;
  }

  window.location.replace("customer-account.html");
}

function waitForInitialAuthState() {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
  });
}

async function initializeSignup() {
  const form = document.getElementById("customerSignupForm");
  const button = document.getElementById("customerSignupButton");
  const status = document.getElementById("customerSignupStatus");

  if (!form || !button || !status) return;

  if (!isFirebaseConfigured || !auth || !db) {
    button.disabled = true;
    setMessage(status, "Account creation is temporarily unavailable because Firebase is not configured.", "error");
    return;
  }

  try {
    const currentUser = await waitForInitialAuthState();
    if (currentUser) {
      await routeSignedInUser(currentUser);
      return;
    }
  } catch (error) {
    console.error("Signup auth check failed:", error);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const business = String(data.get("business") || "").trim();
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const passwordConfirm = String(data.get("passwordConfirm") || "");

    if (!name) {
      setMessage(status, "Enter your name.", "error");
      return;
    }

    if (password.length < 8) {
      setMessage(status, "Use a password with at least 8 characters.", "error");
      return;
    }

    if (password !== passwordConfirm) {
      setMessage(status, "The passwords do not match.", "error");
      return;
    }

    setButtonBusy(button, true, "Creating Account...", "Create Account");
    setMessage(status, "Creating your secure account...");

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const user = credential.user;

      await updateProfile(user, { displayName: name });

      await setDoc(profileReference(user.uid), {
        uid: user.uid,
        name,
        business,
        email: String(user.email || email).trim(),
        role: "customer",
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      try {
        await sendEmailVerification(user);
      } catch (verificationError) {
        console.warn("Verification email could not be sent:", verificationError);
      }

      setMessage(status, "Account created. Opening your client account...", "success");
      window.location.replace("customer-account.html");
    } catch (error) {
      console.error("Customer signup failed:", error);
      setButtonBusy(button, false, "Creating Account...", "Create Account");
      setMessage(status, friendlyAuthError(error), "error");
    }
  });
}

async function initializeLogin() {
  const form = document.getElementById("customerLoginForm");
  const button = document.getElementById("customerLoginButton");
  const forgotButton = document.getElementById("forgotPasswordButton");
  const status = document.getElementById("customerLoginStatus");
  const emailInput = document.getElementById("customerLoginEmail");

  if (!form || !button || !forgotButton || !status || !emailInput) return;

  if (!isFirebaseConfigured || !auth || !db) {
    button.disabled = true;
    forgotButton.disabled = true;
    setMessage(status, "Client sign-in is temporarily unavailable because Firebase is not configured.", "error");
    return;
  }

  try {
    const currentUser = await waitForInitialAuthState();
    if (currentUser) {
      await routeSignedInUser(currentUser);
      return;
    }
  } catch (error) {
    console.error("Login auth check failed:", error);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");

    setButtonBusy(button, true, "Signing In...", "Sign In");
    setMessage(status, "Signing in...");

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const role = await getAdminRole(credential.user);

      if (role?.role === "admin" && role?.active === true) {
        window.location.replace("crm.html");
        return;
      }

      await ensureCustomerProfile(credential.user);
      window.location.replace("customer-account.html");
    } catch (error) {
      console.error("Customer login failed:", error);

      if (auth.currentUser) {
        await signOut(auth);
      }

      setButtonBusy(button, false, "Signing In...", "Sign In");
      setMessage(status, friendlyAuthError(error), "error");
    }
  });

  forgotButton.addEventListener("click", async () => {
    const email = emailInput.value.trim();

    if (!email) {
      setMessage(status, "Enter your email address first.", "error");
      emailInput.focus();
      return;
    }

    forgotButton.disabled = true;
    forgotButton.textContent = "Sending...";

    try {
      await sendPasswordResetEmail(auth, email);
      setMessage(
        status,
        "If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.",
        "success"
      );
    } catch (error) {
      console.error("Customer password reset failed:", error);

      if (error?.code === "auth/invalid-email") {
        setMessage(status, "Enter a valid email address.", "error");
      } else if (error?.code === "auth/too-many-requests") {
        setMessage(status, "Too many reset attempts. Try again later.", "error");
      } else {
        setMessage(status, "The reset request could not be completed. Please try again.", "error");
      }
    } finally {
      forgotButton.disabled = false;
      forgotButton.textContent = "Forgot password?";
    }
  });
}

function formatTimestamp(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") return "Just created";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp.toDate());
}

async function initializeAccount() {
  const gate = document.getElementById("customerAccountGate");
  const gateMessage = document.getElementById("customerAccountGateMessage");
  const app = document.getElementById("customerAccountApp");

  if (!gate || !gateMessage || !app) return;

  if (!isFirebaseConfigured || !auth || !db) {
    gateMessage.textContent = "Client accounts are temporarily unavailable because Firebase is not configured.";
    return;
  }

  onAuthStateChanged(
    auth,
    async (user) => {
      stopDashboard();
      app.hidden = true;
      gate.hidden = false;
      if (!user) {
        window.location.replace("customer-login.html");
        return;
      }

      try {
        const role = await getAdminRole(user);

        if (role?.role === "admin" && role?.active === true) {
          window.location.replace("crm.html");
          return;
        }

        const profileSnapshot = await ensureCustomerProfile(user);
        const profile = profileSnapshot.data();
        if (auth.currentUser?.uid !== user.uid) return;

        document.getElementById("customerWelcome").textContent =
          profile.name ? `Welcome, ${String(profile.name).split(/\s+/)[0]}` : "My account";

        document.getElementById("accountEmail").textContent = user.email || profile.email || "—";
        document.getElementById("accountCreatedAt").textContent = formatTimestamp(profile.createdAt);
        document.getElementById("accountRole").textContent = profile.role || "customer";
        document.getElementById("accountStatus").textContent = profile.status || "active";
        document.getElementById("accountName").value = profile.name || user.displayName || "";
        document.getElementById("accountBusiness").value = profile.business || "";

        const verificationBadge = document.getElementById("verificationBadge");
        const verificationMessage = document.getElementById("verificationMessage");

        if (user.emailVerified) {
          verificationBadge.textContent = "Email Verified";
          verificationBadge.dataset.state = "verified";
          verificationMessage.textContent = "Your email address has been verified.";
        } else {
          verificationBadge.textContent = "Verification Needed";
          verificationBadge.dataset.state = "unverified";
          verificationMessage.textContent = "Verify your email address to keep your account information current and secure.";
        }

        gate.hidden = true;
        app.hidden = false;
        bindAccountActions(user);
        stopDashboard = startCustomerDashboard(user, profile);
      } catch (error) {
        console.error("Customer account load failed:", error);
        gateMessage.textContent = "Your account could not be loaded. Refresh the page or try signing in again.";
      }
    },
    (error) => {
      console.error("Customer auth observer failed:", error);
      gateMessage.textContent = "The sign-in service could not be reached. Try again.";
    }
  );
}

window.addEventListener("beforeunload", () => stopDashboard());

function bindAccountActions(user) {
  const form = document.getElementById("customerProfileForm");
  const nameInput = document.getElementById("accountName");
  const businessInput = document.getElementById("accountBusiness");
  const updateButton = document.getElementById("updateProfileButton");
  const profileStatus = document.getElementById("customerProfileStatus");
  const verificationButton = document.getElementById("sendVerificationButton");
  const passwordButton = document.getElementById("accountPasswordResetButton");
  const signOutButton = document.getElementById("customerSignOutButton");
  const actionStatus = document.getElementById("customerAccountActionStatus");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const name = nameInput.value.trim();
    const business = businessInput.value.trim();

    if (!name) {
      setMessage(profileStatus, "Enter your name.", "error");
      return;
    }

    setButtonBusy(updateButton, true, "Saving...", "Save Profile");
    setMessage(profileStatus, "Saving your profile...");

    try {
      await updateDoc(profileReference(user.uid), {
        name,
        business,
        updatedAt: serverTimestamp()
      });

      await updateProfile(user, { displayName: name });
      document.getElementById("customerWelcome").textContent = `Welcome, ${name.split(/\s+/)[0]}`;
      setMessage(profileStatus, "Profile updated.", "success");
    } catch (error) {
      console.error("Customer profile update failed:", error);
      setMessage(profileStatus, "Your profile could not be updated. Please try again.", "error");
    } finally {
      setButtonBusy(updateButton, false, "Saving...", "Save Profile");
    }
  });

  verificationButton?.addEventListener("click", async () => {
    verificationButton.disabled = true;
    verificationButton.textContent = "Sending...";

    try {
      await reload(user);

      if (user.emailVerified) {
        setMessage(actionStatus, "Your email is already verified.", "success");
        window.location.reload();
        return;
      }

      await sendEmailVerification(user);
      setMessage(actionStatus, "Verification email sent. Open the link, then refresh this page.", "success");
    } catch (error) {
      console.error("Verification email failed:", error);
      setMessage(actionStatus, "The verification email could not be sent. Try again later.", "error");
    } finally {
      verificationButton.disabled = false;
      verificationButton.textContent = "Send Verification Email";
    }
  });

  passwordButton?.addEventListener("click", async () => {
    const email = String(user.email || "").trim();

    if (!email) {
      setMessage(actionStatus, "No email address is available for this account.", "error");
      return;
    }

    passwordButton.disabled = true;
    passwordButton.textContent = "Sending...";

    try {
      await sendPasswordResetEmail(auth, email);
      setMessage(actionStatus, "Password reset email sent. Check your inbox and spam folder.", "success");
    } catch (error) {
      console.error("Account password reset failed:", error);
      setMessage(actionStatus, "The password reset email could not be sent. Try again later.", "error");
    } finally {
      passwordButton.disabled = false;
      passwordButton.textContent = "Send Password Reset";
    }
  });

  signOutButton?.addEventListener("click", async () => {
    signOutButton.disabled = true;
    signOutButton.textContent = "Signing Out...";

    try {
      await signOut(auth);
      // The auth observer clears private data and redirects once.
    } catch (error) {
      setMessage(actionStatus, "Sign out could not be completed. Please try again.", "error");
      signOutButton.disabled = false;
      signOutButton.textContent = "Sign Out";
    }
  });
}

if (page === "signup") {
  initializeSignup();
} else if (page === "login") {
  initializeLogin();
} else if (page === "account") {
  initializeAccount();
}
