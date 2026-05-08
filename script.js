console.log("QueueFlow Website Loaded Successfully");

/* ========================= */
/* NAVBAR SHADOW ON SCROLL   */
/* ========================= */
window.addEventListener("scroll", function () {
  const navbar = document.querySelector(".navbar");
  if (window.scrollY > 50) {
    navbar.style.boxShadow = "0px 10px 30px rgba(0,0,0,0.08)";
  } else {
    navbar.style.boxShadow = "0px 5px 25px rgba(0,0,0,0.05)";
  }
});

/* ========================= */
/* MODAL OPEN / CLOSE        */
/* ========================= */
function openModal(id) {
  document.getElementById(id).style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
  document.body.style.overflow = "";
}

// Close modal when clicking outside the box
document.addEventListener("click", function (e) {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.style.display = "none";
    document.body.style.overflow = "";
  }
});

/* ========================= */
/* TAB SWITCHING             */
/* ========================= */
function switchTab(portal, tab) {
  if (portal === "customer") {
    const loginForm  = document.getElementById("customerLoginForm");
    const signupForm = document.getElementById("customerSignupForm");
    const loginTab   = document.getElementById("cLoginTab");
    const signupTab  = document.getElementById("cSignupTab");

    if (tab === "login") {
      loginForm.style.display  = "block";
      signupForm.style.display = "none";
      loginTab.classList.add("active");
      signupTab.classList.remove("active");
    } else {
      loginForm.style.display  = "none";
      signupForm.style.display = "block";
      loginTab.classList.remove("active");
      signupTab.classList.add("active");
    }
  }

  if (portal === "admin") {
    const loginForm  = document.getElementById("adminLoginForm");
    const signupForm = document.getElementById("adminSignupForm");
    const loginTab   = document.getElementById("aLoginTab");
    const signupTab  = document.getElementById("aSignupTab");

    if (tab === "login") {
      loginForm.style.display  = "block";
      signupForm.style.display = "none";
      loginTab.classList.add("active");
      signupTab.classList.remove("active");
    } else {
      loginForm.style.display  = "none";
      signupForm.style.display = "block";
      loginTab.classList.remove("active");
      signupTab.classList.add("active");
    }
  }
}

/* ========================= */
/* SHOW MESSAGE HELPER       */
/* ========================= */
function showMsg(id, text, type = "error") {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "form-msg " + (type === "success" ? "msg-success" : "msg-error");
  setTimeout(() => { el.textContent = ""; el.className = "form-msg"; }, 4000);
}

/* ========================= */
/* CUSTOMER LOGIN             */
/* ========================= */
async function customerLogin() {
  const email    = document.getElementById("cLoginEmail").value.trim();
  const password = document.getElementById("cLoginPassword").value;

  if (!email || !password) {
    showMsg("customerLoginMsg", "⚠️ Please fill in all fields.");
    return;
  }

  try {
    const auth = firebase.auth();
    const result = await auth.signInWithEmailAndPassword(email, password);

    // Verify this user is a customer (not admin)
    const sEmail = window.sanitizeEmail(email);
    const snap = await window.queueDB.ref("customers/" + sEmail).once("value");
    if (!snap.exists()) {
      showMsg("customerLoginMsg", "❌ No customer account found for this email.");
      await auth.signOut();
      return;
    }

    showMsg("customerLoginMsg", "✅ Login successful! Redirecting...", "success");
    setTimeout(() => {
      closeModal("customerModal");
      // Redirect to customer dashboard
      window.location.href = "customer-dashboard.html";
    }, 1200);

  } catch (err) {
    showMsg("customerLoginMsg", "❌ " + friendlyError(err.code));
  }
}

/* ========================= */
/* CUSTOMER SIGNUP           */
/* ========================= */
async function customerSignup() {
  const name     = document.getElementById("customerName").value.trim();
  const contact  = document.getElementById("customerContact").value.trim();
  const email    = document.getElementById("customerEmail").value.trim();
  const password = document.getElementById("customerPassword").value;

  if (!name || !contact || !email || !password) {
    showMsg("customerSignupMsg", "⚠️ Please fill in all fields.");
    return;
  }

  if (password.length < 6) {
    showMsg("customerSignupMsg", "⚠️ Password must be at least 6 characters.");
    return;
  }

  const sEmail = window.sanitizeEmail(email);

  try {
    // 1️⃣ Create Firebase Auth user
    const auth   = firebase.auth();
    const result = await auth.createUserWithEmailAndPassword(email, password);
    const uid    = result.user.uid;

    // Update display name
    await result.user.updateProfile({ displayName: name });

    // 2️⃣ Store in Realtime DB under /customers/<sanitizedEmail>
    const customerData = {
      uid,
      fullName:      name,
      contactNumber: contact,
      emailAddress:  email,
      role:          "customer",
      createdAt:     Date.now()
    };

    await window.queueDB.ref("customers/" + sEmail).set(customerData);

    showMsg("customerSignupMsg", "✅ Account created successfully! Please login.", "success");

    // Clear inputs & switch to login tab
    document.getElementById("customerName").value     = "";
    document.getElementById("customerContact").value  = "";
    document.getElementById("customerEmail").value    = "";
    document.getElementById("customerPassword").value = "";

    setTimeout(() => switchTab("customer", "login"), 1500);

  } catch (err) {
    showMsg("customerSignupMsg", "❌ " + friendlyError(err.code));
  }
}

/* ========================= */
/* ADMIN LOGIN               */
/* ========================= */
async function adminLogin() {
  const email    = document.getElementById("aLoginEmail").value.trim();
  const password = document.getElementById("aLoginPassword").value;

  if (!email || !password) {
    showMsg("adminLoginMsg", "⚠️ Please fill in all fields.");
    return;
  }

  try {
    const auth   = firebase.auth();
    const result = await auth.signInWithEmailAndPassword(email, password);

    // Verify this user is an admin
    const sEmail = window.sanitizeEmail(email);
    const snap = await window.queueDB.ref("admins/" + sEmail).once("value");
    if (!snap.exists()) {
      showMsg("adminLoginMsg", "❌ No admin account found for this email.");
      await auth.signOut();
      return;
    }

    showMsg("adminLoginMsg", "✅ Admin login successful! Redirecting...", "success");
    setTimeout(() => {
      closeModal("adminModal");
      // Redirect to admin dashboard
      window.location.href = "admin-dashboard.html";
    }, 1200);

  } catch (err) {
    showMsg("adminLoginMsg", "❌ " + friendlyError(err.code));
  }
}

/* ========================= */
/* ADMIN SIGNUP              */
/* ========================= */
async function adminSignup() {
  const name     = document.getElementById("adminName").value.trim();
  const adminId  = document.getElementById("adminId").value.trim();
  const email    = document.getElementById("adminEmail").value.trim();
  const contact  = document.getElementById("adminContact").value.trim();
  const password = document.getElementById("adminPassword").value;
  const queue    = document.getElementById("adminQueue").value;

  if (!name || !adminId || !email || !contact || !password || !queue) {
    showMsg("adminSignupMsg", "⚠️ Please fill in all fields including the queue type.");
    return;
  }

  if (password.length < 6) {
    showMsg("adminSignupMsg", "⚠️ Password must be at least 6 characters.");
    return;
  }

  const sEmail = window.sanitizeEmail(email);

  try {
    // 1️⃣ Create Firebase Auth user
    const auth   = firebase.auth();
    const result = await auth.createUserWithEmailAndPassword(email, password);
    const uid    = result.user.uid;

    await result.user.updateProfile({ displayName: name });

    // 2️⃣ Store in Realtime DB under /admins/<sanitizedEmail>
    const adminData = {
      uid,
      fullName:      name,
      adminId:       adminId,
      emailAddress:  email,
      contactNumber: contact,
      queueType:     queue,
      role:          "admin",
      createdAt:     Date.now()
    };

    await window.queueDB.ref("admins/" + sEmail).set(adminData);

    // 3️⃣ Initialize queue node in DB
    if (window.initService) {
      await window.initService(queue);
    }

    showMsg("adminSignupMsg", "✅ Admin registered successfully! Please login.", "success");

    // Clear inputs
    document.getElementById("adminName").value     = "";
    document.getElementById("adminId").value       = "";
    document.getElementById("adminEmail").value    = "";
    document.getElementById("adminContact").value  = "";
    document.getElementById("adminPassword").value = "";
    document.getElementById("adminQueue").value    = "";

    setTimeout(() => switchTab("admin", "login"), 1500);

  } catch (err) {
    showMsg("adminSignupMsg", "❌ " + friendlyError(err.code));
  }
}

/* ========================= */
/* FRIENDLY FIREBASE ERRORS  */
/* ========================= */
function friendlyError(code) {
  const map = {
    "auth/email-already-in-use":    "This email is already registered.",
    "auth/invalid-email":           "Invalid email address.",
    "auth/weak-password":           "Password is too weak (min 6 chars).",
    "auth/user-not-found":          "No account found with this email.",
    "auth/wrong-password":          "Incorrect password.",
    "auth/too-many-requests":       "Too many attempts. Try again later.",
    "auth/network-request-failed":  "Network error. Check your connection.",
    "auth/invalid-credential":      "Invalid credentials. Please try again."
  };
  return map[code] || "Something went wrong. Please try again.";
}