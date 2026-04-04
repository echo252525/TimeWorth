<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import supabase from '../lib/supabaseClient'
import { useAdminAuth, getSignedAdminProfileUrl, ADMIN_PROFILE_BUCKET, adminProfile } from '../composables/useAdminAuth'
import type { AdminRow, AdminRole } from '../composables/useAdminAuth'
import { useAuth } from '../composables/useAuth'

const { user } = useAuth()
const { isSuperadmin, fetchAdminProfile } = useAdminAuth()

const name = ref('')
const employeeid = ref('')
const positionInCompany = ref('')
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
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)
const changingPassword = ref(false)
const passwordError = ref<string | null>(null)
const passwordSuccess = ref(false)

const admins = ref<AdminRow[]>([])
const adminsLoading = ref(false)
const adminsError = ref<string | null>(null)

const showPersonalInfoForm = ref(false)
interface PersonalBaseline {
  name: string
  employeeid: string
  positionInCompany: string
}
const personalBaseline = ref<PersonalBaseline | null>(null)

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function roleFromEvent(e: Event): string {
  return (e.target as HTMLSelectElement).value
}

function capturePersonalBaseline() {
  personalBaseline.value = {
    name: name.value.trim(),
    employeeid: employeeid.value.trim(),
    positionInCompany: positionInCompany.value.trim(),
  }
}

function startEditPersonalInfo() {
  capturePersonalBaseline()
  showPersonalInfoForm.value = true
  success.value = false
}

function cancelEditPersonalInfo() {
  if (personalBaseline.value) {
    const b = personalBaseline.value
    name.value = b.name
    employeeid.value = b.employeeid
    positionInCompany.value = b.positionInCompany
  }
  showPersonalInfoForm.value = false
  personalBaseline.value = null
  error.value = null
  success.value = false
}

const personalInfoDirty = computed(() => {
  if (!showPersonalInfoForm.value || !personalBaseline.value) return false
  const b = personalBaseline.value
  return (
    name.value.trim() !== b.name ||
    employeeid.value.trim() !== b.employeeid ||
    positionInCompany.value.trim() !== b.positionInCompany
  )
})

const canSubmitPasswordChange = computed(() => {
  return (
    currentPassword.value.length > 0 &&
    newPassword.value.length >= 6 &&
    confirmPassword.value.length > 0
  )
})

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
  if (!user.value?.id || !showPersonalInfoForm.value) return
  error.value = null
  success.value = false
  saving.value = true
  try {
    const updates = {
      name: name.value.trim(),
      employeeid: employeeid.value.trim(),
      position_in_company: positionInCompany.value.trim(),
      updated_at: new Date().toISOString()
    }
    const { error: updateError } = await supabase.from('admin').update(updates).eq('id', user.value.id)
    if (updateError) throw new Error(updateError.message)
    await fetchAdminProfile()
    success.value = true
    showPersonalInfoForm.value = false
    personalBaseline.value = null
    window.dispatchEvent(new CustomEvent('profile-updated'))
    setTimeout(() => { success.value = false }, 4000)
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
    setTimeout(() => { success.value = false }, 4000)
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
    const signInEmail = user.value?.email
    if (!signInEmail) throw new Error('No email on session')
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: signInEmail,
      password: currentPassword.value
    })
    if (verifyError) throw new Error('Current password is incorrect')
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword.value })
    if (updateError) throw updateError
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordError.value = null
    showCurrentPassword.value = false
    showNewPassword.value = false
    showConfirmPassword.value = false
    showPasswordForm.value = false
    passwordSuccess.value = true
    setTimeout(() => { passwordSuccess.value = false }, 4000)
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : 'Failed to change password'
  } finally {
    changingPassword.value = false
  }
}

function togglePasswordForm() {
  const opening = !showPasswordForm.value
  showPasswordForm.value = opening
  if (opening) {
    passwordSuccess.value = false
    passwordError.value = null
  } else {
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordError.value = null
    showCurrentPassword.value = false
    showNewPassword.value = false
    showConfirmPassword.value = false
  }
}

function toggleCurrentPasswordVisibility() {
  showCurrentPassword.value = !showCurrentPassword.value
}

function toggleNewPasswordVisibility() {
  showNewPassword.value = !showNewPassword.value
}

function toggleConfirmPasswordVisibility() {
  showConfirmPassword.value = !showConfirmPassword.value
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
      <p class="page-desc">Manage your account details here.</p>
    </header>

    <div v-if="loading" class="loading-state">Loading…</div>

    <template v-else>
      <div class="settings-grid">
        <section class="card personal-card profile-card settings-grid__personal">
          <h2 class="card-title">Personal Information</h2>
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
              <template v-if="!showPersonalInfoForm">
                <div class="personal-summary">
                  <div class="personal-summary__row">
                    <div class="summary-item">
                      <span class="summary-label">Full name</span>
                      <span class="summary-value">{{ name || '—' }}</span>
                    </div>
                    <div class="summary-item">
                      <span class="summary-label">Position</span>
                      <span class="summary-value">{{ positionInCompany || '—' }}</span>
                    </div>
                    <div class="summary-item">
                      <span class="summary-label">Employee ID</span>
                      <span class="summary-value">{{ employeeid || '—' }}</span>
                    </div>
                  </div>
                  <div class="personal-summary__row">
                    <div class="summary-item">
                      <span class="summary-label">Email</span>
                      <span class="summary-value summary-value--email">{{ email || '—' }}</span>
                    </div>
                    <div class="summary-item summary-item--empty" aria-hidden="true"></div>
                    <div class="summary-item summary-item--empty" aria-hidden="true"></div>
                  </div>
                </div>
                <p class="email-hint">Email is tied to your login and cannot be changed here.</p>
              </template>
              <template v-else>
                <form id="admin-personal-form" class="personal-form" @submit.prevent="saveProfile">
                  <div class="personal-summary personal-form__summary">
                    <div class="personal-summary__row">
                      <div class="summary-item personal-form__cell">
                        <label class="summary-label" for="admin-full-name">Full name</label>
                        <input
                          id="admin-full-name"
                          v-model="name"
                          type="text"
                          autocomplete="name"
                          placeholder="Your name"
                        />
                      </div>
                      <div class="summary-item personal-form__cell">
                        <label class="summary-label" for="admin-position">Position</label>
                        <input
                          id="admin-position"
                          v-model="positionInCompany"
                          type="text"
                          autocomplete="organization-title"
                          placeholder="e.g. Office manager"
                        />
                      </div>
                      <div class="summary-item personal-form__cell">
                        <label class="summary-label" for="admin-employeeid">Employee ID</label>
                        <input
                          id="admin-employeeid"
                          v-model="employeeid"
                          type="text"
                          autocomplete="off"
                          placeholder="Employee ID"
                        />
                      </div>
                    </div>
                    <div class="personal-summary__row">
                      <div class="summary-item personal-form__cell">
                        <span class="summary-label">Email</span>
                        <span class="summary-value summary-value--email summary-value--readonly">{{ email || '—' }}</span>
                      </div>
                      <div class="summary-item summary-item--empty" aria-hidden="true"></div>
                      <div class="summary-item summary-item--empty" aria-hidden="true"></div>
                    </div>
                  </div>
                </form>
              </template>
            </div>
          </div>
          <p v-if="error" class="msg error">{{ error }}</p>
          <p v-if="success" class="msg success">Profile saved.</p>
          <div v-if="!showPersonalInfoForm" class="personal-card__footer">
            <button type="button" class="btn settings-accent-action-btn" @click="startEditPersonalInfo">
              <span class="material-symbols-outlined" aria-hidden="true">person_edit</span>
              Edit personal information
            </button>
          </div>
          <div v-else class="personal-card__footer">
            <div class="form-actions personal-form__actions">
              <button type="button" class="btn btn-ghost" @click="cancelEditPersonalInfo">Cancel</button>
              <button
                type="submit"
                form="admin-personal-form"
                class="btn btn-primary"
                :disabled="saving || !personalInfoDirty"
              >
                {{ saving ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </div>
        </section>

        <section class="card security-card settings-grid__security">
          <h2 class="card-title">Security</h2>
          <template v-if="!showPasswordForm">
            <p class="security-intro">We recommend changing your password every 90 days to ensure the highest security.</p>
            <p v-if="passwordSuccess" class="msg success">Password changed successfully.</p>
            <div class="security-card__footer">
              <button type="button" class="btn settings-accent-action-btn" @click="togglePasswordForm">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Change password
              </button>
            </div>
          </template>
          <template v-else>
            <form id="admin-password-change-form" class="password-form" @submit.prevent="changePassword">
              <div class="password-form__grid">
                <div class="field password-form__field password-form__field--full">
                  <label for="admin-current-password">Current password</label>
                  <div class="input-with-icon">
                    <input
                      id="admin-current-password"
                      v-model="currentPassword"
                      :type="showCurrentPassword ? 'text' : 'password'"
                      placeholder="Current password"
                      autocomplete="current-password"
                    />
                    <button
                      type="button"
                      class="icon-btn"
                      :aria-label="showCurrentPassword ? 'Hide password' : 'Show password'"
                      @click="toggleCurrentPasswordVisibility"
                    >
                      <svg v-if="!showCurrentPassword" class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
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
                <div class="field password-form__field">
                  <label for="admin-new-password">New password</label>
                  <div class="input-with-icon">
                    <input
                      id="admin-new-password"
                      v-model="newPassword"
                      :type="showNewPassword ? 'text' : 'password'"
                      placeholder="Minimum of 6 characters"
                      autocomplete="new-password"
                      minlength="6"
                    />
                    <button
                      type="button"
                      class="icon-btn"
                      :aria-label="showNewPassword ? 'Hide password' : 'Show password'"
                      @click="toggleNewPasswordVisibility"
                    >
                      <svg v-if="!showNewPassword" class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
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
                <div class="field password-form__field">
                  <label for="admin-confirm-password">Confirm new password</label>
                  <div class="input-with-icon">
                    <input
                      id="admin-confirm-password"
                      v-model="confirmPassword"
                      :type="showConfirmPassword ? 'text' : 'password'"
                      placeholder="Confirm your password"
                      autocomplete="new-password"
                      minlength="6"
                    />
                    <button
                      type="button"
                      class="icon-btn"
                      :aria-label="showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'"
                      @click="toggleConfirmPasswordVisibility"
                    >
                      <svg v-if="!showConfirmPassword" class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
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
              </div>
            </form>
            <p v-if="passwordError" class="msg error">{{ passwordError }}</p>
            <div class="security-card__footer">
              <div class="form-actions password-form__actions">
                <button type="button" class="btn btn-ghost" @click="togglePasswordForm">Cancel</button>
                <button
                  type="submit"
                  form="admin-password-change-form"
                  class="btn btn-primary"
                  :disabled="changingPassword || !canSubmitPasswordChange"
                >
                  {{ changingPassword ? 'Updating…' : 'Update password' }}
                </button>
              </div>
            </div>
          </template>
        </section>
      </div>

      <section v-if="isSuperadmin" class="card manage-admins-card">
        <h2 class="card-title">Manage admins</h2>
        <p class="role-line">Your role: <strong>{{ adminProfile?.role }}</strong></p>
        <p v-if="adminsError" class="msg error admins-error">{{ adminsError }}</p>
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
.page {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.page-header { margin-bottom: 1.75rem; }
.page-header h1 { margin: 0; font-size: 1.5rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.02em; }
.page-desc { margin: 0.25rem 0 0; font-size: 0.9375rem; color: var(--text-tertiary); }
.loading-state { color: var(--text-tertiary); font-size: 0.9375rem; padding: 2rem 0; }

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  column-gap: 1rem;
  row-gap: 1rem;
  align-items: start;
}
.settings-grid > .card {
  margin-bottom: 0;
  min-width: 0;
}
.settings-grid__personal {
  grid-column: 1 / -1;
}
.settings-grid__security {
  grid-column: 1 / -1;
}
@media (max-width: 640px) {
  .settings-grid {
    grid-template-columns: 1fr;
    row-gap: 1rem;
  }

  /* Match SettingsView.vue mobile spacing */
  .page-header {
    margin-bottom: 1rem;
  }
  .page-header h1 {
    font-size: 1.375rem;
  }
  .page-desc {
    font-size: 0.875rem;
  }

  .card {
    padding: 1rem;
    border-radius: 12px;
  }

  .card-title {
    margin-bottom: 1rem;
  }

  .profile-card .profile-row {
    gap: 0.875rem;
  }

  .personal-summary {
    gap: 0.75rem;
  }

  .personal-card__footer,
  .security-card__footer {
    margin-top: 1rem;
    justify-content: stretch;
  }

  .form-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
    width: 100%;
  }

  .form-actions .btn {
    width: 100%;
    justify-content: center;
  }

  .settings-accent-action-btn {
    width: 100%;
  }
}

.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}
.manage-admins-card {
  margin-bottom: 0;
}
.card-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 1.25rem;
}

.profile-card .profile-row { display: flex; gap: 1.25rem; align-items: flex-start; margin: 0; }
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

.personal-summary {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
}
.personal-summary__row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem 1.5rem;
  align-items: start;
}
.summary-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.summary-item--empty {
  display: block;
  pointer-events: none;
}
.email-hint {
  margin: 0.75rem 0 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
.summary-value--readonly {
  padding-top: 0.15rem;
}
@media (max-width: 720px) {
  .profile-card .profile-row {
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }
  .profile-card .profile-meta {
    width: 100%;
    align-self: stretch;
    text-align: left;
  }
  .personal-summary__row {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .summary-item--empty {
    display: none;
  }
  .password-form__grid {
    grid-template-columns: 1fr;
    gap: 0.875rem;
  }
}
.summary-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}
.summary-value {
  font-size: 0.9375rem;
  color: var(--text-primary);
  word-break: break-word;
}
.summary-value--email {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.personal-card__footer,
.security-card__footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 1.25rem;
}

.settings-accent-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0;
  padding: 0.6rem 1rem;
  border: none;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-weight: 500;
  color: #fff;
  background: var(--accent-light);
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  transition:
    transform 0.22s cubic-bezier(0.34, 1.2, 0.64, 1),
    box-shadow 0.22s ease,
    background 0.22s ease,
    opacity 0.22s ease;
}
.settings-accent-action-btn:hover {
  color: #fff;
  background: var(--accent-light-for-hover);
  opacity: 1;
  transform: translateY(-2px);
  box-shadow:
    0 6px 16px rgba(14, 165, 233, 0.4),
    0 2px 4px rgba(0, 0, 0, 0.06);
}
.settings-accent-action-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 4px rgba(14, 165, 233, 0.3);
  transition-duration: 0.1s;
}
.settings-accent-action-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg-secondary), 0 0 0 4px rgba(56, 189, 248, 0.45);
}
.settings-accent-action-btn:focus-visible:hover {
  box-shadow:
    0 0 0 2px var(--bg-secondary),
    0 0 0 4px rgba(56, 189, 248, 0.45),
    0 6px 16px rgba(14, 165, 233, 0.35);
}
.settings-accent-action-btn .material-symbols-outlined {
  font-size: 1.25rem;
  line-height: 1;
  transition: transform 0.22s cubic-bezier(0.34, 1.2, 0.64, 1);
}
.settings-accent-action-btn svg {
  flex-shrink: 0;
  display: block;
  transition: transform 0.22s cubic-bezier(0.34, 1.2, 0.64, 1);
}
.settings-accent-action-btn:hover .material-symbols-outlined,
.settings-accent-action-btn:hover svg {
  transform: scale(1.08);
}
.settings-accent-action-btn:active .material-symbols-outlined,
.settings-accent-action-btn:active svg {
  transform: scale(1.02);
}
@media (prefers-reduced-motion: reduce) {
  .settings-accent-action-btn,
  .settings-accent-action-btn .material-symbols-outlined,
  .settings-accent-action-btn svg {
    transition: none;
  }
  .settings-accent-action-btn:hover,
  .settings-accent-action-btn:active {
    transform: none;
  }
  .settings-accent-action-btn:hover .material-symbols-outlined,
  .settings-accent-action-btn:active .material-symbols-outlined,
  .settings-accent-action-btn:hover svg,
  .settings-accent-action-btn:active svg {
    transform: none;
  }
}

.personal-form {
  width: 100%;
  min-width: 0;
}
.personal-form__cell {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.personal-form__cell .summary-label {
  margin: 0;
}
.personal-form__cell input {
  width: 100%;
  max-width: none;
  min-width: 0;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.9375rem;
  box-sizing: border-box;
}
.personal-form__cell input:focus {
  outline: none;
  border-color: var(--accent);
}
.personal-card__footer .personal-form__actions,
.security-card__footer .password-form__actions {
  margin-top: 0;
}

.msg { margin: 0; font-size: 0.875rem; }
.msg.error {
  margin: 0;
  padding: 0.3rem 1rem;
  border-radius: 8px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--error);
  text-align: left;
}
.msg.error + .personal-card__footer,
.msg.error + .security-card__footer {
  margin-top: 0.75rem;
}
.msg.success { color: #34d399; }

.personal-card > .msg,
.security-card > .msg {
  margin-top: 0.75rem;
  margin-bottom: 0;
}
.admins-error {
  margin-top: 0.75rem;
}

.security-intro {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.security-card .btn-ghost {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0; font-size: 0.9375rem; color: var(--text-secondary);
  background: none; border: none; cursor: pointer; border-radius: 6px;
  transition: color 0.2s, background 0.2s;
}
.security-card .btn-ghost:hover { color: var(--accent); background: rgba(56,189,248,0.08); }
.security-card .btn-ghost svg { flex-shrink: 0; opacity: 0.8; }

.password-form { display: flex; flex-direction: column; gap: 0.875rem; }
.password-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.875rem 1.5rem;
  align-items: start;
}
.password-form__field--full {
  grid-column: 1 / -1;
}
.password-form__grid .password-form__field {
  min-width: 0;
}
.password-form .field { display: flex; flex-direction: column; gap: 0.35rem; }
.password-form label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
.password-form .input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 280px;
}
.password-form__grid .input-with-icon {
  max-width: none;
}
.password-form input {
  width: 100%; max-width: 280px; padding: 0.5rem 0.75rem; border-radius: 8px;
  border: 1px solid var(--border-color); background: var(--bg-primary);
  color: var(--text-primary); font-size: 0.9375rem;
}
.password-form .input-with-icon input {
  max-width: none;
  padding-right: 2.5rem;
}
.password-form .password-form__grid input {
  max-width: none;
}
.password-form input:focus { outline: none; border-color: var(--accent); }
.password-form .icon-btn {
  position: absolute;
  right: 0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.1rem;
  height: 2.1rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.password-form .icon-btn:hover { color: var(--text-secondary); }
.password-form .icon-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15);
}
.password-form .icon { display: block; }
.form-actions { display: flex; gap: 0.75rem; align-items: center; margin-top: 0.25rem; }

.role-line { margin: 0 0 0.75rem; font-size: 0.875rem; color: var(--text-secondary); }
.muted { color: var(--text-tertiary); font-size: 0.875rem; }
.table-wrap { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.table th, .table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border-color); }
.table th { color: var(--text-tertiary); font-weight: 500; }
.select { padding: 0.35rem 0.5rem; border-radius: 6px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color); font-size: 0.8125rem; cursor: pointer; }

.btn { padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; transition: opacity 0.2s, background 0.2s; }
.btn.settings-accent-action-btn {
  transition:
    transform 0.22s cubic-bezier(0.34, 1.2, 0.64, 1),
    box-shadow 0.22s ease,
    background 0.22s ease,
    opacity 0.22s ease;
}
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { opacity: 0.92; }
.btn-ghost { background: transparent; color: var(--text-secondary); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
