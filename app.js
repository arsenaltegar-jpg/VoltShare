// ============================================================
// ChargeShare — app.js
// Full client-side application logic
// ============================================================

// ── Supabase init ──────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── App State ─────────────────────────────────────────────
let currentUser = null;
let currentProfile = null;
let currentPage = 'home';
let searchMap = null;
let searchMarkers = [];
let editingListingId = null;
let activeConversationId = null;
let realtimeChannel = null;

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Auth state listener
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      await loadProfile();
      updateNavUser();
      subscribeToNotifications();
    } else {
      currentUser = null;
      currentProfile = null;
      updateNavGuest();
    }
  });

  // ✅ FIX: Wait for Supabase to resolve the session FIRST
  // (handles OAuth redirect tokens in the URL before navigating)
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    await loadProfile();
    updateNavUser();
    subscribeToNotifications();
  }

  // Photo preview wiring
  const lPhotos = document.getElementById('lPhotos');
  if (lPhotos) lPhotos.addEventListener('change', previewPhotos);

  // Filter range live labels
  const fPower = document.getElementById('filterPower');
  const fPrice = document.getElementById('filterPrice');
  if (fPower) fPower.addEventListener('input', () => {
    document.getElementById('filterPowerVal').textContent = fPower.value + ' kW+';
  });
  if (fPrice) fPrice.addEventListener('input', () => {
    const v = parseFloat(fPrice.value);
    document.getElementById('filterPriceVal').textContent = v >= 1 ? 'Any' : '$' + v.toFixed(2);
  });

  // Read URL hash — now safe because session is already resolved
  const hash = location.hash.replace('#', '') || 'home';
  navigate(hash, false);
});

window.addEventListener('popstate', () => {
  const hash = location.hash.replace('#', '') || 'home';
  navigate(hash, false);
});

// ══════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════
function navigate(page, pushState = true) {
  const protectedPages = ['host', 'my-listings', 'my-bookings', 'messages', 'profile', 'dashboard', 'admin', 'notifications'];
  if (protectedPages.includes(page) && !currentUser) {
    openModal('loginModal');
    return;
  }
  if (page === 'admin' && currentProfile?.role !== 'admin') {
    showToast('Access denied', 'error');
    return;
  }

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (!target) { navigate('home'); return; }
  target.classList.add('active');
  currentPage = page;
  if (pushState) history.pushState({}, '', '#' + page);
  window.scrollTo(0, 0);

  // Close avatar dropdown
  const dd = document.getElementById('avatarDropdown');
  if (dd) dd.classList.add('hidden');

  // Page-specific init
  switch (page) {
    case 'search': initSearchPage(); break;
    case 'my-listings': loadMyListings(); break;
    case 'my-bookings': loadMyBookings(); break;
    case 'messages': loadMessages(); break;
    case 'profile': loadProfilePage(); break;
    case 'dashboard': loadDashboard(); break;
    case 'admin': loadAdminPanel(); break;
    case 'notifications': loadNotifications(); break;
    case 'host': initHostForm(); break;
  }

  // Update active nav link
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
}

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
async function loginWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) showToast(error.message, 'error');
}

async function loginWithEmail() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) return showToast('Please fill all fields', 'error');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showToast(error.message, 'error'); return; }
  closeModal('loginModal');
  showToast('Welcome back!', 'success');
  navigate('dashboard');
}

async function registerWithEmail() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  if (!name || !email || !password) return showToast('Please fill all fields', 'error');
  if (password.length < 8) return showToast('Password must be at least 8 characters', 'error');

  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
  if (error) { showToast(error.message, 'error'); return; }

  // Create profile row
  if (data.user) {
    await sb.from('profiles').upsert({
      id: data.user.id,
      email,
      full_name: name,
      role: email === APP_CONFIG.adminEmail ? 'admin' : 'guest',
    });
  }
  closeModal('registerModal');
  showToast('Account created! Please check your email.', 'success');
}

async function logout() {
  await sb.auth.signOut();
  currentUser = null;
  currentProfile = null;
  updateNavGuest();
  navigate('home');
  showToast('Logged out', 'info');
}

// ══════════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════════
async function loadProfile() {
  if (!currentUser) return;
  let { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (!data) {
    // Auto-create on first login (Google OAuth)
    const meta = currentUser.user_metadata || {};
    await sb.from('profiles').insert({
      id: currentUser.id,
      email: currentUser.email,
      full_name: meta.full_name || meta.name || 'New User',
      avatar_url: meta.avatar_url || meta.picture || '',
      role: currentUser.email === APP_CONFIG.adminEmail ? 'admin' : 'guest',
      google_verified: true,
    });
    ({ data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single());
  }
  currentProfile = data;
}

async function updateProfile(e) {
  e.preventDefault();
  if (!currentUser) return;
  const updates = {
    full_name: document.getElementById('editName').value.trim(),
    bio: document.getElementById('editBio').value.trim(),
    ev_model: document.getElementById('editEvModel').value.trim(),
    phone: document.getElementById('editPhone').value.trim(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('profiles').update(updates).eq('id', currentUser.id);
  if (error) { showToast(error.message, 'error'); return; }
  await loadProfile();
  showToast('Profile updated!', 'success');
  loadProfilePage();
}

async function uploadProfilePhoto() {
  const file = document.getElementById('profilePhotoInput').files[0];
  if (!file) return showToast('Please select a photo', 'error');
  const ext = file.name.split('.').pop();
  const path = `avatars/${currentUser.id}.${ext}`;
  const { error: upErr } = await sb.storage.from('profile-images').upload(path, file, { upsert: true });
  if (upErr) { showToast(upErr.message, 'error'); return; }
  const { data: { publicUrl } } = sb.storage.from('profile-images').getPublicUrl(path);
  await sb.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
  await loadProfile();
  showToast('Photo updated!', 'success');
  updateNavUser();
  loadProfilePage();
}

async function sendPhoneOtp() {
  const phone = document.getElementById('phoneVerifyInput').value.trim();
  if (!phone) return showToast('Enter your phone number', 'error');
  // In production use Supabase phone OTP. Here we simulate with a simple approach.
  // Store pending phone in profile
  await sb.from('profiles').update({ phone_pending: phone }).eq('id', currentUser.id);
  document.getElementById('otpSection').classList.remove('hidden');
  showToast('OTP sent (demo: use 123456)', 'info');
}

async function verifyPhoneOtp() {
  const otp = document.getElementById('otpInput').value.trim();
  if (otp !== '123456') return showToast('Invalid OTP', 'error');
  // Mark phone verified
  const { data: prof } = await sb.from('profiles').select('phone_pending').eq('id', currentUser.id).single();
  await sb.from('profiles').update({
    phone: prof?.phone_pending,
    phone_verified: true,
    phone_pending: null,
    trust_score: (currentProfile?.trust_score || 0) + 10
  }).eq('id', currentUser.id);
  // Insert verification record
  await sb.from('verifications').upsert({
    user_id: currentUser.id, type: 'phone', status: 'approved', reviewed_at: new Date().toISOString()
  }, { onConflict: 'user_id,type' });
  await loadProfile();
  showToast('Phone verified! +10 trust score', 'success');
  document.getElementById('otpSection').classList.add('hidden');
  loadProfilePage();
}

async function uploadIdDoc() {
  const file = document.getElementById('idDocInput').files[0];
  if (!file) return showToast('Please select a file', 'error');
  const ext = file.name.split('.').pop();
  const path = `verification-docs/${currentUser.id}/id.${ext}`;
  const { error: upErr } = await sb.storage.from('verification-documents').upload(path, file, { upsert: true });
  if (upErr) { showToast(upErr.message, 'error'); return; }
  await sb.from('verifications').upsert({
    user_id: currentUser.id, type: 'id', status: 'pending', doc_url: path
  }, { onConflict: 'user_id,type' });
  showToast('ID submitted for admin review', 'success');
  loadProfilePage();
}

async function loadProfilePage() {
  if (!currentUser || !currentProfile) return;
  document.getElementById('profileName').textContent = currentProfile.full_name || 'User';
  document.getElementById('profileEmail').textContent = currentProfile.email;
  if (currentProfile.avatar_url) document.getElementById('profileAvatar').src = currentProfile.avatar_url;
  document.getElementById('trustScore').textContent = currentProfile.trust_score || 0;

  document.getElementById('editName').value = currentProfile.full_name || '';
  document.getElementById('editBio').value = currentProfile.bio || '';
  document.getElementById('editEvModel').value = currentProfile.ev_model || '';
  document.getElementById('editPhone').value = currentProfile.phone || '';

  // Badges
  const badges = [];
  if (currentProfile.google_verified) badges.push('<span class="badge badge-google">✓ Google</span>');
  if (currentProfile.phone_verified) badges.push('<span class="badge badge-phone">✓ Phone</span>');
  if (currentProfile.id_verified) badges.push('<span class="badge badge-id">✓ ID</span>');
  if (currentProfile.charger_verified) badges.push('<span class="badge badge-charger">✓ Charger</span>');
  document.getElementById('profileBadges').innerHTML = badges.join('') || '<span class="muted">No badges yet</span>';

  // Verifications
  const { data: verifs } = await sb.from('verifications').select('*').eq('user_id', currentUser.id);
  const vTypes = ['google', 'phone', 'id', 'charger', 'address'];
  const vMap = {};
  (verifs || []).forEach(v => vMap[v.type] = v);
  document.getElementById('verificationList').innerHTML = vTypes.map(t => {
    const v = vMap[t];
    const icon = v?.status === 'approved' ? '✅' : v?.status === 'pending' ? '⏳' : '❌';
    const label = t.charAt(0).toUpperCase() + t.slice(1) + ' Verified';
    return `<div class="verif-row"><span>${icon} ${label}</span><span class="verif-status ${v?.status || 'none'}">${v?.status || 'Not submitted'}</span></div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
// LISTINGS
// ══════════════════════════════════════════════════════════
function initHostForm() {
  if (editingListingId) {
    // Form already pre-filled by editListing()
  } else {
    document.getElementById('listingForm').reset();
    document.getElementById('photoPreview').innerHTML = '';
    document.getElementById('listingSubmitText').textContent = 'Publish Listing';
    editingListingId = null;
  }
}

async function submitListing(e) {
  e.preventDefault();
  if (!currentUser) { openModal('loginModal'); return; }

  const btn = document.getElementById('listingSubmitText');
  btn.textContent = 'Saving...';

  // Gather days
  const days = [...document.querySelectorAll('#dayPicker input:checked')].map(i => parseInt(i.value));

  const listingData = {
    host_id: currentUser.id,
    title: document.getElementById('lTitle').value.trim(),
    description: document.getElementById('lDesc').value.trim(),
    charger_type: document.getElementById('lChargerType').value,
    connector_type: document.getElementById('lConnector').value,
    power_kw: parseFloat(document.getElementById('lPower').value),
    price_model: document.getElementById('lPriceModel').value,
    price: parseFloat(document.getElementById('lPrice').value) || 0,
    address_full: document.getElementById('lAddress').value.trim(),
    city: document.getElementById('lCity').value.trim(),
    postcode: document.getElementById('lPostcode').value.trim(),
    lat: parseFloat(document.getElementById('lLat').value) || null,
    lng: parseFloat(document.getElementById('lLng').value) || null,
    available_days: days,
    available_from: document.getElementById('lTimeFrom').value,
    available_to: document.getElementById('lTimeTo').value,
    instant_booking: document.getElementById('lInstantBooking').checked,
    approval_required: document.getElementById('lApprovalRequired').checked,
    is_active: document.getElementById('lActive').checked,
    updated_at: new Date().toISOString(),
  };

  let listingId = editingListingId;
  let error;

  if (editingListingId) {
    ({ error } = await sb.from('listings').update(listingData).eq('id', editingListingId));
  } else {
    listingData.created_at = new Date().toISOString();
    const res = await sb.from('listings').insert(listingData).select().single();
    error = res.error;
    listingId = res.data?.id;
  }

  if (error) { showToast(error.message, 'error'); btn.textContent = 'Publish Listing'; return; }

  // Upload photos
  const files = document.getElementById('lPhotos').files;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = f.name.split('.').pop();
    const path = `charger-images/${listingId}/${Date.now()}_${i}.${ext}`;
    const { error: upErr } = await sb.storage.from('charger-images').upload(path, f);
    if (!upErr) {
      const { data: { publicUrl } } = sb.storage.from('charger-images').getPublicUrl(path);
      await sb.from('listing_photos').insert({ listing_id: listingId, url: publicUrl, order: i });
    }
  }

  // Update host role
  await sb.from('profiles').update({ role: 'host' }).eq('id', currentUser.id).eq('role', 'guest');
  await loadProfile();

  // Add charger verification request if first listing
  await sb.from('verifications').upsert({
    user_id: currentUser.id, type: 'charger', status: 'pending'
  }, { onConflict: 'user_id,type' });

  showToast(editingListingId ? 'Listing updated!' : 'Listing published!', 'success');
  editingListingId = null;
  navigate('my-listings');
}

async function loadMyListings() {
  const grid = document.getElementById('myListingsGrid');
  grid.innerHTML = '<p class="empty-state">Loading...</p>';
  const { data, error } = await sb.from('listings').select('*, listing_photos(url)').eq('host_id', currentUser.id).order('created_at', { ascending: false });
  if (error || !data?.length) {
    grid.innerHTML = '<p class="empty-state">No listings yet. <a onclick="navigate(\'host\')" style="cursor:pointer">Add your first charger →</a></p>';
    return;
  }
  grid.innerHTML = data.map(l => renderListingCard(l, true)).join('');
}

async function toggleListingActive(id, val) {
  await sb.from('listings').update({ is_active: val }).eq('id', id);
  showToast(val ? 'Listing activated' : 'Listing deactivated', 'info');
  loadMyListings();
}

async function editListing(id) {
  const { data: l } = await sb.from('listings').select('*').eq('id', id).single();
  if (!l) return;
  editingListingId = id;
  navigate('host');
  setTimeout(() => {
    document.getElementById('lTitle').value = l.title || '';
    document.getElementById('lDesc').value = l.description || '';
    document.getElementById('lChargerType').value = l.charger_type || '';
    document.getElementById('lConnector').value = l.connector_type || '';
    document.getElementById('lPower').value = l.power_kw || '';
    document.getElementById('lPriceModel').value = l.price_model || '';
    document.getElementById('lPrice').value = l.price || 0;
    document.getElementById('lAddress').value = l.address_full || '';
    document.getElementById('lCity').value = l.city || '';
    document.getElementById('lPostcode').value = l.postcode || '';
    document.getElementById('lLat').value = l.lat || '';
    document.getElementById('lLng').value = l.lng || '';
    document.getElementById('lTimeFrom').value = l.available_from || '08:00';
    document.getElementById('lTimeTo').value = l.available_to || '22:00';
    document.getElementById('lInstantBooking').checked = !!l.instant_booking;
    document.getElementById('lApprovalRequired').checked = !!l.approval_required;
    document.getElementById('lActive').checked = !!l.is_active;
    document.getElementById('listingSubmitText').textContent = 'Update Listing';
    // Days
    document.querySelectorAll('#dayPicker input').forEach(inp => {
      inp.checked = (l.available_days || []).includes(parseInt(inp.value));
    });
  }, 100);
}

async function deleteListing(id) {
  if (!confirm('Delete this listing? This cannot be undone.')) return;
  await sb.from('listings').delete().eq('id', id);
  showToast('Listing deleted', 'info');
  loadMyListings();
}

function renderListingCard(l, isOwner = false) {
  const photo = l.listing_photos?.[0]?.url || 'https://placehold.co/400x220/1a1a2e/00f5d4?text=Charger';
  const price = l.price_model === 'free' ? 'Free' : `${APP_CONFIG.currency}${l.price} / ${l.price_model?.replace('per_', '')}`;
  const activeLabel = l.is_active ? '<span class="badge-active">● Active</span>' : '<span class="badge-inactive">● Inactive</span>';
  return `
  <div class="listing-card">
    <div class="listing-card-img" style="background-image:url('${photo}')">
      ${isOwner ? `<label class="active-toggle" title="Toggle active">
        <input type="checkbox" ${l.is_active ? 'checked' : ''} onchange="toggleListingActive('${l.id}', this.checked)"/>
        <span class="toggle-switch sm"></span>
      </label>` : ''}
      <div class="listing-badge">${l.connector_type}</div>
    </div>
    <div class="listing-card-body">
      <h3>${escHtml(l.title)}</h3>
      <div class="listing-meta">
        <span>⚡ ${l.power_kw} kW</span>
        <span>📍 ${escHtml(l.city)}</span>
        <span class="listing-price">${price}</span>
      </div>
      <div class="listing-tags">
        ${l.instant_booking ? '<span class="tag tag-instant">⚡ Instant</span>' : ''}
        ${isOwner ? activeLabel : ''}
        ${l.host?.google_verified ? '<span class="tag tag-verified">✓ Verified</span>' : ''}
      </div>
      <div class="listing-actions">
        ${isOwner
          ? `<button class="btn-secondary sm" onclick="editListing('${l.id}')">Edit</button>
             <button class="btn-danger sm" onclick="deleteListing('${l.id}')">Delete</button>`
          : `<button class="btn-primary sm" onclick="viewListing('${l.id}')">View Details</button>`}
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════
async function initSearchPage() {
  await searchListings();
  if (!searchMap) {
    setTimeout(() => {
      searchMap = L.map('searchMap').setView([51.505, -0.09], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(searchMap);
      plotMarkersOnMap(window._lastSearchResults || []);
    }, 200);
  }
}

async function searchListings() {
  const resultsEl = document.getElementById('searchResults');
  if (resultsEl) resultsEl.innerHTML = '<p class="results-loading">Searching...</p>';

  let query = sb.from('listings')
    .select('*, listing_photos(url), profiles!host_id(full_name, google_verified, avatar_url, trust_score)')
    .eq('is_active', true);

  const connector = document.getElementById('filterConnector')?.value;
  const power = parseInt(document.getElementById('filterPower')?.value || 3);
  const price = parseFloat(document.getElementById('filterPrice')?.value || 1);
  const verifiedOnly = document.getElementById('filterVerified')?.checked;
  const instantOnly = document.getElementById('filterInstant')?.checked;

  if (connector) query = query.eq('connector_type', connector);
  if (power > 3) query = query.gte('power_kw', power);
  if (price < 1) query = query.lte('price', price);
  if (verifiedOnly) query = query.eq('profiles.google_verified', true);
  if (instantOnly) query = query.eq('instant_booking', true);

  const { data, error } = await query.limit(50);
  window._lastSearchResults = data || [];

  if (error) { resultsEl.innerHTML = '<p class="empty-state">Error loading results</p>'; return; }
  if (!data?.length) { resultsEl.innerHTML = '<p class="empty-state">No chargers found. Try adjusting your filters.</p>'; return; }

  resultsEl.innerHTML = data.map(l => renderListingCard(l)).join('');
  if (searchMap) plotMarkersOnMap(data);
}

function plotMarkersOnMap(listings) {
  if (!searchMap) return;
  searchMarkers.forEach(m => m.remove());
  searchMarkers = [];
  const valid = listings.filter(l => l.lat && l.lng);
  valid.forEach(l => {
    const m = L.marker([l.lat, l.lng]).addTo(searchMap)
      .bindPopup(`<strong>${escHtml(l.title)}</strong><br/>${l.connector_type} · ${l.power_kw}kW<br/><button onclick="viewListing('${l.id}')">View</button>`);
    searchMarkers.push(m);
  });
  if (valid.length > 0) {
    const group = L.featureGroup(searchMarkers);
    searchMap.fitBounds(group.getBounds().pad(0.2));
  }
}

// ══════════════════════════════════════════════════════════
// LISTING DETAIL
// ══════════════════════════════════════════════════════════
async function viewListing(id) {
  navigate('listing');
  const detail = document.getElementById('listingDetail');
  detail.innerHTML = '<p class="results-loading">Loading...</p>';

  const { data: l } = await sb.from('listings')
    .select('*, listing_photos(url), profiles!host_id(id, full_name, google_verified, phone_verified, id_verified, avatar_url, trust_score, bio)')
    .eq('id', id).single();
  if (!l) { detail.innerHTML = '<p class="empty-state">Listing not found</p>'; return; }

  const { data: reviews } = await sb.from('reviews').select('*, profiles!reviewer_id(full_name, avatar_url)').eq('listing_id', id).order('created_at', { ascending: false });
  const avgRating = reviews?.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : 'No reviews';

  const photos = l.listing_photos?.length
    ? l.listing_photos.map(p => `<img src="${p.url}" alt="Charger photo"/>`).join('')
    : `<img src="https://placehold.co/800x400/1a1a2e/00f5d4?text=Charger+Photo" alt=""/>`;

  const price = l.price_model === 'free' ? 'Free' : `${APP_CONFIG.currency}${l.price} / ${l.price_model?.replace('per_', '')}`;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = (l.available_days || []).map(d => dayNames[d]).join(', ') || 'Not set';

  const host = l.profiles;
  const isOwner = currentUser?.id === l.host_id;
  const canBook = currentUser && !isOwner;

  detail.innerHTML = `
  <div class="listing-full">
    <div class="listing-photos-strip">${photos}</div>
    <div class="listing-full-body">
      <div class="listing-full-main">
        <div class="listing-full-header">
          <div>
            <h1>${escHtml(l.title)}</h1>
            <div class="listing-location">📍 ${escHtml(l.city)}, ${escHtml(l.postcode)} ${isOwner ? `<small>(Full address: ${escHtml(l.address_full)})</small>` : '<small>Full address shown after booking confirmation</small>'}</div>
          </div>
          <div class="listing-rating">${avgRating}${reviews?.length ? ` <span class="muted">(${reviews.length})</span>` : ''}</div>
        </div>
        <div class="listing-specs-grid">
          <div class="spec-item"><span>🔌</span><div><strong>Connector</strong><small>${l.connector_type}</small></div></div>
          <div class="spec-item"><span>⚡</span><div><strong>Power</strong><small>${l.power_kw} kW</small></div></div>
          <div class="spec-item"><span>🚗</span><div><strong>Charger Type</strong><small>${l.charger_type}</small></div></div>
          <div class="spec-item"><span>💰</span><div><strong>Price</strong><small>${price}</small></div></div>
          <div class="spec-item"><span>📅</span><div><strong>Available Days</strong><small>${days}</small></div></div>
          <div class="spec-item"><span>🕐</span><div><strong>Hours</strong><small>${l.available_from || '?'} – ${l.available_to || '?'}</small></div></div>
        </div>
        <div class="listing-desc-section">
          <h3>About this Charger</h3>
          <p>${escHtml(l.description)}</p>
        </div>
        <div class="listing-tags-row">
          ${l.instant_booking ? '<span class="tag tag-instant">⚡ Instant Booking</span>' : '<span class="tag tag-request">📬 Approval Required</span>'}
          ${l.is_active ? '<span class="tag tag-active">● Available</span>' : '<span class="tag tag-inactive">● Unavailable</span>'}
        </div>

        <div class="reviews-section">
          <h3>Reviews (${reviews?.length || 0})</h3>
          ${reviews?.length ? reviews.map(r => `
            <div class="review-card">
              <div class="review-header">
                <img src="${r.profiles?.avatar_url || 'https://ui-avatars.com/api/?name=U'}" class="review-avatar"/>
                <strong>${escHtml(r.profiles?.full_name || 'User')}</strong>
                <span class="review-rating">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
              </div>
              <p>${escHtml(r.comment || '')}</p>
            </div>
          `).join('') : '<p class="muted">No reviews yet.</p>'}
        </div>
      </div>

      <div class="listing-full-sidebar">
        <div class="host-card">
          <img src="${host?.avatar_url || 'https://ui-avatars.com/api/?name=Host'}" class="host-avatar"/>
          <div>
            <strong>${escHtml(host?.full_name || 'Host')}</strong>
            <div class="host-badges">
              ${host?.google_verified ? '<span class="badge badge-google sm">✓ Google</span>' : ''}
              ${host?.phone_verified ? '<span class="badge badge-phone sm">✓ Phone</span>' : ''}
              ${host?.id_verified ? '<span class="badge badge-id sm">✓ ID</span>' : ''}
            </div>
            <div class="host-trust">Trust Score: <strong>${host?.trust_score || 0}</strong></div>
          </div>
        </div>
        ${canBook && l.is_active ? `
          <button class="btn-primary large full-width" onclick="openBookingModal('${l.id}', ${JSON.stringify(l).replace(/"/g, '&quot;')})">
            ${l.instant_booking ? '⚡ Book Instantly' : '📬 Request Booking'}
          </button>
          <button class="btn-secondary full-width" onclick="messageHost('${host?.id}')">💬 Message Host</button>
        ` : isOwner ? '<div class="muted">This is your listing.</div>' : '<div class="muted">Log in to book</div>'}
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════
// BOOKING
// ══════════════════════════════════════════════════════════
function openBookingModal(listingId, listing) {
  if (!currentUser) { openModal('loginModal'); return; }
  const content = document.getElementById('bookingModalContent');
  const price = listing.price_model === 'free' ? 'Free' : `${APP_CONFIG.currency}${listing.price} / ${listing.price_model?.replace('per_', '')}`;
  content.innerHTML = `
    <div class="booking-form">
      <div class="booking-listing-info">
        <strong>${escHtml(listing.title)}</strong>
        <span>${listing.connector_type} · ${listing.power_kw} kW</span>
        <span>${price}</span>
      </div>
      <div class="form-group">
        <label>Start Date & Time *</label>
        <input type="datetime-local" id="bookStart" min="${new Date().toISOString().slice(0,16)}"/>
      </div>
      <div class="form-group">
        <label>End Date & Time *</label>
        <input type="datetime-local" id="bookEnd"/>
      </div>
      <div class="form-group">
        <label>Message to Host (optional)</label>
        <textarea id="bookMsg" rows="3" placeholder="Introduce yourself, mention your EV model..."></textarea>
      </div>
      <div class="booking-notice">
        ${listing.instant_booking
          ? '⚡ This listing supports <strong>instant booking</strong>. Your booking will be confirmed immediately.'
          : '📬 Host <strong>approval is required</strong>. You will be notified once the host accepts.'}
        <br/><small>The full address will be revealed after confirmation.</small>
      </div>
      <button class="btn-primary large full-width" onclick="submitBooking('${listingId}', ${listing.approval_required}, ${listing.instant_booking}, '${listing.host_id}')">
        ${listing.instant_booking ? 'Confirm Booking' : 'Send Request'}
      </button>
    </div>`;
  openModal('bookingModal');
}

async function submitBooking(listingId, approvalRequired, instantBooking, hostId) {
  const start = document.getElementById('bookStart').value;
  const end = document.getElementById('bookEnd').value;
  const msg = document.getElementById('bookMsg').value.trim();
  if (!start || !end) return showToast('Please select start and end time', 'error');
  if (new Date(end) <= new Date(start)) return showToast('End time must be after start time', 'error');

  // Check for conflicts
  const { data: conflicts } = await sb.from('bookings')
    .select('id')
    .eq('listing_id', listingId)
    .in('status', ['pending', 'approved', 'confirmed'])
    .lt('start_time', end)
    .gt('end_time', start);

  if (conflicts?.length) { showToast('This slot is already booked. Choose a different time.', 'error'); return; }

  const status = (instantBooking && !approvalRequired) ? 'confirmed' : 'pending';

  const { data: booking, error } = await sb.from('bookings').insert({
    listing_id: listingId,
    driver_id: currentUser.id,
    host_id: hostId,
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    status,
    payment_status: 'pending',
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) { showToast(error.message, 'error'); return; }

  // Initial message
  if (msg) {
    const { data: conv } = await sb.from('conversations').insert({
      booking_id: booking.id, participant_a: currentUser.id, participant_b: hostId
    }).select().single();
    await sb.from('messages').insert({
      conversation_id: conv.id, sender_id: currentUser.id, content: msg
    });
  }

  // Notification for host
  await createNotification(hostId, 'booking_request', `New booking ${status === 'confirmed' ? 'confirmed' : 'request'} for your charger`, booking.id);

  if (status === 'confirmed') {
    await createNotification(currentUser.id, 'booking_confirmed', 'Your booking is confirmed! The address has been revealed.', booking.id);
  }

  closeModal('bookingModal');
  showToast(status === 'confirmed' ? 'Booking confirmed!' : 'Booking request sent!', 'success');
  navigate('my-bookings');
}

async function loadMyBookings() {
  loadBookingsDriver();
  loadBookingsHost();
}

async function loadBookingsDriver() {
  const el = document.getElementById('bookingsDriver');
  const { data } = await sb.from('bookings')
    .select('*, listings(title, city, connector_type, address_full), profiles!host_id(full_name, avatar_url)')
    .eq('driver_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (!data?.length) { el.innerHTML = '<p class="empty-state">No bookings as driver yet.</p>'; return; }
  el.innerHTML = data.map(b => renderBookingCard(b, 'driver')).join('');
}

async function loadBookingsHost() {
  const el = document.getElementById('bookingsHost');
  const { data } = await sb.from('bookings')
    .select('*, listings(title, city, connector_type, address_full), profiles!driver_id(full_name, avatar_url)')
    .eq('host_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (!data?.length) { el.innerHTML = '<p class="empty-state">No booking requests for your listings yet.</p>'; return; }
  el.innerHTML = data.map(b => renderBookingCard(b, 'host')).join('');
}

function renderBookingCard(b, role) {
  const statusColors = { pending: 'orange', confirmed: 'green', approved: 'green', rejected: 'red', cancelled: 'gray', completed: 'blue' };
  const col = statusColors[b.status] || 'gray';
  const other = role === 'driver' ? b.profiles : b.profiles;
  const listing = b.listings;
  const startStr = b.start_time ? new Date(b.start_time).toLocaleString() : '?';
  const endStr = b.end_time ? new Date(b.end_time).toLocaleString() : '?';
  const showAddress = ['confirmed', 'approved', 'completed'].includes(b.status);

  return `
  <div class="booking-card">
    <div class="booking-card-header">
      <div>
        <strong>${escHtml(listing?.title || 'Charger')}</strong>
        <div class="muted">${listing?.city} · ${listing?.connector_type}</div>
        ${showAddress ? `<div class="address-reveal">📍 ${escHtml(listing?.address_full || '')}</div>` : ''}
      </div>
      <span class="status-badge" style="--status-color:${col}">${b.status}</span>
    </div>
    <div class="booking-times">
      <span>🕐 ${startStr}</span> → <span>${endStr}</span>
    </div>
    <div class="booking-actions">
      ${role === 'host' && b.status === 'pending' ? `
        <button class="btn-primary sm" onclick="approveBooking('${b.id}')">Approve</button>
        <button class="btn-danger sm" onclick="rejectBooking('${b.id}')">Decline</button>
      ` : ''}
      ${b.status === 'confirmed' || b.status === 'approved' ? `
        <button class="btn-secondary sm" onclick="checkIn('${b.id}')">Check In</button>
        <button class="btn-secondary sm" onclick="checkOut('${b.id}')">Check Out</button>
      ` : ''}
      ${b.status === 'completed' && role === 'driver' ? `
        <button class="btn-secondary sm" onclick="openReviewModal('${b.id}', '${b.host_id}', '${b.listing_id}')">Leave Review</button>
      ` : ''}
      ${['pending', 'confirmed', 'approved'].includes(b.status) ? `
        <button class="btn-ghost sm" onclick="cancelBooking('${b.id}', '${role}')">Cancel</button>
      ` : ''}
      <button class="btn-ghost sm" onclick="openConversationForBooking('${b.id}')">💬 Message</button>
    </div>
  </div>`;
}

async function approveBooking(id) {
  const { data: b } = await sb.from('bookings').select('driver_id, listing_id').eq('id', id).single();
  await sb.from('bookings').update({ status: 'approved' }).eq('id', id);
  await createNotification(b.driver_id, 'booking_approved', 'Your booking request was approved! Address revealed.', id);
  showToast('Booking approved', 'success');
  loadMyBookings();
}

async function rejectBooking(id) {
  const { data: b } = await sb.from('bookings').select('driver_id').eq('id', id).single();
  await sb.from('bookings').update({ status: 'rejected' }).eq('id', id);
  await createNotification(b.driver_id, 'booking_rejected', 'Your booking request was declined by the host.', id);
  showToast('Booking declined', 'info');
  loadMyBookings();
}

async function cancelBooking(id, role) {
  if (!confirm('Cancel this booking?')) return;
  const { data: b } = await sb.from('bookings').select('driver_id, host_id').eq('id', id).single();
  await sb.from('bookings').update({ status: 'cancelled' }).eq('id', id);
  const otherParty = role === 'driver' ? b.host_id : b.driver_id;
  await createNotification(otherParty, 'booking_cancelled', 'A booking was cancelled.', id);
  showToast('Booking cancelled', 'info');
  loadMyBookings();
}

async function checkIn(id) {
  await sb.from('bookings').update({ checked_in_at: new Date().toISOString() }).eq('id', id);
  showToast('Checked in!', 'success');
  loadMyBookings();
}

async function checkOut(id) {
  const { data: b } = await sb.from('bookings').select('host_id').eq('id', id).single();
  await sb.from('bookings').update({ checked_out_at: new Date().toISOString(), status: 'completed', payment_status: 'paid' }).eq('id', id);
  await createNotification(b.host_id, 'payment_received', 'Payment for booking received!', id);
  await createNotification(currentUser.id, 'review_reminder', 'How was your charging experience? Leave a review!', id);
  showToast('Checked out! Booking completed.', 'success');
  loadMyBookings();
}

// ══════════════════════════════════════════════════════════
// REVIEWS
// ══════════════════════════════════════════════════════════
function openReviewModal(bookingId, hostId, listingId) {
  const content = document.getElementById('reviewModalContent');
  content.innerHTML = `
    <div class="review-form">
      <div class="star-picker" id="starPicker">
        ${[1,2,3,4,5].map(n => `<span class="star" onclick="setRating(${n})" data-val="${n}">☆</span>`).join('')}
      </div>
      <div class="form-group">
        <label>Your review</label>
        <textarea id="reviewText" rows="4" placeholder="Share your experience..."></textarea>
      </div>
      <button class="btn-primary full-width" onclick="submitReview('${bookingId}','${hostId}','${listingId}')">Submit Review</button>
    </div>`;
  openModal('reviewModal');
}

let selectedRating = 0;
function setRating(n) {
  selectedRating = n;
  document.querySelectorAll('#starPicker .star').forEach(s => {
    s.textContent = parseInt(s.dataset.val) <= n ? '★' : '☆';
  });
}

async function submitReview(bookingId, revieweeId, listingId) {
  if (!selectedRating) return showToast('Please select a rating', 'error');
  const comment = document.getElementById('reviewText').value.trim();
  const { error } = await sb.from('reviews').insert({
    booking_id: bookingId, reviewer_id: currentUser.id, reviewee_id: revieweeId,
    listing_id: listingId, rating: selectedRating, comment,
    created_at: new Date().toISOString()
  });
  if (error) { showToast(error.message, 'error'); return; }
  // Update trust score of reviewee
  const { data: reviews } = await sb.from('reviews').select('rating').eq('reviewee_id', revieweeId);
  if (reviews?.length) {
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    await sb.from('profiles').update({ trust_score: Math.round(avg * 20) }).eq('id', revieweeId);
  }
  await createNotification(revieweeId, 'review_received', 'You received a new review!', bookingId);
  closeModal('reviewModal');
  showToast('Review submitted!', 'success');
}

// ══════════════════════════════════════════════════════════
// MESSAGES
// ══════════════════════════════════════════════════════════
async function loadMessages() {
  const convList = document.getElementById('convList');
  const { data } = await sb.from('conversations')
    .select('*, bookings(id, listings(title)), profiles!participant_a(full_name, avatar_url), profiles!participant_b(full_name, avatar_url)')
    .or(`participant_a.eq.${currentUser.id},participant_b.eq.${currentUser.id}`)
    .order('created_at', { ascending: false });

  if (!data?.length) { convList.innerHTML = '<p class="muted">No messages yet.</p>'; return; }

  convList.innerHTML = data.map(c => {
    const other = c.participant_a === currentUser.id ? c.profiles_participant_b : c.profiles_participant_a;
    const otherProfile = Array.isArray(c.profiles) ? c.profiles.find(p => p) : other;
    const name = c.participant_a === currentUser.id
      ? c['profiles!participant_b']?.full_name || 'User'
      : c['profiles!participant_a']?.full_name || 'User';
    return `<div class="conv-item ${activeConversationId === c.id ? 'active' : ''}" onclick="openConversation('${c.id}', '${name}')">
      <div class="conv-name">${escHtml(name)}</div>
      <div class="conv-listing muted">${c.bookings?.listings?.title || ''}</div>
    </div>`;
  }).join('');
}

async function openConversation(convId, otherName) {
  activeConversationId = convId;
  const chatArea = document.getElementById('chatArea');
  chatArea.innerHTML = `
    <div class="chat-header"><strong>${escHtml(otherName)}</strong></div>
    <div class="chat-messages" id="chatMessages"></div>
    <div class="chat-input-row">
      <input type="text" id="chatInput" placeholder="Type a message..." onkeydown="if(event.key==='Enter') sendMessage('${convId}')"/>
      <button class="btn-primary" onclick="sendMessage('${convId}')">Send</button>
    </div>`;
  await loadChatMessages(convId);

  // Subscribe to new messages
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel('chat:' + convId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, () => loadChatMessages(convId))
    .subscribe();
}

async function loadChatMessages(convId) {
  const { data } = await sb.from('messages').select('*, profiles!sender_id(full_name, avatar_url)').eq('conversation_id', convId).order('created_at', { ascending: true });
  const el = document.getElementById('chatMessages');
  if (!el) return;
  el.innerHTML = (data || []).map(m => {
    const mine = m.sender_id === currentUser.id;
    return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}">
      <div class="chat-bubble">${escHtml(m.content)}</div>
      <div class="chat-time">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function sendMessage(convId) {
  const input = document.getElementById('chatInput');
  const content = input?.value.trim();
  if (!content) return;
  input.value = '';
  await sb.from('messages').insert({ conversation_id: convId, sender_id: currentUser.id, content, created_at: new Date().toISOString() });
}

async function messageHost(hostId) {
  if (!currentUser) { openModal('loginModal'); return; }
  // Find or create conversation
  let { data: existing } = await sb.from('conversations')
    .select('id')
    .or(`and(participant_a.eq.${currentUser.id},participant_b.eq.${hostId}),and(participant_a.eq.${hostId},participant_b.eq.${currentUser.id})`)
    .limit(1).single();

  let convId = existing?.id;
  if (!convId) {
    const { data: newConv } = await sb.from('conversations').insert({ participant_a: currentUser.id, participant_b: hostId }).select().single();
    convId = newConv?.id;
  }
  navigate('messages');
  setTimeout(() => openConversation(convId, 'Host'), 300);
}

async function openConversationForBooking(bookingId) {
  const { data: conv } = await sb.from('conversations').select('id').eq('booking_id', bookingId).single();
  if (!conv) return showToast('No conversation for this booking yet. Use the message host button on the listing.', 'info');
  navigate('messages');
  setTimeout(() => openConversation(conv.id, 'Other Party'), 300);
}

function switchBookingTab(tab) {
  document.querySelectorAll('.tabs .tab').forEach((t, i) => t.classList.toggle('active', (tab === 'driver' && i === 0) || (tab === 'host' && i === 1)));
  document.getElementById('bookingsDriver').classList.toggle('hidden', tab !== 'driver');
  document.getElementById('bookingsHost').classList.toggle('hidden', tab !== 'host');
}

// ══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════
async function createNotification(userId, type, message, refId = null) {
  await sb.from('notifications').insert({ user_id: userId, type, message, ref_id: refId, created_at: new Date().toISOString() });
}

function subscribeToNotifications() {
  if (!currentUser) return;
  try {
    sb.channel('notifs:' + currentUser.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, (payload) => {
        showToast(payload.new.message, 'info');
        updateNotifBadge();
      })
      .subscribe((status, err) => {
        if (err) console.warn('Realtime unavailable (non-fatal):', err.message);
      });
  } catch (e) {
    console.warn('Realtime channel setup failed (non-fatal):', e.message);
  }
  updateNotifBadge();
}

async function updateNotifBadge() {
  if (!currentUser) return;
  const { count } = await sb.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id).eq('is_read', false);
  const badge = document.getElementById('notifBadge');
  if (badge) {
    badge.textContent = count || 0;
    badge.classList.toggle('hidden', !count);
  }
}

async function loadNotifications() {
  const el = document.getElementById('notificationsList');
  const { data } = await sb.from('notifications').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (!data?.length) { el.innerHTML = '<p class="empty-state">No notifications yet.</p>'; return; }
  el.innerHTML = data.map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markNotifRead('${n.id}')">
      <div class="notif-msg">${escHtml(n.message)}</div>
      <div class="notif-time muted">${new Date(n.created_at).toLocaleString()}</div>
    </div>
  `).join('');
  // Mark all read
  await sb.from('notifications').update({ is_read: true }).eq('user_id', currentUser.id).eq('is_read', false);
  updateNotifBadge();
}

async function markNotifRead(id) {
  await sb.from('notifications').update({ is_read: true }).eq('id', id);
}

// ══════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════
async function loadDashboard() {
  // Stats
  const [{ count: myListings }, { count: myBookingsDriver }, { count: pendingRequests }] = await Promise.all([
    sb.from('listings').select('*', { count: 'exact', head: true }).eq('host_id', currentUser.id),
    sb.from('bookings').select('*', { count: 'exact', head: true }).eq('driver_id', currentUser.id),
    sb.from('bookings').select('*', { count: 'exact', head: true }).eq('host_id', currentUser.id).eq('status', 'pending'),
  ]);

  document.getElementById('dashStats').innerHTML = `
    <div class="dash-stat"><span class="ds-num">${myListings || 0}</span><span class="ds-label">My Listings</span></div>
    <div class="dash-stat"><span class="ds-num">${myBookingsDriver || 0}</span><span class="ds-label">My Bookings</span></div>
    <div class="dash-stat"><span class="ds-num">${pendingRequests || 0}</span><span class="ds-label">Pending Requests</span></div>
    <div class="dash-stat"><span class="ds-num">${currentProfile?.trust_score || 0}</span><span class="ds-label">Trust Score</span></div>`;

  // Recent bookings
  const { data: recentB } = await sb.from('bookings').select('*, listings(title)').eq('driver_id', currentUser.id).order('created_at', { ascending: false }).limit(5);
  document.getElementById('dashBookings').innerHTML = recentB?.length
    ? recentB.map(b => `<div class="dash-item"><span>${escHtml(b.listings?.title || '?')}</span><span class="status-badge" style="--status-color:${b.status === 'confirmed' ? 'green' : 'orange'}">${b.status}</span></div>`).join('')
    : '<p class="muted">No bookings yet.</p>';

  // Recent notifs
  const { data: notifs } = await sb.from('notifications').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(5);
  document.getElementById('dashNotifs').innerHTML = notifs?.length
    ? notifs.map(n => `<div class="dash-item"><span>${escHtml(n.message)}</span><span class="muted">${new Date(n.created_at).toLocaleDateString()}</span></div>`).join('')
    : '<p class="muted">No notifications.</p>';
}

// ══════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════
async function loadAdminPanel() {
  if (currentProfile?.role !== 'admin') { navigate('home'); return; }
  switchAdminTab('verifications');
}

async function switchAdminTab(tab) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  const tabs = ['verifications', 'listings', 'bookings', 'reports', 'users'];
  const idx = tabs.indexOf(tab);
  document.querySelectorAll('.tabs .tab')[idx]?.classList.add('active');

  const content = document.getElementById('adminContent');
  content.innerHTML = '<p class="results-loading">Loading...</p>';

  switch (tab) {
    case 'verifications': await adminVerifications(content); break;
    case 'listings': await adminListings(content); break;
    case 'bookings': await adminBookings(content); break;
    case 'reports': await adminReports(content); break;
    case 'users': await adminUsers(content); break;
  }
}

async function adminVerifications(el) {
  const { data } = await sb.from('verifications').select('*, profiles!user_id(full_name, email)').eq('status', 'pending');
  if (!data?.length) { el.innerHTML = '<p class="empty-state">No pending verifications.</p>'; return; }
  el.innerHTML = `<table class="admin-table">
    <thead><tr><th>User</th><th>Email</th><th>Type</th><th>Actions</th></tr></thead>
    <tbody>${data.map(v => `<tr>
      <td>${escHtml(v.profiles?.full_name || '?')}</td>
      <td>${escHtml(v.profiles?.email || '?')}</td>
      <td>${v.type}</td>
      <td>
        <button class="btn-primary sm" onclick="adminApproveVerif('${v.id}', '${v.user_id}', '${v.type}')">Approve</button>
        <button class="btn-danger sm" onclick="adminRejectVerif('${v.id}')">Reject</button>
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function adminApproveVerif(verifId, userId, type) {
  await sb.from('verifications').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id }).eq('id', verifId);
  // Update profile flag
  const fieldMap = { id: 'id_verified', phone: 'phone_verified', charger: 'charger_verified', address: 'address_verified', google: 'google_verified' };
  if (fieldMap[type]) {
    const upd = { [fieldMap[type]]: true, trust_score: sb.rpc('increment', { row_id: userId, amount: 15 }) };
    await sb.from('profiles').update({ [fieldMap[type]]: true }).eq('id', userId);
  }
  await createNotification(userId, 'verification_approved', `Your ${type} verification was approved! Trust score +15`, verifId);
  showToast('Verification approved', 'success');
  switchAdminTab('verifications');
}

async function adminRejectVerif(verifId) {
  await sb.from('verifications').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id }).eq('id', verifId);
  showToast('Verification rejected', 'info');
  switchAdminTab('verifications');
}

async function adminListings(el) {
  const { data } = await sb.from('listings').select('*, profiles!host_id(full_name, email)').order('created_at', { ascending: false }).limit(50);
  el.innerHTML = `<table class="admin-table">
    <thead><tr><th>Title</th><th>Host</th><th>City</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${(data || []).map(l => `<tr>
      <td>${escHtml(l.title)}</td><td>${escHtml(l.profiles?.full_name || '?')}</td>
      <td>${escHtml(l.city)}</td>
      <td><span style="color:${l.is_active ? 'green' : 'gray'}">${l.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>
        <button class="btn-danger sm" onclick="adminDeactivateListing('${l.id}')">Deactivate</button>
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function adminDeactivateListing(id) {
  await sb.from('listings').update({ is_active: false }).eq('id', id);
  showToast('Listing deactivated', 'info');
  switchAdminTab('listings');
}

async function adminBookings(el) {
  const { data } = await sb.from('bookings').select('*, listings(title), profiles!driver_id(full_name)').order('created_at', { ascending: false }).limit(50);
  el.innerHTML = `<table class="admin-table">
    <thead><tr><th>Listing</th><th>Driver</th><th>Start</th><th>Status</th><th>Payment</th></tr></thead>
    <tbody>${(data || []).map(b => `<tr>
      <td>${escHtml(b.listings?.title || '?')}</td>
      <td>${escHtml(b.profiles?.full_name || '?')}</td>
      <td>${new Date(b.start_time).toLocaleString()}</td>
      <td>${b.status}</td>
      <td>${b.payment_status}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function adminReports(el) {
  const { data } = await sb.from('reports').select('*, profiles!reporter_id(full_name)').order('created_at', { ascending: false });
  if (!data?.length) { el.innerHTML = '<p class="empty-state">No reports.</p>'; return; }
  el.innerHTML = `<table class="admin-table">
    <thead><tr><th>Reporter</th><th>Type</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${data.map(r => `<tr>
      <td>${escHtml(r.profiles?.full_name || '?')}</td>
      <td>${r.report_type}</td>
      <td>${escHtml(r.description || '')}</td>
      <td>${r.status}</td>
      <td><button class="btn-secondary sm" onclick="adminResolveReport('${r.id}')">Resolve</button></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function adminResolveReport(id) {
  await sb.from('reports').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
  showToast('Report resolved', 'success');
  switchAdminTab('reports');
}

async function adminUsers(el) {
  const { data } = await sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(100);
  el.innerHTML = `<table class="admin-table">
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Trust</th><th>Actions</th></tr></thead>
    <tbody>${(data || []).map(u => `<tr>
      <td>${escHtml(u.full_name || '?')}</td>
      <td>${escHtml(u.email || '')}</td>
      <td>
        <select onchange="adminSetRole('${u.id}', this.value)">
          <option ${u.role === 'guest' ? 'selected' : ''}>guest</option>
          <option ${u.role === 'host' ? 'selected' : ''}>host</option>
          <option ${u.role === 'admin' ? 'selected' : ''}>admin</option>
        </select>
      </td>
      <td>${u.trust_score || 0}</td>
      <td><button class="btn-danger sm" onclick="adminSuspendUser('${u.id}')">Suspend</button></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function adminSetRole(userId, role) {
  await sb.from('profiles').update({ role }).eq('id', userId);
  showToast('Role updated', 'success');
}

async function adminSuspendUser(userId) {
  if (!confirm('Suspend this user?')) return;
  await sb.from('profiles').update({ suspended: true }).eq('id', userId);
  showToast('User suspended', 'info');
}

// ══════════════════════════════════════════════════════════
// PHOTO PREVIEW
// ══════════════════════════════════════════════════════════
function previewPhotos() {
  const files = document.getElementById('lPhotos').files;
  const preview = document.getElementById('photoPreview');
  preview.innerHTML = '';
  [...files].forEach(f => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    img.className = 'photo-thumb';
    preview.appendChild(img);
  });
}

// ══════════════════════════════════════════════════════════
// NAV HELPERS
// ══════════════════════════════════════════════════════════
function updateNavUser() {
  document.getElementById('navActions').classList.add('hidden');
  document.getElementById('navUser').classList.remove('hidden');
  if (currentProfile) {
    const name = currentProfile.full_name || 'User';
    document.getElementById('dropdownName').textContent = name;
    document.getElementById('dropdownEmail').textContent = currentProfile.email;
    document.getElementById('navAvatar').src = currentProfile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1a1a2e&color=00f5d4`;
    if (currentProfile.role === 'admin') document.getElementById('adminLink').classList.remove('hidden');
  }
}

function updateNavGuest() {
  document.getElementById('navActions').classList.remove('hidden');
  document.getElementById('navUser').classList.add('hidden');
}

function toggleAvatarMenu() {
  document.getElementById('avatarDropdown').classList.toggle('hidden');
}

function toggleMobileMenu() {
  document.getElementById('navLinks').classList.toggle('mobile-open');
}

// ══════════════════════════════════════════════════════════
// MODAL HELPERS
// ══════════════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function handleModalBgClick(e, id) {
  if (e.target.id === id) closeModal(id);
}

function switchModal(from, to) {
  closeModal(from);
  openModal(to);
}

// ══════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3500);
}

// ══════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════
function escHtml(s) {
  if (!s) return '';
  return s.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Close dropdown on outside click
document.addEventListener('click', e => {
  const dd = document.getElementById('avatarDropdown');
  const menu = document.getElementById('avatarMenu');
  if (dd && menu && !menu.contains(e.target)) dd.classList.add('hidden');
});
