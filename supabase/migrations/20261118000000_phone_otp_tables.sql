-- OTP records are private server data. Edge Functions use the Supabase
-- service role; mobile clients must never read or write these tables.
create table if not exists public.phone_otps (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists phone_otps_phone_created_at_idx
  on public.phone_otps (phone, created_at desc);

create table if not exists public.claimed_phones (
  phone text primary key,
  uid text not null,
  created_at timestamptz not null default now(),
  constraint claimed_phones_uid_unique unique (uid)
);

alter table public.phone_otps enable row level security;
alter table public.claimed_phones enable row level security;

revoke all on table public.phone_otps from anon, authenticated;
revoke all on table public.claimed_phones from anon, authenticated;
grant all on table public.phone_otps to service_role;
grant all on table public.claimed_phones to service_role;
