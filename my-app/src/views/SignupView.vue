<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AuthLayout from '../components/AuthLayout.vue'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { signUp, isLoading, error } = useAuth()
const form = reactive({ name: '', position_in_company: '', company_branch: '', employee_no: '' as string, email: '', password: '' })
const pictureFile = ref<File | null>(null)

function onPictureChange(e: Event) {
  const input = e.target as HTMLInputElement
  pictureFile.value = input.files?.[0] ?? null
}

async function onSubmit() {
  const num = Number(form.employee_no)
  if (!Number.isInteger(num) || num < 1) { error.value = 'Employee number must be a positive number'; return }
  const err = await signUp({
    name: form.name,
    position_in_company: form.position_in_company,
    company_branch: form.company_branch,
    employee_no: num,
    picture: pictureFile.value ?? undefined,
    email: form.email,
    password: form.password
  }).then(r => r.error)
  if (!err) router.push('/dashboard')
}
</script>
<template>
  <AuthLayout>
    <h1>Create account</h1>
    <form class="auth-form" @submit.prevent="onSubmit">
      <div class="field"><label for="name">Full name</label><input id="name" v-model="form.name" type="text" required placeholder="Juan Dela Cruz" autocomplete="name" /></div>
      <div class="field"><label for="position">Position</label><input id="position" v-model="form.position_in_company" type="text" required placeholder="e.g. Developer" /></div>
      <div class="field"><label for="branch">Branch</label><input id="branch" v-model="form.company_branch" type="text" required placeholder="e.g. Manila HQ" /></div>
      <div class="field"><label for="empno">Employee no.</label><input id="empno" v-model="form.employee_no" type="number" required min="1" placeholder="10001" /></div>
      <div class="field">
        <label for="picture">Profile picture <span class="muted">(optional)</span></label>
        <input id="picture" type="file" accept="image/*" @change="onPictureChange" />
        <span v-if="pictureFile" class="file-name">{{ pictureFile.name }}</span>
      </div>
      <div class="field"><label for="email">Email</label><input id="email" v-model="form.email" type="email" required placeholder="you@company.com" autocomplete="email" /></div>
      <div class="field"><label for="password">Password</label><input id="password" v-model="form.password" type="password" required minlength="6" placeholder="••••••••" autocomplete="new-password" /></div>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" class="btn primary" :disabled="isLoading">{{ isLoading ? 'Creating…' : 'Sign up' }}</button>
    </form>
    <p class="footer">Already have an account? <router-link to="/login">Log in</router-link></p>
  </AuthLayout>
</template>
<style scoped>
.muted { color: #64748b; font-weight: normal; }
.file-name { font-size: 0.8125rem; color: #94a3b8; margin-left: 0.5rem; }
input[type="file"] { padding: 0.35rem 0; }
</style>
