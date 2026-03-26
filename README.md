# ⚡ ChargeShare — EV Charger Slot Marketplace

A complete web-based EV charger sharing marketplace. Hosts list private chargers. Drivers book them. Built with vanilla HTML/CSS/JS + Supabase.

---

## 📁 File Structure

```
chargesharex/
├── index.html          # Main app shell (all pages/modals)
├── styles.css          # Full dark-mode UI styles
├── app.js              # All client-side logic
├── config.js           # ← YOU EDIT THIS FIRST
└── supabase-schema.sql # Full DB schema + RLS + Storage
```

---

## 🚀 Setup in 5 Steps

### 1. Create Supabase Project
- Go to https://app.supabase.com → New project
- Note your **Project URL** and **anon public key** (Settings → API)

### 2. Run the Schema
- Go to Supabase Dashboard → **SQL Editor**
- Paste the entire contents of `supabase-schema.sql`
- Click **Run**

### 3. Enable Google OAuth
- Supabase Dashboard → **Authentication** → **Providers** → Google
- Create OAuth credentials at https://console.cloud.google.com
- Add your GitHub Pages URL to Authorized Redirect URIs:
  `https://YOUR_USERNAME.github.io/YOUR_REPO/`
- Also add to Supabase Auth → URL Configuration → Redirect URLs

### 4. Update config.js
```js
const SUPABASE_URL    = 'https://xxxxxxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...your_anon_key...';
```

### 5. Host on GitHub Pages
- Create a new GitHub repository (public)
- Push all 4 files to the repo root
- Go to repo **Settings** → **Pages** → Source: **main branch / root**
- Your app will be live at: `https://USERNAME.github.io/REPO_NAME/`

---

## 🔑 First Admin Account

After signing up with your email:
1. Go to Supabase Dashboard → **Table Editor** → `profiles`
2. Find your row and change `role` to `admin`

Or run this SQL:
```sql
update profiles set role = 'admin' where email = 'your@email.com';
```

---

## ✨ Features Included

| Feature | Status |
|---|---|
| Google OAuth + Email/Password login | ✅ |
| User roles: guest / host / admin | ✅ |
| Charger listing with full details | ✅ |
| Photos upload to Supabase Storage | ✅ |
| Availability schedule & days | ✅ |
| Instant booking + approval flow | ✅ |
| Booking conflict prevention | ✅ |
| Check-in / check-out | ✅ |
| Address hidden until confirmed | ✅ |
| Real-time messaging | ✅ |
| Star reviews for hosts & drivers | ✅ |
| Trust score system | ✅ |
| Verification badges (Google/Phone/ID/Charger) | ✅ |
| Phone OTP verification (demo code: 123456) | ✅ |
| ID document upload for review | ✅ |
| Push notifications (in-app) | ✅ |
| Real-time notification badge | ✅ |
| Admin: user management & role assignment | ✅ |
| Admin: verification review & approval | ✅ |
| Admin: listing moderation | ✅ |
| Admin: booking oversight | ✅ |
| Admin: dispute/report resolution | ✅ |
| Map view with Leaflet.js | ✅ |
| Search with filters | ✅ |
| Instant enable/disable listing toggle | ✅ |
| Row-Level Security on all tables | ✅ |
| Supabase Storage buckets | ✅ |
| Mobile-responsive UI | ✅ |
| Dark-mode industrial-electric design | ✅ |

---

## 🔧 Notes

- **Phone OTP** is simulated (code: `123456`). In production, integrate Twilio/Supabase Phone Auth.
- **Payments** are tracked in the DB but require a real payment gateway (Stripe) for live transactions.
- **Map** uses free OpenStreetMap via Leaflet. Geocoding (address → lat/lng) requires a geocoding API.
- The `postgis` extension is listed for optional geo queries but not required for basic search.

---

## 🔐 Security

- All tables use Row Level Security (RLS)
- Full addresses are never returned in listing queries — only revealed in booking details after confirmation
- Host phone numbers are stored encrypted in profiles and never exposed in public queries
- Verification documents are in a **private** Supabase Storage bucket

---

## 📄 License

MIT — use freely, modify as you need.
