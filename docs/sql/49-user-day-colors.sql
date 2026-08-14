-- Phase 49: per-user day colors
-- Idempotent. Apply AFTER 48.
--
-- Paste this whole file into the Supabase SQL editor.
--
-- Day cards (Log), the home calendar, and past-log pills used a fixed palette
-- keyed off push/pull/legs (or a rotating extra pool for custom days). There
-- was no way to pick a color. user_day_colors stores an optional #rrggbb
-- override per (user, day_key). Missing row = keep the derived default.
-- RLS is owner-only. delete_my_grind_data also wipes the table.

create table if not exists public.user_day_colors (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day_key  text not null,
  color    text not null,
  primary key (user_id, day_key),
  constraint user_day_colors_key_nonempty check (char_length(trim(day_key)) > 0),
  constraint user_day_colors_hex check (color ~ '^#[0-9a-fA-F]{6}$')
);

comment on table public.user_day_colors is
  'Optional per-day color override (#rrggbb). Missing row uses the derived palette.';

alter table public.user_day_colors enable row level security;

drop policy if exists "own day colors" on public.user_day_colors;
create policy "own day colors"
  on public.user_day_colors for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists user_day_colors_user_idx
  on public.user_day_colors (user_id);

grant select, insert, update, delete on table public.user_day_colors to authenticated;
revoke all on table public.user_day_colors from anon;

-- Keep delete-my-data in sync (39 is the last full replacement).
create or replace function public.delete_my_grind_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  delete from public.session_logs
    where session_id in (select id from public.sessions where user_id = uid);
  delete from public.sessions where user_id = uid;
  delete from public.exercises where user_id = uid;
  delete from public.user_stats where user_id = uid;
  delete from public.user_badges where user_id = uid;
  delete from public.body_weights where user_id = uid;
  delete from public.user_day_categories where user_id = uid;
  if to_regclass('public.user_day_colors') is not null then
    delete from public.user_day_colors where user_id = uid;
  end if;
  delete from public.user_rotation where user_id = uid;
  delete from public.user_rest_cancels where user_id = uid;
  delete from public.user_rest_days where user_id = uid;
  delete from public.user_rest_dates where user_id = uid;
  if to_regclass('public.user_flex_days') is not null then
    delete from public.user_flex_days where user_id = uid;
  end if;
  delete from public.feedback where user_id = uid;
  delete from public.friendships
    where requester_id = uid or addressee_id = uid;

  if to_regclass('public.progress_photo_groups') is not null then
    delete from public.progress_photos
      where group_id in (select id from public.progress_photo_groups where user_id = uid);
    delete from public.progress_photo_groups where user_id = uid;
  end if;

  if to_regclass('public.push_subscriptions') is not null then
    delete from public.push_subscriptions where user_id = uid;
  end if;
  if to_regclass('public.notification_prefs') is not null then
    delete from public.notification_prefs where user_id = uid;
  end if;
  if to_regclass('public.scheduled_notifications') is not null then
    delete from public.scheduled_notifications where user_id = uid;
  end if;

  if to_regclass('public.coach_action_proposals') is not null then
    delete from public.coach_action_proposals where user_id = uid;
  end if;
  if to_regclass('public.coach_messages') is not null then
    delete from public.coach_messages
      where conversation_id in (
        select id from public.coach_conversations where user_id = uid
      );
  end if;
  if to_regclass('public.coach_conversations') is not null then
    delete from public.coach_conversations where user_id = uid;
  end if;

  delete from public.user_profiles where id = uid;
end;
$$;

revoke all on function public.delete_my_grind_data() from public;
grant execute on function public.delete_my_grind_data() to authenticated;
