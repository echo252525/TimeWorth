<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import { useAdminAuth } from '../composables/useAdminAuth'

const router = useRouter()
const route = useRoute()
const { signIn } = useAdminAuth()
const form = reactive({ email: '', password: '' })
const isLoading = ref(false)
const error = ref<string | null>(null)
const accountModal = ref<null | 'pending' | 'welcome'>(null)
const showPassword = ref(false)
const showPasswordResetBanner = ref(false)
const pendingWelcomeAdminId = ref<string | null>(null)
const ADMIN_WELCOME_KEY_PREFIX = 'admin_welcome_seen:'

watch(
  () => route.query.pending,
  (p) => {
    if (p === '1') accountModal.value = 'pending'
    if (route.query.password_reset === '1') {
      showPasswordResetBanner.value = true
      router.replace({
        path: '/admin/login',
        query: route.query.pending ? { pending: String(route.query.pending) } : {}
      })
    }
  },
  { immediate: true }
)

function dismissAccountModal() {
  const variant = accountModal.value
  accountModal.value = null
  if (variant === 'welcome' && pendingWelcomeAdminId.value) {
    try {
      localStorage.setItem(`${ADMIN_WELCOME_KEY_PREFIX}${pendingWelcomeAdminId.value}`, '1')
    } catch {
      // ignore storage errors
    }
    pendingWelcomeAdminId.value = null
    router.push({ name: 'AdminHome' })
    return
  }
  if (route.query.pending) router.replace({ path: '/admin/login', query: {} })
}

function goBack() {
  router.push({ name: 'Home' })
}

function togglePassword() {
  showPassword.value = !showPassword.value
}

async function onSubmit() {
  isLoading.value = true
  error.value = null
  accountModal.value = null
  const r = await signIn(form.email, form.password)
  console.log('[AdminLogin] signIn result', r)
  isLoading.value = false
  if ('error' in r) {
    error.value = r.error
    return
  }
  if ('pendingReview' in r && r.pendingReview) {
    accountModal.value = 'pending'
    return
  }
  if ('ok' in r && r.ok) {
    if (r.role === 'admin') {
      const key = `${ADMIN_WELCOME_KEY_PREFIX}${r.userId}`
      let seen = false
      try {
        seen = localStorage.getItem(key) === '1'
      } catch {
        seen = false
      }
      if (!seen) {
        pendingWelcomeAdminId.value = r.userId
        accountModal.value = 'welcome'
        return
      }
    }
    router.push({ name: 'AdminHome' })
  }
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
            {{ accountModal === 'pending' ? 'Account under review' : 'Welcome admin' }}
          </h3>
          <p class="auth-modal-text">
            {{
              accountModal === 'pending'
                ? 'Your account is being reviewed by a superadmin. You will be able to sign in once your role has been approved.'
                : 'Welcome to the admin portal. Click okay to continue.'
            }}
          </p>
          <button type="button" class="btn primary auth-modal-cta" @click="dismissAccountModal">Okay</button>
        </div>
      </div>
      <template v-if="!accountModal">
        <div
          v-if="showPasswordResetBanner"
          class="auth-success-banner auth-success-banner--spaced"
          role="status"
          aria-live="polite"
        >
          <p class="auth-success-banner__title">Password updated</p>
          <p class="auth-success-banner__text">
            Your admin password has been changed. Sign in with your new password.
          </p>
        </div>
        <h2 class="auth-title"><strong>ADMIN LOGIN</strong></h2>
        <form class="auth-form" @submit.prevent="onSubmit">
          <div class="field">
            <label for="admin-login-email">EMAIL <span class="required-asterisk">*</span></label>
            <input
              id="admin-login-email"
              v-model="form.email"
              type="email"
              required
              placeholder="name@gmail.com"
              autocomplete="email"
            />
          </div>
          <div class="field">
            <label for="admin-login-password">PASSWORD (Must be at least 6 characters) <span class="required-asterisk">*</span></label>
            <div class="input-with-icon">
              <input
                id="admin-login-password"
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
              @click="router.push({ path: '/forgot-password', query: form.email.trim() ? { from: 'admin', email: form.email.trim() } : { from: 'admin' } })"
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
            <button type="submit" class="btn primary" :disabled="isLoading">{{ isLoading ? 'Signing in…' : 'Sign in' }}</button>
          </div>
        </form>
        <p class="footer">New admin? <router-link to="/admin/signup">Sign up</router-link></p>
      </template>
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

.login-view .required-asterisk {
  color: #ef4444;
}

.login-view .auth-success-banner--spaced {
  margin-bottom: 1rem;
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
</style>
