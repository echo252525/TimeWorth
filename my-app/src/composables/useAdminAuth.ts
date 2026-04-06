/**
 * Admin auth: `admin.id` = `auth.users.id`. RLS example:
 * create policy "admin_select_own" on public.admin for select to authenticated using (id = auth.uid());
 */
import { ref, computed } from 'vue'
import supabase from '../lib/supabaseClient'
import { buildAdminEmailConfirmationRedirect, useAuth } from './useAuth'

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
  picture: string | null
  email: string
  role: AdminRole
  created_at: string
  updated_at: string
}

const adminProfile = ref<AdminRow | null>(null)

export type AdminSignInResult =
  | { ok: true; role: 'admin' | 'superadmin'; userId: string }
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
    let uid = user.value?.id ?? null
    if (!uid) {
      const { data: { session } } = await supabase.auth.getSession()
      uid = session?.user?.id ?? null
      if (session?.user) user.value = session.user
    }
    if (!uid) { adminProfile.value = null; return null }
    const { data, error } = await supabase.from('admin').select('*').eq('id', uid).maybeSingle()
    if (error || !data) { adminProfile.value = null; return null }
    adminProfile.value = data as AdminRow
    return adminProfile.value
  }

  async function signIn(email: string, password: string): Promise<AdminSignInResult> {
    console.log('[AdminAuth] signIn start', { email: email.trim().toLowerCase() })
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password })
    if (authErr) {
      console.log('[AdminAuth] auth signInWithPassword failed', { message: authErr.message })
      return { error: authErr.message }
    }

    const uid = authData.user.id
    console.log('[AdminAuth] auth signInWithPassword success', { uid })
    const { data: row, error: rowErr } = await supabase.from('admin').select('*').eq('id', uid).maybeSingle()
    if (rowErr) {
      console.log('[AdminAuth] admin row query error', { uid, message: rowErr.message })
      await supabase.auth.signOut()
      user.value = null
      adminProfile.value = null
      return { error: rowErr.message ?? 'Sign in failed' }
    }
    if (!row) {
      console.log('[AdminAuth] admin row not found for uid', { uid })
      // RLS can hide admin rows when ids are mismatched. Distinguish employee accounts:
      // - if this uid has an employee row -> not an admin account ("No account found")
      // - otherwise -> treat as pending review (likely admin row exists but not yet linked to this uid)
      const { data: employeeRow, error: employeeErr } = await supabase
        .from('employee')
        .select('id')
        .eq('id', uid)
        .maybeSingle()
      if (employeeErr) {
        console.log('[AdminAuth] employee fallback query failed', { uid, message: employeeErr.message })
      } else {
        console.log('[AdminAuth] employee fallback query result', { uid, isEmployee: !!employeeRow })
      }
      if (!employeeRow) {
        await supabase.auth.signOut()
        user.value = null
        adminProfile.value = null
        return { pendingReview: true }
      }
      await supabase.auth.signOut()
      user.value = null
      adminProfile.value = null
      return { error: 'No account found.' }
    }
    console.log('[AdminAuth] admin row fetched', {
      uid,
      roleRaw: (row as { role?: string | null }).role ?? null,
      emailRaw: (row as { email?: string | null }).email ?? null
    })
    const roleNormalized = String((row as { role?: string | null }).role ?? '').trim().toLowerCase()
    console.log('[AdminAuth] normalized role', { uid, roleNormalized })
    if (roleNormalized === 'pending') {
      console.log('[AdminAuth] pending role path', { uid })
      await supabase.auth.signOut()
      user.value = null
      adminProfile.value = null
      return { pendingReview: true }
    }
    if (roleNormalized !== 'admin' && roleNormalized !== 'superadmin') {
      console.log('[AdminAuth] unsupported role path', { uid, roleNormalized })
      await supabase.auth.signOut()
      user.value = null
      adminProfile.value = null
      return { error: 'No account found.' }
    }

    user.value = authData.user
    adminProfile.value = row as AdminRow
    console.log('[AdminAuth] admin signIn success', { uid, roleNormalized })
    return { ok: true, role: roleNormalized as 'admin' | 'superadmin', userId: uid }
  }

  async function signUpAdmin(p: {
    name: string
    employeeid: string
    position_in_company: string
    email: string
    password: string
  }) {
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: p.email,
      password: p.password,
      options: { emailRedirectTo: buildAdminEmailConfirmationRedirect() }
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
      employeeid: p.employeeid.trim(),
      position_in_company: p.position_in_company,
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
