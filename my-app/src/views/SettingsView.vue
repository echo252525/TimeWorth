<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import supabase from '../lib/supabaseClient'
import { validateEmployeeIdentifier } from '../lib/employeeIdentifierValidation'
import { useAuth } from '../composables/useAuth'

const BUCKET = 'employee_profile'
const WFH_PICTURE_BUCKET = 'wfh_employee_picture'
const REGISTERED_FACE_BUCKET = 'registered_user_face'

const { user, getSignedProfileUrl } = useAuth()

/** Each word: first letter uppercase, rest lowercase (as stored in DB). */
function titleCaseName(s: string): string {
  const t = s.trim()
  if (!t) return ''
  return t
    .split(/\s+/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ''))
    .join(' ')
}

const name = ref('')
const email = ref('')
const positionInCompany = ref('')
const employeeNo = ref('')
const phoneNumber = ref('')
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
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)
const changingPassword = ref(false)
const passwordError = ref<string | null>(null)
const passwordSuccess = ref(false)

// Delete account
const showDeleteConfirm = ref(false)
const deleteConfirmPassword = ref('')
const showDeletePassword = ref(false)
const deletingAccount = ref(false)
const deleteError = ref<string | null>(null)

const previewUrl = ref<string | null>(null)

/** Personal info: collapsed by default; expand to edit like Security → change password. */
const showPersonalInfoForm = ref(false)
interface PersonalBaseline {
  name: string
  positionInCompany: string
  employeeNo: string
  phoneNumber: string
  email: string
}
const personalBaseline = ref<PersonalBaseline | null>(null)

function capturePersonalBaseline() {
  personalBaseline.value = {
    name: name.value.trim(),
    positionInCompany: positionInCompany.value.trim(),
    employeeNo: String(employeeNo.value ?? '').trim(),
    phoneNumber: phoneNumber.value.trim(),
    email: email.value.trim(),
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
    positionInCompany.value = b.positionInCompany
    employeeNo.value = b.employeeNo
    phoneNumber.value = b.phoneNumber
    email.value = b.email
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
    positionInCompany.value.trim() !== b.positionInCompany ||
    String(employeeNo.value ?? '').trim() !== b.employeeNo ||
    phoneNumber.value.trim() !== b.phoneNumber ||
    email.value.trim() !== b.email
  )
})

const canSubmitPasswordChange = computed(() => {
  return (
    currentPassword.value.length > 0 &&
    newPassword.value.length >= 6 &&
    confirmPassword.value.length > 0
  )
})

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
  const { data } = await supabase.from('employee').select('name, picture, email, position_in_company, employee_no, phone_number').eq('id', user.value.id).maybeSingle()
  if (data) {
    name.value = data.name ?? ''
    email.value = data.email ?? ''
    positionInCompany.value = data.position_in_company ?? ''
    employeeNo.value = data.employee_no != null ? String(data.employee_no) : ''
    phoneNumber.value = (data as { phone_number?: string | null }).phone_number ?? ''
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
    const signInEmail = user.value?.email
    if (!signInEmail) {
      throw new Error('No email on session')
    }
    // Use auth email so verification is correct even if the personal-info form has unsaved email edits
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: signInEmail,
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

    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordError.value = null
    showCurrentPassword.value = false
    showNewPassword.value = false
    showConfirmPassword.value = false
    showPasswordForm.value = false
    passwordSuccess.value = true

    setTimeout(() => {
      passwordSuccess.value = false
    }, 4000)
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

function toggleDeleteConfirm() {
  showDeleteConfirm.value = !showDeleteConfirm.value
  if (!showDeleteConfirm.value) {
    deleteConfirmPassword.value = ''
    showDeletePassword.value = false
    deleteError.value = null
  }
}

function toggleDeletePasswordVisibility() {
  showDeletePassword.value = !showDeletePassword.value
}

function joinStoragePath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name
}

async function listAllStoragePaths(bucket: string, prefix: string): Promise<string[]> {
  const collected: string[] = []
  const queue: string[] = [prefix]
  while (queue.length) {
    const folder = queue.shift() ?? ''
    let offset = 0
    while (true) {
      const { data, error: listError } = await supabase.storage
        .from(bucket)
        .list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      if (listError) throw new Error(listError.message || `Failed to list ${bucket} files`)
      const rows = data ?? []
      for (const entry of rows) {
        const fullPath = joinStoragePath(folder, entry.name)
        if (entry.id) collected.push(fullPath)
        else queue.push(fullPath)
      }
      if (rows.length < 100) break
      offset += rows.length
    }
  }
  return collected
}

async function removeStoragePaths(bucket: string, paths: string[]) {
  if (!paths.length) return
  for (let i = 0; i < paths.length; i += 100) {
    const slice = paths.slice(i, i + 100)
    const { error: removeError } = await supabase.storage.from(bucket).remove(slice)
    if (removeError) throw new Error(removeError.message || `Failed to delete files in ${bucket}`)
  }
}

async function cleanupAccountStorage(userId: string) {
  // Private buckets are removed through authenticated storage APIs.
  const byBucket: Record<string, Set<string>> = {
    [BUCKET]: new Set<string>(),
    [WFH_PICTURE_BUCKET]: new Set<string>(),
    [REGISTERED_FACE_BUCKET]: new Set<string>(),
  }

  for (const bucket of Object.keys(byBucket)) {
    const fromPrefix = await listAllStoragePaths(bucket, userId)
    for (const path of fromPrefix) byBucket[bucket].add(path)
  }

  if (oldPicturePath.value) byBucket[BUCKET].add(oldPicturePath.value)

  const { data: attendancePictures, error: attendanceError } = await supabase
    .from('attendance')
    .select('wfh_pic_url')
    .eq('user_id', userId)
    .not('wfh_pic_url', 'is', null)
  if (attendanceError) {
    throw new Error(attendanceError.message || 'Failed to load WFH picture paths')
  }
  for (const row of attendancePictures ?? []) {
    const path = (row as { wfh_pic_url?: string | null }).wfh_pic_url
    if (path) byBucket[WFH_PICTURE_BUCKET].add(path)
  }

  for (const bucket of Object.keys(byBucket)) {
    await removeStoragePaths(bucket, [...byBucket[bucket]])
  }
}

async function deleteAccount() {
  if (!user.value?.id) return

  deleteError.value = null

  if (!deleteConfirmPassword.value) {
    deleteError.value = 'Enter your password to confirm'
    return
  }

  deletingAccount.value = true

  try {
    const signInEmail = user.value.email
    if (!signInEmail) {
      throw new Error('No email on session')
    }
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: signInEmail,
      password: deleteConfirmPassword.value,
    })
    if (verifyError) {
      throw new Error('Password is incorrect')
    }

    await cleanupAccountStorage(user.value.id)

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

/** PostgREST 409 / Postgres 23505: duplicate key on employee_no, email, etc. */
function formatProfileSaveError(e: unknown): string {
  const err = e as { code?: string; message?: string; details?: string; hint?: string; status?: number }
  const combined = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.toLowerCase()
  if (
    err.code === '23505'
    || err.status === 409
    || combined.includes('duplicate key')
    || combined.includes('unique constraint')
  ) {
    if (combined.includes('employee_no')) {
      return 'This employee number is already in use. Choose a different number or contact an admin.'
    }
    if (combined.includes('email')) {
      return 'This email is already registered to another employee. Use a different email or contact an admin.'
    }
    return 'That change conflicts with existing data (for example a duplicate employee number or email).'
  }
  if (typeof err.message === 'string' && err.message.length > 0) {
    return err.message
  }
  return 'Failed to save'
}

async function save() {
  if (!user.value?.id || !showPersonalInfoForm.value) return
  error.value = null
  success.value = false

  const b = personalBaseline.value
  if (!b) {
    error.value = 'Please cancel and open edit again.'
    return
  }

  const trimmedName = titleCaseName(name.value)
  const trimmedPosition = positionInCompany.value.trim()
  const trimmedEmail = email.value.trim()
  const trimmedEmp = String(employeeNo.value ?? '').trim()
  const trimmedPhone = phoneNumber.value.trim()

  if (!trimmedName) {
    error.value = 'Full name is required'
    return
  }
  if (!trimmedPosition) {
    error.value = 'Position is required'
    return
  }
  const empErr = validateEmployeeIdentifier(String(employeeNo.value ?? ''))
  if (empErr) {
    error.value = empErr
    return
  }
  if (!trimmedPhone) {
    error.value = 'Phone number is required'
    return
  }
  if (!trimmedEmail) {
    error.value = 'Email is required'
    return
  }

  saving.value = true
  try {
    const authEmail = user.value.email ?? ''
    if (trimmedEmail !== authEmail) {
      const { error: authEmailError } = await supabase.auth.updateUser({ email: trimmedEmail })
      if (authEmailError) throw authEmailError
    }

    const updates: {
      name?: string
      position_in_company?: string
      employee_no?: string
      phone_number?: string
      email?: string
    } = {}
    if (trimmedName !== b.name) updates.name = trimmedName
    if (trimmedPosition !== b.positionInCompany) updates.position_in_company = trimmedPosition
    if (trimmedEmp !== b.employeeNo) updates.employee_no = trimmedEmp
    if (trimmedPhone !== b.phoneNumber) updates.phone_number = trimmedPhone
    if (trimmedEmail !== b.email) updates.email = trimmedEmail

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase.from('employee').update(updates).eq('id', user.value.id)
      if (updateError) throw updateError
    }

    name.value = trimmedName
    success.value = true
    showPersonalInfoForm.value = false
    personalBaseline.value = null
    window.dispatchEvent(new CustomEvent('profile-updated'))
  } catch (e) {
    error.value = formatProfileSaveError(e)
  } finally {
    saving.value = false
  }
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
      <!-- Personal Information -->
      <section class="card personal-card profile-card settings-grid__personal">
        <h2 class="card-title">Personal Information</h2>
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
                    <span class="summary-label">Employee no.</span>
                    <span class="summary-value">{{ employeeNo || '—' }}</span>
                  </div>
                </div>
                <div class="personal-summary__row">
                  <div class="summary-item">
                    <span class="summary-label">Email</span>
                    <span class="summary-value summary-value--email">{{ email || '—' }}</span>
                  </div>
                  <div class="summary-item">
                    <span class="summary-label">Phone</span>
                    <span class="summary-value">{{ phoneNumber || '—' }}</span>
                  </div>
                  <div class="summary-item summary-item--empty" aria-hidden="true"></div>
                </div>
              </div>
            </template>
            <template v-else>
              <form id="personal-info-form" class="personal-form" @submit.prevent="save">
                <div class="personal-summary personal-form__summary">
                  <div class="personal-summary__row">
                    <div class="summary-item personal-form__cell">
                      <label class="summary-label" for="settings-full-name">Full name</label>
                      <input
                        id="settings-full-name"
                        v-model="name"
                        type="text"
                        autocomplete="name"
                        placeholder="Juan Dela Cruz"
                      />
                    </div>
                    <div class="summary-item personal-form__cell">
                      <label class="summary-label" for="settings-position">Position</label>
                      <input
                        id="settings-position"
                        v-model="positionInCompany"
                        type="text"
                        placeholder="e.g. Developer"
                        readonly
                        aria-readonly="true"
                      />
                    </div>
                    <div class="summary-item personal-form__cell">
                      <label class="summary-label" for="settings-emp-no">Employee no.</label>
                      <input
                        id="settings-emp-no"
                        v-model="employeeNo"
                        type="text"
                        autocomplete="off"
                        placeholder="e.g. A-1001, EMP/01"
                        maxlength="100"
                      />
                    </div>
                  </div>
                  <div class="personal-summary__row">
                    <div class="summary-item personal-form__cell">
                      <label class="summary-label" for="settings-email">Email</label>
                      <input
                        id="settings-email"
                        v-model="email"
                        type="email"
                        autocomplete="email"
                        placeholder="Enter your personal/company email"
                        readonly
                        aria-readonly="true"
                      />
                    </div>
                    <div class="summary-item personal-form__cell">
                      <label class="summary-label" for="settings-phone">Phone</label>
                      <input
                        id="settings-phone"
                        v-model="phoneNumber"
                        type="tel"
                        autocomplete="tel"
                        placeholder="Phone number"
                      />
                    </div>
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
            Edit
          </button>
        </div>
        <div v-else class="personal-card__footer">
          <div class="form-actions personal-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancelEditPersonalInfo">Cancel</button>
            <button
              type="submit"
              form="personal-info-form"
              class="btn btn-primary"
              :disabled="saving || !personalInfoDirty"
            >
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </section>

      <!-- Security: change password (button → form) -->
      <section class="card security-card settings-grid__security">
        <h2 class="card-title">Security</h2>
        <template v-if="!showPasswordForm">
          <p class="danger-text">We recommend changing your password every 90 days to ensure the highest security.</p>
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
          <form id="password-change-form" class="password-form" @submit.prevent="changePassword">
            <div class="password-form__grid">
              <div class="field password-form__field password-form__field--full">
                <label for="currentPassword">Current password</label>
                <div class="input-with-icon">
                  <input
                    id="currentPassword"
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
              <div class="field password-form__field password-form__field--full">
                <label for="newPassword">New password</label>
                <div class="input-with-icon">
                  <input
                    id="newPassword"
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
              <div class="field password-form__field password-form__field--full">
                <label for="confirmPassword">Confirm new password</label>
                <div class="input-with-icon">
                  <input
                    id="confirmPassword"
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
                form="password-change-form"
                class="btn btn-primary"
                :disabled="changingPassword || !canSubmitPasswordChange"
              >
                {{ changingPassword ? 'Updating…' : 'Update password' }}
              </button>
            </div>
          </div>
        </template>
      </section>

      <!-- Delete Account -->
      <section class="card danger-card settings-grid__danger">
        <h2 class="card-title">Danger Zone</h2>
        <template v-if="!showDeleteConfirm">
          <p class="danger-text">Once you delete your account, there is no going back. Please be certain.</p>
          <div class="danger-card__footer">
            <button type="button" class="btn btn-danger" @click="toggleDeleteConfirm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Delete account
            </button>
          </div>
        </template>
        <template v-else>
          <div class="delete-form">
            <p class="danger-warning">
              <strong>Warning:</strong> This action cannot be undone. This will permanently delete your account and all associated data.
            </p>
            <div class="field">
              <label for="deleteConfirmPassword">Enter your password to confirm</label>
              <div class="input-with-icon">
                <input
                  id="deleteConfirmPassword"
                  v-model="deleteConfirmPassword"
                  :type="showDeletePassword ? 'text' : 'password'"
                  placeholder="Your account password"
                  autocomplete="current-password"
                />
                <button
                  type="button"
                  class="icon-btn"
                  :aria-label="showDeletePassword ? 'Hide password' : 'Show password'"
                  @click="toggleDeletePasswordVisibility"
                >
                  <svg v-if="!showDeletePassword" class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
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
          <p v-if="deleteError" class="msg error">{{ deleteError }}</p>
          <div class="danger-card__footer">
            <div class="form-actions delete-form__actions">
              <button type="button" class="btn btn-ghost" @click="toggleDeleteConfirm">Cancel</button>
              <button
                type="button"
                class="btn btn-danger"
                :disabled="deletingAccount || deleteConfirmPassword.length === 0"
                @click="deleteAccount"
              >
                {{ deletingAccount ? 'Deleting…' : 'Delete my account' }}
              </button>
            </div>
          </div>
        </template>
      </section>
      </div>
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
.page {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.page-header { margin-bottom: 1.75rem; }

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: auto auto;
  column-gap: 1rem;
  row-gap: 1rem;
  /* Keep Security / Danger cards their own height when the other expands */
  align-items: start;
}
.settings-grid > .card {
  margin-bottom: 0;
  min-width: 0;
}
.settings-grid__personal {
  grid-area: 1 / 1 / 2 / 3;
}
.settings-grid__security {
  grid-area: 2 / 1 / 3 / 2;
}
.settings-grid__danger {
  grid-area: 2 / 2 / 3 / 3;
}
@media (max-width: 640px) {
  .settings-grid {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    row-gap: 1rem;
  }
  .settings-grid__personal,
  .settings-grid__security,
  .settings-grid__danger {
    grid-area: auto;
  }
}

/* Mobile spacing tweaks (CSS only) */
@media (max-width: 640px) {
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
  .security-card__footer,
  .danger-card__footer {
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

  .settings-accent-action-btn,
  .btn-danger {
    width: 100%;
  }

  .modal-overlay {
    padding: 0.75rem;
  }

  .modal-header,
  .modal-body,
  .modal-footer {
    padding: 1rem;
  }

  .modal-body {
    min-height: 320px;
  }

  .crop-container,
  .drop-zone {
    height: 320px;
  }

  .crop-guide {
    font-size: 0.8125rem;
    padding: 0.45rem 0.75rem;
  }
}
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
.avatar-edit:hover { background: var(--accent-light); transform: scale(1.05); }

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
.security-card__footer,
.danger-card__footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 1.25rem;
}
/* Shared: employee login–style primary + hover motion (personal + security) */
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

.personal-form__cell input[readonly] {
  cursor: not-allowed;
  opacity: 0.85;
  background: color-mix(in srgb, var(--bg-primary) 80%, var(--border-color));
}

.personal-form__cell input[readonly]:focus {
  border-color: var(--border-color);
}
.personal-card__footer .personal-form__actions,
.security-card__footer .password-form__actions,
.danger-card__footer .delete-form__actions {
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
.msg.error + .security-card__footer,
.msg.error + .danger-card__footer {
  margin-top: 0.75rem;
}
.msg.success { color: #34d399; }

.personal-card > .msg,
.security-card > .msg,
.danger-card > .msg {
  margin-top: 0.75rem;
  margin-bottom: 0;
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

.danger-card { border-color: rgba(239, 68, 68, 0.3); }
.danger-text { margin: 0; font-size: 0.875rem; color: var(--text-secondary); }
.danger-warning { margin: 0; font-size: 0.875rem; color: #f87171; line-height: 1.5; }
.danger-warning strong { color: #ef4444; }
.delete-form { display: flex; flex-direction: column; gap: 0.875rem; }
.delete-form .field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: 100%;
  min-width: 0;
}
.delete-form label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
.delete-form input {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.3);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.9375rem;
}
.delete-form .input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  max-width: none;
  min-width: 0;
}
.delete-form .input-with-icon input {
  max-width: none;
  padding-right: 2.5rem;
}
.delete-form .icon-btn {
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
.delete-form .icon-btn:hover { color: #f87171; }
.delete-form .icon-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}
.delete-form .icon { display: block; }
.delete-form input:focus { outline: none; border-color: #ef4444; }
.btn { padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; transition: opacity 0.2s, background 0.2s; }
/* Win over .btn so transform/box-shadow animate (same issue .btn-danger fixes below) */
.btn.settings-accent-action-btn {
  transition:
    transform 0.22s cubic-bezier(0.34, 1.2, 0.64, 1),
    box-shadow 0.22s ease,
    background 0.22s ease,
    opacity 0.22s ease;
}
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { opacity: 0.92; }
.btn.primary { background: var(--accent); color: #fff; }
.btn.primary:hover:not(:disabled) { opacity: 0.92; }
.btn-ghost { background: transparent; color: var(--text-secondary); }
.btn.secondary { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); }
.btn.secondary:hover { background: var(--bg-hover); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-danger {
  background: #ef4444;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  transition:
    transform 0.22s cubic-bezier(0.34, 1.2, 0.64, 1),
    box-shadow 0.22s ease,
    background 0.22s ease,
    opacity 0.22s ease;
}
.btn-danger:hover:not(:disabled) {
  background: #dc2626;
  opacity: 1;
  transform: translateY(-2px);
  box-shadow:
    0 6px 16px rgba(239, 68, 68, 0.4),
    0 2px 4px rgba(0, 0, 0, 0.06);
}
.btn-danger:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 4px rgba(239, 68, 68, 0.3);
  transition-duration: 0.1s;
}
.btn-danger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg-secondary), 0 0 0 4px rgba(239, 68, 68, 0.45);
}
.btn-danger:focus-visible:hover:not(:disabled) {
  box-shadow:
    0 0 0 2px var(--bg-secondary),
    0 0 0 4px rgba(239, 68, 68, 0.45),
    0 6px 16px rgba(239, 68, 68, 0.35);
}
.btn-danger svg {
  flex-shrink: 0;
  display: block;
  transition: transform 0.22s cubic-bezier(0.34, 1.2, 0.64, 1);
}
.btn-danger:hover:not(:disabled) svg {
  transform: scale(1.08);
}
.btn-danger:active:not(:disabled) svg {
  transform: scale(1.02);
}
.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .btn-danger,
  .btn-danger svg {
    transition: none;
  }
  .btn-danger:hover:not(:disabled),
  .btn-danger:active:not(:disabled) {
    transform: none;
  }
  .btn-danger:hover:not(:disabled) svg,
  .btn-danger:active:not(:disabled) svg {
    transform: none;
  }
}

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
