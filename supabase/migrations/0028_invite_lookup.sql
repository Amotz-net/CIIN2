-- =====================================================================
-- Let an invited person actually open their invitation.
--
-- AcceptInvite looks the invitation up by token BEFORE the person has an
-- account, so the request arrives as `anon`. invites_select only admits a
-- platform admin, an org admin, or a signed-in user whose email matches — so
-- the lookup returned nothing and every invite link read "Invitation not
-- valid". The first accounts were created by SQL, which is why it went unseen.
--
-- Opening the table to anon would expose every pending invitation's email.
-- Instead, one function returns exactly one invitation, and only to a caller
-- who already holds its token. The token is the secret; nothing can be listed.
-- =====================================================================

create or replace function invite_by_token(p_token uuid)
returns table (
  id         uuid,
  email      text,
  level      member_level,
  status     invite_status,
  expires_at timestamptz,
  org_id     uuid,
  org_name   text,
  org_role   ciin_role
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.level, i.status, i.expires_at, i.org_id, o.name, o.role
  from invitations i
  left join organizations o on o.id = i.org_id
  where i.token = p_token
  limit 1
$$;

revoke all on function invite_by_token(uuid) from public;
grant execute on function invite_by_token(uuid) to anon, authenticated;

comment on function invite_by_token is
  'Returns the single invitation matching a token, for the pre-signup accept '
  'page. security definer because the caller is anonymous; the token is the '
  'credential and the function cannot enumerate invitations.';
