<script setup lang="ts">
import { reactive } from 'vue'
import { useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { signIn, isLoading, error } = useAuth()
const form = reactive({ email: '', password: '' })

async function onSubmit() {
  const err = await signIn(form.email, form.password).then(r => r.error)
  if (!err) router.push('/dashboard')
}
</script>
<template>
  <AuthLayout>
    <h1>Log in</h1>
    <form class="auth-form" @submit.prevent="onSubmit">
      <div class="field"><label for="email">Email</label><input id="email" v-model="form.email" type="email" required placeholder="you@company.com" autocomplete="email" /></div>
      <div class="field"><label for="password">Password</label><input id="password" v-model="form.password" type="password" required placeholder="••••••••" autocomplete="current-password" /></div>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" class="btn primary" :disabled="isLoading">{{ isLoading ? 'Signing in…' : 'Sign in' }}</button>
    </form>
    <p class="footer">No account? <router-link to="/signup">Sign up</router-link></p>
  </AuthLayout>
</template>
