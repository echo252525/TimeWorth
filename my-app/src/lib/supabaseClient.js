import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing Supabase env vars. In .env.local set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (no angle brackets). Restart the dev server after changing .env.local.'
  )
}

const supabase = createClient(supabaseUrl, supabasePublishableKey)
export default supabase