begin;

-- Only the addressee can update status under RLS. Keep both participants immutable.
revoke update on public.friendships from public, anon, authenticated;
grant update (status) on public.friendships to authenticated;

-- Bind a new Coach message to a conversation owned by the same account.
alter table public.coach_messages drop constraint if exists coach_messages_conversation_owner_fkey;
create unique index if not exists coach_conversations_id_user_idx
  on public.coach_conversations (id, user_id);
alter table public.coach_messages add constraint coach_messages_conversation_owner_fkey
  foreign key (conversation_id, user_id) references public.coach_conversations (id, user_id)
  on delete cascade not valid;

-- Check the subscription RPC and direct writes. The send path also checks the
-- destination immediately before opening a connection, including legacy rows.
alter table public.push_subscriptions drop constraint if exists push_subscriptions_provider_check;
alter table public.push_subscriptions add constraint push_subscriptions_provider_check check (
  octet_length(endpoint) <= 4096
  and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/[^[:cntrl:][:space:]#]+$'
  and strpos(endpoint, chr(92)) = 0
  and p256dh ~ '^[A-Za-z0-9_-]{87}=?$'
  and auth ~ '^[A-Za-z0-9_-]{22}(==)?$'
) not valid;

create or replace function public.upsert_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_expiration_time timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  insert into public.push_subscriptions as ps (user_id, endpoint, p256dh, auth, expiration_time, updated_at)
  values (v_uid, p_endpoint, p_p256dh, p_auth, p_expiration_time, now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        expiration_time = excluded.expiration_time,
        updated_at = now()
    where ps.user_id = v_uid
       or (rtrim(ps.p256dh, '=') = rtrim(excluded.p256dh, '=') and rtrim(ps.auth, '=') = rtrim(excluded.auth, '='));

  if not found then
    raise exception 'SUBSCRIPTION_CONFLICT' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.upsert_push_subscription(text, text, text, timestamptz) from public, anon;
grant execute on function public.upsert_push_subscription(text, text, text, timestamptz) to authenticated;
revoke insert, update on public.push_subscriptions from public, anon, authenticated;

-- Triggers run independently of the API roles' EXECUTE grants.
revoke execute on function public.enforce_coach_rate_limit(),
  public.enforce_feedback_rate_limit(), public.grind_guard_rest_date_delete(),
  public.grind_seed_user_stats(), public.grind_touch_coach_action_proposal()
  from public, anon, authenticated;
revoke execute on function public.grind_coach_delete_conversation(uuid), public.is_grind_admin()
  from public, anon;

-- Profile settings become owner-only after the web deployment uses this RPC.
create or replace function public.grind_profile_directory(
  p_ids uuid[] default null, p_username text default null, p_search text default null
)
returns table (id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_search text;
begin
  if v_user is null then
    return;
  end if;

  if p_ids is not null and p_username is null and p_search is null then
    return query
      select p.id, p.username::text, p.display_name::text, p.avatar_url::text, p.created_at
      from public.user_profiles p where p.id = any(p_ids);
  elsif p_username is not null and p_ids is null and p_search is null then
    return query
      select p.id, p.username::text, p.display_name::text, p.avatar_url::text, p.created_at
      from public.user_profiles p where p.username = p_username;
  elsif char_length(p_search) between 1 and 40 and p_ids is null and p_username is null then
    v_search := replace(replace(replace(p_search, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_');
    return query
      select p.id, p.username::text, p.display_name::text, p.avatar_url::text, p.created_at
      from public.user_profiles p
      where p.id <> v_user
        and p.username ilike '%' || v_search || '%'
        and not exists (
          select 1 from public.friendships f
          where (f.requester_id = v_user and f.addressee_id = p.id)
             or (f.addressee_id = v_user and f.requester_id = p.id)
        )
      order by p.username, p.id limit 6;
  end if;
end;
$$;

revoke execute on function public.grind_profile_directory(uuid[], text, text) from public, anon;
grant execute on function public.grind_profile_directory(uuid[], text, text) to authenticated;

insert into public.grind_migrations (version) values ('85-application-security') on conflict (version) do nothing;

commit;
