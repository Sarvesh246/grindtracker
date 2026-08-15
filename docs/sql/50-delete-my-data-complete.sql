-- Phase 50: complete delete-my-data (storage + orphan Coach rows)
-- Idempotent. Apply AFTER 49.
--
-- Paste this whole file into the Supabase SQL editor.
--
-- `delete_my_grind_data` already wiped Postgres rows (last rewritten in 49)
-- but left objects in the private `progress-photos` / `feedback-images`
-- buckets, and Coach messages whose conversation_id was null (pre-35
-- orphans). Those leftovers survived a confirmed wipe. Also delete
-- coach_messages by user_id so append-only RLS cannot strand rows.

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

  -- Private buckets are keyed `{user_id}/…`. security definer bypasses
  -- storage RLS so the wipe still works if the client session is mid-teardown.
  begin
    delete from storage.objects
     where bucket_id in ('progress-photos', 'feedback-images')
       and split_part(name, '/', 1) = uid::text;
  exception
    when undefined_table then
      null;
    when invalid_schema_name then
      null;
  end;

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
  -- Orphans (conversation_id null) plus every row still keyed by user_id.
  -- Conversations cascade the rest after this.
  if to_regclass('public.coach_messages') is not null then
    delete from public.coach_messages where user_id = uid;
  end if;
  if to_regclass('public.coach_conversations') is not null then
    delete from public.coach_conversations where user_id = uid;
  end if;

  delete from public.user_profiles where id = uid;
end;
$$;

revoke all on function public.delete_my_grind_data() from public;
grant execute on function public.delete_my_grind_data() to authenticated;
