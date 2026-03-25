<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import supabase from '../lib/supabaseClient'
import { useAuth } from '../composables/useAuth'

const BUCKET = 'employee_profile'

const { user, getSignedProfileUrl } = useAuth()
const name = ref('')
const email = ref('')
const positionInCompany = ref('')
const companyBranch = ref('')
const employeeNo = ref('')
const currentPictureUrl = ref<string | null>(null)
const oldPicturePath = ref<string | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const success = ref(false)
const previewBlobUrl = ref<string | null>(null)

// Password change: show as button, expand to form on click
const showPasswordForm = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const changingPassword = ref(false)
const passwordError = ref<string | null>(null)
const passwordSuccess = ref(false)

// Delete account
const showDeleteConfirm = ref(false)
const deleteConfirmText = ref('')
const deletingAccount = ref(false)
const deleteError = ref<string | null>(null)

const previewUrl = ref<string | null>(null)

// Edit modal state
const showFileSelectModal = ref(false)
const showCropModal = ref(false)
const editImageSrc = ref<string | null>(null)
const editImageFile = ref<File | null>(null)
const cropCanvas = ref<HTMLCanvasElement | null>(null)
const cropContainer = ref<HTMLDivElement | null>(null)
const imageRef = ref<HTMLImageElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const cropX = ref(0)
const cropY = ref(0)
const cropScale = ref(1)
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
// Crop size will be determined dynamically in cropAndSave function

watch([currentPictureUrl], () => {
  if (previewBlobUrl.value) {
    URL.revokeObjectURL(previewBlobUrl.value)
    previewBlobUrl.value = null
  }
  previewUrl.value = currentPictureUrl.value
}, { immediate: true })

onBeforeUnmount(() => {
  if (previewBlobUrl.value) URL.revokeObjectURL(previewBlobUrl.value)
  if (editImageSrc.value && editImageSrc.value.startsWith('blob:')) {
    URL.revokeObjectURL(editImageSrc.value)
  }
})

onMounted(async () => {
  if (!user.value?.id) return
  loading.value = true
  error.value = null
  const { data } = await supabase.from('employee').select('name, picture, email, position_in_company, company_branch, employee_no').eq('id', user.value.id).maybeSingle()
  if (data) {
    name.value = data.name ?? ''
    email.value = data.email ?? ''
    positionInCompany.value = data.position_in_company ?? ''
    companyBranch.value = data.company_branch ?? ''
    employeeNo.value = data.employee_no ?? ''
    const path = data.picture
    oldPicturePath.value = path && !path.startsWith('http') ? path : null
    if (path && !path.startsWith('http')) {
      currentPictureUrl.value = await getSignedProfileUrl(path)
    } else if (path) {
      currentPictureUrl.value = path
    }
  }
  loading.value = false
})

async function changePassword() {
  if (!user.value?.id) return
  
  passwordError.value = null
  passwordSuccess.value = false
  
  // Validation
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
    // First verify current password by attempting to sign in
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: email.value,
      password: currentPassword.value
    })
    
    if (verifyError) {
      throw new Error('Current password is incorrect')
    }
    
    // Update password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword.value
    })
    
    if (updateError) throw updateError
    
    passwordSuccess.value = true
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    
    // Clear success message after 3 seconds
    setTimeout(() => {
      passwordSuccess.value = false
    }, 3000)
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

function toggleDeleteConfirm() {
  showDeleteConfirm.value = !showDeleteConfirm.value
  if (!showDeleteConfirm.value) {
    deleteConfirmText.value = ''
    deleteError.value = null
  }
}

async function deleteAccount() {
  if (!user.value?.id) return

  deleteError.value = null

  if (deleteConfirmText.value !== 'DELETE') {
    deleteError.value = 'Please type DELETE to confirm'
    return
  }

  deletingAccount.value = true

  try {
    const session = await supabase.auth.getSession()

    const { data, error } = await supabase.functions.invoke('delete-account', {
      headers: {
        Authorization: `Bearer ${session.data.session?.access_token}`,
      },
    })

    if (error) {
      console.error(error)
      throw new Error(error.message || 'Failed to delete account')
    }

    if (data?.error) {
      throw new Error(data.error)
    }

    await supabase.auth.signOut()

    window.location.href = '/login'
  } catch (e) {
    deleteError.value =
      e instanceof Error ? e.message : 'Failed to delete account'
  } finally {
    deletingAccount.value = false
  }
}

function openEditModal() {
  showFileSelectModal.value = true
  showCropModal.value = false
  editImageSrc.value = null
  editImageFile.value = null
  cropX.value = 0
  cropY.value = 0
  cropScale.value = 1
}

function closeFileSelectModal() {
  showFileSelectModal.value = false
}

function closeCropModal() {
  showCropModal.value = false
  if (editImageSrc.value && editImageSrc.value.startsWith('blob:')) {
    URL.revokeObjectURL(editImageSrc.value)
    editImageSrc.value = null
  }
  editImageFile.value = null
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    handleImageFile(file)
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file && file.type.startsWith('image/')) {
    handleImageFile(file)
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
}

function handleImageFile(file: File) {
  if (editImageSrc.value && editImageSrc.value.startsWith('blob:')) {
    URL.revokeObjectURL(editImageSrc.value)
  }
  editImageFile.value = file
  editImageSrc.value = URL.createObjectURL(file)
  cropX.value = 0
  cropY.value = 0
  cropScale.value = 1
  
  // Switch to crop modal
  showFileSelectModal.value = false
  showCropModal.value = true
  
  nextTick(() => {
    if (imageRef.value) {
      centerImage()
    }
  })
}

function centerImage() {
  if (!imageRef.value || !cropContainer.value) return
  const img = imageRef.value
  const container = cropContainer.value
  const containerRect = container.getBoundingClientRect()
  const imgAspect = img.naturalWidth / img.naturalHeight
  const containerAspect = containerRect.width / containerRect.height
  
  let scale = 1
  if (imgAspect > containerAspect) {
    scale = containerRect.height / img.naturalHeight
  } else {
    scale = containerRect.width / img.naturalWidth
  }
  cropScale.value = scale * 1.2 // Slightly larger to allow cropping
  cropX.value = (containerRect.width - img.naturalWidth * cropScale.value) / 2
  cropY.value = (containerRect.height - img.naturalHeight * cropScale.value) / 2
}

function startDrag(e: MouseEvent | TouchEvent) {
  isDragging.value = true
  const point = 'touches' in e ? e.touches[0] : e
  if (!point) return
  dragStart.value = { x: point.clientX - cropX.value, y: point.clientY - cropY.value }
}

function onDrag(e: MouseEvent | TouchEvent) {
  if (!isDragging.value || !cropContainer.value) return
  e.preventDefault()
  const point = 'touches' in e ? e.touches[0] : e
  if (!point) return
  const container = cropContainer.value
  const containerRect = container.getBoundingClientRect()
  
  let newX = point.clientX - dragStart.value.x
  let newY = point.clientY - dragStart.value.y
  
  if (imageRef.value) {
    const img = imageRef.value
    const imgWidth = img.naturalWidth * cropScale.value
    const imgHeight = img.naturalHeight * cropScale.value
    
    // Constrain to container bounds
    newX = Math.max(containerRect.width - imgWidth, Math.min(0, newX))
    newY = Math.max(containerRect.height - imgHeight, Math.min(0, newY))
  }
  
  cropX.value = newX
  cropY.value = newY
}

function endDrag() {
  isDragging.value = false
}

function handleWheel(e: WheelEvent) {
  if (!imageRef.value || !cropContainer.value) return
  e.preventDefault()
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(0.5, Math.min(3, cropScale.value * delta))
  
  if (imageRef.value) {
    const img = imageRef.value
    const container = cropContainer.value
    const containerRect = container.getBoundingClientRect()
    const imgWidth = img.naturalWidth * newScale
    const imgHeight = img.naturalHeight * newScale
    
    // Keep image within bounds
    cropScale.value = newScale
    if (cropX.value + imgWidth < containerRect.width) {
      cropX.value = containerRect.width - imgWidth
    }
    if (cropY.value + imgHeight < containerRect.height) {
      cropY.value = containerRect.height - imgHeight
    }
    if (cropX.value > 0) cropX.value = 0
    if (cropY.value > 0) cropY.value = 0
  }
}

async function cropAndSave() {
  if (!imageRef.value || !cropCanvas.value || !cropContainer.value) return
  
  const img = imageRef.value
  const canvas = cropCanvas.value
  const container = cropContainer.value
  const containerRect = container.getBoundingClientRect()
  
  // Get actual crop circle size (responsive)
  const actualCropSize = window.innerWidth <= 640 ? 250 : 300
  
  // Calculate crop area (circle in center)
  const centerX = containerRect.width / 2
  const centerY = containerRect.height / 2
  const radius = actualCropSize / 2
  
  // Calculate source coordinates
  const scaleX = img.naturalWidth / (img.naturalWidth * cropScale.value)
  const scaleY = img.naturalHeight / (img.naturalHeight * cropScale.value)
  
  const sourceX = (centerX - radius - cropX.value) * scaleX
  const sourceY = (centerY - radius - cropY.value) * scaleY
  const sourceSize = radius * 2 * scaleX
  
  // Set canvas size
  canvas.width = actualCropSize
  canvas.height = actualCropSize
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  // Create circular clipping
  ctx.beginPath()
  ctx.arc(actualCropSize / 2, actualCropSize / 2, actualCropSize / 2, 0, Math.PI * 2)
  ctx.clip()
  
  // Draw cropped image
  ctx.drawImage(
    img,
    sourceX, sourceY, sourceSize, sourceSize,
    0, 0, actualCropSize, actualCropSize
  )
  
  // Convert to blob
  canvas.toBlob(async (blob) => {
    if (!blob || !user.value?.id) return
    
    try {
      // Delete old picture if exists
      if (oldPicturePath.value) {
        await supabase.storage.from(BUCKET).remove([oldPicturePath.value])
      }
      
      // Upload new picture
      const ext = 'png'
      const path = `${user.value.id}/${Date.now()}.${ext}`
      const arrayBuffer = await blob.arrayBuffer()
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, arrayBuffer, { 
        upsert: false, 
        contentType: 'image/png' 
      })
      
      if (uploadError) throw new Error(uploadError.message || 'Profile picture upload failed')
      
      // Update database
      const { error: updateError } = await supabase.from('employee').update({ picture: path }).eq('id', user.value.id)
      if (updateError) throw updateError
      
      // Update UI
      oldPicturePath.value = path
      currentPictureUrl.value = await getSignedProfileUrl(path)
      success.value = true
      window.dispatchEvent(new CustomEvent('profile-updated'))
      closeCropModal()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save'
    }
  }, 'image/png')
}

async function save() {
  if (!user.value?.id) return
  error.value = null
  success.value = false
  saving.value = true
  try {
    const updates: { name: string } = { name: name.value.trim() }
    const { error: updateError } = await supabase.from('employee').update(updates).eq('id', user.value.id)
    if (updateError) throw updateError
    success.value = true
    window.dispatchEvent(new CustomEvent('profile-updated'))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <div class="page">
    <header class="page-header">
      <h1>Settings</h1>
      <p class="page-desc">Profile and account</p>
    </header>

    <div v-if="loading" class="loading-state">Loading…</div>

    <template v-else>
      <!-- Profile card -->
      <section class="card profile-card">
        <div class="profile-row">
          <div class="avatar-wrap">
            <img v-if="previewUrl" :src="previewUrl" alt="" class="avatar" />
            <span v-else class="avatar placeholder">{{ (name || '?').slice(0, 1).toUpperCase() }}</span>
            <button type="button" class="avatar-edit" @click="openEditModal" title="Change photo" aria-label="Change photo">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11.33 2a2 2 0 0 1 1.42.59l1.66 1.66a2 2 0 0 1 0 2.82L5 14H2v-3L9.09 3.09a2 2 0 0 1 2.24-.09z"/>
              </svg>
            </button>
          </div>
          <div class="profile-meta">
            <input id="name" v-model="name" type="text" class="name-input" placeholder="Your name" autocomplete="name" />
            <p class="email">{{ email }}</p>
            <p v-if="positionInCompany" class="meta-line">{{ positionInCompany }}<template v-if="companyBranch"> · {{ companyBranch }}</template></p>
            <p v-if="employeeNo" class="meta-line muted">#{{ employeeNo }}</p>
          </div>
        </div>
        <p v-if="error" class="msg error">{{ error }}</p>
        <p v-if="success" class="msg success">Profile saved.</p>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save profile' }}
        </button>
      </section>

      <!-- Security: change password (button → form) -->
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
              <label for="currentPassword">Current password</label>
              <input id="currentPassword" v-model="currentPassword" type="password" placeholder="Current password" autocomplete="current-password" />
            </div>
            <div class="field">
              <label for="newPassword">New password</label>
              <input id="newPassword" v-model="newPassword" type="password" placeholder="At least 6 characters" autocomplete="new-password" minlength="6" />
            </div>
            <div class="field">
              <label for="confirmPassword">Confirm new password</label>
              <input id="confirmPassword" v-model="confirmPassword" type="password" placeholder="Confirm" autocomplete="new-password" minlength="6" />
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

      <!-- Delete Account -->
      <section class="card danger-card">
        <h2 class="card-title">Danger Zone</h2>
        <template v-if="!showDeleteConfirm">
          <p class="danger-text">Once you delete your account, there is no going back. Please be certain.</p>
          <button type="button" class="btn btn-danger" @click="toggleDeleteConfirm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete account
          </button>
        </template>
        <template v-else>
          <div class="delete-form">
            <p class="danger-warning">
              <strong>Warning:</strong> This action cannot be undone. This will permanently delete your account and all associated data.
            </p>
            <div class="field">
              <label for="deleteConfirm">Type <strong>DELETE</strong> to confirm:</label>
              <input 
                id="deleteConfirm" 
                v-model="deleteConfirmText" 
                type="text" 
                placeholder="DELETE" 
                autocomplete="off"
              />
            </div>
            <p v-if="deleteError" class="msg error">{{ deleteError }}</p>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" @click="toggleDeleteConfirm">Cancel</button>
              <button 
                type="button" 
                class="btn btn-danger" 
                :disabled="deletingAccount || deleteConfirmText !== 'DELETE'"
                @click="deleteAccount"
              >
                {{ deletingAccount ? 'Deleting…' : 'Delete my account' }}
              </button>
            </div>
          </div>
        </template>
      </section>
    </template>

    <!-- File Selection Modal -->
    <div v-if="showFileSelectModal" class="modal-overlay" @click.self="closeFileSelectModal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Select Profile Picture</h2>
        </div>
        
        <div class="modal-body">
          <div class="drop-zone" @drop="handleDrop" @dragover="handleDragOver">
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              style="display: none"
              @change="handleFileSelect"
            />
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <p class="drop-zone-text">Drag and drop your profile picture here</p>
          </div>
        </div>
        
        <div class="modal-footer">
          <button type="button" class="btn secondary" @click="closeFileSelectModal">Cancel</button>
          <button 
            type="button" 
            class="btn primary" 
            @click="fileInputRef?.click()"
          >
            Choose from Device
          </button>
        </div>
      </div>
    </div>

    <!-- Crop/Edit Modal -->
    <div v-if="showCropModal" class="modal-overlay" @click.self="closeCropModal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Edit Profile Picture</h2>
        </div>
        
        <div class="modal-body">
          <div 
            v-if="editImageSrc"
            ref="cropContainer"
            class="crop-container"
            @mousedown="startDrag"
            @mousemove="onDrag"
            @mouseup="endDrag"
            @mouseleave="endDrag"
            @touchstart="startDrag"
            @touchmove="onDrag"
            @touchend="endDrag"
            @wheel.prevent="handleWheel"
          >
            <img
              ref="imageRef"
              :src="editImageSrc"
              alt=""
              class="crop-image"
              :style="{
                transform: `translate(${cropX}px, ${cropY}px) scale(${cropScale})`,
                transformOrigin: 'top left'
              }"
              @load="centerImage"
            />
            <div class="crop-overlay">
              <div class="crop-circle"></div>
              <div class="crop-guide">
                <p>Drag to reposition • Scroll to zoom</p>
              </div>
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button type="button" class="btn secondary" @click="closeCropModal">Cancel</button>
          <button 
            type="button" 
            class="btn primary" 
            @click="cropAndSave"
            :disabled="!editImageSrc"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
    
    <canvas ref="cropCanvas" style="display: none"></canvas>
  </div>
</template>
<style scoped>
.page { width: 100%; max-width: 480px; }
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
.avatar-edit:hover { background: var(--accent-light); transform: scale(1.05); }

.profile-meta { flex: 1; min-width: 0; }
.name-input {
  width: 100%; margin: 0 0 0.25rem; padding: 0.35rem 0;
  font-size: 1.125rem; font-weight: 600; color: var(--text-primary);
  background: transparent; border: none; border-radius: 0; border-bottom: 1px solid transparent;
  transition: border-color 0.2s, background 0.2s;
}
.name-input:hover { border-bottom-color: var(--border-color); }
.name-input:focus { outline: none; border-bottom-color: var(--accent); }
.email { margin: 0; font-size: 0.875rem; color: var(--text-secondary); }
.meta-line { margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--text-secondary); }
.meta-line.muted { color: var(--text-tertiary); }
.msg { margin: 0 0 0.75rem; font-size: 0.875rem; }
.msg.error { color: #f87171; }
.msg.success { color: #34d399; }

.profile-card .btn-primary { margin-top: 0.25rem; }

.security-card .btn-ghost {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0; font-size: 0.9375rem; color: var(--text-secondary);
  background: none; border: none; cursor: pointer; border-radius: 6px;
  transition: color 0.2s, background 0.2s;
}
.security-card .btn-ghost:hover { color: var(--accent); background: rgba(56,189,248,0.08); }
.security-card .btn-ghost svg { flex-shrink: 0; opacity: 0.8; }

.password-form { display: flex; flex-direction: column; gap: 0.875rem; }
.password-form .field { display: flex; flex-direction: column; gap: 0.35rem; }
.password-form label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
.password-form input {
  width: 100%; max-width: 280px; padding: 0.5rem 0.75rem; border-radius: 8px;
  border: 1px solid var(--border-color); background: var(--bg-primary);
  color: var(--text-primary); font-size: 0.9375rem;
}
.password-form input:focus { outline: none; border-color: var(--accent); }
.form-actions { display: flex; gap: 0.75rem; align-items: center; margin-top: 0.25rem; }

.danger-card { border-color: rgba(239, 68, 68, 0.3); }
.danger-text { margin: 0 0 1rem; font-size: 0.875rem; color: var(--text-secondary); }
.danger-warning { margin: 0 0 1rem; font-size: 0.875rem; color: #f87171; line-height: 1.5; }
.danger-warning strong { color: #ef4444; }
.delete-form { display: flex; flex-direction: column; gap: 0.875rem; }
.delete-form .field { display: flex; flex-direction: column; gap: 0.35rem; }
.delete-form label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
.delete-form input {
  width: 100%; max-width: 280px; padding: 0.5rem 0.75rem; border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.3); background: var(--bg-primary);
  color: var(--text-primary); font-size: 0.9375rem;
}
.delete-form input:focus { outline: none; border-color: #ef4444; }
.btn-danger {
  background: #ef4444; color: #fff;
  display: inline-flex; align-items: center; gap: 0.5rem;
}
.btn-danger:hover:not(:disabled) { background: #dc2626; opacity: 1; }
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

.btn { padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; transition: opacity 0.2s, background 0.2s; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { opacity: 0.92; }
.btn.primary { background: var(--accent); color: #fff; }
.btn.primary:hover:not(:disabled) { opacity: 0.92; }
.btn-ghost { background: transparent; color: var(--text-secondary); }
.btn.secondary { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); }
.btn.secondary:hover { background: var(--bg-hover); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

/* Modal Styles */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-content {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  padding: 1.5rem;
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

.crop-container {
  position: relative;
  width: 100%;
  height: 400px;
  overflow: hidden;
  background: var(--bg-secondary);
  border-radius: 12px;
  cursor: move;
  user-select: none;
}

.crop-image {
  max-width: none;
  height: auto;
  display: block;
  pointer-events: none;
}

.crop-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.crop-circle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 300px;
  height: 300px;
  border: 3px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
}

.crop-guide {
  position: absolute;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
}

.crop-guide p {
  margin: 0;
}

.drop-zone {
  width: 100%;
  height: 400px;
  border: 2px dashed var(--border-color);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-secondary);
}

.drop-zone:hover {
  border-color: var(--accent);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.drop-zone p,
.drop-zone-text {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-primary);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1.5rem;
  border-top: 1px solid var(--border-color);
}

@media (max-width: 640px) {
  .crop-circle {
    width: 250px;
    height: 250px;
  }
}
</style>
