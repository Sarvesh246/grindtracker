-- 42-rest-today-undo.sql
--
-- Home "Rest today" undo deletes user_rest_dates. That must also clear any
-- user_rest_cancels steal rows created when the one-off spent a later
-- scheduled rest day. DELETE on user_rest_cancels is revoked for authenticated
-- (40); if grind_guard_rest_date_delete is not SECURITY DEFINER, undo raises
-- permission denied — including when zero steal rows match.
--
-- Apply after 40. Idempotent.

begin;

create or replace function public.grind_guard_rest_date_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_rest_cancels
   where user_id = old.user_id
     and stolen_for = old.rest_date;
  return old;
end;
$$;

drop trigger if exists grind_guard_rest_date_delete on public.user_rest_dates;
create trigger grind_guard_rest_date_delete
  before delete on public.user_rest_dates
  for each row
  execute function public.grind_guard_rest_date_delete();

-- Definer RPC also clears steal rows before deleting the one-off so undo does
-- not depend solely on the trigger firing with the right privileges.
create or replace function public.toggle_rest_today(p_local_date date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_date date := grind_safe_local_date(p_local_date);
  v_budget int;
  v_was_one_off boolean;
  v_was_rest boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  v_budget := public.grind_rest_budget(v_user, v_date);
  v_was_one_off := exists (
    select 1 from public.user_rest_dates d
     where d.user_id = v_user and d.rest_date = v_date
  );
  v_was_rest := public.grind_is_rest_day(v_user, v_date);

  if v_was_one_off then
    delete from public.user_rest_cancels
     where user_id = v_user and stolen_for = v_date;
    delete from public.user_rest_dates
     where user_id = v_user and rest_date = v_date;
    perform grind_recompute_stats(v_user, v_date);
    return json_build_object('rest', false, 'undone', true);
  end if;

  if v_was_rest then
    return json_build_object('rest', true, 'scheduled', true);
  end if;

  if v_budget <= 0 then
    raise exception 'REST_BUDGET_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.user_rest_dates (user_id, rest_date)
  values (v_user, v_date);

  perform grind_recompute_stats(v_user, v_date);
  return json_build_object('rest', true, 'undone', false);
end;
$$;

revoke all on function public.toggle_rest_today(date) from public, anon;
grant execute on function public.toggle_rest_today(date) to authenticated;

commit;
