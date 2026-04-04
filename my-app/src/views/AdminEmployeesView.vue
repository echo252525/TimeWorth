<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MagnifyingGlassIcon, ChevronDownIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/vue/24/outline'
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
  'attendance_id,user_id,clock_in,clock_out,facial_status,lunch_break_start,lunch_break_end,total_time,location_in,location_out,branch_location,work_modality,facial_verifications_id,created_at,updated_at'

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
  employee_no: string | number
  phone_number: string | null
  picture: string | null
  account_status: 'pending' | 'approved' | 'rejected' | null
}

interface PositionRow {
  position_id: string
  title: string
}
interface AttendanceRecord {
  clock_in: string | null
  clock_out: string | null
  total_time: string | null
}

const list = ref<Emp[]>([])
const positionRows = ref<PositionRow[]>([])
const avatarUrls = ref<Record<string, string | null>>({})
const loading = ref(true)
const error = ref<string | null>(null)

const searchQuery = ref('')
const filterStatus = ref<'all' | 'active' | 'not_active'>('all')
/** Select value: `position_in_company` contains "admin" (case-insensitive). */
const FILTER_POSITION_ADMIN = '__filter_admin__'
const filterPosition = ref<string>('all')
const filterModality = ref<'all' | 'office' | 'wfh'>('all')

/* Table header filters (same UX as TimesheetView: chevron + teleported menu) */
const showModalityFilterDropdown = ref(false)
const showStatusFilterDropdown = ref(false)
const showPositionFilterDropdown = ref(false)
const modalityFilterTriggerRef = ref<HTMLElement | null>(null)
const statusFilterTriggerRef = ref<HTMLElement | null>(null)
const positionFilterTriggerRef = ref<HTMLElement | null>(null)
const modalityDropdownStyle = ref<Record<string, string>>({})
const statusDropdownStyle = ref<Record<string, string>>({})
const positionDropdownStyle = ref<Record<string, string>>({})

const modalityFilterLabel = computed(() => {
  switch (filterModality.value) {
    case 'all':
      return 'All'
    case 'office':
      return 'Office'
    case 'wfh':
      return 'WFH'
    default:
      return 'All'
  }
})

const statusFilterLabel = computed(() => {
  switch (filterStatus.value) {
    case 'all':
      return 'All'
    case 'active':
      return 'Active'
    case 'not_active':
      return 'Not active'
    default:
      return 'All'
  }
})

const positionFilterLabel = computed(() => {
  if (filterPosition.value === 'all') return 'All'
  if (filterPosition.value === FILTER_POSITION_ADMIN) return 'Admin'
  return filterPosition.value
})

function positionModalityDropdown() {
  const el = modalityFilterTriggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const minW = Math.max(r.width, 140)
  const left = Math.min(Math.max(8, r.left), window.innerWidth - minW - 8)
  modalityDropdownStyle.value = {
    position: 'fixed',
    top: `${r.bottom + 6}px`,
    left: `${left}px`,
    minWidth: `${minW}px`,
    zIndex: '300'
  }
}

function positionStatusDropdown() {
  const el = statusFilterTriggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const minW = Math.max(r.width, 150)
  const left = Math.min(Math.max(8, r.left), window.innerWidth - minW - 8)
  statusDropdownStyle.value = {
    position: 'fixed',
    top: `${r.bottom + 6}px`,
    left: `${left}px`,
    minWidth: `${minW}px`,
    zIndex: '300'
  }
}

function positionPositionDropdown() {
  const el = positionFilterTriggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const minW = Math.max(r.width, 180)
  const left = Math.min(Math.max(8, r.left), window.innerWidth - minW - 8)
  positionDropdownStyle.value = {
    position: 'fixed',
    top: `${r.bottom + 6}px`,
    left: `${left}px`,
    minWidth: `${minW}px`,
    zIndex: '300'
  }
}

function repositionOpenEmpFilterDropdowns() {
  if (showModalityFilterDropdown.value) positionModalityDropdown()
  if (showStatusFilterDropdown.value) positionStatusDropdown()
  if (showPositionFilterDropdown.value) positionPositionDropdown()
}

function closeAllEmpFilterDropdowns() {
  showModalityFilterDropdown.value = false
  showStatusFilterDropdown.value = false
  showPositionFilterDropdown.value = false
}

function toggleModalityFilterMenu() {
  const opening = !showModalityFilterDropdown.value
  showStatusFilterDropdown.value = false
  showPositionFilterDropdown.value = false
  showModalityFilterDropdown.value = opening
  if (opening) void nextTick(() => positionModalityDropdown())
}

function toggleStatusFilterMenu() {
  const opening = !showStatusFilterDropdown.value
  showModalityFilterDropdown.value = false
  showPositionFilterDropdown.value = false
  showStatusFilterDropdown.value = opening
  if (opening) void nextTick(() => positionStatusDropdown())
}

function togglePositionFilterMenu() {
  const opening = !showPositionFilterDropdown.value
  showModalityFilterDropdown.value = false
  showStatusFilterDropdown.value = false
  showPositionFilterDropdown.value = opening
  if (opening) void nextTick(() => positionPositionDropdown())
}

function selectModalityFilter(v: 'all' | 'office' | 'wfh') {
  showModalityFilterDropdown.value = false
  filterModality.value = v
}

function selectStatusFilter(v: 'all' | 'active' | 'not_active') {
  showStatusFilterDropdown.value = false
  filterStatus.value = v
}

function selectPositionFilter(v: string) {
  showPositionFilterDropdown.value = false
  filterPosition.value = v
}

function handleEmpFilterClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('.ts-filter-trigger-wrap') || target.closest('.ts-filter-dropdown-portal')) return
  closeAllEmpFilterDropdowns()
}

const anyEmpFilterMenuOpen = computed(
  () =>
    showModalityFilterDropdown.value ||
    showStatusFilterDropdown.value ||
    showPositionFilterDropdown.value
)

const selectedEmployee = ref<Emp | null>(null)
const profilePictureUrl = ref<string | null>(null)
const attendanceHistory = ref<AttendanceRecord[]>([])
const modalLoading = ref(false)
const statusUpdatingByUser = ref<Record<string, boolean>>({})

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
let hoverTickTimer: ReturnType<typeof setInterval> | null = null
let attendanceRefreshTimer: ReturnType<typeof setInterval> | null = null
let leaveHoverTimer: ReturnType<typeof setTimeout> | null = null

function parseIntervalToSeconds(interval: string | null | undefined): number {
  if (!interval) return 0
  const m = interval.match(/^(\d+):(\d+):(\d+)/)
  if (m) {
    const [, h, min, sec] = m.map(Number)
    return (h || 0) * 3600 + (min || 0) * 60 + (sec || 0)
  }
  return 0
}

/** Display total seconds as e.g. "142h 35m" for KPI. */
function formatSecondsAsHoursCompact(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h === 0 && m === 0) return '0h'
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

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

/** Clocked in or on lunch today (open attendance row). */
function isEmployeeActiveToday(userId: string): boolean {
  const p = presenceForUserId(userId)
  return p.kind === 'clocked_in' || p.kind === 'on_lunch'
}

function normalizePositionLabel(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function employeePositionContainsAdmin(e: Emp): boolean {
  return normalizePositionLabel(e.position_in_company).includes('admin')
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

function currentWorkModalityLabel(userId: string): string {
  const p = presenceForUserId(userId)
  if (p.kind !== 'clocked_in' && p.kind !== 'on_lunch') return '—'
  const m = p.activeRecord?.work_modality
  if (!m) return '—'
  const s = String(m).trim().toLowerCase()
  if (!s) return '—'
  // Match app labels: office / wfh
  return s === 'wfh' ? 'WFH' : s.charAt(0).toUpperCase() + s.slice(1)
}

function currentWorkModalityKey(userId: string): 'office' | 'wfh' | null {
  const p = presenceForUserId(userId)
  if (p.kind !== 'clocked_in' && p.kind !== 'on_lunch') return null
  const m = p.activeRecord?.work_modality
  if (!m) return null
  const s = String(m).trim().toLowerCase()
  if (s === 'office' || s === 'wfh') return s
  return null
}

function isPendingAccount(e: Emp): boolean {
  return e.account_status === 'pending'
}

async function updateAccountStatus(e: Emp, nextStatus: 'approved' | 'rejected') {
  if (!isPendingAccount(e)) return
  statusUpdatingByUser.value[e.id] = true
  const { error: err } = await supabase
    .from('employee')
    .update({ account_status: nextStatus })
    .eq('id', e.id)
  statusUpdatingByUser.value[e.id] = false
  if (err) {
    error.value = err.message
    return
  }
  list.value = list.value.map((item) =>
    item.id === e.id ? { ...item, account_status: nextStatus } : item
  )
  if (selectedEmployee.value?.id === e.id) {
    selectedEmployee.value = { ...selectedEmployee.value, account_status: nextStatus }
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

  const openByUser: Record<string, AttendanceRow | null> = {}
  for (const id of ids) openByUser[id] = null
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
  const lastMap: Record<string, AttendanceRow | null> = {}
  for (const id of ids) lastMap[id] = null
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
    L.circleMarker([p.lat, p.lng], {
      radius: 9,
      fillColor: '#0ea5e9',
      color: '#fff',
      weight: 2,
      fillOpacity: 1
    }).addTo(miniMap)
    requestAnimationFrame(() => miniMap?.invalidateSize())
  }
)


const topHoursThisMonth = ref<{ name: string; seconds: number } | null>(null)
const bottomHoursThisMonth = ref<{ name: string; seconds: number } | null>(null)
const monthHoursLoading = ref(false)

const currentMonthLabelShort = computed(() =>
  new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
)

const topHoursValueDisplay = computed(() => {
  if (monthHoursLoading.value) return '…'
  const t = topHoursThisMonth.value
  if (!t || t.seconds <= 0) return '—'
  return formatSecondsAsHoursCompact(t.seconds)
})

const bottomHoursValueDisplay = computed(() => {
  if (monthHoursLoading.value) return '…'
  const b = bottomHoursThisMonth.value
  if (!b) return '—'
  return formatSecondsAsHoursCompact(b.seconds)
})

const showLeastHoursThisMonth = computed(
  () => !monthHoursLoading.value && !!topHoursThisMonth.value && !!bottomHoursThisMonth.value
)

const mostHoursKpiCardTitle = computed(() => {
  if (monthHoursLoading.value) return undefined
  const t = topHoursThisMonth.value
  if (!t || t.seconds <= 0) return undefined
  return `${t.name}: ${formatSecondsAsHoursCompact(t.seconds)} logged this month (most)`
})

const leastHoursKpiCardTitle = computed(() => {
  if (monthHoursLoading.value) return undefined
  const b = bottomHoursThisMonth.value
  if (!b) return undefined
  return `${b.name}: ${formatSecondsAsHoursCompact(b.seconds)} logged this month (least)`
})

async function loadMonthHoursLeader() {
  const ids = list.value.map((e) => e.id)
  if (!ids.length) {
    topHoursThisMonth.value = null
    bottomHoursThisMonth.value = null
    return
  }
  monthHoursLoading.value = true
  try {
    const now = new Date()
    const y = now.getFullYear()
    const mo = now.getMonth()
    const monthStart = new Date(y, mo, 1)
    const monthEnd = new Date(y, mo + 1, 0)
    const startDay = getLocalDateString(monthStart)
    const endDay = getLocalDateString(monthEnd)
    const start = `${startDay}T00:00:00.000Z`
    const end = `${endDay}T23:59:59.999Z`

    const { data, error: qErr } = await supabase
      .from('attendance')
      .select('user_id,total_time')
      .in('user_id', ids)
      .gte('clock_in', start)
      .lte('clock_in', end)

    if (qErr) {
      console.warn('[AdminEmployees] month hours leader', qErr.message)
      topHoursThisMonth.value = null
      bottomHoursThisMonth.value = null
      return
    }

    const byUser: Record<string, number> = {}
    for (const id of ids) byUser[id] = 0
    for (const row of data ?? []) {
      const uid = (row as { user_id: string }).user_id
      const tt = (row as { total_time: string | null }).total_time
      byUser[uid] = (byUser[uid] ?? 0) + parseIntervalToSeconds(tt)
    }

    let bestId: string | null = null
    let bestSec = 0
    let worstId: string | null = null
    let worstSec = Infinity
    for (const id of ids) {
      const t = byUser[id] ?? 0
      if (t > bestSec) {
        bestSec = t
        bestId = id
      }
      if (t < worstSec) {
        worstSec = t
        worstId = id
      }
    }

    if (!bestId || bestSec <= 0) {
      topHoursThisMonth.value = null
      bottomHoursThisMonth.value = null
      return
    }

    const emp = list.value.find((e) => e.id === bestId)
    topHoursThisMonth.value = {
      name: emp?.name?.trim() || 'Employee',
      seconds: bestSec
    }

    if (ids.length < 2 || !worstId || worstId === bestId) {
      bottomHoursThisMonth.value = null
    } else {
      const empLo = list.value.find((e) => e.id === worstId)
      bottomHoursThisMonth.value = {
        name: empLo?.name?.trim() || 'Employee',
        seconds: worstSec
      }
    }
  } finally {
    monthHoursLoading.value = false
  }
}

const totalPeople = computed(() => list.value.length)
const totalDepartments = computed(() => {
  if (positionRows.value.length) return positionRows.value.length
  const set = new Set(list.value.map((e) => e.position_in_company).filter(Boolean))
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
        String(e.employee_no).toLowerCase().includes(q) ||
        (e.phone_number && e.phone_number.toLowerCase().includes(q))
    )
  }
  if (filterPosition.value === FILTER_POSITION_ADMIN) {
    rows = rows.filter((e) => employeePositionContainsAdmin(e))
  } else if (filterPosition.value !== 'all') {
    const want = normalizePositionLabel(filterPosition.value)
    rows = rows.filter((e) => normalizePositionLabel(e.position_in_company) === want)
  }
  if (filterStatus.value === 'active') {
    rows = rows.filter((e) => isEmployeeActiveToday(e.id))
  } else if (filterStatus.value === 'not_active') {
    rows = rows.filter((e) => !isEmployeeActiveToday(e.id))
  }
  if (filterModality.value !== 'all') {
    const want = filterModality.value
    rows = rows.filter((e) => currentWorkModalityKey(e.id) === want)
  }
  return rows
})

watch(
  () => positionRows.value.map((p) => p.title),
  (titles) => {
    if (filterPosition.value === 'all' || filterPosition.value === FILTER_POSITION_ADMIN) {
      return
    }
    const want = normalizePositionLabel(filterPosition.value)
    const stillValid = titles.some((t) => normalizePositionLabel(t) === want)
    if (!stillValid) {
      filterPosition.value = 'all'
    }
  }
)

watch(anyEmpFilterMenuOpen, (open) => {
  if (open) {
    void nextTick(() => repositionOpenEmpFilterDropdowns())
    window.addEventListener('scroll', repositionOpenEmpFilterDropdowns, true)
    window.addEventListener('resize', repositionOpenEmpFilterDropdowns)
  } else {
    window.removeEventListener('scroll', repositionOpenEmpFilterDropdowns, true)
    window.removeEventListener('resize', repositionOpenEmpFilterDropdowns)
  }
})

async function loadPositions() {
  const { data, error: err } = await supabase
    .from('position')
    .select('position_id, title')
    .order('title', { ascending: true })
  if (err) return
  positionRows.value = (data ?? []) as PositionRow[]
}

async function loadEmployees() {
  loading.value = true
  error.value = null
  const { data, error: err } = await supabase
    .from('employee')
    .select('id, name, email, position_in_company, employee_no, phone_number, picture, account_status')
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
  await loadMonthHoursLeader()
}

onMounted(() => {
  void loadPositions()
  loadEmployees()
  attendanceRefreshTimer = setInterval(() => {
    void loadAttendanceSnapshot()
    void loadMonthHoursLeader()
  }, 45000)
  document.addEventListener('click', handleEmpFilterClickOutside)
})

onUnmounted(() => {
  if (attendanceRefreshTimer) clearInterval(attendanceRefreshTimer)
  if (leaveHoverTimer) clearTimeout(leaveHoverTimer)
  stopHoverTick()
  destroyMiniMap()
  document.removeEventListener('click', handleEmpFilterClickOutside)
  window.removeEventListener('scroll', repositionOpenEmpFilterDropdowns, true)
  window.removeEventListener('resize', repositionOpenEmpFilterDropdowns)
})

function openEmployee(e: Emp) {
  console.log('[AdminEmployees] openEmployee called', {
    id: e.id,
    name: e.name,
    account_status: e.account_status
  })
  cancelHoverLeave()
  hoveredEmp.value = null
  stopHoverTick()
  destroyMiniMap()
  selectedEmployee.value = e
  console.log('[AdminEmployees] selectedEmployee set', {
    selectedId: selectedEmployee.value?.id ?? null
  })
}

function onEmployeeRowClick(e: Emp, ev: MouseEvent) {
  const target = ev.target as HTMLElement | null
  const clickedStatusBtn = !!target?.closest('.account-status-btn')
  console.log('[AdminEmployees] row click', {
    employeeId: e.id,
    targetTag: target?.tagName ?? null,
    clickedStatusBtn
  })
  if (clickedStatusBtn) {
    console.log('[AdminEmployees] row click ignored because account-status button was clicked')
    return
  }
  openEmployee(e)
}

watch(selectedEmployee, async (emp) => {
  console.log('[AdminEmployees] selectedEmployee watcher fired', {
    selectedId: emp?.id ?? null
  })
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
    console.log('[AdminEmployees] modal data loaded', {
      selectedId: emp.id,
      historyCount: attendanceHistory.value.length,
      hasProfilePicture: !!profilePictureUrl.value
    })
  } finally {
    modalLoading.value = false
    console.log('[AdminEmployees] modal loading finished', {
      selectedId: emp.id
    })
  }
})

function closeModal() {
  console.log('[AdminEmployees] closeModal called', {
    selectedBeforeClose: selectedEmployee.value?.id ?? null
  })
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
        <div class="kpi-card kpi-card-people">
          <div class="kpi-icon-wrap" aria-hidden="true">
            <span class="material-symbols-outlined kpi-icon">person</span>
          </div>
          <div class="kpi-value">{{ totalPeople }}</div>
          <div class="kpi-label">Employees</div>
        </div>
        <div class="kpi-card kpi-card-positions">
          <div class="kpi-icon-wrap" aria-hidden="true">
            <span class="material-symbols-outlined kpi-icon">work</span>
          </div>
          <div class="kpi-value">{{ totalDepartments }}</div>
          <div class="kpi-label">Positions</div>
        </div>
        <div class="kpi-card kpi-card-hours" :title="mostHoursKpiCardTitle">
          <div class="kpi-icon-wrap" aria-hidden="true">
            <span class="material-symbols-outlined kpi-icon">schedule</span>
          </div>
          <div class="kpi-value">{{ topHoursValueDisplay }}</div>
          <div class="kpi-label">Most hours ({{ currentMonthLabelShort }})</div>
          <div v-if="topHoursThisMonth" class="kpi-sub">{{ topHoursThisMonth.name }}</div>
        </div>
        <div
          v-if="showLeastHoursThisMonth"
          class="kpi-card kpi-card-hours-least"
          :title="leastHoursKpiCardTitle"
        >
          <div class="kpi-icon-wrap" aria-hidden="true">
            <span class="material-symbols-outlined kpi-icon">timer</span>
          </div>
          <div class="kpi-value">{{ bottomHoursValueDisplay }}</div>
          <div class="kpi-label">Least hours ({{ currentMonthLabelShort }})</div>
          <div class="kpi-sub">{{ bottomHoursThisMonth?.name }}</div>
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
      </div>

      <!-- Table -->
      <div class="table-card">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Employee ID</th>
                <th class="th-modality" scope="col" @click.stop>
                  <div class="th-modality-wrap">
                    <span>Modality</span>
                    <div ref="modalityFilterTriggerRef" class="ts-filter-trigger-wrap">
                      <button
                        type="button"
                        class="period-btn ts-filter-period-btn"
                        aria-haspopup="listbox"
                        :aria-expanded="showModalityFilterDropdown"
                        :aria-label="`Modality filter, ${modalityFilterLabel}`"
                        @click.stop="toggleModalityFilterMenu"
                      >
                        <ChevronDownIcon class="ts-period-chevron" aria-hidden="true" />
                      </button>
                      <Teleport to="body">
                        <div
                          v-if="showModalityFilterDropdown"
                          class="ts-filter-dropdown-portal period-dropdown"
                          :style="modalityDropdownStyle"
                          role="listbox"
                          @click.stop
                        >
                          <button
                            type="button"
                            class="period-option"
                            :class="{ active: filterModality === 'all' }"
                            role="option"
                            :aria-selected="filterModality === 'all'"
                            @click="selectModalityFilter('all')"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            class="period-option"
                            :class="{ active: filterModality === 'office' }"
                            role="option"
                            :aria-selected="filterModality === 'office'"
                            @click="selectModalityFilter('office')"
                          >
                            Office
                          </button>
                          <button
                            type="button"
                            class="period-option"
                            :class="{ active: filterModality === 'wfh' }"
                            role="option"
                            :aria-selected="filterModality === 'wfh'"
                            @click="selectModalityFilter('wfh')"
                          >
                            WFH
                          </button>
                        </div>
                      </Teleport>
                    </div>
                  </div>
                </th>
                <th class="th-status" scope="col" @click.stop>
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
                          :style="statusDropdownStyle"
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
                            :class="{ active: filterStatus === 'active' }"
                            role="option"
                            :aria-selected="filterStatus === 'active'"
                            @click="selectStatusFilter('active')"
                          >
                            Active
                          </button>
                          <button
                            type="button"
                            class="period-option"
                            :class="{ active: filterStatus === 'not_active' }"
                            role="option"
                            :aria-selected="filterStatus === 'not_active'"
                            @click="selectStatusFilter('not_active')"
                          >
                            Not active
                          </button>
                        </div>
                      </Teleport>
                    </div>
                  </div>
                </th>
                <th scope="col">Email</th>
                <th class="th-position" scope="col" @click.stop>
                  <div class="th-position-wrap">
                    <span>Position</span>
                    <div ref="positionFilterTriggerRef" class="ts-filter-trigger-wrap">
                      <button
                        type="button"
                        class="period-btn ts-filter-period-btn"
                        aria-haspopup="listbox"
                        :aria-expanded="showPositionFilterDropdown"
                        :aria-label="`Position filter, ${positionFilterLabel}`"
                        @click.stop="togglePositionFilterMenu"
                      >
                        <ChevronDownIcon class="ts-period-chevron" aria-hidden="true" />
                      </button>
                      <Teleport to="body">
                        <div
                          v-if="showPositionFilterDropdown"
                          class="ts-filter-dropdown-portal period-dropdown"
                          :style="positionDropdownStyle"
                          role="listbox"
                          @click.stop
                        >
                          <button
                            type="button"
                            class="period-option"
                            :class="{ active: filterPosition === 'all' }"
                            role="option"
                            :aria-selected="filterPosition === 'all'"
                            @click="selectPositionFilter('all')"
                          >
                            All
                          </button>
                          <button
                            v-for="p in positionRows"
                            :key="p.position_id"
                            type="button"
                            class="period-option"
                            :class="{ active: filterPosition === p.title }"
                            role="option"
                            :aria-selected="filterPosition === p.title"
                            @click="selectPositionFilter(p.title)"
                          >
                            {{ p.title }}
                          </button>
                          <button
                            type="button"
                            class="period-option"
                            :class="{ active: filterPosition === FILTER_POSITION_ADMIN }"
                            role="option"
                            :aria-selected="filterPosition === FILTER_POSITION_ADMIN"
                            @click="selectPositionFilter(FILTER_POSITION_ADMIN)"
                          >
                            Admin
                          </button>
                        </div>
                      </Teleport>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="e in filteredList"
                :key="e.id"
                class="data-row"
                @mouseenter="onRowEnter(e, $event)"
                @mouseleave="onRowLeave"
                @click="onEmployeeRowClick(e, $event)"
              >
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
                <td class="td-muted">{{ e.employee_no ?? '—' }}</td>
                <td class="td-muted">{{ currentWorkModalityLabel(e.id) }}</td>
                <td class="td-muted td-status">
                  <div class="status-cell-wrap">
                    <span
                      class="status-pill"
                      :class="'status-pill--' + presenceForUserId(e.id).kind"
                    >{{ tableStatusLabel(e.id) }}</span>
                  </div>
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
      <div
        v-if="selectedEmployee"
        class="modal-overlay"
        style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:1rem;z-index:2147483647;background:rgba(0,0,0,.45);"
        @click.self="closeModal"
      >
        <div class="employee-modal-panel" style="display:block;position:relative;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;">
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
                <dt>Phone</dt>
                <dd>{{ selectedEmployee.phone_number || '—' }}</dd>
                <dt>Employee no.</dt>
                <dd>{{ selectedEmployee.employee_no ?? '—' }}</dd>
              </dl>
              <div v-if="isPendingAccount(selectedEmployee)" class="modal-account-actions">
                <button
                  type="button"
                  class="account-status-btn approve modal-account-btn"
                  :disabled="statusUpdatingByUser[selectedEmployee.id]"
                  @click="updateAccountStatus(selectedEmployee, 'approved')"
                >
                  <CheckCircleIcon class="account-status-icon" />
                  <span>Approve</span>
                </button>
                <button
                  type="button"
                  class="account-status-btn reject modal-account-btn"
                  :disabled="statusUpdatingByUser[selectedEmployee.id]"
                  @click="updateAccountStatus(selectedEmployee, 'rejected')"
                >
                  <XCircleIcon class="account-status-icon" />
                  <span>Reject</span>
                </button>
              </div>
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

/* KPI — 2×2 on narrow viewports; fluid row on wider screens */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
@media (min-width: 900px) {
  .kpi-row {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
  }
}
.kpi-card {
  min-width: 0;
  text-align: left;
  padding: 1.25rem 1.375rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
body.dark-mode .kpi-card {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
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
.kpi-card-people .kpi-icon-wrap {
  background: rgba(34, 197, 94, 0.18);
}
.kpi-card-positions .kpi-icon-wrap {
  background: rgba(147, 51, 234, 0.16);
}
.kpi-card-hours .kpi-icon-wrap {
  background: rgba(249, 115, 22, 0.2);
}
body.light-mode .kpi-card-people .kpi-icon-wrap {
  background: rgba(34, 197, 94, 0.14);
}
body.light-mode .kpi-card-positions .kpi-icon-wrap {
  background: rgba(147, 51, 234, 0.12);
}
body.light-mode .kpi-card-hours .kpi-icon-wrap {
  background: rgba(249, 115, 22, 0.14);
}
.kpi-card-hours-least .kpi-icon-wrap {
  background: rgba(14, 165, 233, 0.18);
}
body.light-mode .kpi-card-hours-least .kpi-icon-wrap {
  background: rgba(14, 165, 233, 0.12);
}
.kpi-icon {
  font-size: 1.375rem;
  font-variation-settings: 'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24;
  line-height: 1;
}
.kpi-card-people .kpi-icon {
  color: #4ade80;
}
.kpi-card-positions .kpi-icon {
  color: #c084fc;
}
.kpi-card-hours .kpi-icon {
  color: #fb923c;
}
body.light-mode .kpi-card-people .kpi-icon {
  color: #15803d;
}
body.light-mode .kpi-card-positions .kpi-icon {
  color: #7c3aed;
}
body.light-mode .kpi-card-hours .kpi-icon {
  color: #c2410c;
}
.kpi-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.kpi-label {
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  font-weight: 500;
  letter-spacing: 0.01em;
}
.kpi-sub {
  margin-top: 0.35rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-weight: 600;
  line-height: 1.35;
  word-break: break-word;
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
.th-status {
  width: 1%;
  min-width: 9rem;
  white-space: nowrap;
}
.th-status-wrap {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.4rem;
  min-width: 0;
}
.th-modality {
  width: 1%;
  min-width: 0;
}
.th-modality-wrap {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.4rem;
  min-width: 0;
}
.th-position {
  width: 1%;
  min-width: 0;
}
.th-position-wrap {
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
.data-row {
  cursor: pointer;
  transition: background 0.12s ease;
}
.data-row:hover {
  background: var(--bg-hover);
}
.data-table tbody td {
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}
.data-table tbody tr:last-child td {
  border-bottom: none;
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
.td-status {
  width: 1%;
  min-width: 9rem;
  white-space: nowrap;
  vertical-align: middle;
}
.status-cell-wrap {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.account-status-btn {
  width: 1.45rem;
  height: 1.45rem;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.account-status-btn.approve {
  color: #22c55e;
}
.account-status-btn.reject {
  color: #ef4444;
}
.account-status-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.account-status-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}
.account-status-icon {
  width: 1rem;
  height: 1rem;
}
.modal-account-actions {
  margin-top: 1rem;
  display: flex;
  justify-content: center;
  gap: 0.6rem;
}
.modal-account-btn {
  width: auto;
  height: auto;
  border: 1px solid var(--border-light);
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  gap: 0.35rem;
}
.status-pill {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-hover);
  white-space: nowrap;
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
  pointer-events: none;
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
.employee-modal-panel {
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
