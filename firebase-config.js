// ============================================
//   SMART QUEUE SYSTEM — firebase-config.js
// ============================================

const firebaseConfig = {
  apiKey: "AIzaSyC2Qf-oaGVPC_cBUWstNpZE4gtKxpFHUek",
  authDomain: "smart-queue-system-aa6ba.firebaseapp.com",
  projectId: "smart-queue-system-aa6ba",
  storageBucket: "smart-queue-system-aa6ba.firebasestorage.app",
  messagingSenderId: "57364544256",
  appId: "1:57364544256:web:1e4809bed8a02e121851e5",
  measurementId: "G-XS1VXDXLH5"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

window.sanitizeEmail = (email) => {
  return email.toLowerCase().replace(/\./g, ',');
};

window.SERVICE_PREFIX = {
  doctor:  "D",
  bank:    "B",
  billing: "L",
  enquiry: "E",
  pharmacy:"P",
  support: "S"
};

window.SERVICE_LABELS = {
  doctor:  "🩺 Doctor",
  bank:    "🏦 Bank",
  billing: "💳 Billing",
  enquiry: "📋 Enquiry",
  pharmacy:"💊 Pharmacy",
  support: "🎧 Support"
};

window.makeToken = (service, number) => {
  const prefix = window.SERVICE_PREFIX[service] || "Q";
  return `${prefix}${number}`;
};

// ── FIXED: Added missing initService function ──
window.initService = async (service) => {
  const counterRef = db.ref(`queues/${service}/next_number`);
  const snap = await counterRef.once('value');
  if (!snap.exists()) {
    await counterRef.set(1);
  }
};

window.getAdminsForService = async (service) => {
  const snap = await db.ref('admins').once('value');
  const admins = [];
  snap.forEach(child => {
    const val = child.val();
    if (val.queueType === service) {
      admins.push({ id: child.key, name: val.fullName });
    }
  });
  return admins;
};

window.addToken = async (name, service, adminId) => {
  await window.initService(service); // Now this function exists!
  const counterRef = db.ref(`queues/${service}/next_number`);
  const snap = await counterRef.once('value');
  const number = snap.val() || 1;
  const token  = window.makeToken(service, number);

  const tokenData = {
    name,
    token,
    service,
    adminId,
    status: 'waiting',
    timestamp: Date.now()
  };

  const newRef = db.ref(`queues/${service}/${adminId}/tokens`).push();
  await newRef.set(tokenData);
  await counterRef.set(number + 1);

  return { id: newRef.key, token, number };
};

window.getWaitingTokens = (service, adminId, callback) => {
  const ref = db.ref(`queues/${service}/${adminId}/tokens`).orderByChild('timestamp');
  return ref.on('value', snap => {
    const tokens = [];
    snap.forEach(child => {
      const val = child.val();
      if (val.status === 'waiting' || val.status === 'serving') {
        tokens.push({ id: child.key, ...val });
      }
    });
    callback(tokens);
  });
};

window.watchCurrentToken = (service, callback) => {
  const ref = db.ref(`queues/${service}/current_token`);
  return ref.on('value', snap => callback(snap.val()));
};

window.callNextToken = async (service, adminId) => {
  const tokensRef = db.ref(`queues/${service}/${adminId}/tokens`).orderByChild('timestamp');
  const snap = await tokensRef.once('value');
  let nextId = null, nextToken = null;

  snap.forEach(child => {
    if (!nextId && child.val().status === 'waiting') {
      nextId    = child.key;
      nextToken = child.val().token;
    }
  });

  if (!nextId) return { success: false, message: 'Queue is empty' };
  await db.ref(`queues/${service}/${adminId}/tokens/${nextId}`).update({ status: 'serving' });
  await db.ref(`queues/${service}/current_token`).set(nextToken);
  return { success: true, token: nextToken };
};

window.skipCurrentToken = async (service, adminId) => {
  const tokensRef = db.ref(`queues/${service}/${adminId}/tokens`).orderByChild('timestamp');
  const snap = await tokensRef.once('value');
  let servingId = null;
  snap.forEach(child => {
    if (child.val().status === 'serving') servingId = child.key;
  });
  if (servingId) {
    await db.ref(`queues/${service}/${adminId}/tokens/${servingId}`).update({ status: 'skipped' });
  }
  return await window.callNextToken(service, adminId);
};

window.completeCurrentToken = async (service, adminId) => {
  const tokensRef = db.ref(`queues/${service}/${adminId}/tokens`).orderByChild('timestamp');
  const snap = await tokensRef.once('value');
  snap.forEach(child => {
    if (child.val().status === 'serving') {
      db.ref(`queues/${service}/${adminId}/tokens/${child.key}`).update({ status: 'done' });
    }
  });
  return await window.callNextToken(service, adminId);
};

window.queueDB = db;
console.log('✅ Firebase Queue System Initialized');