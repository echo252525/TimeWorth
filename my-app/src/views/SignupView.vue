<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import { useAuth } from '../composables/useAuth'
import supabase from '../lib/supabaseClient'

const router = useRouter()
const { signUp, isLoading, error } = useAuth()
const form = reactive({
  first_name: '',
  middle_initial: '',
  last_name: '',
  position_in_company: '',
  employee_no: '' as string,
  phone_number: '',
  email: '',
  password: '',
  confirmPassword: ''
})
const showPassword = ref(false)
const showConfirmPassword = ref(false)
/** True after signup when email must be verified before a session exists (typical Supabase flow). */
const postSignupAwaitingEmail = ref(false)

const positionOptions = ref<{ position_id: string; title: string }[]>([])
const positionsLoading = ref(false)

onMounted(async () => {
  positionsLoading.value = true
  const { data, error: posErr } = await supabase.from('position').select('position_id, title').order('title', { ascending: true })
  positionsLoading.value = false
  if (!posErr && data?.length) positionOptions.value = data as { position_id: string; title: string }[]
})

/** First letter uppercase, rest lowercase (as stored in DB). */
function titleCasePart(s: string): string {
  const t = s.trim()
  if (!t) return ''
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

function combineFullName(): string {
  const first = titleCasePart(form.first_name)
  const mid = titleCasePart(form.middle_initial)
  const last = titleCasePart(form.last_name)
  const parts = [first, mid, last].filter(Boolean)
  return parts.join(' ')
}

function goBack() {
  router.push({ name: 'Home' })
}

function togglePassword() {
  showPassword.value = !showPassword.value
}

function toggleConfirmPassword() {
  showConfirmPassword.value = !showConfirmPassword.value
}

async function onSubmit() {
  if (!form.first_name.trim() || !form.last_name.trim()) {
    error.value = 'First name and last name are required'
    return
  }
  const emp = form.employee_no.trim()
  if (!emp || !/^[a-zA-Z0-9]+$/.test(emp)) {
    error.value = 'Employee number must contain only letters and numbers (no spaces)'
    return
  }
  const phone = form.phone_number.trim()
  if (!phone) {
    error.value = 'Phone number is required'
    return
  }
  if (form.password !== form.confirmPassword) { error.value = 'Passwords do not match'; return }
  const result = await signUp({
    name: combineFullName(),
    position_in_company: form.position_in_company,
    employee_no: emp,
    phone_number: phone,
    email: form.email,
    password: form.password
  })
  if (result.error) return
  if (result.needsEmailConfirmation) {
    postSignupAwaitingEmail.value = true
    return
  }
  router.push('/dashboard')
}
</script>
<template>
  <AuthLayout>
    <div
      v-if="postSignupAwaitingEmail"
      class="auth-success-banner"
      role="status"
      aria-live="polite"
    >
      <p class="auth-success-banner__title">Account created</p>
      <p class="auth-success-banner__text">
        Check your email to verify your address. You can sign in after you confirm the link we sent.
      </p>
      <router-link class="btn primary auth-success-banner__cta" to="/login">Go to log in</router-link>
    </div>
    <template v-else>
    <h2 class="auth-title"><strong>CREATE ACCOUNT</strong></h2>
    <form class="auth-form" @submit.prevent="onSubmit">
      <div class="field"><label for="first_name">FIRST NAME</label><input id="first_name" v-model="form.first_name" type="text" required placeholder="First name" autocomplete="given-name" /></div>
      <div class="field"><label for="last_name">LAST NAME</label><input id="last_name" v-model="form.last_name" type="text" required placeholder="Last name" autocomplete="family-name" /></div>
      <div class="field"><label for="middle_initial">MIDDLE INITIAL</label><input id="middle_initial" v-model="form.middle_initial" type="text" maxlength="8" placeholder="Optional" autocomplete="additional-name" /></div>
      <div class="field">
        <label for="position">POSITION IN COMPANY</label>
        <select
          v-if="positionOptions.length"
          id="position"
          v-model="form.position_in_company"
          class="select-input"
          required
        >
          <option disabled value="">Select a position</option>
          <option v-for="p in positionOptions" :key="p.position_id" :value="p.title">{{ p.title }}</option>
        </select>
        <input
          v-else
          id="position"
          v-model="form.position_in_company"
          type="text"
          required
          :placeholder="positionsLoading ? 'Loading positions…' : 'e.g. Developer'"
          :disabled="positionsLoading"
        />
      </div>
      <div class="field"><label for="empno">EMPLOYEE NO.</label><input id="empno" v-model="form.employee_no" type="text" required autocomplete="off" placeholder="Letters and numbers only" pattern="[A-Za-z0-9]+" title="Letters and numbers only" /></div>
      <div class="field"><label for="phone">PHONE NUMBER</label><input id="phone" v-model="form.phone_number" type="tel" required autocomplete="tel" placeholder="e.g. +63 9xx xxx xxxx" /></div>
      <div class="field"><label for="email">COMPANY EMAIL</label><input id="email" v-model="form.email" type="email" required placeholder="company.email@pcworth.com" autocomplete="email" /></div>
      <div class="field">
        <label for="password">Password</label>
        <div class="input-with-icon">
          <input
            id="password"
            v-model="form.password"
            :type="showPassword ? 'text' : 'password'"
            required
            minlength="6"
            placeholder="Minimum of 6 characters"
            autocomplete="new-password"
          />
          <button
            type="button"
            class="icon-btn"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            @click="togglePassword"
          >
            <svg v-if="!showPassword" class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
            <svg v-else class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M10.6 10.6a2.5 2.5 0 0 0 3.8 3.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M6.4 6.4C3.8 8.2 2 12 2 12s3.5 7 10 7c2 0 3.7-.5 5.2-1.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
              <path d="M9.5 4.2C10.3 4.1 11.1 4 12 4c6.5 0 10 8 10 8s-1.2 2.8-3.6 5.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <div class="field">
        <label for="confirmPassword">Confirm password</label>
        <div class="input-with-icon">
          <input
            id="confirmPassword"
            v-model="form.confirmPassword"
            :type="showConfirmPassword ? 'text' : 'password'"
            required
            minlength="6"
            placeholder="Confirm your password"
            autocomplete="new-password"
          />
          <button
            type="button"
            class="icon-btn"
            :aria-label="showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'"
            @click="toggleConfirmPassword"
          >
            <svg v-if="!showConfirmPassword" class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
            <svg v-else class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M10.6 10.6a2.5 2.5 0 0 0 3.8 3.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M6.4 6.4C3.8 8.2 2 12 2 12s3.5 7 10 7c2 0 3.7-.5 5.2-1.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
              <path d="M9.5 4.2C10.3 4.1 11.1 4 12 4c6.5 0 10 8 10 8s-1.2 2.8-3.6 5.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="auth-actions-row">
        <button type="button" class="btn btn-outline-secondary" @click="goBack">Back</button>
        <button type="submit" class="btn primary" :disabled="isLoading">{{ isLoading ? 'Creating…' : 'Sign up' }}</button>
      </div>
    </form>
    <p class="footer">Already have an account? <router-link to="/login">Log in</router-link></p>
    </template>
  </AuthLayout>
</template>
<style scoped>
.select-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 1rem;
  box-sizing: border-box;
}
.select-input:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
