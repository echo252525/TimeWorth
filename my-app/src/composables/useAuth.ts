import { ref, computed } from 'vue'
import supabase from '../lib/supabaseClient'
import type { User } from '@supabase/supabase-js'

const user = ref<User | null>(null)

interface EmployeeSignup {
  name: string
  position_in_company: string
  company_branch: string
  employee_no: number
  picture?: File | null
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

export function useAuth() {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const isLoggedIn = computed(() => !!user.value)

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    user.value = session?.user ?? null
    supabase.auth.onAuthStateChange((_e, session) => { user.value = session?.user ?? null })
  }

  async function signUp(p: EmployeeSignup) {
    isLoading.value = true
    error.value = null
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email: p.email, password: p.password, options: { emailRedirectTo: undefined } })
      if (signUpError) throw signUpError
      if (!data.user) throw new Error('Sign up failed')
      if (data.session) await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
      let picturePath: string | null = null
      if (p.picture && p.picture instanceof File) {
        const ext = p.picture.name.split('.').pop()?.toLowerCase() || 'jpg'
        const path = `${data.user.id}/${Date.now()}.${ext}`
        const contentType = p.picture.type || (ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg')
        const body = await p.picture.arrayBuffer()
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: false, contentType })
        if (uploadError) throw new Error(uploadError.message || 'Profile picture upload failed')
        picturePath = path
      }
      const { error: insertError } = await supabase.from('employee').insert({
        id: data.user.id, name: p.name, position_in_company: p.position_in_company, company_branch: p.company_branch,
        employee_no: Number(p.employee_no), picture: picturePath, email: p.email, password: p.password
      })
      if (insertError) throw insertError
      return { data, error: null }
    } catch (e) {
      const err = e as { message?: string; details?: string }
      const msg = err?.message || err?.details || errMsg(e, 'Sign up failed')
      error.value = msg
      return { data: null, error: msg }
    } finally {
      isLoading.value = false
    }
  }

  async function signIn(email: string, password: string) {
    isLoading.value = true
    error.value = null
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) throw signInError
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

  return { user, isLoggedIn, isLoading, error, init, signUp, signIn, signOut, getSignedProfileUrl }
}

export { user }
