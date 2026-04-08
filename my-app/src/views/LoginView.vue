<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import { useAuth } from '../composables/useAuth'
import supabase from '../lib/supabaseClient'

const route = useRoute()
const router = useRouter()
const { signIn, isLoading, error } = useAuth()
const form = reactive({ email: '', password: '' })
const showPassword = ref(false)
const accountModal = ref<null | 'pending' | 'welcome' | 'rejected'>(null)
/** Shown after user lands from Supabase email confirmation link (see useAuth signUp emailRedirectTo). */
const showEmailConfirmedBanner = ref(false)
const showPasswordResetBanner = ref(false)

onMounted(() => {
  const nextQuery = { ...route.query }
  let shouldReplaceQuery = false

  const isSignupEmailCallback =
    route.query.email_confirmed === '1'
    || route.query.type === 'signup'
    || typeof route.query.token_hash === 'string'
    || typeof route.query.code === 'string'
    || route.hash.includes('type=signup')
    || route.hash.includes('access_token=')
    || route.hash.includes('refresh_token=')

  if (isSignupEmailCallback) {
    // Keep users on login after email confirmation instead of jumping to dashboard.
    void supabase.auth.signOut()
    showEmailConfirmedBanner.value = true
    delete nextQuery.email_confirmed
    delete nextQuery.type
    delete nextQuery.token_hash
    delete nextQuery.code
    shouldReplaceQuery = true
  }
  if (route.query.password_reset === '1') {
    showPasswordResetBanner.value = true
    delete nextQuery.password_reset
    shouldReplaceQuery = true
  }

  if (shouldReplaceQuery) router.replace({ path: route.path, query: nextQuery, hash: '' })
})

function goBack() {
  router.push({ name: 'Home' })
}

function togglePassword() {
  showPassword.value = !showPassword.value
}

async function onSubmit() {
  const result = await signIn(form.email, form.password)
  if ('error' in result) return
  if ('pendingReview' in result && result.pendingReview) {
    accountModal.value = 'pending'
    return
  }
  if ('rejected' in result && result.rejected) {
    accountModal.value = 'rejected'
    return
  }
  if ('ok' in result && result.ok) {
    if (result.firstTimeWelcome) {
      accountModal.value = 'welcome'
      return
    }
    router.push('/dashboard')
  }
}

function dismissAccountModal() {
  const variant = accountModal.value
  accountModal.value = null
  if (variant === 'welcome') router.push('/dashboard')
}
</script>
<template>
  <div class="login-view">
    <AuthLayout>
      <div
        v-if="accountModal"
        class="auth-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
      >
        <div class="auth-modal-card">
          <div class="auth-modal-badge">
            {{ accountModal === 'welcome' ? 'Welcome to TimeWorth' : 'Account update' }}
          </div>
          <h3 class="auth-modal-title">
            {{
              accountModal === 'pending'
                ? 'Account under review'
                : accountModal === 'rejected'
                  ? 'Account not approved'
                  : 'Welcome aboard'
            }}
          </h3>
          <p class="auth-modal-text">
            {{
              accountModal === 'pending'
                ? 'Your employee account is currently being reviewed by the admin. Please wait for approval before logging in.'
                : accountModal === 'rejected'
                  ? 'After careful review by the admin, your employee account has been rejected. Please contact the admin if you think this was a mistake.'
                  : 'Your account has been approved. Welcome to TimeWorth. Click okay to continue to your dashboard.'
            }}
          </p>
          <button type="button" class="btn primary auth-modal-cta" @click="dismissAccountModal">Okay</button>
        </div>
      </div>
      <div
        v-if="showEmailConfirmedBanner"
        class="auth-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-labelledby="email-confirmed-title"
      >
        <div class="auth-modal-card">
          <div class="auth-modal-badge">Success</div>
          <h3 id="email-confirmed-title" class="auth-modal-title">Email confirmed</h3>
          <p class="auth-modal-text">
            You have successfully confirmed your email. You can now log in.
          </p>
        </div>
      </div>
      <div
        v-if="showPasswordResetBanner"
        class="auth-success-banner auth-success-banner--spaced"
        role="status"
        aria-live="polite"
      >
        <p class="auth-success-banner__title">Password updated</p>
        <p class="auth-success-banner__text">
          Your password has been changed. Sign in with your new password.
        </p>
      </div>
      <h2 class="auth-title"><strong>EMPLOYEE LOGIN</strong></h2>
      <form class="auth-form" @submit.prevent="onSubmit">
        <div class="field"><label for="email">EMAIL <span class="required-asterisk">*</span></label><input id="email" v-model="form.email" type="email" required placeholder="name@gmail.com" autocomplete="email" /></div>
        <div class="field">
          <label for="password">PASSWORD <span class="required-asterisk">*</span> (Must be at least 6 characters)</label>
          <div class="input-with-icon">
            <input
              id="password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              required
              placeholder="Enter password"
              autocomplete="current-password"
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
        <div class="forgot-password-row">
          <button
            type="button"
            class="auth-link-btn"
            @click="router.push({ path: '/forgot-password', query: form.email.trim() ? { from: 'employee', email: form.email.trim() } : { from: 'employee' } })"
          >
            Forgot password?
          </button>
        </div>
        <p
          v-if="error"
          class="error"
          role="alert"
          aria-live="polite"
        >
          {{ error }}
        </p>
        <div class="auth-actions-row">
          <button type="button" class="btn btn-outline-secondary" @click="goBack">Back</button>
          <button type="submit" class="btn primary" :disabled="isLoading">{{ isLoading ? 'Logging in…' : 'Log in' }}</button>
        </div>
      </form>
      <p class="footer">No account? <router-link to="/signup">Sign up</router-link></p>

    </AuthLayout>
  </div>
</template>

<style>
.login-view .auth-page {
  background: #c2deff;
  background: linear-gradient(260deg, rgba(194, 222, 255, 1) 0%, rgba(255, 217, 217, 1) 100%);
}

body.dark-mode .login-view .auth-page {
  background: #122c4a;
  background: linear-gradient(260deg, rgba(18, 44, 74, 1) 0%, rgba(74, 16, 16, 1) 100%);
}

.login-view .auth-link-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-light);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.login-view .auth-link-btn:hover {
  text-decoration: underline;
}

.login-view .forgot-password-row {
  display: flex;
  justify-content: flex-end;
  margin-top: -0.15rem;
}

.login-view .auth-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(6px);
}

.login-view .auth-modal-card {
  width: min(100%, 420px);
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.35rem;
  border-radius: 18px;
  border: 1px solid rgba(56, 189, 248, 0.18);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.82)),
    rgba(14, 165, 233, 0.08);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
}

body.dark-mode .login-view .auth-modal-card {
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.9)),
    rgba(14, 165, 233, 0.1);
}

.login-view .auth-modal-badge {
  align-self: center;
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(14, 165, 233, 0.18);
  color: var(--accent-light);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.login-view .auth-modal-title {
  margin: 0;
  text-align: center;
  font-size: 1.2rem;
  color: var(--text-primary);
}

.login-view .auth-modal-text {
  margin: 0;
  text-align: center;
  color: var(--text-secondary);
  line-height: 1.6;
  font-size: 0.94rem;
}

.login-view .auth-modal-cta {
  align-self: center;
  min-width: 140px;
}

.login-view .auth-success-banner--spaced {
  margin-bottom: 1rem;
}

.login-view .required-asterisk {
  color: #ef4444;
}
</style>
