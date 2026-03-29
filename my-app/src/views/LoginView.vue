<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import { useAuth } from '../composables/useAuth'

const route = useRoute()
const router = useRouter()
const { signIn, isLoading, error } = useAuth()
const form = reactive({ email: '', password: '' })
const showPassword = ref(false)
/** Shown after user lands from Supabase email confirmation link (see useAuth signUp emailRedirectTo). */
const showEmailConfirmedBanner = ref(false)
const showPasswordResetBanner = ref(false)

onMounted(() => {
  const nextQuery = { ...route.query }
  let shouldReplaceQuery = false

  if (route.query.email_confirmed === '1') {
    showEmailConfirmedBanner.value = true
    delete nextQuery.email_confirmed
    shouldReplaceQuery = true
  }
  if (route.query.password_reset === '1') {
    showPasswordResetBanner.value = true
    delete nextQuery.password_reset
    shouldReplaceQuery = true
  }

  if (shouldReplaceQuery) router.replace({ path: route.path, query: nextQuery })
})

function goBack() {
  router.push({ name: 'Home' })
}

function togglePassword() {
  showPassword.value = !showPassword.value
}

async function onSubmit() {
  const err = await signIn(form.email, form.password).then(r => r.error)
  if (!err) router.push('/dashboard')
}
</script>
<template>
  <div class="login-view">
    <AuthLayout>
      <div
        v-if="showEmailConfirmedBanner"
        class="auth-success-banner"
        role="status"
        aria-live="polite"
      >
        <p class="auth-success-banner__title">Email confirmed</p>
        <p class="auth-success-banner__text">
          You have successfully confirmed your email. You can now log in.
        </p>
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
      <h2 class="auth-title"><strong>LOGIN</strong></h2>
      <form class="auth-form" @submit.prevent="onSubmit">
        <div class="field"><label for="email">COMPANY EMAIL</label><input id="email" v-model="form.email" type="email" required placeholder="company.email@pcworth.com" autocomplete="email" /></div>
        <div class="field">
          <label for="password">PASSWORD</label>
          <div class="input-with-icon">
            <input
              id="password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              required
              placeholder="Minimum of 6 characters"
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
          <button type="submit" class="btn primary" :disabled="isLoading">{{ isLoading ? 'Signing in…' : 'Sign in' }}</button>
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

.login-view .auth-success-banner--spaced {
  margin-bottom: 1rem;
}
</style>
