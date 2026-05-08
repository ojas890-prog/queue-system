// ============================================
//   admin-dashboard.js
//   All Admin Dashboard Logic
// ============================================

let adminData        = null;
let currentUser      = null;
let adminQueueListener   = null;
let adminCurrentListener = null;

const serviceAvgTime = {
  doctor: 10, bank: 5, billing: 7, enquiry: 5, pharmacy: 4, support: 8
};

/* ========================= */
/* AUTH GUARD                */
/* ========================= */
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;

  const sEmail = window.sanitizeEmail(user.email);
  const snap   = await window.queueDB.ref('admins/' + sEmail).once('value');
  if (!snap.exists()) {
    await firebase.auth().signOut();
    window.location.href = 'index.html';
    return;
  }

  adminData = snap.val();
  document.getElementById('adminBadge').textContent = adminData.fullName;
  loadAdminProfile();
  loadAdminQueue();
  loadOverview();
});

/* ========================= */
/* SECTION SWITCHING         */
/* ========================= */
function showSection(name, el) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-menu li').forEach(li => li.classList.remove('active'));
  document.getElementById('sec-' + name).classList.add('active');
  if (el) el.classList.add('active');
}

/* ========================= */
/* OVERVIEW                  */
/* ========================= */
function loadOverview() {
  window.getAllServicesStats(stats => {
    let totalActive = 0, totalWaiting = 0, totalDone = 0;

    Object.values(stats).forEach(s => {
      totalActive  += s.waiting + s.serving;
      totalWaiting += s.waiting;
      totalDone    += s.done;
    });

    document.getElementById('statActive').textContent  = totalActive;
    document.getElementById('statWaiting').textContent = totalWaiting;
    document.getElementById('statDone').textContent    = totalDone;

    const overviewGrid = document.getElementById('serviceOverview');
    overviewGrid.innerHTML = Object.entries(stats).map(([svc, s]) => {
      const label = window.SERVICE_LABELS[svc] || svc;
      return `
        <div class="svc-mini">
          <h5>${label}</h5>
          <div class="mini-stats">
            <span class="mini-stat ms-w">Waiting: ${s.waiting}</span>
            <span class="mini-stat ms-s">Serving: ${s.serving}</span>
            <span class="mini-stat ms-d">Done: ${s.done}</span>
          </div>
        </div>
      `;
    }).join('');

    // Current serving from this admin's assigned queue
    if (adminData?.queueType) {
      window.queueDB.ref(`queues/${adminData.queueType}/current_token`).once('value', snap => {
        document.getElementById('statServing').textContent = snap.val() || '—';
      });
    }
  });
}

/* ========================= */
/* LOAD ADMIN QUEUE          */
/*   Only shows tokens that  */
/*   belong to THIS admin    */
/* ========================= */
function loadAdminQueue() {
  if (!adminData || !adminData.queueType) return;

  const service = adminData.queueType;
  const adminId = window.sanitizeEmail(currentUser.email); // this admin's node key

  // Clear previous listeners
  if (adminQueueListener)   { adminQueueListener();   adminQueueListener   = null; }
  if (adminCurrentListener) { adminCurrentListener(); adminCurrentListener = null; }

  // Watch current token for THIS admin's service node
  const currentRef = window.queueDB.ref(`queues/${service}/${adminId}/current_token`);
  currentRef.on('value', snap => {
    const token = snap.val() || '—';
    document.getElementById('adminCurrentToken').textContent = token;
    document.getElementById('statServing').textContent       = token;
  });
  adminCurrentListener = () => currentRef.off();

  // Watch ONLY this admin's tokens
  const tokensRef = window.queueDB
    .ref(`queues/${service}/${adminId}/tokens`)
    .orderByChild('timestamp');

  tokensRef.on('value', snap => {
    const tbody = document.getElementById('adminQueueBody');
    const rows  = [];

    snap.forEach(child => {
      const v = child.val();
      if (v.status === 'done' || v.status === 'cancelled') return;

      const pillClass = {
        waiting: 'sp-waiting',
        serving: 'sp-serving',
        skipped: 'sp-skipped'
      }[v.status] || 'sp-done';

      rows.push(`
        <tr>
          <td><strong>${v.token}</strong></td>
          <td>${v.name}</td>
          <td>${new Date(v.timestamp).toLocaleTimeString()}</td>
          <td><span class="status-pill ${pillClass}">${v.status}</span></td>
          <td>
            ${v.status === 'waiting'
              ? `<button class="action-btn" onclick="priorityUp('${service}','${adminId}','${child.key}')">Priority Up</button>`
              : ''}
          </td>
        </tr>
      `);
    });

    tbody.innerHTML = rows.length
      ? rows.join('')
      : '<tr><td colspan="5" class="no-data">Queue is empty</td></tr>';
  });

  adminQueueListener = () => tokensRef.off();
}

/* ========================= */
/* QUEUE CONTROLS            */
/* ========================= */
async function callNext() {
  const service = adminData.queueType;
  const adminId = window.sanitizeEmail(currentUser.email);
  const result  = await window.callNextToken(service, adminId);
  if (!result.success) alert(result.message);
}

async function skipCurrent() {
  const service = adminData.queueType;
  const adminId = window.sanitizeEmail(currentUser.email);
  await window.skipCurrentToken(service, adminId);
}

async function completeCurrent() {
  const service = adminData.queueType;
  const adminId = window.sanitizeEmail(currentUser.email);
  await window.completeCurrentToken(service, adminId);
}

/* ========================= */
/* PRIORITY MOVE             */
/* ========================= */
async function priorityUp(service, adminId, tokenId) {
  const snap = await window.queueDB
    .ref(`queues/${service}/${adminId}/tokens`)
    .orderByChild('timestamp')
    .once('value');

  const tokens = [];
  snap.forEach(child => {
    if (child.val().status === 'waiting') tokens.push({ id: child.key, ...child.val() });
  });

  const idx = tokens.findIndex(t => t.id === tokenId);
  if (idx <= 0) { alert('Already at top of queue.'); return; }

  const prev = tokens[idx - 1];
  const curr = tokens[idx];
  await window.queueDB.ref(`queues/${service}/${adminId}/tokens/${prev.id}`).update({ timestamp: curr.timestamp });
  await window.queueDB.ref(`queues/${service}/${adminId}/tokens/${curr.id}`).update({ timestamp: prev.timestamp });
}

/* ========================= */
/* NOTIFICATIONS             */
/* ========================= */
function setQuickMsg(msg) {
  document.getElementById('notifMessage').value = msg;
}

async function sendNotification() {
  const token   = document.getElementById('notifToken').value.trim();
  const message = document.getElementById('notifMessage').value.trim();
  if (!message) { alert('Please enter a message.'); return; }

  await window.queueDB.ref('notifications').push({
    token:     token || 'ALL',
    message,
    timestamp: Date.now(),
    sentBy:    adminData?.fullName || 'Admin'
  });

  const log  = document.getElementById('notifLog');
  const item = document.createElement('div');
  item.className = 'notif-log-item';
  item.innerHTML = `
    <span>${token ? token + ': ' : 'Broadcast: '} ${message}</span>
    <span style="color:#9ca3af;font-size:11px">${new Date().toLocaleTimeString()}</span>
  `;
  log.prepend(item);

  document.getElementById('notifToken').value   = '';
  document.getElementById('notifMessage').value = '';
}

/* ========================= */
/* RESET QUEUE               */
/* ========================= */
async function resetQueue() {
  if (!confirm('Reset ALL queues? This cannot be undone.')) return;
  const services = Object.keys(window.SERVICE_PREFIX);
  for (const svc of services) {
    await window.queueDB.ref(`queues/${svc}/tokens`).remove();
    await window.queueDB.ref(`queues/${svc}/current_token`).remove();
    await window.queueDB.ref(`queues/${svc}/next_number`).set(1);
  }
  alert('All queues reset.');
  loadOverview();
}

async function resetSpecificQueue() {
  const service = document.getElementById('resetServiceSelect').value;
  if (!service)  { alert('Select a service to reset.'); return; }
  if (!confirm(`Reset the ${service} queue?`)) return;

  const admins = await window.getAdminsForService(service);
  for (const admin of admins) {
    await window.queueDB.ref(`queues/${service}/${admin.id}/tokens`).remove();
    await window.queueDB.ref(`queues/${service}/${admin.id}/current_token`).remove();
  }
  await window.queueDB.ref(`queues/${service}/next_number`).set(1);
  alert(service + ' queue reset.');
}

/* ========================= */
/* ADMIN PROFILE             */
/* ========================= */
function loadAdminProfile() {
  if (!adminData) return;
  document.getElementById('aName').textContent    = adminData.fullName      || '—';
  document.getElementById('aAdminId').textContent = adminData.adminId       || '—';
  document.getElementById('aEmail').textContent   = adminData.emailAddress  || '—';
  document.getElementById('aQueue').textContent   =
    window.SERVICE_LABELS?.[adminData.queueType] || adminData.queueType || '—';
}

/* ========================= */
/* LOGOUT                    */
/* ========================= */
async function logoutAdmin() {
  if (adminQueueListener)   adminQueueListener();
  if (adminCurrentListener) adminCurrentListener();
  await firebase.auth().signOut();
  window.location.href = 'index.html';
}