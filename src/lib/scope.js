// =====================================================================
// Scoped data-access layer (Master Spec v1.3 §11.2)
//
// Every dashboard query goes through here so scoping is written ONCE, not
// re-decided per screen. Two axes:
//   - OPERATIONAL data  -> visible to all members of the org (filter: org_id)
//   - ADMINISTRATIVE data -> org_admin only          (filter: org_id + level)
//
// Row-Level Security enforces this on the server too; these helpers make the
// client honest and keep every query consistent. Access is also gated LIVE on
// the org's current approved status (revocation cascades).
//
// Per-role-type note: the "members see all operational data" rule is the HOTEL
// decision. Other role types get their own scoping call — do NOT assume this
// default for government/processor/etc. without an explicit decision.
// =====================================================================
import { supabase } from './supabase'

// Guard values a caller passes so we never run an unscoped operational query.
export function requireOrg(profile) {
  if (!profile?.org_id) throw new Error('No organization in scope')
  return profile.org_id
}

export function isOrgAdmin(profile) {
  return profile?.level === 'org_admin' || !!profile?.is_platform_admin
}

// True only if the caller's org is currently approved (or they're platform admin).
// Mirrors the DB's my_org_approved() so the UI and the server agree.
export function orgApproved(profile) {
  if (profile?.is_platform_admin) return true
  return !!profile?.organizations?.approved
}

// OPERATIONAL query: automatically filtered to the caller's org.
// Usage: const rows = await selectOperational(profile, 'missions', 'id, status')
export async function selectOperational(profile, table, columns = '*') {
  const orgId = requireOrg(profile)
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq('org_id', orgId)
  if (error) throw error
  return data
}

// ADMINISTRATIVE query: filtered to the caller's org AND requires org_admin.
export async function selectAdministrative(profile, table, columns = '*') {
  const orgId = requireOrg(profile)
  if (!isOrgAdmin(profile)) throw new Error('Administrative data requires org admin')
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq('org_id', orgId)
  if (error) throw error
  return data
}
