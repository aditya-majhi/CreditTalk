create extension if not exists "pgcrypto";

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references auth.users(id),
  applicant_name text not null,
  loan_type text not null,
  requested_amount bigint not null,
  loan_purpose text,
  created_at timestamptz not null default now()
);

-- Existing installations must clear their application data before applying
-- this ownership change, or explicitly assign owners before SET NOT NULL.
alter table public.applications add column if not exists lender_id uuid references auth.users(id);
alter table public.applications alter column lender_id set not null;
create index if not exists idx_applications_lender_created on public.applications(lender_id, created_at desc);

create table if not exists interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  status text not null default 'pending',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  analysis_json jsonb,
  credit_bureau_status text not null default 'not_connected',
  consent_reference text,
  borrower_token_hash text unique,
  created_at timestamptz not null default now()
);

alter table interviews add column if not exists borrower_token_hash text unique;

create table if not exists transcript_turns (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references interviews(id) on delete cascade,
  speaker text not null check (speaker in ('borrower', 'agent')),
  text text not null,
  timestamp_ms bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_applications_created_at on applications(created_at desc);
create index if not exists idx_interviews_application on interviews(application_id);
create index if not exists idx_transcript_turns_interview on transcript_turns(interview_id, timestamp_ms);


-- Lender authorization is managed by the backend using the Supabase service role.
-- Add only explicitly approved Supabase Auth users to this table.
create table if not exists public.lender_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.lender_users enable row level security;
revoke all on public.lender_users from anon, authenticated;
grant select, insert, update on public.lender_users to service_role;

-- Browser clients use the authorized backend, never these tables directly.
alter table public.applications enable row level security;
alter table public.interviews enable row level security;
alter table public.transcript_turns enable row level security;
revoke all on public.applications, public.interviews, public.transcript_turns from anon, authenticated;
grant select, insert, update, delete on public.applications, public.interviews, public.transcript_turns to service_role;
