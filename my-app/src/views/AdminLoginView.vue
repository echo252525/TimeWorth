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
const showPendingReview = ref(false)
const showPassword = ref(false)

watch(
  () => route.query.pending,
  (p) => {
    if (p === '1') showPendingReview.value = true
  },
  { immediate: true }
)

function dismissPendingReview() {
  showPendingReview.value = false
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
  showPendingReview.value = false
  const r = await signIn(form.email, form.password)
  isLoading.value = false
  if ('error' in r) {
    error.value = r.error
    return
  }
  if ('pendingReview' in r && r.pendingReview) {
    showPendingReview.value = true
    return
  }
  if ('ok' in r && r.ok) router.push({ name: 'AdminHome' })
}
</script>
<template>
  <div class="login-view">
    <AuthLayout>
      <template v-if="showPendingReview">
        <div
          class="auth-success-banner"
          role="status"
          aria-live="polite"
        >
          <p class="auth-success-banner__title">Account under review</p>
          <p class="auth-success-banner__text">
            Your account is being reviewed by a superadmin. You will be able to sign in once your role has been approved.
          </p>
          <button
            type="button"
            class="btn primary auth-success-banner__cta"
            @click="dismissPendingReview"
          >
            Okay
          </button>
        </div>
      </template>
      <template v-else>
        <h2 class="auth-title">Admin Log in</h2>
        <form class="auth-form" @submit.prevent="onSubmit">
          <div class="field">
            <label for="admin-login-email">Email</label>
            <input
              id="admin-login-email"
              v-model="form.email"
              type="email"
              required
              placeholder="Enter your email used for admin account"
              autocomplete="email"
            />
          </div>
          <div class="field">
            <label for="admin-login-password">Password</label>
            <div class="input-with-icon">
              <input
                id="admin-login-password"
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
</style>
