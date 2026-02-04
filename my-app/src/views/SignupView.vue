<script setup lang="ts">
import { reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import '../assets/auth.css'

const router = useRouter()
const { signUp, isLoading, error } = useAuth()
const form = reactive({
  name: '',
  position_in_company: '',
  company_branch: '',
  employee_no: '' as string,
  picture: '',
  email: '',
  password: ''
})

async function onSubmit() {
  const empNo = Number(form.employee_no)
  if (Number.isNaN(empNo)) return
  const { error: err } = await signUp({
    name: form.name,
    position_in_company: form.position_in_company,
    company_branch: form.company_branch,
    employee_no: empNo,
    picture: form.picture || undefined,
    email: form.email,
    password: form.password
  })
  if (!err) router.push('/dashboard')
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <h1>Sign up</h1>
      <form @submit.prevent="onSubmit" class="auth-form">
        <div class="field">
          <label for="name">Full name</label>
          <input id="name" v-model="form.name" type="text" required placeholder="Juan Dela Cruz" autocomplete="name" />
        </div>
        <div class="field">
          <label for="position">Position</label>
          <input id="position" v-model="form.position_in_company" type="text" required placeholder="e.g. Developer" />
        </div>
        <div class="field">
          <label for="branch">Company branch</label>
          <input id="branch" v-model="form.company_branch" type="text" required placeholder="e.g. Manila HQ" />
        </div>
        <div class="field">
          <label for="empNo">Employee number</label>
          <input id="empNo" v-model="form.employee_no" type="number" required min="1" placeholder="e.g. 10001" />
        </div>
        <div class="field">
          <label for="picture">Picture URL <span class="optional">(optional)</span></label>
          <input id="picture" v-model="form.picture" type="url" placeholder="https://..." />
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" v-model="form.email" type="email" required placeholder="you@company.com" autocomplete="email" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" v-model="form.password" type="password" required minlength="6" placeholder="••••••••" autocomplete="new-password" />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn primary" :disabled="isLoading">
          {{ isLoading ? 'Creating account…' : 'Create account' }}
        </button>
      </form>
      <p class="footer">Already have an account? <router-link to="/login">Log in</router-link></p>
    </div>
  </div>
</template>

<style scoped>
.optional {
  color: #64748b;
  font-weight: normal;
}
</style>
