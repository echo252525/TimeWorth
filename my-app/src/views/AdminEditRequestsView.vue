<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import supabase from '../lib/supabaseClient'
import { useAuth } from '../composables/useAuth'
import {
  storedToRealInstant,
  computeTotalTimeForEdit,
  type AttendanceRow,
  type WorkModality
} from '../composables/useAttendance'

const { user } = useAuth()

type EditStatus = 'pending' | 'approved' | 'rejected'

interface EditRequestRow {
  id: string
  attendance_id: string
  requested_by: string
  old_clock_in: string | null
  old_clock_out: string | null
  old_lunch_break_start: string | null
  old_lunch_break_end: string | null
  old_location_in: string | null
  old_location_out: string | null
  old_work_modality: WorkModality | null
  new_clock_in: string | null
  new_clock_out: string | null
  new_lunch_break_start: string | null
  new_lunch_break_end: string | null
  new_location_in: string | null
  new_location_out: string | null
  new_work_modality: WorkModality | null
  status: EditStatus
  reviewed_by: string | null
  reviewed_at: string | null
  reason: string | null
  admin_comment: string | null
  created_at: string | null
  updated_at: string | null
  requester_name?: string
  requester_email?: string
}

const rows = ref<EditRequestRow[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const processingId = ref<string | null>(null)
const filterStatus = ref<'all' | EditStatus>('all')

const filteredRows = computed(() => {
  if (filterStatus.value === 'all') return rows.value
  return rows.value.filter((r) => r.status === filterStatus.value)
})

/* Status column filter: chevron + teleported menu (same UX as TimesheetView / AdminEmployeesView) */
const showStatusFilterDropdown = ref(false)
const statusFilterTriggerRef = ref<HTMLElement | null>(null)
const statusFilterDropdownStyle = ref<Record<string, string>>({})

const statusFilterLabel = computed(() => {
  switch (filterStatus.value) {
    case 'all':
      return 'All'
    case 'pending':
      return 'Pending'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    default:
      return 'All'
  }
})

function positionStatusFilterDropdown() {
  const el = statusFilterTriggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const minW = Math.max(r.width, 160)
  const left = Math.min(Math.max(8, r.left), window.innerWidth - minW - 8)
  statusFilterDropdownStyle.value = {
    position: 'fixed',
    top: `${r.bottom + 6}px`,
    left: `${left}px`,
    minWidth: `${minW}px`,
    zIndex: '300'
  }
}

function toggleStatusFilterMenu() {
  showStatusFilterDropdown.value = !showStatusFilterDropdown.value
  if (showStatusFilterDropdown.value) void nextTick(() => positionStatusFilterDropdown())
}

function selectStatusFilter(v: 'all' | EditStatus) {
  showStatusFilterDropdown.value = false
  filterStatus.value = v
}

function handleStatusFilterClickOutside(event: MouseEvent) {
  if (!showStatusFilterDropdown.value) return
  const target = event.target as HTMLElement
  if (target.closest('.ts-filter-trigger-wrap') || target.closest('.ts-filter-dropdown-portal')) return
  showStatusFilterDropdown.value = false
}

watch(showStatusFilterDropdown, (open) => {
  if (open) {
    void nextTick(() => positionStatusFilterDropdown())
    window.addEventListener('scroll', positionStatusFilterDropdown, true)
    window.addEventListener('resize', positionStatusFilterDropdown)
  } else {
    window.removeEventListener('scroll', positionStatusFilterDropdown, true)
    window.removeEventListener('resize', positionStatusFilterDropdown)
  }
})

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(storedToRealInstant(iso))
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function shortRange(inIso: string | null, outIso: string | null): string {
  const a = formatDateTime(inIso)
  const b = formatDateTime(outIso)
  if (a === '—' && b === '—') return '—'
  return `${a} → ${b}`
}

async function getReviewerEmployeeId(): Promise<string | null> {
  const uid = user.value?.id
  if (!uid) return null
  const { data } = await supabase.from('employee').select('id').eq('id', uid).maybeSingle()
  return data?.id ?? null
}

async function load() {
  loading.value = true
  error.value = null
  const { data, error: err } = await supabase
    .from('attendance_edit_requests')
    .select('*')
    .order('created_at', { ascending: false })
  loading.value = false
  if (err) {
    error.value = err.message
    rows.value = []
    return
  }
  const list = (data ?? []) as EditRequestRow[]
  const ids = [...new Set(list.map((r) => r.requested_by).filter(Boolean))]
  const empMap: Record<string, { name: string; email: string }> = {}
  if (ids.length) {
    const { data: emps, error: empErr } = await supabase.from('employee').select('id, name, email').in('id', ids)
    if (!empErr && emps) {
      for (const e of emps) {
        empMap[e.id] = { name: e.name, email: e.email }
      }
    }
  }
  rows.value = list.map((r) => {
    const e = empMap[r.requested_by]
    return {
      ...r,
      requester_name: e?.name ?? '—',
      requester_email: e?.email ?? '—'
    }
  })
}

async function approve(row: EditRequestRow) {
  if (row.status !== 'pending' || processingId.value) return
  processingId.value = row.id
  error.value = null
  const { data: att, error: attErr } = await supabase
    .from('attendance')
    .select('*')
    .eq('attendance_id', row.attendance_id)
    .maybeSingle()
  if (attErr || !att) {
    error.value = attErr?.message ?? 'Attendance record not found.'
    processingId.value = null
    return
  }
  const a = att as AttendanceRow
  const clock_in = row.new_clock_in ?? a.clock_in
  const clock_out = row.new_clock_out ?? a.clock_out
  const lunch_break_start = row.new_lunch_break_start ?? a.lunch_break_start
  const lunch_break_end = row.new_lunch_break_end ?? a.lunch_break_end
  const location_in = row.new_location_in ?? a.location_in
  const location_out = row.new_location_out ?? a.location_out
  const work_modality = row.new_work_modality ?? a.work_modality
  const total_time = computeTotalTimeForEdit(clock_in, clock_out, lunch_break_start, lunch_break_end)
  const { error: updErr } = await supabase
    .from('attendance')
    .update({
      clock_in,
      clock_out,
      lunch_break_start,
      lunch_break_end,
      location_in,
      location_out,
      work_modality,
      total_time,
      updated_at: new Date().toISOString()
    })
    .eq('attendance_id', row.attendance_id)
  if (updErr) {
    error.value = updErr.message
    processingId.value = null
    return
  }
  const reviewed_by = await getReviewerEmployeeId()
  const reviewed_at = new Date().toISOString()
  const { error: reqErr } = await supabase
    .from('attendance_edit_requests')
    .update({ status: 'approved', reviewed_by, reviewed_at })
    .eq('id', row.id)
  if (reqErr) {
    error.value = reqErr.message
    processingId.value = null
    return
  }
  row.status = 'approved'
  row.reviewed_by = reviewed_by
  row.reviewed_at = reviewed_at
  processingId.value = null
}

async function decline(row: EditRequestRow) {
  if (row.status !== 'pending' || processingId.value) return
  processingId.value = row.id
  error.value = null
  const reviewed_by = await getReviewerEmployeeId()
  const reviewed_at = new Date().toISOString()
  const { error: reqErr } = await supabase
    .from('attendance_edit_requests')
    .update({ status: 'rejected', reviewed_by, reviewed_at })
    .eq('id', row.id)
  if (reqErr) {
    error.value = reqErr.message
    processingId.value = null
    return
  }
  row.status = 'rejected'
  row.reviewed_by = reviewed_by
  row.reviewed_at = reviewed_at
  processingId.value = null
}

function statusClass(s: EditStatus): string {
  if (s === 'pending') return 'status-pill--pending'
  if (s === 'approved') return 'status-pill--approved'
  return 'status-pill--rejected'
}

onMounted(() => {
  void load()
  document.addEventListener('click', handleStatusFilterClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleStatusFilterClickOutside)
  window.removeEventListener('scroll', positionStatusFilterDropdown, true)
  window.removeEventListener('resize', positionStatusFilterDropdown)
})
</script>

<template>
  <div class="page">
    <h1>Edit requests</h1>
    <p class="muted">Review employee requests to change clock times, lunch, locations, or work modality.</p>

    <p v-if="error" class="banner-error">{{ error }}</p>

    <div class="controls">
      <button type="button" class="btn-ghost" :disabled="loading" @click="load">Refresh</button>
    </div>

    <div v-if="loading" class="loading-state">Loading…</div>

    <div v-else class="table-card">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Requested</th>
              <th scope="col" class="th-status" @click.stop>
                <div class="th-status-wrap">
                  <span>Status</span>
                  <div ref="statusFilterTriggerRef" class="ts-filter-trigger-wrap">
                    <button
                      type="button"
                      class="period-btn ts-filter-period-btn"
                      aria-haspopup="listbox"
                      :aria-expanded="showStatusFilterDropdown"
                      :aria-label="`Status filter, ${statusFilterLabel}`"
                      @click.stop="toggleStatusFilterMenu"
                    >
                      <ChevronDownIcon class="ts-period-chevron" aria-hidden="true" />
                    </button>
                    <Teleport to="body">
                      <div
                        v-if="showStatusFilterDropdown"
                        class="ts-filter-dropdown-portal period-dropdown"
                        :style="statusFilterDropdownStyle"
                        role="listbox"
                        @click.stop
                      >
                        <button
                          type="button"
                          class="period-option"
                          :class="{ active: filterStatus === 'all' }"
                          role="option"
                          :aria-selected="filterStatus === 'all'"
                          @click="selectStatusFilter('all')"
                        >
                          All
                        </button>
                        <button
                          type="button"
                          class="period-option"
                          :class="{ active: filterStatus === 'pending' }"
                          role="option"
                          :aria-selected="filterStatus === 'pending'"
                          @click="selectStatusFilter('pending')"
                        >
                          Pending
                        </button>
                        <button
                          type="button"
                          class="period-option"
                          :class="{ active: filterStatus === 'approved' }"
                          role="option"
                          :aria-selected="filterStatus === 'approved'"
                          @click="selectStatusFilter('approved')"
                        >
                          Approved
                        </button>
                        <button
                          type="button"
                          class="period-option"
                          :class="{ active: filterStatus === 'rejected' }"
                          role="option"
                          :aria-selected="filterStatus === 'rejected'"
                          @click="selectStatusFilter('rejected')"
                        >
                          Rejected
                        </button>
                      </div>
                    </Teleport>
                  </div>
                </div>
              </th>
              <th scope="col">Previous (in → out)</th>
              <th scope="col">Requested (in → out)</th>
              <th scope="col">Modality</th>
              <th scope="col">Reason</th>
              <th scope="col" class="th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filteredRows" :key="r.id" class="data-row">
              <td>
                <div class="cell-name">{{ r.requester_name }}</div>
                <div class="cell-email">{{ r.requester_email }}</div>
              </td>
              <td class="td-muted">{{ formatDateTime(r.created_at) }}</td>
              <td>
                <span class="status-pill" :class="statusClass(r.status)">{{ r.status }}</span>
              </td>
              <td class="td-muted cell-compact">{{ shortRange(r.old_clock_in, r.old_clock_out) }}</td>
              <td class="td-muted cell-compact">{{ shortRange(r.new_clock_in, r.new_clock_out) }}</td>
              <td class="td-muted">
                <span v-if="r.old_work_modality || r.new_work_modality">
                  {{ r.old_work_modality ?? '—' }} → {{ r.new_work_modality ?? '—' }}
                </span>
                <span v-else>—</span>
              </td>
              <td class="td-muted cell-reason">{{ r.reason || '—' }}</td>
              <td class="td-actions">
                <template v-if="r.status === 'pending'">
                  <button
                    type="button"
                    class="btn-approve"
                    :disabled="processingId !== null"
                    @click="approve(r)"
                  >
                    {{ processingId === r.id ? '…' : 'Approve' }}
                  </button>
                  <button
                    type="button"
                    class="btn-decline"
                    :disabled="processingId !== null"
                    @click="decline(r)"
                  >
                    {{ processingId === r.id ? '…' : 'Decline' }}
                  </button>
                </template>
                <span v-else class="td-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!filteredRows.length" class="empty-hint">
        {{ rows.length ? 'No requests match this filter.' : 'No edit requests yet.' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 100%;
}
.page h1 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}
.muted {
  color: var(--text-secondary);
  font-size: 0.9375rem;
  margin: 0 0 1rem;
}
.banner-error {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.12);
  color: var(--error, #f87171);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
.controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.btn-ghost {
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-light);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.btn-ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.btn-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.loading-state {
  color: var(--text-secondary);
  padding: 2rem 0;
}
.table-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.data-table {
  width: 100%;
  min-width: 920px;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.data-table th {
  text-align: left;
  padding: 0.75rem 1rem;
  color: var(--text-tertiary);
  font-weight: 500;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}
.th-status {
  width: 1%;
}
.th-status-wrap {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.4rem;
  min-width: 0;
}

.ts-filter-trigger-wrap {
  position: relative;
  flex: 0 0 auto;
}

.ts-filter-period-btn.period-btn {
  width: auto;
  min-width: 1.75rem;
  justify-content: center;
  padding: 0.35rem;
  font-size: 0.75rem;
  border-radius: 8px;
  border: none;
  background: transparent;
  box-shadow: none;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.ts-filter-period-btn.period-btn:hover,
.ts-filter-period-btn.period-btn:focus,
.ts-filter-period-btn.period-btn:focus-visible,
.ts-filter-period-btn.period-btn:active {
  background: transparent;
  border: none;
  box-shadow: none;
  outline: none;
}

.period-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.875rem;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  transition: all 0.2s ease;
  position: relative;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

.period-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-light);
}

.ts-period-chevron {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  color: var(--text-secondary);
  transition: transform 0.2s ease;
}

.period-btn:hover .ts-period-chevron {
  color: var(--text-primary);
  transform: translateY(1px);
}

.ts-filter-dropdown-portal.period-dropdown {
  box-sizing: border-box;
  margin: 0;
  padding: 0.375rem;
  background: var(--bg-primary);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  min-width: 150px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.period-option {
  display: block;
  width: 100%;
  padding: 0.625rem 0.875rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  transition: all 0.2s ease;
}

.period-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.period-option.active {
  background: rgba(56, 189, 248, 0.15);
  color: var(--accent);
}
.data-table td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
}
.data-row:last-child td {
  border-bottom: none;
}
.td-muted {
  color: var(--text-secondary);
}
.cell-name {
  font-weight: 500;
  color: var(--text-primary);
}
.cell-email {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  margin-top: 0.15rem;
}
.cell-compact {
  max-width: 220px;
  font-size: 0.8125rem;
  line-height: 1.35;
}
.cell-reason {
  max-width: 180px;
  word-break: break-word;
}
.th-actions {
  width: 1%;
}
.td-actions {
  white-space: nowrap;
}
.btn-approve,
.btn-decline {
  padding: 0.35rem 0.65rem;
  margin-right: 0.35rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s;
}
.btn-approve {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}
.btn-approve:hover:not(:disabled) {
  background: rgba(34, 197, 94, 0.3);
}
.btn-decline {
  background: rgba(248, 113, 113, 0.15);
  color: #f87171;
}
.btn-decline:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.25);
}
.btn-approve:disabled,
.btn-decline:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.status-pill {
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: capitalize;
}
.status-pill--pending {
  background: rgba(234, 179, 8, 0.15);
  color: #fbbf24;
}
.status-pill--approved {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}
.status-pill--rejected {
  background: rgba(248, 113, 113, 0.12);
  color: #f87171;
}
.empty-hint {
  padding: 1rem 1.25rem;
  color: var(--text-tertiary);
  font-size: 0.875rem;
  margin: 0;
}

:root.light-mode .ts-filter-dropdown-portal.period-dropdown,
body.light-mode .ts-filter-dropdown-portal.period-dropdown {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

:root.light-mode .period-option.active,
body.light-mode .period-option.active {
  background: rgba(56, 189, 248, 0.2);
  color: #0284c7;
}
</style>
