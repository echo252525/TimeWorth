<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, watchEffect, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MagnifyingGlassIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import supabase from '../lib/supabaseClient'
import { getSignedProfileUrl } from '../composables/useAuth'
import {
  storedToRealInstant,
  getLocalDateString,
  parseLocation,
  getBranch,
  type AttendanceRow
} from '../composables/useAttendance'

/** Columns needed for employee hover (maps use `location_in` / `location_out` as `lat,lng` text). */
const ATTENDANCE_HOVER_SELECT =
  'attendance_id,user_id,clock_in,clock_out,facial_status,lunch_break_start,lunch_break_end,total_time,location_in,location_out,branch_location,work_modality,liveness_verifications_id,created_at,updated_at'

/**
 * Prefer `location_in` (GPS). If missing and office, fall back to registered branch coords.
 */
function mapFromClockIn(row: AttendanceRow): { lat: number; lng: number; mapCaption: string } | null {
  const gps = parseLocation(row.location_in)
  if (gps) {
    return { ...gps, mapCaption: 'Clock in location' }
  }
  if (row.work_modality === 'office' && row.branch_location) {
    const b = getBranch(row.branch_location)
    if (b) {
      return {
        lat: b.lat,
        lng: b.lng,
        mapCaption: 'Office branch (no clock-in GPS)'
      }
    }
  }
  return null
}

/**
 * Prefer `location_out` (GPS). If missing and office, fall back to registered branch coords.
 */
function mapFromClockOut(row: AttendanceRow, lastSession: boolean): { lat: number; lng: number; mapCaption: string } | null {
  const gps = parseLocation(row.location_out)
  if (gps) {
    return {
      ...gps,
      mapCaption: lastSession ? 'Last clock out location' : 'Clock out location'
    }
  }
  if (row.work_modality === 'office' && row.branch_location) {
    const b = getBranch(row.branch_location)
    if (b) {
      return {
        lat: b.lat,
        lng: b.lng,
        mapCaption: lastSession
          ? 'Last session — office (no clock-out GPS)'
          : 'Office branch (no clock-out GPS)'
      }
    }
  }
  return null
}

interface Emp {
  id: string
  name: string
  email: string
  position_in_company: string
  company_branch: string
  employee_no: number
  picture: string | null
}
interface AttendanceRecord {
  clock_in: string | null
  clock_out: string | null
  total_time: string | null
}

const list = ref<Emp[]>([])
const avatarUrls = ref<Record<string, string | null>>({})
const loading = ref(true)
const error = ref<string | null>(null)

const searchQuery = ref('')
const filterStatus = ref<'all' | 'active'>('all')
const filterPosition = ref<string>('all')
const selectedIds = ref<string[]>([])
const headerCheckboxRef = ref<HTMLInputElement | null>(null)

const selectedEmployee = ref<Emp | null>(null)
const profilePictureUrl = ref<string | null>(null)
const attendanceHistory = ref<AttendanceRecord[]>([])
const modalLoading = ref(false)

/** Today's attendance rows per employee (local calendar day). */
const attendanceTodayByUser = ref<Record<string, AttendanceRow[]>>({})
/** Last completed row for employees with no attendance today (for “last clock out” map). */
const lastClockOutByUser = ref<Record<string, AttendanceRow | null>>({})

type PresenceKind = 'not_clocked_in' | 'clocked_in' | 'on_lunch' | 'clocked_out'

interface HoverPresence {
  kind: PresenceKind
  title: string
  mapCaption: string
  lat: number | null
  lng: number | null
  ticking: boolean
  tickKind: 'work' | 'lunch' | null
  activeRecord: AttendanceRow | null
}

const hoveredEmp = ref<Emp | null>(null)
const popPos = ref({ top: 0, left: 0 })
const miniMapEl = ref<HTMLElement | null>(null)
const tickNow = ref(Date.now())
let miniMap: L.Map | null = null
let miniMarker: L.Layer | null = null
let hoverTickTimer: ReturnType<typeof setInterval> | null = null
let attendanceRefreshTimer: ReturnType<typeof setInterval> | null = null
let leaveHoverTimer: ReturnType<typeof setTimeout> | null = null

function formatElapsedMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}h ${m}m ${sec}s`
}

function workElapsedMs(record: AttendanceRow, now: number): number {
  if (!record.clock_in) return 0
  const start = storedToRealInstant(record.clock_in)
  let lunchMs = 0
  if (record.lunch_break_start) {
    const ls = storedToRealInstant(record.lunch_break_start)
    const le = record.lunch_break_end ? storedToRealInstant(record.lunch_break_end) : now
    lunchMs = le - ls
  }
  return Math.max(0, now - start - lunchMs)
}

function lunchElapsedMs(record: AttendanceRow, now: number): number {
  if (!record.lunch_break_start || record.lunch_break_end) return 0
  return Math.max(0, now - storedToRealInstant(record.lunch_break_start))
}

function presenceForUserId(userId: string): HoverPresence {
  const todayRows = attendanceTodayByUser.value[userId] ?? []
  const lastGlobal = lastClockOutByUser.value[userId] ?? null

  if (todayRows.length === 0) {
    const m = lastGlobal ? mapFromClockOut(lastGlobal, true) : null
    return {
      kind: 'not_clocked_in',
      title: "Hasn't clocked in today",
      mapCaption: m?.mapCaption ?? 'No location on file',
      lat: m?.lat ?? null,
      lng: m?.lng ?? null,
      ticking: false,
      tickKind: null,
      activeRecord: lastGlobal
    }
  }

  const activeRow = todayRows.find((r) => !r.clock_out)
  if (activeRow) {
    const onLunch = !!activeRow.lunch_break_start && !activeRow.lunch_break_end
    const m = mapFromClockIn(activeRow)
    if (onLunch) {
      return {
        kind: 'on_lunch',
        title: 'On lunch break',
        mapCaption: m?.mapCaption ?? 'No location on file',
        lat: m?.lat ?? null,
        lng: m?.lng ?? null,
        ticking: true,
        tickKind: 'lunch',
        activeRecord: activeRow
      }
    }
    return {
      kind: 'clocked_in',
      title: 'Clocked in',
      mapCaption: m?.mapCaption ?? 'No location on file',
      lat: m?.lat ?? null,
      lng: m?.lng ?? null,
      ticking: true,
      tickKind: 'work',
      activeRecord: activeRow
    }
  }

  const completed = todayRows.filter((r) => r.clock_out)
  const lastOut = completed.sort(
    (a, b) => storedToRealInstant(b.clock_out!) - storedToRealInstant(a.clock_out!)
  )[0]
  const m = lastOut ? mapFromClockOut(lastOut, false) : null
  return {
    kind: 'clocked_out',
    title: 'Clocked out (today)',
    mapCaption: m?.mapCaption ?? 'No location on file',
    lat: m?.lat ?? null,
    lng: m?.lng ?? null,
    ticking: false,
    tickKind: null,
    activeRecord: lastOut ?? null
  }
}

function tableStatusLabel(userId: string): string {
  const p = presenceForUserId(userId)
  switch (p.kind) {
    case 'not_clocked_in':
      return 'Not in today'
    case 'clocked_in':
      return 'Clocked in'
    case 'on_lunch':
      return 'On lunch'
    case 'clocked_out':
      return 'Clocked out'
    default:
      return '—'
  }
}

const hoverPresence = computed(() => (hoveredEmp.value ? presenceForUserId(hoveredEmp.value.id) : null))

const liveElapsed = computed(() => {
  const p = hoverPresence.value
  if (!p?.ticking || !p.activeRecord) return ''
  const now = tickNow.value
  if (p.tickKind === 'lunch') return formatElapsedMs(lunchElapsedMs(p.activeRecord, now))
  return formatElapsedMs(workElapsedMs(p.activeRecord, now))
})

function destroyMiniMap() {
  if (miniMap) {
    miniMap.remove()
    miniMap = null
    miniMarker = null
  }
}

function startHoverTick() {
  stopHoverTick()
  hoverTickTimer = setInterval(() => {
    tickNow.value = Date.now()
  }, 1000)
}

function stopHoverTick() {
  if (hoverTickTimer) {
    clearInterval(hoverTickTimer)
    hoverTickTimer = null
  }
}

async function loadAttendanceSnapshot() {
  const ids = list.value.map((e) => e.id)
  if (!ids.length) {
    attendanceTodayByUser.value = {}
    lastClockOutByUser.value = {}
    return
  }
  const today = getLocalDateString(new Date())
  // Match AdminHome / DB convention: clock_in is stored as local calendar date + literal "Z"
  const start = `${today}T00:00:00.000Z`
  const end = `${today}T23:59:59.999Z`

  const [{ data: todayData, error: todayErr }, { data: openData, error: openErr }] = await Promise.all([
    supabase
      .from('attendance')
      .select(ATTENDANCE_HOVER_SELECT)
      .in('user_id', ids)
      .gte('clock_in', start)
      .lte('clock_in', end)
      .order('clock_in', { ascending: false }),
    supabase
      .from('attendance')
      .select(ATTENDANCE_HOVER_SELECT)
      .in('user_id', ids)
      .is('clock_out', null)
  ])

  if (todayErr) {
    console.warn('[AdminEmployees] attendance today', todayErr.message)
    return
  }
  if (openErr) {
    console.warn('[AdminEmployees] attendance open sessions', openErr.message)
  }

  const openByUser: Record<string, AttendanceRow | null> = Object.fromEntries(ids.map((id) => [id, null]))
  for (const row of (openData ?? []) as AttendanceRow[]) {
    const uid = row.user_id
    const cur = openByUser[uid]
    if (
      !cur ||
      (row.clock_in &&
        cur.clock_in &&
        storedToRealInstant(row.clock_in) > storedToRealInstant(cur.clock_in))
    ) {
      openByUser[uid] = row
    }
  }

  const byUser: Record<string, AttendanceRow[]> = {}
  for (const id of ids) byUser[id] = []
  for (const row of (todayData ?? []) as AttendanceRow[]) {
    if (!byUser[row.user_id]) byUser[row.user_id] = []
    byUser[row.user_id].push(row)
  }
  // Open shift can be missing from the "today" string range (timezone / storage quirks) — always merge it in
  for (const id of ids) {
    const openRow = openByUser[id]
    if (!openRow) continue
    const arr = byUser[id]
    const already = arr.some((r) => r.attendance_id === openRow.attendance_id)
    if (!already) byUser[id] = [openRow, ...arr]
  }
  attendanceTodayByUser.value = byUser

  const missing = ids.filter((id) => !byUser[id]?.length)
  const lastMap: Record<string, AttendanceRow | null> = Object.fromEntries(ids.map((id) => [id, null]))
  if (missing.length) {
    const { data: lastRows } = await supabase
      .from('attendance')
      .select(ATTENDANCE_HOVER_SELECT)
      .in('user_id', missing)
      .not('clock_out', 'is', null)
      .order('clock_out', { ascending: false })
    const seen = new Set<string>()
    for (const row of (lastRows ?? []) as AttendanceRow[]) {
      if (seen.has(row.user_id)) continue
      seen.add(row.user_id)
      lastMap[row.user_id] = row
    }
  }
  lastClockOutByUser.value = lastMap

  if (hoveredEmp.value) {
    const p = presenceForUserId(hoveredEmp.value.id)
    stopHoverTick()
    tickNow.value = Date.now()
    if (p.ticking) startHoverTick()
  }
}

function onRowEnter(emp: Emp, ev: MouseEvent) {
  if (leaveHoverTimer) {
    clearTimeout(leaveHoverTimer)
    leaveHoverTimer = null
  }
  hoveredEmp.value = emp
  tickNow.value = Date.now()
  const tr = ev.currentTarget as HTMLElement
  const rect = tr.getBoundingClientRect()
  const cardW = 288
  const cardH = 300
  let left = rect.right + 10
  if (left + cardW > window.innerWidth - 12) left = rect.left - cardW - 10
  left = Math.max(12, Math.min(left, window.innerWidth - cardW - 12))
  let top = rect.top
  if (top + cardH > window.innerHeight - 12) top = window.innerHeight - cardH - 12
  top = Math.max(12, top)
  popPos.value = { top, left }
  const p = presenceForUserId(emp.id)
  stopHoverTick()
  if (p.ticking) startHoverTick()
}

function onRowLeave() {
  leaveHoverTimer = setTimeout(() => {
    hoveredEmp.value = null
    stopHoverTick()
    destroyMiniMap()
  }, 120)
}

function cancelHoverLeave() {
  if (leaveHoverTimer) {
    clearTimeout(leaveHoverTimer)
    leaveHoverTimer = null
  }
}

watch(
  () => [hoveredEmp.value?.id, hoverPresence.value?.lat, hoverPresence.value?.lng] as const,
  async () => {
    await nextTick()
    destroyMiniMap()
    const p = hoverPresence.value
    const el = miniMapEl.value
    if (!hoveredEmp.value || !p || p.lat == null || p.lng == null || !el) return
    miniMap = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false
    }).setView([p.lat, p.lng], 16)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(miniMap)
    miniMarker = L.circleMarker([p.lat, p.lng], {
      radius: 9,
      fillColor: '#0ea5e9',
      color: '#fff',
      weight: 2,
      fillOpacity: 1
    }).addTo(miniMap)
    requestAnimationFrame(() => miniMap?.invalidateSize())
  }
)


const positionOptions = computed(() => {
  const set = new Set(list.value.map((e) => e.position_in_company).filter(Boolean))
  return Array.from(set).sort((a, b) => a.localeCompare(b))
})

const totalPeople = computed(() => list.value.length)
const totalDepartments = computed(() => {
  const set = new Set(list.value.map((e) => e.company_branch).filter(Boolean))
  return set.size
})

const filteredList = computed(() => {
  let rows = list.value
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.position_in_company.toLowerCase().includes(q) ||
        e.company_branch.toLowerCase().includes(q) ||
        String(e.employee_no).includes(q)
    )
  }
  if (filterPosition.value !== 'all') {
    rows = rows.filter((e) => e.position_in_company === filterPosition.value)
  }
  if (filterStatus.value === 'active') {
    rows = rows.filter((e) => Boolean(e.id))
  }
  return rows
})

watchEffect(() => {
  const ids = filteredList.value.map((e) => e.id)
  const n = ids.filter((id) => selectedIds.value.includes(id)).length
  const el = headerCheckboxRef.value
  if (!el) return
  el.indeterminate = n > 0 && n < ids.length
  el.checked = ids.length > 0 && n === ids.length
})

async function loadEmployees() {
  loading.value = true
  error.value = null
  const { data, error: err } = await supabase
    .from('employee')
    .select('id, name, email, position_in_company, company_branch, employee_no, picture')
    .order('name')
  loading.value = false
  if (err) {
    error.value = err.message
    return
  }
  list.value = (data ?? []) as Emp[]
  const entries = await Promise.all(
    list.value.map(async (e) => [e.id, await getSignedProfileUrl(e.picture)] as const)
  )
  const map: Record<string, string | null> = {}
  for (const [id, url] of entries) map[id] = url
  avatarUrls.value = map
  await loadAttendanceSnapshot()
}

onMounted(() => {
  loadEmployees()
  attendanceRefreshTimer = setInterval(() => {
    loadAttendanceSnapshot()
  }, 45000)
})

onUnmounted(() => {
  if (attendanceRefreshTimer) clearInterval(attendanceRefreshTimer)
  if (leaveHoverTimer) clearTimeout(leaveHoverTimer)
  stopHoverTick()
  destroyMiniMap()
})

function toggleRow(id: string) {
  const i = selectedIds.value.indexOf(id)
  if (i === -1) selectedIds.value = [...selectedIds.value, id]
  else selectedIds.value = selectedIds.value.filter((x) => x !== id)
}

function toggleSelectAll() {
  const ids = filteredList.value.map((e) => e.id)
  const allOn = ids.length > 0 && ids.every((id) => selectedIds.value.includes(id))
  if (allOn) {
    selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id))
  } else {
    selectedIds.value = [...new Set([...selectedIds.value, ...ids])]
  }
}

function openEmployee(e: Emp) {
  cancelHoverLeave()
  hoveredEmp.value = null
  stopHoverTick()
  destroyMiniMap()
  selectedEmployee.value = e
}

watch(selectedEmployee, async (emp) => {
  profilePictureUrl.value = null
  attendanceHistory.value = []
  if (!emp) return
  modalLoading.value = true
  try {
    profilePictureUrl.value = await getSignedProfileUrl(emp.picture)
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 7)
    const startStr = start.toISOString().slice(0, 10)
    const endStr = end.toISOString().slice(0, 10)
    const { data } = await supabase
      .from('attendance')
      .select('clock_in, clock_out, total_time')
      .eq('user_id', emp.id)
      .gte('clock_in', `${startStr}T00:00:00.000Z`)
      .lte('clock_in', `${endStr}T23:59:59.999Z`)
      .order('clock_in', { ascending: false })
    attendanceHistory.value = (data ?? []) as AttendanceRecord[]
  } finally {
    modalLoading.value = false
  }
})

function closeModal() {
  selectedEmployee.value = null
}

function formatTotalTime(interval: string | null): string {
  if (!interval) return '—'
  const m = interval.match(/^(\d+):(\d+):(\d+)/)
  if (m) {
    const [, h, min] = m.map(Number)
    if (h) return `${h}h ${min}m`
    return `${min}m`
  }
  return interval
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(storedToRealInstant(iso))
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(storedToRealInstant(iso))
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}
</script>

<template>
  <div class="page">
    <p v-if="error" class="banner-error">{{ error }}</p>

    <template v-else-if="loading">
      <div class="loading-state">Loading…</div>
    </template>

    <template v-else>
      <!-- KPI header -->
      <section class="kpi-row" aria-label="Summary">
        <div class="kpi-card">
          <div class="kpi-value">{{ totalPeople }}</div>
          <div class="kpi-label">People</div>
        </div>
        <div class="kpi-divider" aria-hidden="true" />
        <div class="kpi-card">
          <div class="kpi-value">{{ totalDepartments }}</div>
          <div class="kpi-label">Departments</div>
        </div>
      </section>

      <!-- Search & filters -->
      <div class="controls">
        <div class="search-wrap">
          <MagnifyingGlassIcon class="search-icon" aria-hidden="true" />
          <input
            v-model="searchQuery"
            type="search"
            class="search-input"
            placeholder="Search"
            autocomplete="off"
            aria-label="Search employees"
          />
        </div>
        <div class="filters-row">
          <div class="select-wrap">
            <select v-model="filterStatus" class="filter-select" aria-label="Filter by status">
              <option value="all">All</option>
              <option value="active">Active</option>
            </select>
            <ChevronDownIcon class="select-chevron" aria-hidden="true" />
          </div>
          <div class="select-wrap">
            <select v-model="filterPosition" class="filter-select" aria-label="Filter by position">
              <option value="all">All positions</option>
              <option v-for="p in positionOptions" :key="p" :value="p">{{ p }}</option>
            </select>
            <ChevronDownIcon class="select-chevron" aria-hidden="true" />
          </div>
        </div>
      </div>

      <!-- Table -->
      <div class="table-card">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="th-check" scope="col">
                  <input
                    ref="headerCheckboxRef"
                    type="checkbox"
                    class="row-check"
                    aria-label="Select all visible"
                    @click.prevent="toggleSelectAll"
                  />
                </th>
                <th scope="col">User</th>
                <th scope="col">Status</th>
                <th scope="col">Email</th>
                <th scope="col">Position</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="e in filteredList"
                :key="e.id"
                class="data-row"
                :class="{ 'data-row-selected': selectedIds.includes(e.id) }"
                @mouseenter="onRowEnter(e, $event)"
                @mouseleave="onRowLeave"
                @click="openEmployee(e)"
              >
                <td class="td-check" @click.stop>
                  <input
                    type="checkbox"
                    class="row-check"
                    :checked="selectedIds.includes(e.id)"
                    :aria-label="`Select ${e.name}`"
                    @click.stop.prevent="toggleRow(e.id)"
                  />
                </td>
                <td class="td-user">
                  <div class="user-cell">
                    <div class="avatar">
                      <img
                        v-if="avatarUrls[e.id]"
                        :src="String(avatarUrls[e.id])"
                        alt=""
                        width="40"
                        height="40"
                      />
                      <span v-else class="avatar-placeholder">{{ (e.name || '?').slice(0, 1).toUpperCase() }}</span>
                    </div>
                    <span class="user-name">{{ e.name }}</span>
                  </div>
                </td>
                <td class="td-muted">
                  <span
                    class="status-pill"
                    :class="'status-pill--' + presenceForUserId(e.id).kind"
                  >{{ tableStatusLabel(e.id) }}</span>
                </td>
                <td class="td-muted">{{ e.email }}</td>
                <td class="td-muted">{{ e.position_in_company || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!filteredList.length" class="empty-hint">
          {{ list.length ? 'No matches for your filters.' : 'No employees yet.' }}
        </p>
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="hoveredEmp && hoverPresence"
        class="emp-hover-popover"
        :style="{ top: popPos.top + 'px', left: popPos.left + 'px' }"
        @mouseenter="cancelHoverLeave"
        @mouseleave="onRowLeave"
      >
        <p class="eh-name">{{ hoveredEmp.name }}</p>
        <p class="eh-status">{{ hoverPresence.title }}</p>
        <p v-if="hoverPresence.ticking" class="eh-timer" aria-live="polite">{{ liveElapsed }}</p>
        <p v-if="hoverPresence.ticking" class="eh-timer-label">
          {{ hoverPresence.tickKind === 'lunch' ? 'Lunch duration' : 'Time on shift' }}
        </p>
        <div
          v-if="hoverPresence.lat != null && hoverPresence.lng != null"
          ref="miniMapEl"
          class="eh-map"
          role="img"
          :aria-label="hoverPresence.mapCaption"
        />
        <div v-else class="eh-map eh-map-empty">{{ hoverPresence.mapCaption }}</div>
        <p v-if="hoverPresence.lat != null && hoverPresence.lng != null" class="eh-map-caption">
          {{ hoverPresence.mapCaption }}
        </p>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="selectedEmployee" class="modal-overlay" @click.self="closeModal">
        <div class="modal">
          <button type="button" class="modal-close" aria-label="Close" @click="closeModal">&times;</button>
          <div v-if="modalLoading" class="modal-loading">Loading…</div>
          <template v-else>
            <div class="profile-section">
              <div class="profile-avatar-wrap">
                <img v-if="profilePictureUrl" :src="profilePictureUrl" alt="" class="profile-avatar" />
                <span v-else class="profile-avatar placeholder">{{
                  (selectedEmployee.name || '?').slice(0, 1).toUpperCase()
                }}</span>
              </div>
              <h2 class="profile-name">{{ selectedEmployee.name }}</h2>
              <dl class="profile-details">
                <dt>Email</dt>
                <dd>{{ selectedEmployee.email }}</dd>
                <dt>Position</dt>
                <dd>{{ selectedEmployee.position_in_company || '—' }}</dd>
                <dt>Branch</dt>
                <dd>{{ selectedEmployee.company_branch || '—' }}</dd>
                <dt>Employee no.</dt>
                <dd>{{ selectedEmployee.employee_no ?? '—' }}</dd>
              </dl>
            </div>
            <div class="history-section">
              <h3>Last 7 days – Clock in/out</h3>
              <div class="history-table-wrap">
                <table class="history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Clock in</th>
                      <th>Clock out</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, i) in attendanceHistory" :key="i">
                      <td>{{ formatDate(r.clock_in) }}</td>
                      <td>{{ formatDateTime(r.clock_in) }}</td>
                      <td>{{ formatDateTime(r.clock_out) }}</td>
                      <td>{{ formatTotalTime(r.total_time) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="!attendanceHistory.length" class="muted">No attendance in the last 7 days.</p>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 100%;
}

.loading-state,
.banner-error {
  color: var(--text-secondary);
  font-size: 0.9375rem;
}
.banner-error {
  color: var(--error);
  margin: 0 0 1rem;
}

/* KPI */
.kpi-row {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin-bottom: 1.5rem;
  padding: 1.25rem 1.5rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 14px;
}
.kpi-card {
  flex: 1;
  text-align: center;
  min-width: 0;
}
.kpi-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.kpi-label {
  margin-top: 0.35rem;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  font-weight: 500;
}
.kpi-divider {
  width: 1px;
  background: var(--border-light);
  margin: 0.25rem 0;
  flex-shrink: 0;
}

/* Controls */
.controls {
  margin-bottom: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.search-wrap {
  position: relative;
  width: 100%;
}
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
.search-input::placeholder {
  color: var(--text-tertiary);
}
.search-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15);
}

.filters-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.select-wrap {
  position: relative;
  min-width: 140px;
}
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
.filter-select:focus {
  outline: none;
  border-color: var(--accent);
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

/* Table */
.table-card {
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.table-scroll {
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.data-table thead th {
  text-align: left;
  padding: 0.75rem 1rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}
.th-check {
  width: 48px;
  text-align: center;
  vertical-align: middle;
}
.data-row {
  cursor: pointer;
  transition: background 0.12s ease;
}
.data-row:hover {
  background: var(--bg-hover);
}
.data-row-selected {
  background: rgba(99, 102, 241, 0.12);
}
:root.light-mode .data-row-selected {
  background: rgba(99, 102, 241, 0.14);
}
.data-table tbody td {
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}
.data-table tbody tr:last-child td {
  border-bottom: none;
}
.td-check {
  width: 48px;
  text-align: center;
}
.row-check {
  width: 1.05rem;
  height: 1.05rem;
  accent-color: var(--accent-light);
  cursor: pointer;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
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
.td-muted {
  color: var(--text-secondary);
}
.status-pill {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-hover);
}
.status-pill--not_clocked_in {
  color: var(--text-tertiary);
  background: rgba(148, 163, 184, 0.15);
}
.status-pill--clocked_in {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.15);
}
.status-pill--on_lunch {
  color: #f97316;
  background: rgba(249, 115, 22, 0.15);
}
.status-pill--clocked_out {
  color: var(--accent);
  background: rgba(14, 165, 233, 0.15);
}

.emp-hover-popover {
  position: fixed;
  z-index: 950;
  width: 288px;
  padding: 0.875rem 1rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}
.eh-name {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}
.eh-status {
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.35;
}
.eh-timer {
  margin: 0 0 0.15rem;
  font-size: 1.125rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  letter-spacing: 0.02em;
}
.eh-timer-label {
  margin: 0 0 0.65rem;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}
.eh-map {
  height: 140px;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-light);
  margin-top: 0.25rem;
}
.eh-map :deep(.leaflet-container) {
  height: 140px;
  width: 100%;
  font-family: inherit;
  background: var(--bg-secondary);
}
.eh-map-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  text-align: center;
  padding: 0.5rem;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px dashed var(--border-light);
}
.eh-map-caption {
  margin: 0.35rem 0 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.empty-hint {
  margin: 0;
  padding: 1.25rem 1rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.875rem;
}

/* Modal */
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
.modal {
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
.modal-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.modal-loading {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
}
.profile-section {
  padding: 1.5rem 1.5rem 1rem;
  border-bottom: 1px solid var(--border-color);
  text-align: center;
}
.profile-avatar-wrap {
  margin-bottom: 0.75rem;
}
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
.profile-name {
  margin: 0 0 1rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}
.profile-details {
  text-align: left;
  max-width: 280px;
  margin: 0 auto;
  font-size: 0.875rem;
}
.profile-details dt {
  color: var(--text-secondary);
  margin-top: 0.5rem;
}
.profile-details dd {
  margin: 0.15rem 0 0;
  color: var(--text-primary);
}
.history-section {
  padding: 1rem 1.5rem 1.5rem;
}
.history-section h3 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}
.history-table-wrap {
  overflow-x: auto;
}
.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}
.history-table th,
.history-table td {
  padding: 0.4rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}
.history-table th {
  color: var(--text-secondary);
  font-weight: 500;
}
.muted {
  color: var(--text-secondary);
  font-size: 0.875rem;
}
</style>
