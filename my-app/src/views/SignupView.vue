<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { signUp, isLoading, error } = useAuth()
const form = reactive({
  name: '',
  position_in_company: '',
  company_branch: '',
  employee_no: '' as string,
  email: '',
  password: '',
  confirmPassword: ''
})
const showPassword = ref(false)
const showConfirmPassword = ref(false)
/** True after signup when email must be verified before a session exists (typical Supabase flow). */
const postSignupAwaitingEmail = ref(false)

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
  const num = Number(form.employee_no)
  if (!Number.isInteger(num) || num < 1) { error.value = 'Employee number must be a positive number'; return }
  if (form.password !== form.confirmPassword) { error.value = 'Passwords do not match'; return }
  const result = await signUp({
    name: form.name,
    position_in_company: form.position_in_company,
    company_branch: form.company_branch,
    employee_no: num,
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
    <h2 class="auth-title">Create account</h2>
    <form class="auth-form" @submit.prevent="onSubmit">
      <div class="field"><label for="name">Full name</label><input id="name" v-model="form.name" type="text" required placeholder="Juan Dela Cruz" autocomplete="name" /></div>
      <div class="field"><label for="position">Position</label><input id="position" v-model="form.position_in_company" type="text" required placeholder="e.g. Developer" /></div>
      <div class="field"><label for="branch">Branch</label><input id="branch" v-model="form.company_branch" type="text" required placeholder="aalisin na to diba?" /></div>
      <div class="field"><label for="empno">Employee no.</label><input id="empno" v-model="form.employee_no" type="number" required min="1" placeholder="10001" /></div>
      <div class="field"><label for="email">Email</label><input id="email" v-model="form.email" type="email" required placeholder="Enter your personal/company email" autocomplete="email" /></div>
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
</style>