// ============================================
//   customer-dashboard.js
//   All Customer Dashboard Logic
// ============================================

let currentUser    = null;
let customerData   = null;
let activeTokenRef = null;
let activeQueueRef = null;
let myActiveToken  = null; // { id, token, service, adminId, adminName }

const AVG_SERVICE_TIME = 5; // minutes per customer (default)

const SERVICES = [
  { key: 'doctor',   label: 'Doctor / OPD',  desc: 'Medical consultation' },
  { key: 'bank',     label: 'Bank Counter',   desc: 'Banking services'     },
  { key: 'billing',  label: 'Billing',        desc: 'Payments & invoices'  },
  { key: 'enquiry',  label: 'Enquiry',        desc: 'General questions'    },
  { key: 'pharmacy', label: 'Pharmacy',       desc: 'Medicine pickup'      },
  { key: 'support',  label: 'Support',        desc: 'Customer support'     }
];

/* ========================= */
/* AUTH GUARD                */
/* ========================= */
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;

  const sEmail = window.sanitizeEmail(user.email);
  const snap   = await window.queueDB.ref('customers/' + sEmail).once('value');
  if (!snap.exists()) {
    await firebase.auth().signOut();
    window.location.href = 'index.html';
    return;
  }

  customerData = snap.val();
  document.getElementById('userBadge').textContent = customerData.fullName;
  loadProfile();
  renderServiceGrid();
  checkExistingToken();
  loadHistory();
});

/* ========================= */
/* SECTION SWITCHING         */
/* ========================= */
function showSection(name, el) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-menu li').forEach(li => li.classList.remove('active'));
  document.getElementById('sec-' + name).classList.add('active');
  if (el) el.classList.add('active');

  if (name === 'myToken')  startLiveStatus();
  if (name === 'history')  loadHistory();
}

/* ========================= */
/* STEP 1 — SERVICE GRID     */
/* ========================= */
function renderServiceGrid() {
  const grid = document.getElementById('serviceGrid');
  grid.innerHTML = SERVICES.map(s => `
    <div class="service-btn" onclick="selectService('${s.key}')">
      <h4>${s.label}</h4>
      <p>${s.desc}</p>
    </div>
  `).join('');

  // Show service grid, hide admin picker
  document.getElementById('serviceGrid').style.display        = 'grid';
  document.getElementById('adminPickerSection').style.display = 'none';
}

function backToServices() {
  renderServiceGrid();
}

/* ========================= */
/* STEP 2 — ADMIN PICKER     */
/*   Shows only admins for   */
/*   the chosen service      */
/* ========================= */
async function selectService(serviceKey) {
  const svc    = SERVICES.find(s => s.key === serviceKey);
  const admins = await window.getAdminsForService(serviceKey);

  if (!admins || admins.length === 0) {
    alert('No admins are currently available for ' + svc.label + '. Please try again later.');
    return;
  }

  // Hide service grid, show admin picker
  document.getElementById('serviceGrid').style.display        = 'none';
  document.getElementById('adminPickerSection').style.display = 'block';
  document.getElementById('adminPickerTitle').textContent     = 'Select Admin for ' + svc.label;

  const adminGrid = document.getElementById('adminGrid');
  adminGrid.innerHTML = admins.map(a => `
    <div class="service-btn" onclick="joinQueue('${serviceKey}', '${a.id}', '${a.name}')">
      <h4>${a.name}</h4>
      <p>${svc.label}</p>
    </div>
  `).join('');
}

/* ========================= */
/* STEP 3 — JOIN QUEUE       */
/* ========================= */
async function joinQueue(service, adminId, adminName) {
  if (myActiveToken) {
    alert('You already have an active token: ' + myActiveToken.token + '. Please cancel it first.');
    return;
  }

  try {
    const result = await window.addToken(customerData.fullName, service, adminId);
    myActiveToken = { ...result, service, adminId, adminName };

    // Persist active token to customer profile
    const sEmail = window.sanitizeEmail(currentUser.email);
    await window.queueDB.ref(`customers/${sEmail}/activeToken`).set({
      tokenId:   result.id,
      token:     result.token,
      service,
      adminId,
      adminName,
      timestamp: Date.now()
    });

    const pos = await getQueuePosition(service, adminId, result.id);

    // Show token card
    const svcLabel = SERVICES.find(s => s.key === service)?.label || service;
    document.getElementById('tokenBadge').textContent       = result.token;
    document.getElementById('tokenServiceName').textContent = svcLabel + ' — ' + adminName;
    document.getElementById('tokenTime').textContent        = new Date().toLocaleTimeString();
    document.getElementById('tokenPosition').textContent    = '#' + pos;
    document.getElementById('tokenWait').textContent        = ((pos - 1) * AVG_SERVICE_TIME) + ' min';
    document.getElementById('tokenResult').style.display   = 'flex';

    // Go back to service grid view (token card is below it)
    document.getElementById('serviceGrid').style.display        = 'grid';
    document.getElementById('adminPickerSection').style.display = 'none';

  } catch (err) {
    alert('Failed to join queue: ' + err.message);
  }
}

/* ========================= */
/* CANCEL TOKEN              */
/* ========================= */
async function cancelMyToken() {
  if (!myActiveToken) return;
  if (!confirm('Cancel your token ' + myActiveToken.token + '?')) return;

  try {
    await window.queueDB
      .ref(`queues/${myActiveToken.service}/${myActiveToken.adminId}/tokens/${myActiveToken.id}`)
      .update({ status: 'cancelled' });

    const sEmail = window.sanitizeEmail(currentUser.email);
    await window.queueDB.ref(`customers/${sEmail}/activeToken`).remove();

    myActiveToken = null;
    document.getElementById('tokenResult').style.display = 'none';
    alert('Token cancelled successfully.');
    loadHistory();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/* ========================= */
/* CHECK EXISTING TOKEN      */
/* ========================= */
async function checkExistingToken() {
  const sEmail = window.sanitizeEmail(currentUser.email);
  const snap   = await window.queueDB.ref(`customers/${sEmail}/activeToken`).once('value');
  if (!snap.exists()) return;

  const at     = snap.val();
  const tSnap  = await window.queueDB
    .ref(`queues/${at.service}/${at.adminId}/tokens/${at.tokenId}`)
    .once('value');

  if (!tSnap.exists()) return;

  const tokenData = tSnap.val();
  if (['done', 'cancelled', 'skipped'].includes(tokenData.status)) {
    await window.queueDB.ref(`customers/${sEmail}/activeToken`).remove();
    return;
  }

  myActiveToken = {
    id: at.tokenId, token: at.token,
    service: at.service, adminId: at.adminId, adminName: at.adminName
  };

  const svcLabel = window.SERVICE_LABELS?.[at.service] || at.service;
  const pos      = await getQueuePosition(at.service, at.adminId, at.tokenId);

  document.getElementById('tokenBadge').textContent       = at.token;
  document.getElementById('tokenServiceName').textContent = svcLabel + ' — ' + at.adminName;
  document.getElementById('tokenTime').textContent        = new Date(at.timestamp).toLocaleTimeString();
  document.getElementById('tokenPosition').textContent    = '#' + pos;
  document.getElementById('tokenWait').textContent        = ((pos - 1) * AVG_SERVICE_TIME) + ' min';
  document.getElementById('tokenResult').style.display   = 'flex';
}

/* ========================= */
/* GET QUEUE POSITION        */
/* ========================= */
async function getQueuePosition(service, adminId, tokenId) {
  const snap = await window.queueDB
    .ref(`queues/${service}/${adminId}/tokens`)
    .orderByChild('timestamp')
    .once('value');

  let pos = 0, found = false;
  snap.forEach(child => {
    const v = child.val();
    if (v.status === 'waiting' || v.status === 'serving') {
      pos++;
      if (child.key === tokenId) found = true;
    }
  });
  return found ? pos : 1;
}

/* ========================= */
/* LIVE STATUS               */
/*   Watches only this       */
/*   admin's queue node      */
/* ========================= */
function startLiveStatus() {
  if (!myActiveToken) {
    document.getElementById('liveMyToken').textContent      = '—';
    document.getElementById('liveCurrentToken').textContent = '—';
    document.getElementById('liveAhead').textContent        = '—';
    document.getElementById('liveWait').textContent         = '—';
    return;
  }

  document.getElementById('liveMyToken').textContent = myActiveToken.token;

  // Watch current_token for THIS admin's node
  if (activeTokenRef) activeTokenRef.off();
  activeTokenRef = window.queueDB
    .ref(`queues/${myActiveToken.service}/${myActiveToken.adminId}/current_token`);
  activeTokenRef.on('value', snap => {
    const cur = snap.val() || '—';
    document.getElementById('liveCurrentToken').textContent = cur;
    checkNotification(cur);
  });

  // Watch ONLY this admin's token list
  if (activeQueueRef) activeQueueRef.off();
  activeQueueRef = window.queueDB
    .ref(`queues/${myActiveToken.service}/${myActiveToken.adminId}/tokens`)
    .orderByChild('timestamp');

  activeQueueRef.on('value', snap => {
    const items  = [];
    let myPos    = 0, counter = 0;

    snap.forEach(child => {
      const v = child.val();
      if (v.status === 'waiting' || v.status === 'serving') {
        counter++;
        items.push({ id: child.key, ...v });
        if (child.key === myActiveToken.id) myPos = counter;
      }
    });

    const ahead = Math.max(0, myPos - 1);
    document.getElementById('liveAhead').textContent = ahead;
    document.getElementById('liveWait').textContent  = (ahead * AVG_SERVICE_TIME) + ' min';
    renderQueueList(items);
  });
}

function renderQueueList(items) {
  const box = document.getElementById('liveQueueList');
  if (!items.length) { box.innerHTML = '<p class="no-data">Queue is empty.</p>'; return; }

  box.innerHTML = items.map(item => `
    <div class="queue-item
      ${item.id === myActiveToken?.id ? 'my-token' : ''}
      ${item.status === 'serving'     ? 'serving'  : ''}">
      <div>
        <div class="token-num">${item.token} ${item.id === myActiveToken?.id ? '(You)' : ''}</div>
        <div class="token-name">${item.name}</div>
      </div>
      <span class="token-status ${item.status === 'serving' ? 'status-serving' : 'status-waiting'}">
        ${item.status === 'serving' ? 'Serving' : 'Waiting'}
      </span>
    </div>
  `).join('');
}

/* ========================= */
/* NOTIFICATIONS             */
/* ========================= */
function checkNotification(currentToken) {
  if (!myActiveToken) return;
  const banner = document.getElementById('notifBanner');
  const myNum  = parseInt(myActiveToken.token.replace(/\D/g, ''));
  const curNum = parseInt((currentToken || '').replace(/\D/g, ''));

  if (myActiveToken.token === currentToken) {
    showBanner('Please proceed to the counter now. It\'s your turn.', banner);
  } else if (!isNaN(myNum) && !isNaN(curNum) && myNum - curNum === 1) {
    showBanner('You are next! Please get ready.', banner);
  } else if (!isNaN(myNum) && !isNaN(curNum) && myNum - curNum <= 3) {
    showBanner('Your turn is near. ' + (myNum - curNum) + ' token(s) ahead.', banner);
  } else {
    banner.style.display = 'none';
  }
}

function showBanner(msg, el) {
  el.textContent    = msg;
  el.style.display  = 'block';
}

/* ========================= */
/* HISTORY                   */
/* ========================= */
async function loadHistory() {
  const box = document.getElementById('historyList');
  box.innerHTML = '<p class="no-data">Loading...</p>';

  try {
    const services  = Object.keys(window.SERVICE_PREFIX);
    const allTokens = [];

    for (const svc of services) {
      // Fetch all admin nodes under this service
      const adminsSnap = await window.queueDB.ref(`queues/${svc}`).once('value');
      adminsSnap.forEach(adminNode => {
        if (adminNode.key === 'current_token' || adminNode.key === 'next_number') return;
        const tokensObj = adminNode.val()?.tokens;
        if (!tokensObj) return;
        Object.entries(tokensObj).forEach(([id, v]) => {
          if (v.name === customerData.fullName) {
            allTokens.push({ id, service: svc, adminId: adminNode.key, ...v });
          }
        });
      });
    }

    allTokens.sort((a, b) => b.timestamp - a.timestamp);

    if (!allTokens.length) {
      box.innerHTML = '<p class="no-data">No history found.</p>';
      return;
    }

    box.innerHTML = allTokens.map(t => {
      const statusClass = t.status === 'done'      ? 'hs-done'
                        : t.status === 'cancelled'  ? 'hs-cancelled'
                        : 'hs-waiting';
      const statusLabel = t.status === 'done'      ? 'Completed'
                        : t.status === 'cancelled'  ? 'Cancelled'
                        : t.status === 'skipped'    ? 'Skipped'
                        : 'Active';
      return `
        <div class="history-item">
          <div class="history-left">
            <div class="history-token">${t.token}</div>
            <div class="history-detail">
              <h5>${window.SERVICE_LABELS?.[t.service] || t.service}</h5>
              <p>${new Date(t.timestamp).toLocaleString()}</p>
            </div>
          </div>
          <span class="history-status ${statusClass}">${statusLabel}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    box.innerHTML = '<p class="no-data">Error loading history.</p>';
  }
}

/* ========================= */
/* PROFILE                   */
/* ========================= */
function loadProfile() {
  document.getElementById('pName').textContent    = customerData.fullName     || '—';
  document.getElementById('pEmail').textContent   = customerData.emailAddress || '—';
  document.getElementById('pContact').textContent = customerData.contactNumber|| '—';
  document.getElementById('pSince').textContent   = customerData.createdAt
    ? new Date(customerData.createdAt).toLocaleDateString() : '—';
}

/* ========================= */
/* LOGOUT                    */
/* ========================= */
async function logoutUser() {
  if (activeTokenRef) activeTokenRef.off();
  if (activeQueueRef) activeQueueRef.off();
  await firebase.auth().signOut();
  window.location.href = 'index.html';
}