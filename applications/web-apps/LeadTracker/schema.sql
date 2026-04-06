-- ─────────────────────────────────────────────────────────────
--  MIDAS LEAD TRACKER — LinkedIn Supabase Schema
--  Run this entire file in your Supabase SQL Editor
--  (Project → SQL Editor → New query → paste → Run)
-- ─────────────────────────────────────────────────────────────
--  These tables are populated by the local LinkedIn scraper.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.linkedin_received_invites (
  id                  bigint generated always as identity primary key,
  name                text not null default '',
  title               text not null default '',
  sent_at             text not null default '',
  note                text not null default '',
  mutual_connections  text not null default '',
  profile_url         text not null default '',
  status              text not null default 'pending',
  pulled_at           timestamptz not null default now()
);

create table if not exists public.linkedin_message_replies (
  id            bigint generated always as identity primary key,
  name          text not null default '',
  last_message  text not null default '',
  message_date  text not null default '',
  direction     text not null default 'inbound',
  is_unread     boolean not null default false,
  thread_url    text not null default '',
  pulled_at     timestamptz not null default now()
);

create table if not exists public.linkedin_sent_invites (
  id            bigint generated always as identity primary key,
  name          text not null default '',
  title         text not null default '',
  sent_at       text not null default '',
  profile_url   text not null default '',
  status        text not null default 'pending',
  pulled_at     timestamptz not null default now()
);

create table if not exists public.linkedin_accepted_invites (
  id                 bigint generated always as identity primary key,
  name               text not null default '',
  title              text not null default '',
  connected_on       text not null default '',
  connected_on_date  date,
  profile_url        text not null default '',
  pulled_at          timestamptz not null default now()
);

create table if not exists public.linkedin_catch_up (
  id               bigint generated always as identity primary key,
  name             text not null default '',
  title            text not null default '',
  catch_up_type    text not null default 'all',
  event_text       text not null default '',
  action_text      text not null default '',
  reaction_count   integer not null default 0,
  comment_count    integer not null default 0,
  profile_url      text not null default '',
  pulled_at        timestamptz not null default now()
);

create index if not exists linkedin_received_invites_pulled_at_idx
  on public.linkedin_received_invites(pulled_at desc);

create index if not exists linkedin_message_replies_pulled_at_idx
  on public.linkedin_message_replies(pulled_at desc);

create index if not exists linkedin_sent_invites_pulled_at_idx
  on public.linkedin_sent_invites(pulled_at desc);

create index if not exists linkedin_accepted_invites_pulled_at_idx
  on public.linkedin_accepted_invites(pulled_at desc);

create index if not exists linkedin_accepted_invites_connected_on_date_idx
  on public.linkedin_accepted_invites(connected_on_date desc);

create index if not exists linkedin_catch_up_pulled_at_idx
  on public.linkedin_catch_up(pulled_at desc);

alter table public.linkedin_received_invites enable row level security;
alter table public.linkedin_message_replies enable row level security;
alter table public.linkedin_sent_invites enable row level security;
alter table public.linkedin_accepted_invites enable row level security;
alter table public.linkedin_catch_up enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'linkedin_received_invites'
      and policyname = 'Public read linkedin received invites'
  ) then
    create policy "Public read linkedin received invites"
      on public.linkedin_received_invites for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'linkedin_accepted_invites'
      and policyname = 'Public read linkedin accepted invites'
  ) then
    create policy "Public read linkedin accepted invites"
      on public.linkedin_accepted_invites for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'linkedin_catch_up'
      and policyname = 'Public read linkedin catch up'
  ) then
    create policy "Public read linkedin catch up"
      on public.linkedin_catch_up for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'linkedin_message_replies'
      and policyname = 'Public read linkedin message replies'
  ) then
    create policy "Public read linkedin message replies"
      on public.linkedin_message_replies for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'linkedin_sent_invites'
      and policyname = 'Public read linkedin sent invites'
  ) then
    create policy "Public read linkedin sent invites"
      on public.linkedin_sent_invites for select
      using (true);
  end if;
end $$;
