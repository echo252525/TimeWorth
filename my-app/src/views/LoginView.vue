<script setup lang="ts">
import { reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import '../assets/auth.css'

const router = useRouter()
const { signIn, isLoading, error } = useAuth()
const form = reactive({ email: '', password: '' })

async function onSubmit() {
  const { error: err } = await signIn(form.email, form.password)
  if (!err) router.push('/dashboard')
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <h1>Log in</h1>
      <form @submit.prevent="onSubmit" class="auth-form">
        <div class="field">
          <label for="login-email">Email</label>
          <input id="login-email" v-model="form.email" type="email" required placeholder="you@company.com" autocomplete="email" />
        </div>
        <div class="field">
          <label for="login-password">Password</label>
          <input id="login-password" v-model="form.password" type="password" required placeholder="••••••••" autocomplete="current-password" />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn primary" :disabled="isLoading">
          {{ isLoading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
      <p class="footer">No account? <router-link to="/signup">Sign up</router-link></p>
    </div>
  </div>
</template>
