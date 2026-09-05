import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Central auth state: the logged-in session + the user's CIIN profile
// (which carries org_id, role/level, and the platform-admin flag).
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load the profile row for the current user (or null if none yet).
  async function loadProfile(userId) {
    if (!userId) { setProfile(null); return }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, org_id, level, is_platform_admin, organizations!profiles_org_id_fkey(name, role, country_code, approved)')
      .eq('id', userId)
      .maybeSingle()
    if (error) console.error('profile load error', error)
    // Supabase can return a to-one join as either an object or a 1-element array
    // depending on how it infers the relationship. Normalize to a single object
    // so downstream reads like org?.approved are reliable.
    if (data && Array.isArray(data.organizations)) {
      data.organizations = data.organizations[0] ?? null
    }
    setProfile(data ?? null)
  }

  useEffect(() => {
    // Get any existing session on first load.
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session?.user?.id)
      setLoading(false)
    })
    // Subscribe to future auth changes (login / logout / token refresh).
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      setSession(sess)
      await loadProfile(sess?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = {
    session,
    profile,
    loading,
    user: session?.user ?? null,
    refreshProfile: () => loadProfile(session?.user?.id),
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
