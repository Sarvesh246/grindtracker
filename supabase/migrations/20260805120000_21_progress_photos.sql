-- Phase 21: progress photos
-- Idempotent. Apply AFTER 01-20.
--
-- Adds a self-only, private photo log: one "group" per calendar date (a day's
-- progress-photo entry, optionally tagged with that day's workout and a
-- caption/note), holding one or more individual photos.
--
-- Sensitivity note: unlike feedback-images, these are often body photos.
-- There is deliberately NO admin-read policy anywhere in this file, and this
-- feature is never wired into the leaderboard/friend-profile RPCs — only the
-- owner can ever read their own progress photos.

-- ── Tables ─────────────────────────────────────────────────────────────────

create table if not exists progress_photo_groups (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  taken_date date        not null,
  -- Snapshot label at save time (e.g. 'push'/'pull'/'legs'/custom day name),
  -- or null for "None / N/A". Not a FK to sessions — the source session can
  -- be edited or deleted later; the label here must survive that.
  day_type   text,
  note       text        check (note is null or char_length(btrim(note)) <= 500),
  created_at timestamptz not null default now(),
  -- One entry per calendar date; adding more photos to an existing date
  -- merges into that day's group instead of creating a duplicate.
  unique (user_id, taken_date)
);

create table if not exists progress_photos (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references progress_photo_groups(id) on delete cascade,
  -- Object path in the private `progress-photos` bucket, not a URL.
  storage_path text      not null,
  sort_order int         not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists progress_photo_groups_user_date_idx
  on progress_photo_groups (user_id, taken_date desc);
create index if not exists progress_photos_group_sort_idx
  on progress_photos (group_id, sort_order);

alter table progress_photo_groups enable row level security;
alter table progress_photos enable row level security;

-- Single-owner table, never shared between two parties (unlike friendships),
-- so one FOR ALL policy is the right shape here — same pattern as body_weights.
drop policy if exists "own photo groups" on progress_photo_groups;
create policy "own photo groups"
  on progress_photo_groups for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- progress_photos has no user_id of its own; ownership is checked via the
-- parent group, mirroring session_logs -> sessions.
drop policy if exists "own photos via group" on progress_photos;
create policy "own photos via group"
  on progress_photos for all
  using (exists (
    select 1 from progress_photo_groups g
     where g.id = group_id and g.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from progress_photo_groups g
     where g.id = group_id and g.user_id = auth.uid()
  ));

-- ── Invariants enforced in Postgres, not trusted to the client ─────────────

-- A group with zero photos left (last photo deleted) is auto-removed, so the
-- client never has to orchestrate "delete last photo, then also delete the
-- now-empty group" as two separate steps that could race.
create or replace function grind_delete_empty_photo_group()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from progress_photo_groups
   where id = old.group_id
     and not exists (select 1 from progress_photos where group_id = old.group_id);
  return old;
end;
$$;

drop trigger if exists progress_photos_cleanup_empty_group on progress_photos;
create trigger progress_photos_cleanup_empty_group
  after delete on progress_photos
  for each row execute function grind_delete_empty_photo_group();

-- Defense-in-depth cap per day, mirrors the feedback rate-limit trigger's
-- philosophy: the client should never let a user get here, but the real
-- enforcement lives here, not in the UI.
create or replace function grind_enforce_photo_group_cap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from progress_photos where group_id = new.group_id) >= 40 then
    raise exception 'PROGRESS_PHOTOS_GROUP_CAP: at most 40 photos per day'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists progress_photos_cap on progress_photos;
create trigger progress_photos_cap
  before insert on progress_photos
  for each row execute function grind_enforce_photo_group_cap();

-- ── Image storage ────────────────────────────────────────────────────────
-- Private bucket. Objects keyed `{user_id}/{group_id}/{uuid}.jpg` (client
-- always compresses/re-encodes to JPEG before upload). The group_id segment
-- is organizational only — user_id alone is the RLS boundary, same as every
-- other bucket in this app. No admin policy: nobody but the owner may ever
-- read these, by design.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'progress-photos',
  'progress-photos',
  false,
  8388608,  -- 8 MB; client-side compression keeps real uploads well under this
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload own progress photos" on storage.objects;
create policy "upload own progress photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "read own progress photos" on storage.objects;
create policy "read own progress photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "delete own progress photos" on storage.objects;
create policy "delete own progress photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
