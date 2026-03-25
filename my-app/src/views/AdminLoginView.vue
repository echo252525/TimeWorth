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
  <AuthLayout>
    <template v-if="showPendingReview">
      <h1>Account under review</h1>
      <p class="pending-copy">
        Your account is being reviewed by a superadmin. You will be able to sign in once your role has been approved.
      </p>
      <button type="button" class="btn primary pending-ok" @click="dismissPendingReview">Okay</button>
    </template>
    <template v-else>
      <h1>Admin login</h1>
      <form class="auth-form" @submit.prevent="onSubmit">
        <div class="field"><label for="email">Email</label><input id="email" v-model="form.email" type="email" required placeholder="admin@company.com" autocomplete="email" /></div>
        <div class="field"><label for="password">Password</label><input id="password" v-model="form.password" type="password" required placeholder="••••••••" autocomplete="current-password" /></div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn primary" :disabled="isLoading">{{ isLoading ? 'Signing in…' : 'Sign in' }}</button>
      </form>
      <p class="footer">New admin? <router-link to="/admin/signup">Sign up</router-link></p>
    </template>
  </AuthLayout>
</template>
<style scoped>
.pending-copy {
  margin: 0 0 1.25rem;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--text-secondary);
}
.pending-ok {
  width: 100%;
  margin-top: 0.25rem;
  padding: 0.6rem 1rem;
  border: none;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  background: var(--accent-light);
  color: #fff;
}
.pending-ok:hover { opacity: 0.92; }
</style>
