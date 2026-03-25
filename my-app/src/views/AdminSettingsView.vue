<script setup lang="ts">
import { ref, onMounted } from 'vue'
import supabase from '../lib/supabaseClient'
import { useAdminAuth, getSignedAdminProfileUrl, ADMIN_PROFILE_BUCKET, adminProfile } from '../composables/useAdminAuth'
import type { AdminRow, AdminRole } from '../composables/useAdminAuth'
import { useAuth } from '../composables/useAuth'

const { user } = useAuth()
const { isSuperadmin, fetchAdminProfile } = useAdminAuth()

const name = ref('')
const employeeid = ref('')
const positionInCompany = ref('')
const companyBranch = ref('')
const email = ref('')

const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

const pictureUploading = ref(false)
const oldPicturePath = ref<string | null>(null)
const previewUrl = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const showPasswordForm = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const changingPassword = ref(false)
const passwordError = ref<string | null>(null)
const passwordSuccess = ref(false)

const admins = ref<AdminRow[]>([])
const adminsLoading = ref(false)
const adminsError = ref<string | null>(null)

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function roleFromEvent(e: Event): string {
  return (e.target as HTMLSelectElement).value
}

async function syncPicturePreview() {
  const pic = adminProfile.value?.picture
  if (!pic) {
    previewUrl.value = null
    oldPicturePath.value = null
    return
  }
  if (pic.startsWith('http')) {
    previewUrl.value = pic
    oldPicturePath.value = null
    return
  }
  oldPicturePath.value = pic
  previewUrl.value = await getSignedAdminProfileUrl(pic)
}

async function loadForm() {
  await fetchAdminProfile()
  const p = adminProfile.value
  if (!p) {
    loading.value = false
    return
  }
  name.value = p.name ?? ''
  employeeid.value = p.employeeid ?? ''
  positionInCompany.value = p.position_in_company ?? ''
  companyBranch.value = p.company_branch ?? ''
  email.value = p.email ?? ''
  await syncPicturePreview()
  loading.value = false
}

onMounted(async () => {
  if (!user.value?.id) {
    loading.value = false
    return
  }
  loading.value = true
  await loadForm()
  if (isSuperadmin.value) {
    adminsLoading.value = true
    const { data, error: err } = await supabase.from('admin').select('*').order('created_at', { ascending: false })
    adminsLoading.value = false
    if (err) adminsError.value = err.message
    else admins.value = (data ?? []) as AdminRow[]
  }
})

async function saveProfile() {
  if (!user.value?.id) return
  error.value = null
  success.value = false
  saving.value = true
  try {
    const updates = {
      name: name.value.trim(),
      employeeid: employeeid.value.trim(),
      position_in_company: positionInCompany.value.trim(),
      company_branch: companyBranch.value.trim(),
      updated_at: new Date().toISOString()
    }
    const { error: updateError } = await supabase.from('admin').update(updates).eq('id', user.value.id)
    if (updateError) throw new Error(updateError.message)
    await fetchAdminProfile()
    success.value = true
    window.dispatchEvent(new CustomEvent('profile-updated'))
    setTimeout(() => { success.value = false }, 3000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    saving.value = false
  }
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function extFromMime(file: File): string {
  const t = file.type
  if (t === 'image/png') return 'png'
  if (t === 'image/webp') return 'webp'
  if (t === 'image/gif') return 'gif'
  return 'jpg'
}

async function onPictureFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !user.value?.id) return
  if (!file.type.startsWith('image/')) {
    error.value = 'Please choose an image file'
    return
  }
  if (file.size > MAX_IMAGE_BYTES) {
    error.value = 'Image must be 5MB or smaller'
    return
  }
  pictureUploading.value = true
  error.value = null
  try {
    if (oldPicturePath.value) {
      await supabase.storage.from(ADMIN_PROFILE_BUCKET).remove([oldPicturePath.value])
    }
    const ext = extFromMime(file)
    const path = `${user.value.id}/${Date.now()}.${ext}`
    const buf = await file.arrayBuffer()
    const { error: uploadError } = await supabase.storage.from(ADMIN_PROFILE_BUCKET).upload(path, buf, {
      upsert: false,
      contentType: file.type || `image/${ext}`
    })
    if (uploadError) throw new Error(uploadError.message || 'Upload failed')
    const { error: dbErr } = await supabase
      .from('admin')
      .update({ picture: path, updated_at: new Date().toISOString() })
      .eq('id', user.value.id)
    if (dbErr) throw new Error(dbErr.message)
    await fetchAdminProfile()
    await syncPicturePreview()
    success.value = true
    window.dispatchEvent(new CustomEvent('profile-updated'))
    setTimeout(() => { success.value = false }, 3000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save picture'
  } finally {
    pictureUploading.value = false
  }
}

async function changePassword() {
  if (!user.value?.id) return
  passwordError.value = null
  passwordSuccess.value = false
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    passwordError.value = 'All fields are required'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = 'New passwords do not match'
    return
  }
  if (newPassword.value.length < 6) {
    passwordError.value = 'New password must be at least 6 characters'
    return
  }
  changingPassword.value = true
  try {
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: email.value,
      password: currentPassword.value
    })
    if (verifyError) throw new Error('Current password is incorrect')
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword.value })
    if (updateError) throw updateError
    passwordSuccess.value = true
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    setTimeout(() => { passwordSuccess.value = false }, 3000)
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : 'Failed to change password'
  } finally {
    changingPassword.value = false
  }
}

function togglePasswordForm() {
  showPasswordForm.value = !showPasswordForm.value
  if (!showPasswordForm.value) {
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordError.value = null
  }
}

async function updateRole(id: string, roleVal: string) {
  const role = roleVal as AdminRole
  if (role !== 'pending' && role !== 'admin') return
  adminsError.value = null
  const { error: err } = await supabase.from('admin').update({ role, updated_at: new Date().toISOString() }).eq('id', id)
  if (err) { adminsError.value = err.message; return }
  const a = admins.value.find(x => x.id === id)
  if (a) a.role = role
  if (adminProfile.value?.id === id) adminProfile.value.role = role
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Settings</h1>
      <p class="page-desc">Profile, security, and admin management</p>
    </header>

    <div v-if="loading" class="loading-state">Loading…</div>

    <template v-else>
      <section class="card profile-card">
        <h2 class="card-title">Your profile</h2>
        <div class="profile-row">
          <div class="avatar-wrap">
            <img v-if="previewUrl" :src="previewUrl" alt="" class="avatar" />
            <span v-else class="avatar placeholder">{{ (name || '?').slice(0, 1).toUpperCase() }}</span>
            <button
              type="button"
              class="avatar-edit"
              :disabled="pictureUploading"
              :title="pictureUploading ? 'Uploading…' : 'Change photo'"
              :aria-label="pictureUploading ? 'Uploading…' : 'Change photo'"
              @click="openFilePicker"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11.33 2a2 2 0 0 1 1.42.59l1.66 1.66a2 2 0 0 1 0 2.82L5 14H2v-3L9.09 3.09a2 2 0 0 1 2.24-.09z"/>
              </svg>
            </button>
            <input
              ref="fileInputRef"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              class="visually-hidden"
              @change="onPictureFile"
            />
          </div>
          <div class="profile-meta">
            <label class="field-label" for="admin-name">Name</label>
            <input id="admin-name" v-model="name" type="text" class="text-input" placeholder="Your name" autocomplete="name" />
            <p class="email">{{ email }}</p>
            <p class="field-hint">Email is tied to your login and cannot be changed here.</p>
          </div>
        </div>

        <div class="fields-grid">
          <div class="field">
            <label for="admin-employeeid">Employee ID</label>
            <input id="admin-employeeid" v-model="employeeid" type="text" class="text-input" autocomplete="off" />
          </div>
          <div class="field">
            <label for="admin-position">Position</label>
            <input id="admin-position" v-model="positionInCompany" type="text" class="text-input" autocomplete="organization-title" />
          </div>
          <div class="field field-full">
            <label for="admin-branch">Company branch</label>
            <input id="admin-branch" v-model="companyBranch" type="text" class="text-input" autocomplete="off" />
          </div>
        </div>

        <p v-if="error" class="msg error">{{ error }}</p>
        <p v-if="success" class="msg success">Saved.</p>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="saveProfile">
          {{ saving ? 'Saving…' : 'Save profile' }}
        </button>
      </section>

      <section class="card security-card">
        <h2 class="card-title">Security</h2>
        <template v-if="!showPasswordForm">
          <button type="button" class="btn btn-ghost" @click="togglePasswordForm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Change password
          </button>
          <p v-if="passwordSuccess" class="msg success">Password changed successfully.</p>
        </template>
        <template v-else>
          <form class="password-form" @submit.prevent="changePassword">
            <div class="field">
              <label for="admin-current-password">Current password</label>
              <input id="admin-current-password" v-model="currentPassword" type="password" placeholder="Current password" autocomplete="current-password" />
            </div>
            <div class="field">
              <label for="admin-new-password">New password</label>
              <input id="admin-new-password" v-model="newPassword" type="password" placeholder="At least 6 characters" autocomplete="new-password" minlength="6" />
            </div>
            <div class="field">
              <label for="admin-confirm-password">Confirm new password</label>
              <input id="admin-confirm-password" v-model="confirmPassword" type="password" placeholder="Confirm" autocomplete="new-password" minlength="6" />
            </div>
            <p v-if="passwordError" class="msg error">{{ passwordError }}</p>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" @click="togglePasswordForm">Cancel</button>
              <button type="submit" class="btn btn-primary" :disabled="changingPassword">
                {{ changingPassword ? 'Updating…' : 'Update password' }}
              </button>
            </div>
          </form>
        </template>
      </section>

      <section v-if="isSuperadmin" class="section">
        <h2 class="card-title">Manage admins</h2>
        <p class="muted">Your role: <strong>{{ adminProfile?.role }}</strong></p>
        <p v-if="adminsError" class="error">{{ adminsError }}</p>
        <div v-if="adminsLoading" class="muted">Loading…</div>
        <div v-else class="table-wrap">
          <table class="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr></thead>
            <tbody>
              <tr v-for="a in admins" :key="a.id">
                <td>{{ a.name }}</td>
                <td>{{ a.email }}</td>
                <td>{{ a.role }}</td>
                <td>
                  <select v-if="a.role === 'pending'" :value="a.role" class="select" @change="updateRole(a.id, roleFromEvent($event))">
                    <option value="pending">pending</option>
                    <option value="admin">admin</option>
                  </select>
                  <span v-else class="muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page { width: 100%; max-width: 560px; }
.page-header { margin-bottom: 1.75rem; }
.page-header h1 { margin: 0; font-size: 1.5rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.02em; }
.page-desc { margin: 0.25rem 0 0; font-size: 0.9375rem; color: var(--text-tertiary); }
.loading-state { color: var(--text-tertiary); font-size: 0.9375rem; padding: 2rem 0; }

.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}
.card-title { margin: 0 0 1rem; font-size: 0.8125rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.06em; }

.profile-card .profile-row { display: flex; gap: 1.25rem; align-items: flex-start; margin-bottom: 1.25rem; }
.avatar-wrap { position: relative; flex-shrink: 0; }
.avatar { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; display: block; }
.avatar.placeholder {
  width: 72px; height: 72px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: rgba(56,189,248,0.15); color: var(--accent); font-weight: 600; font-size: 1.75rem;
}
.avatar-edit {
  position: absolute; bottom: -2px; right: -2px;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--bg-secondary); color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: transform 0.2s, background 0.2s;
}
.avatar-edit:hover:not(:disabled) { background: var(--accent-light); transform: scale(1.05); }
.avatar-edit:disabled { opacity: 0.6; cursor: not-allowed; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }

.profile-meta { flex: 1; min-width: 0; }
.field-label { display: block; font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.35rem; }
.text-input {
  width: 100%; padding: 0.5rem 0.75rem; border-radius: 8px;
  border: 1px solid var(--border-color); background: var(--bg-primary);
  color: var(--text-primary); font-size: 0.9375rem; margin-bottom: 0.5rem;
}
.text-input:focus { outline: none; border-color: var(--accent); }
.email { margin: 0; font-size: 0.875rem; color: var(--text-secondary); }
.field-hint { margin: 0.25rem 0 0; font-size: 0.75rem; color: var(--text-tertiary); }

.fields-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.875rem 1rem;
  margin-bottom: 1rem;
}
.field { display: flex; flex-direction: column; gap: 0.35rem; }
.field-full { grid-column: 1 / -1; }
.field label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }

.msg { margin: 0 0 0.75rem; font-size: 0.875rem; }
.msg.error { color: #f87171; }
.msg.success { color: #34d399; }

.btn { padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; transition: opacity 0.2s, background 0.2s; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { opacity: 0.92; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

.security-card .btn-ghost {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0; font-size: 0.9375rem; color: var(--text-secondary);
  background: none; border: none; cursor: pointer; border-radius: 6px;
  transition: color 0.2s, background 0.2s;
}
.security-card .btn-ghost:hover { color: var(--accent); background: rgba(56,189,248,0.08); }
.security-card .btn-ghost svg { flex-shrink: 0; opacity: 0.8; }

.password-form { display: flex; flex-direction: column; gap: 0.875rem; }
.password-form .field input {
  width: 100%; max-width: 320px; padding: 0.5rem 0.75rem; border-radius: 8px;
  border: 1px solid var(--border-color); background: var(--bg-primary);
  color: var(--text-primary); font-size: 0.9375rem;
}
.password-form .field input:focus { outline: none; border-color: var(--accent); }
.form-actions { display: flex; gap: 0.75rem; align-items: center; margin-top: 0.25rem; }

.section { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color); }
.muted { color: var(--text-tertiary); font-size: 0.875rem; margin: 0.5rem 0; }
.error { color: #f87171; font-size: 0.875rem; margin: 0 0 0.5rem; }
.table-wrap { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.table th, .table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border-color); }
.table th { color: var(--text-tertiary); font-weight: 500; }
.select { padding: 0.35rem 0.5rem; border-radius: 6px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color); font-size: 0.8125rem; cursor: pointer; }

@media (max-width: 520px) {
  .fields-grid { grid-template-columns: 1fr; }
}
</style>
