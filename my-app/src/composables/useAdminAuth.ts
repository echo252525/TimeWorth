/**
 * Admin auth: `admin.id` = `auth.users.id`. RLS example:
 * create policy "admin_select_own" on public.admin for select to authenticated using (id = auth.uid());
 */
import { ref, computed } from 'vue'
import supabase from '../lib/supabaseClient'
import { useAuth } from './useAuth'

/** Private bucket; paths are `{auth_uuid}/{filename}` — use `getSignedAdminProfileUrl` for display. */
export const ADMIN_PROFILE_BUCKET = 'admin_profile'

/** Signed URL for a row in `admin.picture` (storage path or legacy URL). */
export async function getSignedAdminProfileUrl(path: string | null, expiresIn = 3600): Promise<string | null> {
  if (!path) return null
  if (path.startsWith('http')) return path
  const { data, error } = await supabase.storage.from(ADMIN_PROFILE_BUCKET).createSignedUrl(path, expiresIn)
  if (error) return null
  return data?.signedUrl ?? null
}

export type AdminRole = 'pending' | 'admin' | 'superadmin'

export interface AdminRow {
  id: string
  name: string
  employeeid: string
  position_in_company: string
  company_branch: string
  picture: string | null
  email: string
  role: AdminRole
  created_at: string
  updated_at: string
}

const adminProfile = ref<AdminRow | null>(null)

export type AdminSignInResult =
  | { ok: true }
  | { error: string }
  | { pendingReview: true }

export function useAdminAuth() {
  const { user, signOut: authSignOut } = useAuth()
  const isAdmin = computed(() => {
    const r = adminProfile.value?.role
    return r === 'admin' || r === 'superadmin'
  })
  const isSuperadmin = computed(() => adminProfile.value?.role === 'superadmin')
  const adminRole = computed(() => adminProfile.value?.role ?? null)

  async function fetchAdminProfile() {
    const uid = user.value?.id
    if (!uid) { adminProfile.value = null; return null }
    const { data, error } = await supabase.from('admin').select('*').eq('id', uid).maybeSingle()
    if (error || !data) { adminProfile.value = null; return null }
    adminProfile.value = data as AdminRow
    return adminProfile.value
  }

  async function signIn(email: string, password: string): Promise<AdminSignInResult> {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password })
    if (authErr) return { error: authErr.message }

    const uid = authData.user.id
    const { data: row, error: rowErr } = await supabase.from('admin').select('*').eq('id', uid).maybeSingle()
    if (rowErr) {
      await supabase.auth.signOut()
      user.value = null
      adminProfile.value = null
      return { error: rowErr.message ?? 'Sign in failed' }
    }
    if (!row) {
      await supabase.auth.signOut()
      user.value = null
      adminProfile.value = null
      return { error: 'No account found.' }
    }
    if (row.role === 'pending') {
      await supabase.auth.signOut()
      user.value = null
      adminProfile.value = null
      return { pendingReview: true }
    }
    if (row.role !== 'admin' && row.role !== 'superadmin') {
      await supabase.auth.signOut()
      user.value = null
      adminProfile.value = null
      return { error: 'No account found.' }
    }

    user.value = authData.user
    adminProfile.value = row as AdminRow
    return { ok: true }
  }

  async function signUpAdmin(p: {
    name: string
    employeeid: string
    position_in_company: string
    company_branch: string
    email: string
    password: string
  }) {
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: p.email,
      password: p.password,
      options: { emailRedirectTo: undefined }
    })
    if (authErr || !authData.user) return { data: null, error: authErr?.message ?? 'Sign up failed' }
    if (authData.session) {
      await supabase.auth.setSession({
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token
      })
    }
    user.value = authData.user
    const { error: insertErr } = await supabase.from('admin').insert({
      id: authData.user.id,
      name: p.name,
      employeeid: p.employeeid,
      position_in_company: p.position_in_company,
      company_branch: p.company_branch,
      email: p.email,
      role: 'pending'
    })
    if (insertErr) return { data: null, error: insertErr.message }
    await signOut()
    return { data: authData, error: null }
  }

  async function signOut() {
    adminProfile.value = null
    await authSignOut()
  }

  return {
    adminProfile,
    isAdmin,
    isSuperadmin,
    adminRole,
    fetchAdminProfile,
    signIn,
    signUpAdmin,
    signOut
  }
}

export { adminProfile }
