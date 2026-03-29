<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import supabase from '../lib/supabaseClient'
import { updateCurrentUserPassword } from '../composables/useAuth'

const route = useRoute()
const router = useRouter()

const form = reactive({
  password: '',
  confirmPassword: ''
})

const isLoading = ref(false)
const isReady = ref(false)
const isRecoverySession = ref(false)
const error = ref<string | null>(null)
const success = ref<string | null>(null)
const showPassword = ref(false)

const origin = computed(() => (route.query.from === 'admin' ? 'admin' : 'employee'))
const loginRoute = computed(() => (origin.value === 'admin' ? '/admin/login' : '/login'))
const title = computed(() => (origin.value === 'admin' ? 'Create your new admin password' : 'Create your new password'))
const subtitle = computed(() => (
  origin.value === 'admin'
    ? 'Use a strong password for your admin account before heading back to the admin login.'
    : 'Use a strong password for your employee account before heading back to sign in.'
))

function togglePassword() {
  showPassword.value = !showPassword.value
}

function cleanedRecoveryUrl() {
  const url = new URL(window.location.href)
  const next = new URLSearchParams()
  const from = url.searchParams.get('from')
  if (from) next.set('from', from)
  return `${url.pathname}${next.toString() ? `?${next.toString()}` : ''}`
}

async function establishRecoverySession() {
  const url = new URL(window.location.href)
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')
  const recoveryType = hashParams.get('type')
  const code = url.searchParams.get('code')

  if (recoveryType === 'recovery' && accessToken && refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    })
    if (sessionError) throw sessionError
    window.history.replaceState({}, '', cleanedRecoveryUrl())
    return true
  }

  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) throw exchangeError
    window.history.replaceState({}, '', cleanedRecoveryUrl())
    return true
  }

  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}

async function goBackToLogin() {
  await supabase.auth.signOut()
  router.push({ path: loginRoute.value, query: { password_reset: '1' } })
}

async function onSubmit() {
  error.value = null
  success.value = null

  if (form.password.length < 6) {
    error.value = 'Your new password must be at least 6 characters long.'
    return
  }
  if (form.password !== form.confirmPassword) {
    error.value = 'Your password confirmation does not match.'
    return
  }

  isLoading.value = true
  const { error: updateError } = await updateCurrentUserPassword(form.password)
  isLoading.value = false

  if (updateError) {
    error.value = updateError
    return
  }

  success.value = 'Your password has been updated successfully.'
  form.password = ''
  form.confirmPassword = ''
}

onMounted(async () => {
  isLoading.value = true
  error.value = null
  try {
    isRecoverySession.value = await establishRecoverySession()
    if (!isRecoverySession.value) {
      error.value = 'This password reset link is invalid or has expired. Request a new one from the login page.'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unable to verify the password reset link.'
    isRecoverySession.value = false
  } finally {
    isLoading.value = false
    isReady.value = true
  }
})
</script>

<template>
  <div class="reset-password-view">
    <AuthLayout>
      <div class="reset-password-shell">
        <div class="reset-password-badge">Secure Password Reset</div>
        <h2 class="auth-title reset-password-title">{{ title }}</h2>
        <p class="reset-password-subtitle">
          {{ subtitle }}
        </p>

        <div
          v-if="error && !isRecoverySession"
          class="auth-success-banner reset-password-banner reset-password-banner--error"
          role="alert"
          aria-live="polite"
        >
          <p class="auth-success-banner__title">Reset link unavailable</p>
          <p class="auth-success-banner__text">{{ error }}</p>
          <button type="button" class="btn primary auth-success-banner__cta" @click="router.push(loginRoute)">
            Back to login
          </button>
        </div>

        <template v-else-if="isReady">
          <form class="auth-form" @submit.prevent="onSubmit">
            <div class="field">
              <label for="new-password">NEW PASSWORD</label>
              <div class="input-with-icon">
                <input
                  id="new-password"
                  v-model="form.password"
                  :type="showPassword ? 'text' : 'password'"
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
              <label for="confirm-new-password">CONFIRM NEW PASSWORD</label>
              <input
                id="confirm-new-password"
                v-model="form.confirmPassword"
                :type="showPassword ? 'text' : 'password'"
                placeholder="Re-enter your new password"
                autocomplete="new-password"
              />
            </div>

            <p
              v-if="error && isRecoverySession"
              class="error"
              role="alert"
              aria-live="polite"
            >
              {{ error }}
            </p>

            <div
              v-if="success"
              class="auth-success-banner reset-password-banner"
              role="status"
              aria-live="polite"
            >
              <p class="auth-success-banner__title">Password saved</p>
              <p class="auth-success-banner__text">{{ success }}</p>
              <button type="button" class="btn primary auth-success-banner__cta" @click="goBackToLogin">
                Continue to login
              </button>
            </div>

            <div class="auth-actions-row">
              <button type="button" class="btn btn-outline-secondary" @click="router.push(loginRoute)">Back</button>
              <button type="submit" class="btn primary" :disabled="isLoading || !!success">
                {{ isLoading ? 'Updating…' : 'Update password' }}
              </button>
            </div>
          </form>
        </template>

        <div v-else class="reset-password-loading">Preparing your secure reset session…</div>
      </div>
    </AuthLayout>
  </div>
</template>

<style>
.reset-password-view .auth-page {
  background: #c2deff;
  background: linear-gradient(260deg, rgba(194, 222, 255, 1) 0%, rgba(255, 217, 217, 1) 100%);
}

body.dark-mode .reset-password-view .auth-page {
  background: #122c4a;
  background: linear-gradient(260deg, rgba(18, 44, 74, 1) 0%, rgba(74, 16, 16, 1) 100%);
}

.reset-password-view .auth-card {
  max-width: 460px;
}

.reset-password-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.reset-password-badge {
  align-self: center;
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  background: rgba(14, 165, 233, 0.14);
  border: 1px solid rgba(14, 165, 233, 0.2);
  color: var(--accent-light);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reset-password-title {
  margin-bottom: 0;
}

.reset-password-subtitle {
  margin: -0.35rem 0 0;
  text-align: center;
  color: var(--text-secondary);
  line-height: 1.55;
  font-size: 0.95rem;
}

.reset-password-banner {
  margin-top: 0.25rem;
}

.reset-password-banner--error {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.1);
}

.reset-password-loading {
  padding: 1rem 0 0.5rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.95rem;
}
</style>
