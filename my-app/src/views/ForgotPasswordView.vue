<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import { sendPasswordResetEmail } from '../composables/useAuth'

const route = useRoute()
const router = useRouter()

const form = reactive({
  email: typeof route.query.email === 'string' ? route.query.email : ''
})

const isLoading = ref(false)
const error = ref<string | null>(null)
const success = ref<string | null>(null)

const origin = computed(() => (route.query.from === 'admin' ? 'admin' : 'employee'))
const isAdmin = computed(() => origin.value === 'admin')
const backRoute = computed(() => (isAdmin.value ? '/admin/login' : '/login'))
const badgeText = computed(() => 'Secure recovery')
const title = computed(() => (isAdmin.value ? 'Reset Admin Password' : 'Reset Password'))
const subtitle = computed(() => (
  isAdmin.value
    ? 'Enter the email linked to your admin account. A secure password reset link will be sent to you.'
    : 'Enter the email you used to sign up to receive a secure password recovery link.'
))
const placeholder = computed(() => (
  isAdmin.value
    ? 'Enter your admin email'
    : 'company.email@pcworth.com'
))
const inputLabel = computed(() => (isAdmin.value ? 'ADMIN EMAIL' : 'EMAIL'))

async function submit() {
  error.value = null
  success.value = null

  if (!form.email.trim()) {
    error.value = isAdmin.value
      ? 'Enter your admin email so we can send the reset link.'
      : 'Enter your company email so we can send the reset link.'
    return
  }

  isLoading.value = true
  const result = await sendPasswordResetEmail(form.email, origin.value)
  isLoading.value = false

  if (result.error) {
    error.value = result.error
    return
  }

  success.value = 'If this email is registered, a reset link has been sent to your inbox.'
}
</script>

<template>
  <div class="forgot-password-view">
    <AuthLayout>
      <div class="forgot-password-shell">
        <div class="forgot-password-badge">{{ badgeText }}</div>
        <h2 class="auth-title forgot-password-title">{{ title }}</h2>
        <p class="forgot-password-subtitle">{{ subtitle }}</p>

        <form class="auth-form" @submit.prevent="submit">
          <div class="field">
            <label for="forgot-password-email">{{ inputLabel }}</label>
            <input
              id="forgot-password-email"
              v-model="form.email"
              type="email"
              :placeholder="placeholder"
              autocomplete="email"
            />
          </div>

          <p
            v-if="error"
            class="error"
            role="alert"
            aria-live="polite"
          >
            {{ error }}
          </p>

          <div
            v-if="success"
            class="auth-success-banner forgot-password-banner"
            role="status"
            aria-live="polite"
          >
            <p class="auth-success-banner__title">Check your inbox</p>
            <p class="auth-success-banner__text">{{ success }}</p>
          </div>

          <div class="auth-actions-row">
            <button type="button" class="btn btn-outline-secondary" @click="router.push(backRoute)">Back</button>
            <button type="submit" class="btn primary" :disabled="isLoading">
              {{ isLoading ? 'Sending link…' : 'Send link' }}
            </button>
          </div>
        </form>
      </div>
    </AuthLayout>
  </div>
</template>

<style>
.forgot-password-view .auth-page {
  background: #c2deff;
  background: linear-gradient(260deg, rgba(194, 222, 255, 1) 0%, rgba(255, 217, 217, 1) 100%);
}

body.dark-mode .forgot-password-view .auth-page {
  background: #122c4a;
  background: linear-gradient(260deg, rgba(18, 44, 74, 1) 0%, rgba(74, 16, 16, 1) 100%);
}

.forgot-password-view .auth-card {
  max-width: 440px;
}

.forgot-password-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.forgot-password-badge {
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

.forgot-password-title {
  margin-bottom: 0;
}

.forgot-password-subtitle {
  margin: -0.35rem 0 0;
  text-align: center;
  color: var(--text-secondary);
  line-height: 1.55;
  font-size: 0.95rem;
}

.forgot-password-banner {
  margin-top: 0.25rem;
}
</style>
