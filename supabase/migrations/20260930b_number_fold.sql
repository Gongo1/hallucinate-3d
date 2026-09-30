-- Hallucinate: let the server rewind the member-number sequence after a
-- throwaway number is folded into a founding one (e.g. Gongo knocked as #003
-- before claiming #001). Rewinds to max(number)+1, never below 3.
-- Callable only with the service-role key. Safe to re-run.
create or replace function hallu_rewind_numbers()
returns void
language sql
security definer
set search_path = public
as $$
  select setval(
    'hallu_member_number_seq',
    greatest(3, (select coalesce(max(number), 0) + 1 from hallu_members)),
    false
  );
$$;
revoke execute on function hallu_rewind_numbers() from public, anon, authenticated;
grant execute on function hallu_rewind_numbers() to service_role;
