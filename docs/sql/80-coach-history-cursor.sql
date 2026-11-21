create index if not exists coach_messages_recent_page_idx
  on public.coach_messages (conversation_id, created_at desc, id desc);
insert into public.grind_migrations (version) values ('80-coach-history-cursor') on conflict (version) do nothing;
