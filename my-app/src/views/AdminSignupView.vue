<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import { useAdminAuth } from '../composables/useAdminAuth'

const router = useRouter()
const { signUpAdmin } = useAdminAuth()
const form = reactive({ name: '', employeeid: '', position_in_company: '', company_branch: '', email: '', password: '' })
const isLoading = ref(false)
const error = ref<string | null>(null)

async function onSubmit() {
  isLoading.value = true
  error.value = null
  const r = await signUpAdmin({
    name: form.name,
    employeeid: form.employeeid,
    position_in_company: form.position_in_company,
    company_branch: form.company_branch,
    email: form.email,
    password: form.password
  })
  isLoading.value = false
  if (r.error) { error.value = r.error; return }
  router.push('/admin/login')
}
</script>
<template>
  <AuthLayout>
    <h1>Admin sign up</h1>
    <form class="auth-form" @submit.prevent="onSubmit">
      <div class="field"><label for="name">Full name</label><input id="name" v-model="form.name" type="text" required placeholder="Admin Name" autocomplete="name" /></div>
      <div class="field"><label for="employeeid">Employee ID</label><input id="employeeid" v-model="form.employeeid" type="text" required placeholder="ADM-001" autocomplete="off" /></div>
      <div class="field"><label for="position">Position</label><input id="position" v-model="form.position_in_company" type="text" required placeholder="e.g. Admin" autocomplete="organization-title" /></div>
      <div class="field"><label for="branch">Branch</label><input id="branch" v-model="form.company_branch" type="text" required placeholder="e.g. Manila" autocomplete="organization" /></div>
      <div class="field"><label for="email">Email</label><input id="email" v-model="form.email" type="email" required placeholder="admin@company.com" autocomplete="email" /></div>
      <div class="field"><label for="password">Password</label><input id="password" v-model="form.password" type="password" required minlength="6" placeholder="••••••••" autocomplete="new-password" /></div>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" class="btn primary" :disabled="isLoading">{{ isLoading ? 'Creating…' : 'Sign up' }}</button>
    </form>
    <p class="footer">Already have an account? <router-link to="/admin/login">Log in</router-link></p>
  </AuthLayout>
</template>
