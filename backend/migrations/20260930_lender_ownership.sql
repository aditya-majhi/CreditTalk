-- Run after clearing existing application/interview/transcript data.
-- This migration does not delete or assign any existing records.
begin;
alter table public.applications add column if not exists lender_id uuid references auth.users(id);
alter table public.applications alter column lender_id set not null;
create index if not exists idx_applications_lender_created on public.applications(lender_id, created_at desc);
alter table public.applications enable row level security;
alter table public.interviews enable row level security;
alter table public.transcript_turns enable row level security;
revoke all on public.applications, public.interviews, public.transcript_turns from anon, authenticated;
grant select, insert, update, delete on public.applications, public.interviews, public.transcript_turns to service_role;
grant select, insert, update on public.lender_users to service_role;
commit;
