import { ref, computed } from 'vue'
import supabase from '../lib/supabaseClient'
import type { User } from '@supabase/supabase-js'

const user = ref<User | null>(null)

interface EmployeeSignup {
  name: string
  position_in_company: string
  employee_no: string
  phone_number: string
  email: string
  password: string
}

const BUCKET = 'employee_profile'

/** Get a signed URL for displaying a profile image. path = bucket object path (same as employee.picture column). */
export async function getSignedProfileUrl(path: string | null, expiresIn = 3600): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn)
  if (error) return null
  return data?.signedUrl ?? null
}

function errMsg(e: unknown, fallback: string): string {
  const err = e as { status?: number; message?: string }
  if (err?.status === 429 || (typeof err?.message === 'string' && err.message.includes('429')))
    return 'Too many attempts. Please wait a few minutes and try again.'
  return e instanceof Error ? e.message : fallback
}

/** Friendly copy for signup; Supabase often returns "User already registered" for duplicate emails. */
function formatSignUpError(e: unknown): string {
  const err = e as { message?: string; details?: string; code?: string; hint?: string }
  const combined = `${err.message || ''} ${err.details || ''} ${err.hint || ''} ${err.code || ''}`.toLowerCase()
  if (
    err.code === 'user_already_exists'
    || combined.includes('user already registered')
    || combined.includes('already been registered')
    || combined.includes('email address is already registered')
    || combined.includes('user already exists')
  ) {
    return 'This email is already registered. Sign in or use a different email.'
  }
  if (err.code === '23505' || combined.includes('duplicate key') || combined.includes('unique constraint')) {
    if (combined.includes('email') || combined.includes('employee_email'))
      return 'This email is already registered. Sign in or use a different email.'
    if (combined.includes('employee_no'))
      return 'This employee number is already in use.'
    return 'An account with these details may already exist. Try signing in or change your details.'
  }
  return err.message || err.details || errMsg(e, 'Sign up failed')
}

const authReady = ref(false)

export function useAuth() {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const isLoggedIn = computed(() => !!user.value)

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    user.value = session?.user ?? null
    supabase.auth.onAuthStateChange((_e, session) => { user.value = session?.user ?? null })
    authReady.value = true
  }

  async function signUp(p: EmployeeSignup) {
    isLoading.value = true
    error.value = null
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email: p.email, password: p.password, options: { emailRedirectTo: undefined } })
      if (signUpError) throw signUpError
      if (!data.user) throw new Error('Sign up failed')
      if (data.session) await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
      const { error: insertError } = await supabase.from('employee').insert({
        id: data.user.id,
        name: p.name,
        position_in_company: p.position_in_company,
        employee_no: p.employee_no.trim(),
        phone_number: p.phone_number.trim(),
        email: p.email
      })
      if (insertError) throw insertError
      /** No session usually means Supabase is waiting for email confirmation before sign-in. */
      const needsEmailConfirmation = !data.session
      return { data, error: null, needsEmailConfirmation }
    } catch (e) {
      const msg = formatSignUpError(e)
      error.value = msg
      return { data: null, error: msg, needsEmailConfirmation: false }
    } finally {
      isLoading.value = false
    }
  }

  async function signIn(email: string, password: string) {
    isLoading.value = true
    error.value = null
    try {
      // First, try to authenticate with Supabase auth.
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) throw signInError

      const authUser = data?.user
      if (!authUser?.id) {
        throw new Error('Sign in failed')
      }

      // Ensure this authenticated user has an employee profile (and is not just an admin).
      const { data: employeeRow, error: employeeErr } = await supabase
        .from('employee')
        .select('id')
        .eq('id', authUser.id)
        .maybeSingle()

      if (employeeErr) throw employeeErr
      if (!employeeRow) {
        const { data: adminRow } = await supabase
          .from('admin')
          .select('id')
          .eq('id', authUser.id)
          .maybeSingle()

        // If this is an admin account, block login on employee form.
        if (adminRow) {
          await supabase.auth.signOut()
          throw new Error('No employee account found for this email.')
        }

        throw new Error('No account found.')
      }

      return { data, error: null }
    } catch (e) {
      const msg = errMsg(e, 'Sign in failed')
      error.value = msg
      return { data: null, error: msg }
    } finally {
      isLoading.value = false
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    user.value = null
  }

  return { user, isLoggedIn, authReady, isLoading, error, init, signUp, signIn, signOut, getSignedProfileUrl }
}

export { user }
