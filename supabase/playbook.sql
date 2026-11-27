-- Juice Box Football: Playbook tab storage.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.

-- 1) One playbook document per coach.
create table if not exists public.call_playbooks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"calls":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.call_playbooks enable row level security;

drop policy if exists "call_playbooks: own row" on public.call_playbooks;
create policy "call_playbooks: own row" on public.call_playbooks
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2) Private bucket for play card pictures. Each coach can only touch the folder named after their user id.
insert into storage.buckets (id, name, public)
values ('playbook-cards', 'playbook-cards', false)
on conflict (id) do nothing;

drop policy if exists "playbook-cards: own folder" on storage.objects;
create policy "playbook-cards: own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'playbook-cards' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'playbook-cards' and (storage.foldername(name))[1] = auth.uid()::text);
