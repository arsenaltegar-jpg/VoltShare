// ============================================================
// ChargeShare — Supabase Configuration
// Replace these values with your own Supabase project keys.
// Get them from: https://app.supabase.com → Project Settings → API
// ============================================================

const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';

// ============================================================
// App Config
// ============================================================
const APP_CONFIG = {
  appName: 'ChargeShare',
  // The email domain used to auto-grant admin role during dev (remove in prod)
  adminEmail: 'admin@chargesharex.com',
  // Currency symbol
  currency: '$',
  // Platform fee % taken from each booking payment
  platformFeePercent: 10,
};
