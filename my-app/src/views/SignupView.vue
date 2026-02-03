<script setup lang="ts">
import { reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { signUp, isLoading, error } = useAuth()

const form = reactive({ name: '', email: '', password: '' })

async function onSubmit() {
  const { error: err } = await signUp(form.name, form.email, form.password)
  if (!err) router.push('/')
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <h1>Sign up</h1>
      <form @submit.prevent="onSubmit" class="auth-form">
        <div class="field">
          <label for="signup-name">Name</label>
          <input
            id="signup-name"
            v-model="form.name"
            type="text"
            required
            placeholder="Your name"
            autocomplete="name"
          />
        </div>
        <div class="field">
          <label for="signup-email">Email</label>
          <input
            id="signup-email"
            v-model="form.email"
            type="email"
            required
            placeholder="you@example.com"
            autocomplete="email"
          />
        </div>
        <div class="field">
          <label for="signup-password">Password</label>
          <input
            id="signup-password"
            v-model="form.password"
            type="password"
            required
            minlength="6"
            placeholder="••••••••"
            autocomplete="new-password"
          />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn primary" :disabled="isLoading">
          {{ isLoading ? 'Creating account…' : 'Create account' }}
        </button>
      </form>
      <p class="footer">
        Already have an account? <router-link to="/login">Log in</router-link>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
}
.auth-card {
  width: 100%;
  max-width: 360px;
  padding: 2rem;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
h1 {
  margin: 0 0 1.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  color: #eee;
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field label {
  font-size: 0.875rem;
  color: #b0b0b0;
}
.field input {
  padding: 0.6rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  color: #fff;
  font-size: 1rem;
}
.field input::placeholder {
  color: #666;
}
.field input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}
.error {
  margin: 0;
  font-size: 0.875rem;
  color: #f87171;
}
.btn {
  padding: 0.65rem 1rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn.primary {
  background: #6366f1;
  color: #fff;
}
.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.footer {
  margin: 1.25rem 0 0;
  font-size: 0.875rem;
  color: #888;
}
.footer a {
  color: #818cf8;
  text-decoration: none;
}
.footer a:hover {
  text-decoration: underline;
}
</style>
