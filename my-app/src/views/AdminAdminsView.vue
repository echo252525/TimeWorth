<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { MagnifyingGlassIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import supabase from '../lib/supabaseClient'
import { useAuth } from '../composables/useAuth'
import { useAdminAuth, getSignedAdminProfileUrl, type AdminRow } from '../composables/useAdminAuth'

type AdminListRow = Pick<
  AdminRow,
  'id' | 'name' | 'email' | 'employeeid' | 'picture' | 'role' | 'created_at' | 'updated_at'
>

const list = ref<AdminListRow[]>([])
const avatarUrls = ref<Record<string, string | null>>({})
const loading = ref(true)
const error = ref<string | null>(null)
const searchQuery = ref('')
const filterRole = ref<'all' | 'admin' | 'superadmin' | 'pending'>('all')
const statusUpdatingByUser = ref<Record<string, boolean>>({})
const deletingByUser = ref<Record<string, boolean>>({})
const actionError = ref<string | null>(null)
const { user } = useAuth()
const { adminRole, isSuperadmin, fetchAdminProfile } = useAdminAuth()

const selectedAdmin = ref<AdminListRow | null>(null)
const profilePictureUrl = ref<string | null>(null)
const modalLoading = ref(false)
const showPromoteConfirmModal = ref(false)
const promoteTargetAdmin = ref<AdminListRow | null>(null)

const totalAdmins = computed(() => list.value.length)
const totalRoles = computed(() => {
  const roles = new Set(list.value.map((r) => r.role).filter(Boolean))
  return roles.size
})

const filteredList = computed(() => {
  let rows = list.value
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter((a) =>
      a.name.toLowerCase().includes(q)
      || a.email.toLowerCase().includes(q)
      || a.employeeid.toLowerCase().includes(q)
      || a.role.toLowerCase().includes(q)
    )
  }
  if (filterRole.value !== 'all') {
    rows = rows.filter((a) => a.role === filterRole.value)
  }
  return rows
})

function roleLabel(role: AdminListRow['role']) {
  if (role === 'superadmin') return 'Superadmin'
  if (role === 'admin') return 'Admin'
  return 'Pending'
}

const canApprovePendingAdmins = computed(() => adminRole.value === 'admin' || adminRole.value === 'superadmin')

function canDeleteAdmin(target: AdminListRow): boolean {
  if (!isSuperadmin.value) return false
  if (!user.value?.id) return false
  if (target.id === user.value.id) return false
  return target.role === 'pending' || target.role === 'admin'
}

async function approvePendingAdmin(target: AdminListRow) {
  if (!canApprovePendingAdmins.value || target.role !== 'pending') return
  actionError.value = null
  statusUpdatingByUser.value[target.id] = true
  const { error: updateErr } = await supabase
    .from('admin')
    .update({ role: 'admin' })
    .eq('id', target.id)
  statusUpdatingByUser.value[target.id] = false
  if (updateErr) {
    actionError.value = updateErr.message
    return
  }
  list.value = list.value.map((row) => row.id === target.id ? { ...row, role: 'admin' } : row)
  if (selectedAdmin.value?.id === target.id) {
    selectedAdmin.value = { ...selectedAdmin.value, role: 'admin' }
  }
}

/** Deletes another admin via Edge Function `delete-other-account` (service role + CORS). */
async function deleteAdminAccount(target: AdminListRow) {
  if (!canDeleteAdmin(target)) return
  const ok = window.confirm(`Delete admin account for ${target.name}? This cannot be undone.`)
  if (!ok) return
  actionError.value = null
  deletingByUser.value[target.id] = true
  try {
    if (!user.value) {
      throw new Error('You must be signed in.')
    }
    const { data, error: invokeErr } = await supabase.functions.invoke('delete-other-account', {
      body: { targetUserId: target.id }
    })
    if (invokeErr) throw new Error(invokeErr.message || 'Failed to delete admin account')
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      throw new Error(String((data as { error: unknown }).error))
    }
    list.value = list.value.filter((row) => row.id !== target.id)
    delete avatarUrls.value[target.id]
    if (selectedAdmin.value?.id === target.id) selectedAdmin.value = null
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Failed to delete admin account'
  } finally {
    deletingByUser.value[target.id] = false
  }
}

const hasSuperadminInList = computed(() => list.value.some((a) => a.role === 'superadmin'))

/** Superadmin can hand off; any admin can bootstrap the first superadmin when none exists. */
function canPromoteToSuperadmin(target: AdminListRow): boolean {
  if (!user.value?.id) return false
  if (target.id === user.value.id) return false
  if (target.role !== 'admin') return false
  if (isSuperadmin.value) return true
  if (!hasSuperadminInList.value && adminRole.value === 'admin') return true
  return false
}

function askPromoteToSuperadmin(target: AdminListRow) {
  if (!canPromoteToSuperadmin(target)) return
  actionError.value = null
  promoteTargetAdmin.value = target
  showPromoteConfirmModal.value = true
}

function cancelPromoteToSuperadmin() {
  showPromoteConfirmModal.value = false
  promoteTargetAdmin.value = null
}

async function confirmPromoteToSuperadmin() {
  const target = promoteTargetAdmin.value
  const selfId = user.value?.id ?? null
  if (!target || !selfId || !canPromoteToSuperadmin(target)) {
    cancelPromoteToSuperadmin()
    return
  }

  const existingSuper = list.value.find((a) => a.role === 'superadmin')
  let demotedId: string | null = null

  actionError.value = null
  statusUpdatingByUser.value[target.id] = true
  try {
    if (existingSuper && existingSuper.id !== target.id) {
      demotedId = existingSuper.id
      const { error: demoteErr } = await supabase
        .from('admin')
        .update({ role: 'admin' })
        .eq('id', existingSuper.id)
      if (demoteErr) throw new Error(demoteErr.message || 'Failed to demote current superadmin')
    }

    const { error: promoteErr } = await supabase
      .from('admin')
      .update({ role: 'superadmin' })
      .eq('id', target.id)
    if (promoteErr) {
      if (demotedId) {
        await supabase.from('admin').update({ role: 'superadmin' }).eq('id', demotedId)
      }
      throw new Error(promoteErr.message || 'Failed to promote admin')
    }

    list.value = list.value.map((row) => {
      if (row.id === target.id) return { ...row, role: 'superadmin' }
      if (demotedId && row.id === demotedId) return { ...row, role: 'admin' }
      return row
    })
    if (selectedAdmin.value?.id === target.id) {
      selectedAdmin.value = { ...selectedAdmin.value, role: 'superadmin' }
    }
    if (demotedId && selectedAdmin.value?.id === demotedId) {
      selectedAdmin.value = { ...selectedAdmin.value, role: 'admin' }
    }
    await fetchAdminProfile()
    cancelPromoteToSuperadmin()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Failed to promote admin'
  } finally {
    statusUpdatingByUser.value[target.id] = false
  }
}

async function loadAdmins() {
  loading.value = true
  error.value = null
  const { data, error: err } = await supabase
    .from('admin')
    .select('id, name, email, employeeid, picture, role, created_at, updated_at')
    .order('name')
  loading.value = false
  if (err) {
    error.value = err.message
    return
  }
  list.value = (data ?? []) as AdminListRow[]
  const entries = await Promise.all(
    list.value.map(async (a) => [a.id, await getSignedAdminProfileUrl(a.picture)] as const)
  )
  const signedMap: Record<string, string | null> = {}
  for (const [id, url] of entries) signedMap[id] = url
  avatarUrls.value = signedMap
}

onMounted(() => {
  void fetchAdminProfile()
  void loadAdmins()
})

watch(selectedAdmin, async (admin) => {
  actionError.value = null
  profilePictureUrl.value = null
  if (!admin) return
  modalLoading.value = true
  try {
    profilePictureUrl.value = await getSignedAdminProfileUrl(admin.picture)
  } finally {
    modalLoading.value = false
  }
})

function openAdmin(admin: AdminListRow) {
  actionError.value = null
  selectedAdmin.value = admin
}

function closeModal() {
  selectedAdmin.value = null
  cancelPromoteToSuperadmin()
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <div class="page">
    <p v-if="error" class="banner-error">{{ error }}</p>

    <template v-else-if="loading">
      <div class="loading-state">Loading…</div>
    </template>

    <template v-else>
      <section class="kpi-row" aria-label="Summary">
        <div class="kpi-card kpi-card-admins">
          <div class="kpi-icon-wrap" aria-hidden="true">
            <span class="material-symbols-outlined kpi-icon">manage_accounts</span>
          </div>
          <div class="kpi-value">{{ totalAdmins }}</div>
          <div class="kpi-label">Admins</div>
        </div>
        <div class="kpi-card kpi-card-roles">
          <div class="kpi-icon-wrap" aria-hidden="true">
            <span class="material-symbols-outlined kpi-icon">shield_person</span>
          </div>
          <div class="kpi-value">{{ totalRoles }}</div>
          <div class="kpi-label">Roles</div>
        </div>
      </section>

      <div class="controls">
        <div class="search-wrap">
          <MagnifyingGlassIcon class="search-icon" aria-hidden="true" />
          <input
            v-model="searchQuery"
            type="search"
            class="search-input"
            placeholder="Search admin accounts"
            autocomplete="off"
            aria-label="Search admins"
          />
        </div>
        <div class="select-wrap">
          <select v-model="filterRole" class="filter-select" aria-label="Filter by role">
            <option value="all">All roles</option>
            <option value="admin">Admin</option>
            <option value="superadmin">Superadmin</option>
            <option value="pending">Pending</option>
          </select>
          <ChevronDownIcon class="select-chevron" aria-hidden="true" />
        </div>
      </div>

      <div class="table-card">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Employee ID</th>
                <th scope="col">Role</th>
                <th scope="col">Email</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in filteredList" :key="a.id" class="data-row" @click="openAdmin(a)">
                <td class="td-user">
                  <div class="user-cell">
                    <div class="avatar">
                      <img
                        v-if="avatarUrls[a.id]"
                        :src="String(avatarUrls[a.id])"
                        alt=""
                        width="40"
                        height="40"
                      />
                      <span v-else class="avatar-placeholder">{{ (a.name || '?').slice(0, 1).toUpperCase() }}</span>
                    </div>
                    <span class="user-name">{{ a.name }}</span>
                  </div>
                </td>
                <td class="td-muted">{{ a.employeeid || '—' }}</td>
                <td class="td-muted">
                  <span class="role-pill" :class="'role-pill--' + a.role">{{ roleLabel(a.role) }}</span>
                </td>
                <td class="td-muted">{{ a.email }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!filteredList.length" class="empty-hint">
          {{ list.length ? 'No matches for your filters.' : 'No admin accounts yet.' }}
        </p>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="selectedAdmin" class="modal-overlay" @click.self="closeModal">
        <div class="modal-panel">
          <button type="button" class="modal-close" aria-label="Close" @click="closeModal">&times;</button>
          <div v-if="modalLoading" class="modal-loading">Loading…</div>
          <template v-else>
            <div class="profile-section">
              <div class="profile-avatar-wrap">
                <img v-if="profilePictureUrl" :src="profilePictureUrl" alt="" class="profile-avatar" />
                <span v-else class="profile-avatar placeholder">{{
                  (selectedAdmin.name || '?').slice(0, 1).toUpperCase()
                }}</span>
              </div>
              <h2 class="profile-name">{{ selectedAdmin.name }}</h2>
              <dl class="profile-details">
                <dt>Email</dt>
                <dd>{{ selectedAdmin.email }}</dd>
                <dt>Employee ID</dt>
                <dd>{{ selectedAdmin.employeeid || '—' }}</dd>
                <dt>Role</dt>
                <dd>{{ roleLabel(selectedAdmin.role) }}</dd>
                <dt>Created</dt>
                <dd>{{ formatDateTime(selectedAdmin.created_at) }}</dd>
                <dt>Updated</dt>
                <dd>{{ formatDateTime(selectedAdmin.updated_at) }}</dd>
              </dl>
              <p v-if="actionError" class="action-error">{{ actionError }}</p>
              <div
                v-if="canApprovePendingAdmins && selectedAdmin.role === 'pending'"
                class="modal-actions"
              >
                <button
                  type="button"
                  class="action-btn approve"
                  :disabled="statusUpdatingByUser[selectedAdmin.id]"
                  @click="approvePendingAdmin(selectedAdmin)"
                >
                  {{ statusUpdatingByUser[selectedAdmin.id] ? 'Approving…' : 'Approve admin' }}
                </button>
              </div>
              <div v-if="canDeleteAdmin(selectedAdmin)" class="modal-actions">
                <button
                  type="button"
                  class="action-btn danger"
                  :disabled="deletingByUser[selectedAdmin.id]"
                  @click="deleteAdminAccount(selectedAdmin)"
                >
                  {{ deletingByUser[selectedAdmin.id] ? 'Deleting…' : 'Delete account' }}
                </button>
              </div>
              <div v-if="canPromoteToSuperadmin(selectedAdmin)" class="modal-actions">
                <button
                  type="button"
                  class="action-btn promote"
                  :disabled="statusUpdatingByUser[selectedAdmin.id]"
                  @click="askPromoteToSuperadmin(selectedAdmin)"
                >
                  {{ statusUpdatingByUser[selectedAdmin.id] ? 'Promoting…' : 'Promote to superadmin' }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showPromoteConfirmModal && promoteTargetAdmin" class="modal-overlay" @click.self="cancelPromoteToSuperadmin">
        <div class="confirm-modal-panel">
          <h3 class="confirm-modal-title">Promote to superadmin</h3>
          <p class="confirm-modal-text">
            Are you sure you want to promote <strong>{{ promoteTargetAdmin.name }}</strong> to superadmin?
            <template v-if="hasSuperadminInList">
              The current superadmin will be demoted to admin first so only one superadmin exists.
            </template>
            <template v-else>
              There is no superadmin yet; this will make them the first superadmin.
            </template>
          </p>
          <div class="modal-actions">
            <button type="button" class="action-btn" @click="cancelPromoteToSuperadmin">Cancel</button>
            <button
              type="button"
              class="action-btn promote"
              :disabled="statusUpdatingByUser[promoteTargetAdmin.id]"
              @click="confirmPromoteToSuperadmin"
            >
              {{ statusUpdatingByUser[promoteTargetAdmin.id] ? 'Applying…' : 'Yes, promote' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page { width: 100%; max-width: 100%; }
.loading-state, .banner-error { color: var(--text-secondary); font-size: 0.9375rem; }
.banner-error { color: var(--error); margin: 0 0 1rem; }

.kpi-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.kpi-card {
  min-width: 0;
  text-align: left;
  padding: 1.25rem 1.375rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 14px;
}
.kpi-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  margin-bottom: 0.875rem;
}
.kpi-card-admins .kpi-icon-wrap { background: rgba(34, 197, 94, 0.18); }
.kpi-card-roles .kpi-icon-wrap { background: rgba(147, 51, 234, 0.16); }
.kpi-icon { font-size: 1.375rem; line-height: 1; }
.kpi-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.kpi-label { margin-top: 0.25rem; font-size: 0.8125rem; color: var(--text-tertiary); font-weight: 500; }

.controls {
  margin-bottom: 1.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}
.search-wrap { position: relative; flex: 1; min-width: 260px; }
.search-icon {
  position: absolute;
  left: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  width: 1.125rem;
  height: 1.125rem;
  color: var(--text-tertiary);
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 0.65rem 0.875rem 0.65rem 2.5rem;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9375rem;
}
.search-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15); }
.select-wrap { position: relative; min-width: 160px; }
.filter-select {
  appearance: none;
  width: 100%;
  padding: 0.5rem 2rem 0.5rem 0.875rem;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}
.select-chevron {
  position: absolute;
  right: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  width: 1rem;
  height: 1rem;
  color: var(--text-tertiary);
  pointer-events: none;
}

.table-card {
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.table-scroll { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.data-table thead th {
  text-align: left;
  padding: 0.75rem 1rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}
.data-row { cursor: pointer; transition: background 0.12s ease; }
.data-row:hover { background: var(--bg-hover); }
.data-table tbody td {
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}
.data-table tbody tr:last-child td { border-bottom: none; }
.user-cell { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
}
.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--accent);
  background: rgba(56, 189, 248, 0.15);
}
.user-name {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.td-muted { color: var(--text-secondary); }
.role-pill {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
}
.role-pill--admin { color: #22c55e; background: rgba(34, 197, 94, 0.15); }
.role-pill--superadmin { color: #a855f7; background: rgba(168, 85, 247, 0.15); }
.role-pill--pending { color: #f97316; background: rgba(249, 115, 22, 0.15); }
.empty-hint { margin: 0; padding: 1.25rem 1rem; text-align: center; color: var(--text-tertiary); font-size: 0.875rem; }

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
.modal-panel {
  position: relative;
  background: var(--bg-tertiary);
  border-radius: 12px;
  max-width: 520px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  border: 1px solid var(--border-light);
}
.modal-close {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
}
.modal-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.modal-loading { padding: 2rem; text-align: center; color: var(--text-secondary); }
.profile-section { padding: 1.5rem; text-align: center; }
.profile-avatar-wrap { margin-bottom: 0.75rem; }
.profile-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  margin: 0 auto;
}
.profile-avatar.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(56, 189, 248, 0.3);
  color: var(--accent);
  font-weight: 600;
  font-size: 2rem;
  margin: 0 auto;
}
.profile-name { margin: 0 0 1rem; font-size: 1.25rem; font-weight: 600; color: var(--text-primary); }
.profile-details {
  text-align: left;
  max-width: 320px;
  margin: 0 auto;
  font-size: 0.875rem;
}
.profile-details dt { color: var(--text-secondary); margin-top: 0.5rem; }
.profile-details dd { margin: 0.15rem 0 0; color: var(--text-primary); }
.action-error {
  margin: 1rem auto 0;
  max-width: 320px;
  color: var(--error);
  font-size: 0.875rem;
  text-align: left;
}
.modal-actions {
  margin-top: 0.85rem;
  display: flex;
  justify-content: center;
  gap: 0.6rem;
}
.action-btn {
  border: 1px solid var(--border-light);
  border-radius: 999px;
  padding: 0.42rem 0.9rem;
  font-size: 0.875rem;
  cursor: pointer;
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.action-btn.approve {
  border-color: rgba(34, 197, 94, 0.35);
  color: #22c55e;
}
.action-btn.danger {
  border-color: rgba(239, 68, 68, 0.35);
  color: #ef4444;
}
.action-btn.promote {
  border-color: rgba(168, 85, 247, 0.35);
  color: #a855f7;
}
.confirm-modal-panel {
  width: 100%;
  max-width: 460px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  padding: 1.1rem 1.1rem 1rem;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
}
.confirm-modal-title {
  margin: 0 0 0.6rem;
  font-size: 1.05rem;
  color: var(--text-primary);
}
.confirm-modal-text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.92rem;
  line-height: 1.55;
}
</style>
