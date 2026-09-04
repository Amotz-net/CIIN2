import { createClient } from '@supabase/supabase-js'

// Values come from .env.local (see .env.example). The anon key is safe to ship
// to the browser BECAUSE row-level security enforces access on the server side.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Fail loudly in dev rather than silently misbehaving.
  console.error('Missing Supabase env vars. Copy .env.example to .env.local and fill it in.')
}

export const supabase = createClient(url, anonKey)
