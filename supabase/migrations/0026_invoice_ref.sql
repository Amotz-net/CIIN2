-- =====================================================================
-- Invoice reference numbers.
--
-- invoice_ref is unique, so generating it in the browser from a row count races
-- two hubs into the same number. Allocate it in the database instead, where the
-- sequence is atomic.
--
-- Shape: <HUB>-<YEAR>-<0000>, e.g. NEG01-2026-0007. The prefix comes from the
-- issuer's own name so a hub recognises its own paperwork.
-- =====================================================================

create sequence if not exists invoice_ref_seq;

create or replace function next_invoice_ref(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text;
  v_prefix text;
begin
  select name into v_name from organizations where id = p_org;
  if v_name is null then
    raise exception 'No such organization.';
  end if;
  -- First word, letters and digits only, uppercased: "NEG01 Recovery Hub" -> NEG01.
  v_prefix := upper(regexp_replace(split_part(v_name, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
  if v_prefix = '' then v_prefix := 'CIIN'; end if;
  return v_prefix || '-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('invoice_ref_seq')::text, 4, '0');
end;
$$;

grant execute on function next_invoice_ref(uuid) to authenticated;

comment on function next_invoice_ref is
  'Allocates a unique invoice reference. Atomic — a client-side count would race.';
