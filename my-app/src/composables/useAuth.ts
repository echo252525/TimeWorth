import { ref, computed } from 'vue'
import supabase from '../lib/supabaseClient'
import type { User } from '@supabase/supabase-js'

const user = ref<User | null>(null)

export type EmployeeSignUp = {
  name: string
  position_in_company: string
  company_branch: string
  employee_no: number
  picture?: string
  email: string
  password: string
}

export function useAuth() {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const isLoggedIn = computed(() => !!user.value)

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    user.value = session?.user ?? null
    supabase.auth.onAuthStateChange((_e, session) => {
      user.value = session?.user ?? null
    })
  }

  async function signUp(p: EmployeeSignUp) {
    isLoading.value = true
    error.value = null
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: p.email,
        password: p.password,
        options: { emailRedirectTo: undefined }
      })
      if (signUpError) throw signUpError
      if (!data.user) throw new Error('Sign up failed')

      const { error: insertError } = await supabase.from('employee').insert({
        id: data.user.id,
        name: p.name,
        position_in_company: p.position_in_company,
        company_branch: p.company_branch,
        employee_no: p.employee_no,
        picture: p.picture || null,
        email: p.email
      })
      if (insertError) throw insertError
      return { data, error: null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign up failed'
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
      const msg = e instanceof Error ? e.message : 'Sign in failed'
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

  return { user, isLoggedIn, isLoading, error, init, signUp, signIn, signOut }
}

export { user as authUser }
