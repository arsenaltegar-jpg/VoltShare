-- ============================================================
-- ChargeShare — Supabase Database Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── EXTENSIONS ───────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "postgis"; -- optional: for geo queries

-- ── CLEANUP (optional: drop existing tables for a clean reinstall) ─
-- drop schema public cascade; create schema public;

-- ============================================================
-- 1. PROFILES
-- ============================================================
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text unique,
  full_name       text,
  bio             text,
  avatar_url      text,
  phone           text,
  phone_pending   text,
  ev_model        text,
  role            text not null default 'guest'  check (role in ('guest','host','admin')),
  trust_score     integer not null default 0,
  google_verified boolean not null default false,
  phone_verified  boolean not null default false,
  id_verified     boolean not null default false,
  charger_verified boolean not null default false,
  address_verified boolean not null default false,
  suspended       boolean not null default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Auto-create profile on new user signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, full_name, avatar_url, google_verified)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', ''),
    (new.app_metadata->>'provider' = 'google')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- 2. VERIFICATIONS
-- ============================================================
create table if not exists verifications (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references profiles(id) on delete cascade,
  type        text not null check (type in ('google','phone','id','charger','address')),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  doc_url     text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at  timestamptz default now(),
  unique(user_id, type)
);

-- ============================================================
-- 3. LISTINGS
-- ============================================================
create table if not exists listings (
  id               uuid primary key default uuid_generate_v4(),
  host_id          uuid not null references profiles(id) on delete cascade,
  title            text not null,
  description      text,
  charger_type     text,    -- Level 1, Level 2, DC Fast
  connector_type   text,    -- Type 1, Type 2, CCS, CHAdeMO, Tesla
  power_kw         numeric(6,2),
  price_model      text,    -- per_kwh, per_hour, flat, free
  price            numeric(10,2) default 0,
  address_full     text,    -- hidden until booking confirmed
  city             text,
  postcode         text,
  lat              double precision,
  lng              double precision,
  available_days   integer[] default '{}', -- 0=Sun..6=Sat
  available_from   time,
  available_to     time,
  instant_booking  boolean not null default false,
  approval_required boolean not null default true,
  is_active        boolean not null default true,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ============================================================
-- 4. LISTING PHOTOS
-- ============================================================
create table if not exists listing_photos (
  id          uuid primary key default uuid_generate_v4(),
  listing_id  uuid not null references listings(id) on delete cascade,
  url         text not null,
  "order"     integer default 0,
  created_at  timestamptz default now()
);

-- ============================================================
-- 5. BLOCKED DATES (Host blocks specific dates)
-- ============================================================
create table if not exists blocked_dates (
  id          uuid primary key default uuid_generate_v4(),
  listing_id  uuid not null references listings(id) on delete cascade,
  blocked_date date not null,
  reason      text,
  created_at  timestamptz default now(),
  unique(listing_id, blocked_date)
);

-- ============================================================
-- 6. BOOKINGS
-- ============================================================
create table if not exists bookings (
  id              uuid primary key default uuid_generate_v4(),
  listing_id      uuid not null references listings(id) on delete restrict,
  driver_id       uuid not null references profiles(id) on delete restrict,
  host_id         uuid not null references profiles(id) on delete restrict,
  start_time      timestamptz not null,
  end_time        timestamptz not null,
  status          text not null default 'pending'
                  check (status in ('pending','approved','confirmed','rejected','cancelled','completed')),
  payment_status  text not null default 'pending'
                  check (payment_status in ('pending','paid','refunded','failed')),
  total_amount    numeric(10,2),
  platform_fee    numeric(10,2),
  host_payout     numeric(10,2),
  checked_in_at   timestamptz,
  checked_out_at  timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================
-- 7. PAYMENTS
-- ============================================================
create table if not exists payments (
  id              uuid primary key default uuid_generate_v4(),
  booking_id      uuid not null references bookings(id) on delete restrict,
  payer_id        uuid not null references profiles(id),
  amount          numeric(10,2) not null,
  currency        text default 'USD',
  status          text not null default 'pending'
                  check (status in ('pending','completed','failed','refunded')),
  provider        text,       -- e.g. 'stripe'
  provider_ref    text,       -- external payment ID
  receipt_url     text,
  created_at      timestamptz default now()
);

-- ============================================================
-- 8. REVIEWS
-- ============================================================
create table if not exists reviews (
  id           uuid primary key default uuid_generate_v4(),
  booking_id   uuid not null references bookings(id) on delete cascade,
  listing_id   uuid references listings(id) on delete set null,
  reviewer_id  uuid not null references profiles(id) on delete cascade,
  reviewee_id  uuid not null references profiles(id) on delete cascade,
  rating       integer not null check (rating between 1 and 5),
  comment      text,
  created_at   timestamptz default now(),
  unique(booking_id, reviewer_id)
);

-- ============================================================
-- 9. CONVERSATIONS & MESSAGES
-- ============================================================
create table if not exists conversations (
  id              uuid primary key default uuid_generate_v4(),
  booking_id      uuid references bookings(id) on delete set null,
  participant_a   uuid not null references profiles(id) on delete cascade,
  participant_b   uuid not null references profiles(id) on delete cascade,
  created_at      timestamptz default now()
);

create table if not exists messages (
  id               uuid primary key default uuid_generate_v4(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  sender_id        uuid not null references profiles(id) on delete cascade,
  content          text not null,
  is_read          boolean default false,
  created_at       timestamptz default now()
);

-- ============================================================
-- 10. NOTIFICATIONS
-- ============================================================
create table if not exists notifications (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references profiles(id) on delete cascade,
  type        text not null,
  -- booking_request, booking_approved, booking_rejected,
  -- booking_cancelled, payment_received, review_reminder,
  -- review_received, verification_approved, verification_rejected
  message     text not null,
  ref_id      uuid,   -- booking_id or review_id
  is_read     boolean default false,
  created_at  timestamptz default now()
);

-- ============================================================
-- 11. REPORTS (Disputes / Abuse reports)
-- ============================================================
create table if not exists reports (
  id           uuid primary key default uuid_generate_v4(),
  reporter_id  uuid not null references profiles(id) on delete cascade,
  reported_id  uuid references profiles(id),         -- reported user
  booking_id   uuid references bookings(id),
  listing_id   uuid references listings(id),
  report_type  text,  -- 'dispute','abuse','spam','safety'
  description  text,
  status       text default 'open' check (status in ('open','investigating','resolved')),
  resolved_at  timestamptz,
  resolved_by  uuid references profiles(id),
  created_at   timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_listings_host       on listings(host_id);
create index if not exists idx_listings_active     on listings(is_active);
create index if not exists idx_listings_connector  on listings(connector_type);
create index if not exists idx_bookings_driver     on bookings(driver_id);
create index if not exists idx_bookings_host       on bookings(host_id);
create index if not exists idx_bookings_listing    on bookings(listing_id);
create index if not exists idx_bookings_times      on bookings(start_time, end_time);
create index if not exists idx_messages_conv       on messages(conversation_id);
create index if not exists idx_notifs_user         on notifications(user_id, is_read);
create index if not exists idx_reviews_listing     on reviews(listing_id);
create index if not exists idx_reviews_reviewee    on reviews(reviewee_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
alter table profiles         enable row level security;
alter table verifications    enable row level security;
alter table listings         enable row level security;
alter table listing_photos   enable row level security;
alter table blocked_dates    enable row level security;
alter table bookings         enable row level security;
alter table payments         enable row level security;
alter table reviews          enable row level security;
alter table conversations    enable row level security;
alter table messages         enable row level security;
alter table notifications    enable row level security;
alter table reports          enable row level security;

-- ── PROFILES ─────────────────────────────────────────────────
create policy "Public profiles are viewable by all"
  on profiles for select using (true);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- ── VERIFICATIONS ─────────────────────────────────────────────
create policy "Users can view own verifications"
  on verifications for select using (auth.uid() = user_id);

create policy "Admins can view all verifications"
  on verifications for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "Users can insert own verification requests"
  on verifications for insert with check (auth.uid() = user_id);

create policy "Admins can update verifications"
  on verifications for update
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "Users can upsert own verifications"
  on verifications for update using (auth.uid() = user_id);

-- ── LISTINGS ──────────────────────────────────────────────────
create policy "Active listings are publicly viewable"
  on listings for select using (is_active = true);

create policy "Hosts can view their own listings"
  on listings for select using (auth.uid() = host_id);

create policy "Admins can view all listings"
  on listings for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "Authenticated users can create listings"
  on listings for insert with check (auth.uid() = host_id);

create policy "Hosts can update own listings"
  on listings for update using (auth.uid() = host_id);

create policy "Admins can update any listing"
  on listings for update
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "Hosts can delete own listings"
  on listings for delete using (auth.uid() = host_id);

-- ── LISTING PHOTOS ─────────────────────────────────────────────
create policy "Photos are publicly viewable"
  on listing_photos for select using (true);

create policy "Hosts can manage their listing photos"
  on listing_photos for all
  using (exists (select 1 from listings where id = listing_id and host_id = auth.uid()));

-- ── BLOCKED DATES ─────────────────────────────────────────────
create policy "Anyone can view blocked dates"
  on blocked_dates for select using (true);

create policy "Hosts manage their own blocked dates"
  on blocked_dates for all
  using (exists (select 1 from listings where id = listing_id and host_id = auth.uid()));

-- ── BOOKINGS ──────────────────────────────────────────────────
create policy "Users can view their own bookings"
  on bookings for select using (auth.uid() = driver_id or auth.uid() = host_id);

create policy "Admins can view all bookings"
  on bookings for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "Authenticated users can create bookings"
  on bookings for insert with check (auth.uid() = driver_id);

create policy "Booking participants can update bookings"
  on bookings for update using (auth.uid() = driver_id or auth.uid() = host_id);

create policy "Admins can update any booking"
  on bookings for update
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ── PAYMENTS ──────────────────────────────────────────────────
create policy "Users can view their own payments"
  on payments for select using (auth.uid() = payer_id);

create policy "Admins can view all payments"
  on payments for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "Users can create payments for their bookings"
  on payments for insert with check (auth.uid() = payer_id);

-- ── REVIEWS ───────────────────────────────────────────────────
create policy "Reviews are publicly viewable"
  on reviews for select using (true);

create policy "Users can create reviews for their bookings"
  on reviews for insert
  with check (
    auth.uid() = reviewer_id
    and exists (select 1 from bookings where id = booking_id and (driver_id = auth.uid() or host_id = auth.uid()))
  );

-- ── CONVERSATIONS ──────────────────────────────────────────────
create policy "Participants can view their conversations"
  on conversations for select
  using (auth.uid() = participant_a or auth.uid() = participant_b);

create policy "Authenticated users can create conversations"
  on conversations for insert with check (auth.uid() = participant_a or auth.uid() = participant_b);

-- ── MESSAGES ──────────────────────────────────────────────────
create policy "Conversation participants can view messages"
  on messages for select
  using (
    exists (
      select 1 from conversations
      where id = conversation_id
      and (participant_a = auth.uid() or participant_b = auth.uid())
    )
  );

create policy "Authenticated users can send messages"
  on messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from conversations
      where id = conversation_id
      and (participant_a = auth.uid() or participant_b = auth.uid())
    )
  );

-- ── NOTIFICATIONS ─────────────────────────────────────────────
create policy "Users can view own notifications"
  on notifications for select using (auth.uid() = user_id);

create policy "Service role can insert notifications"
  on notifications for insert with check (true);

create policy "Users can mark own notifications read"
  on notifications for update using (auth.uid() = user_id);

-- ── REPORTS ───────────────────────────────────────────────────
create policy "Users can create reports"
  on reports for insert with check (auth.uid() = reporter_id);

create policy "Users can view own reports"
  on reports for select using (auth.uid() = reporter_id);

create policy "Admins can view and update all reports"
  on reports for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
-- Run these in Supabase Dashboard → Storage → New Bucket
-- Or use the SQL below (requires storage schema access)

insert into storage.buckets (id, name, public)
values
  ('profile-images',         'profile-images',         true),
  ('charger-images',         'charger-images',         true),
  ('verification-documents', 'verification-documents', false),
  ('receipts',               'receipts',               false)
on conflict (id) do nothing;

-- Storage RLS Policies
-- Profile images: owner can upload, public can view
create policy "Profile images are public"
  on storage.objects for select using (bucket_id = 'profile-images');

create policy "Users can upload own profile image"
  on storage.objects for insert with check (
    bucket_id = 'profile-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Charger images: host can upload, public can view
create policy "Charger images are public"
  on storage.objects for select using (bucket_id = 'charger-images');

create policy "Authenticated users can upload charger images"
  on storage.objects for insert with check (
    bucket_id = 'charger-images' and auth.role() = 'authenticated'
  );

-- Verification docs: owner can upload/view, admins can view
create policy "Users can upload own verification docs"
  on storage.objects for insert with check (
    bucket_id = 'verification-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can view own verification docs"
  on storage.objects for select using (
    bucket_id = 'verification-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Receipts
create policy "Users can view own receipts"
  on storage.objects for select using (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- REALTIME
-- ============================================================
-- Enable realtime for messaging and notifications
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table bookings;

-- ============================================================
-- SAMPLE ADMIN USER (update the email below)
-- ============================================================
-- After running this schema and creating your admin account,
-- run this to promote yourself to admin:
-- update profiles set role = 'admin' where email = 'your@email.com';

-- ============================================================
-- DONE
-- ============================================================
-- Your ChargeShare database is ready.
-- Next: update config.js with your Supabase URL and anon key.
-- Then enable Google OAuth in Supabase Auth → Providers → Google.
