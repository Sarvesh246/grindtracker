-- Phase 9: in-app feedback + developer-only inbox
-- Idempotent: safe to re-run.
--
-- Security model: the developer inbox is enforced in the DATABASE, not the UI.
-- `is_grind_admin()` is the single source of truth — the /admin/feedback route
-- guard is only a convenience so non-admins get a 404 instead of an empty page.

-- ── Admin predicate ────────────────────────────────────────────────────────
-- security definer so it can read auth.users (the caller can't). Reading the
-- table rather than `auth.jwt() ->> 'email'` means the check still holds if a
-- session's JWT carries a stale or absent email claim.
create or replace function is_grind_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select lower(u.email) = 'sarveshvjagtap@gmail.com'
       from auth.users u
      where u.id = auth.uid()),
    false
  );
$$;

revoke all on function is_grind_admin() from public;
grant execute on function is_grind_admin() to authenticated;

-- ── Table ──────────────────────────────────────────────────────────────────

create table if not exists feedback (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  -- Identity snapshot taken at submit time, so the inbox still shows who sent
  -- something after a username change or account deletion.
  username     text,
  email        text,
  category     text        not null default 'other'
                           check (category in ('bug','feature','improvement','other')),
  message      text        not null
                           check (char_length(btrim(message)) between 1 and 4000),
  -- Storage object paths in the private `feedback-images` bucket. Signed URLs
  -- are minted server-side when the inbox renders.
  image_paths  text[]      not null default '{}',
  -- User-facing "submit anonymously". user_id is still recorded for abuse
  -- control; the inbox hides identity unless explicitly unhidden.
  is_anonymous boolean     not null default false,
  is_read      boolean     not null default false,
  is_starred   boolean     not null default false,
  created_at   timestamptz not null default now()
);

alter table feedback enable row level security;

-- Anyone signed in may file feedback as themselves.
drop policy if exists "submit own feedback" on feedback;
create policy "submit own feedback"
  on feedback for insert
  with check (auth.uid() = user_id);

-- Users can read back only their own; the admin reads everything.
drop policy if exists "read own feedback or admin reads all" on feedback;
create policy "read own feedback or admin reads all"
  on feedback for select
  using (auth.uid() = user_id or is_grind_admin());

-- Only the admin mutates state (read/unread, star) or deletes. Users
-- deliberately cannot edit or retract — otherwise the inbox is unreliable.
drop policy if exists "admin updates feedback" on feedback;
create policy "admin updates feedback"
  on feedback for update
  using (is_grind_admin())
  with check (is_grind_admin());

drop policy if exists "admin deletes feedback" on feedback;
create policy "admin deletes feedback"
  on feedback for delete
  using (is_grind_admin());

create index if not exists feedback_created_idx on feedback (created_at desc);
create index if not exists feedback_unread_idx  on feedback (is_read, created_at desc);
create index if not exists feedback_user_idx    on feedback (user_id);
-- Serves the rate-limit counts below (per user, recent-first).
create index if not exists feedback_user_created_idx on feedback (user_id, created_at desc);

-- ── Rate limiting ──────────────────────────────────────────────────────────
-- A BEFORE INSERT trigger, not an RLS predicate: a policy on `feedback` that
-- subqueries `feedback` would recurse, and a policy violation surfaces as the
-- opaque "new row violates row-level security policy". The trigger raises a
-- tagged message the client can turn into plain English instead.
--
-- The client pre-checks these same numbers before uploading images, but THIS is
-- the enforcement — the pre-check is only there to fail fast. Anyone hitting the
-- REST API directly still lands here.

create or replace function enforce_feedback_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  burst_count integer;
  daily_count integer;
begin
  select count(*) into burst_count
    from feedback
   where user_id = new.user_id
     and created_at > now() - interval '10 minutes';

  if burst_count >= 3 then
    raise exception 'FEEDBACK_RATE_LIMIT_BURST: more than 3 submissions in 10 minutes'
      using errcode = '54000';
  end if;

  select count(*) into daily_count
    from feedback
   where user_id = new.user_id
     and created_at > now() - interval '24 hours';

  if daily_count >= 20 then
    raise exception 'FEEDBACK_RATE_LIMIT_DAILY: more than 20 submissions in 24 hours'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists feedback_rate_limit on feedback;
create trigger feedback_rate_limit
  before insert on feedback
  for each row execute function enforce_feedback_rate_limit();

-- ── Image storage ──────────────────────────────────────────────────────────
-- Private bucket. Objects are keyed `{user_id}/{uuid}.{ext}` so the folder
-- prefix is the ownership check.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-images',
  'feedback-images',
  false,
  5242880,  -- 5 MB, mirrored client-side for a friendlier error
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload own feedback images" on storage.objects;
create policy "upload own feedback images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'feedback-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "read own feedback images or admin reads all" on storage.objects;
create policy "read own feedback images or admin reads all"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'feedback-images'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_grind_admin())
  );

drop policy if exists "admin deletes feedback images" on storage.objects;
create policy "admin deletes feedback images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'feedback-images' and is_grind_admin());
