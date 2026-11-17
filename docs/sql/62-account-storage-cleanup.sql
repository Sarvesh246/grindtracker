-- Apply after 61. Storage API cleanup precedes account data deletion.
-- Direct storage.objects DELETE is no longer supported by Supabase.
begin;

create or replace function public.delete_my_grind_data_before_health()
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

  if exists(select 1 from storage.objects where bucket_id in ('progress-photos','feedback-images') and split_part(name,'/',1)=uid::text) then
    raise exception 'STORAGE_CLEANUP_REQUIRED';
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
    delete from public.coach_messages where user_id = uid;
  end if;
  if to_regclass('public.coach_conversations') is not null then
    delete from public.coach_conversations where user_id = uid;
  end if;

  delete from public.daily_body where user_id = uid;
  delete from public.body_prefs where user_id = uid;

  delete from public.user_profiles where id = uid;
end;
$$;

revoke all on function public.delete_my_grind_data_before_health() from public, anon, authenticated;
commit;
insert into public.grind_migrations (version) values ('62-account-storage-cleanup') on conflict (version) do nothing;
