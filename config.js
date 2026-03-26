// ============================================================
// ChargeShare — Supabase Configuration
// Replace these values with your own Supabase project keys.
// Get them from: https://app.supabase.com → Project Settings → API
// ============================================================

const SUPABASE_URL = 'https://qbsjdpxshccqhcobmdjq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DWhjtQ26UuRIc3JZt230GQ_MVJZVnnW';

// ============================================================
// App Config
// ============================================================
const APP_CONFIG = {
  appName: 'VoltShare',
  // The email domain used to auto-grant admin role during dev (remove in prod)
  adminEmail: 'admin@VoltShare.com',
  // Currency symbol
  currency: '$',
  // Platform fee % taken from each booking payment
  platformFeePercent: 10,
};
