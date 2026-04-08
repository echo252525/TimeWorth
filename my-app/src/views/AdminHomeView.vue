<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAdminAuth } from '../composables/useAdminAuth'
import { getSignedProfileUrl } from '../composables/useAuth'
import {
  parseLocation,
  type AttendanceRow
} from '../composables/useAttendance'
import supabase from '../lib/supabaseClient'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'

const { adminProfile } = useAdminAuth()

// Dashboard KPIs (today)
const kpiLoading = ref(true)
const kpiTotalPresent = ref(0)
const kpiTotalAbsent = ref(0)
const kpiTotalWorkingHours = ref(0)
const kpiOnLunch = ref(0)

async function fetchKpis() {
  kpiLoading.value = true
  const today = todayStr()
  const start = `${today}T00:00:00.000Z`
  const end = `${today}T23:59:59.999Z`
  const [empRes, attRes] = await Promise.all([
    supabase.from('employee').select('id'),
    supabase.from('attendance').select('user_id, clock_out, total_time, lunch_break_start, lunch_break_end')
      .gte('clock_in', start)
      .lte('clock_in', end)
  ])
  const totalEmployees = Array.isArray(empRes.data) ? empRes.data.length : 0
  const rows = (attRes.data ?? []) as { user_id: string; clock_out: string | null; total_time: string | null; lunch_break_start: string | null; lunch_break_end: string | null }[]
  const clockedInNow = rows.filter(r => !r.clock_out).length
  const usersWithAttendanceToday = new Set(rows.map(r => r.user_id)).size
  const absent = Math.max(0, totalEmployees - usersWithAttendanceToday)
  let totalSeconds = 0
  for (const r of rows) {
    totalSeconds += parseIntervalToSeconds(r.total_time)
  }
  const onLunch = rows.filter(r => !r.clock_out && r.lunch_break_start && !r.lunch_break_end).length
  kpiTotalPresent.value = clockedInNow
  kpiTotalAbsent.value = absent
  kpiTotalWorkingHours.value = Math.round((totalSeconds / 3600) * 100) / 100
  kpiOnLunch.value = onLunch
  kpiLoading.value = false
}

function formatKpiHours(h: number): string {
  if (h < 0.01) return '0.00'
  return h.toFixed(2)
}

// Map hero – default date is today; status-based pins when viewing a date
const mapContainer = ref<HTMLElement | null>(null)
let map: L.Map | null = null
const todayStr = () => new Date().toISOString().slice(0, 10)
const mapDate = ref(todayStr())
interface MapRecord extends AttendanceRow {
  employee_name: string
  employee_picture: string | null
  employee_picture_url: string | null
}
const mapRecords = ref<MapRecord[]>([])
const lastClockOutByUser = ref<Record<string, MapRecord>>({})
const allEmployeeIds = ref<string[]>([])
const mapLoading = ref(false)
const mapError = ref<string | null>(null)
const addressCache = ref<Record<string, string>>({})
const MARKER_SIZE = 44
const tick = ref(0)
let tickInterval: ReturnType<typeof setInterval> | null = null

/** Employee detail (single marker or from cluster picker). */
const mapDetailPin = ref<MapPin | null>(null)
const mapDetailAddress = ref<string | null>(null)
const mapDetailAddressLoading = ref(false)
/** Cluster picker when zoom is max but icons still overlap. */
const mapClusterPickerPins = ref<MapPin[] | null>(null)

/** Screen-space distance (px) between marker centers: merge as soon as icons touch/overlap a little (≈ one avatar width). */
const CLUSTER_MERGE_PX = MARKER_SIZE
const CLUSTER_MARKER_W = 120
const CLUSTER_MARKER_H = 56
let mapZoomMoveHandler: (() => void) | null = null

// Filters
const filterLocationType = ref<'clock_in' | 'clock_out' | 'both'>('both')
const filterModality = ref<'all' | 'office' | 'wfh'>('all')

/** Map toolbar filters: chevron + teleported menu (Timesheet / Admin employees parity) */
const showLocationTypeDropdown = ref(false)
const showMapModalityDropdown = ref(false)
const locationTypeFilterTriggerRef = ref<HTMLElement | null>(null)
const mapModalityFilterTriggerRef = ref<HTMLElement | null>(null)
const locationTypeDropdownStyle = ref<Record<string, string>>({})
const mapModalityDropdownStyle = ref<Record<string, string>>({})

const locationTypeFilterLabel = computed(() => {
  switch (filterLocationType.value) {
    case 'both':
      return 'All Records'
    case 'clock_in':
      return 'Clocked In'
    case 'clock_out':
      return 'Clocked Out'
    default:
      return 'All Records'
  }
})

const mapModalityFilterLabel = computed(() => {
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

function positionLocationTypeDropdown() {
  const el = locationTypeFilterTriggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const minW = Math.max(r.width, 168)
  const left = Math.min(Math.max(8, r.left), window.innerWidth - minW - 8)
  locationTypeDropdownStyle.value = {
    position: 'fixed',
    top: `${r.bottom + 6}px`,
    left: `${left}px`,
    minWidth: `${minW}px`,
    zIndex: '300'
  }
}

function positionMapModalityDropdown() {
  const el = mapModalityFilterTriggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const minW = Math.max(r.width, 140)
  const left = Math.min(Math.max(8, r.left), window.innerWidth - minW - 8)
  mapModalityDropdownStyle.value = {
    position: 'fixed',
    top: `${r.bottom + 6}px`,
    left: `${left}px`,
    minWidth: `${minW}px`,
    zIndex: '300'
  }
}

function toggleLocationTypeFilterMenu() {
  const opening = !showLocationTypeDropdown.value
  showMapModalityDropdown.value = false
  showLocationTypeDropdown.value = opening
  if (opening) void nextTick(() => positionLocationTypeDropdown())
}

function toggleMapModalityFilterMenu() {
  const opening = !showMapModalityDropdown.value
  showLocationTypeDropdown.value = false
  showMapModalityDropdown.value = opening
  if (opening) void nextTick(() => positionMapModalityDropdown())
}

function selectLocationTypeFilter(v: 'clock_in' | 'clock_out' | 'both') {
  showLocationTypeDropdown.value = false
  filterLocationType.value = v
}

function selectMapModalityFilter(v: 'all' | 'office' | 'wfh') {
  showMapModalityDropdown.value = false
  filterModality.value = v
}

function handleMapFilterClickOutside(event: MouseEvent) {
  if (!showLocationTypeDropdown.value && !showMapModalityDropdown.value) return
  const target = event.target as HTMLElement
  if (target.closest('.ts-filter-trigger-wrap') || target.closest('.ts-filter-dropdown-portal')) return
  showLocationTypeDropdown.value = false
  showMapModalityDropdown.value = false
}

watch(showLocationTypeDropdown, (open) => {
  if (open) {
    void nextTick(() => positionLocationTypeDropdown())
    window.addEventListener('scroll', positionLocationTypeDropdown, true)
    window.addEventListener('resize', positionLocationTypeDropdown)
  } else {
    window.removeEventListener('scroll', positionLocationTypeDropdown, true)
    window.removeEventListener('resize', positionLocationTypeDropdown)
  }
})

watch(showMapModalityDropdown, (open) => {
  if (open) {
    void nextTick(() => positionMapModalityDropdown())
    window.addEventListener('scroll', positionMapModalityDropdown, true)
    window.addEventListener('resize', positionMapModalityDropdown)
  } else {
    window.removeEventListener('scroll', positionMapModalityDropdown, true)
    window.removeEventListener('resize', positionMapModalityDropdown)
  }
})

export type MapPinState = 'not_clocked_in' | 'clocked_in' | 'on_lunch' | 'clocked_out'

interface MapPin {
  state: MapPinState
  type: 'in' | 'out'
  lat: number
  lng: number
  name: string
  pictureUrl: string | null
  initial: string
  clockTime: string
  timeLabel: string
  address: string | null
  record: MapRecord
  opacity: number
  borderColor: string
  isRunning: boolean
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`
  if (addressCache.value[key]) return addressCache.value[key]
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'TimeWorthApp/1.0' } }
    )
    const data = await res.json()
    const addr = data?.display_name ?? null
    if (addr) addressCache.value[key] = addr
    return addr
  } catch {
    return null
  }
}

function fmtTime(t: string | null): string {
  return t ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—'
}

function formatElapsedMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function parseIntervalToSeconds(interval: string | null): number {
  if (!interval) return 0
  const m = interval.match(/^(\d+):(\d+):(\d+)/)
  if (m) {
    const [, h, min, sec] = m.map(Number)
    return (h || 0) * 3600 + (min || 0) * 60 + (sec || 0)
  }
  return 0
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

function formatSecondsAsTotal(seconds: number): string {
  if (seconds <= 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h) return `${h}h ${m}m`
  return `${m}m`
}

function getRunningElapsed(record: MapRecord): string {
  const start = record.clock_in ? new Date(record.clock_in).getTime() : 0
  const now = Date.now()
  const lunchStart = record.lunch_break_start ? new Date(record.lunch_break_start).getTime() : 0
  const lunchEnd = record.lunch_break_end ? new Date(record.lunch_break_end).getTime() : 0
  if (record.lunch_break_start && !record.lunch_break_end) {
    return formatElapsedMs(now - lunchStart)
  }
  let elapsed = now - start
  if (lunchStart && lunchEnd) elapsed -= lunchEnd - lunchStart
  return formatElapsedMs(Math.max(0, elapsed))
}

const filteredPins = computed((): MapPin[] => {
  const pins: MapPin[] = []
  const mod = filterModality.value
  const locType = filterLocationType.value
  const locFilter = (state: MapPinState) => {
    if (locType === 'both') return true
    if (locType === 'clock_in') return state === 'clocked_in' || state === 'on_lunch'
    return state === 'clocked_out' || state === 'not_clocked_in'
  }
  const records = mapRecords.value
  const lastByUser = lastClockOutByUser.value
  const userIdsWithToday = new Set(records.map(r => r.user_id))

  const byUser = new Map<string, MapRecord[]>()
  for (const r of records) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, [])
    byUser.get(r.user_id)!.push(r)
  }

  for (const [userId, userRecords] of byUser) {
    const activeRow = userRecords.find(r => !r.clock_out)
    const r = activeRow ?? userRecords[0]
    const modality = r.work_modality ?? null
    if (mod === 'office' && modality !== 'office') continue
    if (mod === 'wfh' && modality !== 'wfh') continue

    const inLoc = parseLocation(r.location_in)
    const outLoc = parseLocation(r.location_out)

    const name = r.employee_name || 'Unknown'
    const initial = (name.trim().slice(0, 1) || '?').toUpperCase()

    if (activeRow) {
      const onLunch = !!activeRow.lunch_break_start && !activeRow.lunch_break_end
      if (onLunch) {
        if (inLoc && locFilter('on_lunch')) {
          pins.push({
            state: 'on_lunch',
            type: 'in',
            lat: inLoc.lat,
            lng: inLoc.lng,
            name,
            pictureUrl: r.employee_picture_url ?? null,
            initial,
            clockTime: fmtTime(activeRow.lunch_break_start),
            timeLabel: getRunningElapsed(activeRow),
            address: addressCache.value[`${inLoc.lat.toFixed(6)},${inLoc.lng.toFixed(6)}`] ?? null,
            record: activeRow,
            opacity: 1,
            borderColor: '#f97316',
            isRunning: true
          })
        }
      } else {
        if (inLoc && locFilter('clocked_in')) {
          pins.push({
            state: 'clocked_in',
            type: 'in',
            lat: inLoc.lat,
            lng: inLoc.lng,
            name,
            pictureUrl: r.employee_picture_url ?? null,
            initial,
            clockTime: fmtTime(activeRow.clock_in),
            timeLabel: getRunningElapsed(activeRow),
            address: addressCache.value[`${inLoc.lat.toFixed(6)},${inLoc.lng.toFixed(6)}`] ?? null,
            record: activeRow,
            opacity: 1,
            borderColor: '#22c55e',
            isRunning: true
          })
        }
      }
    } else {
      const clockedOutRows = userRecords.filter(row => !!row.clock_out).sort((a, b) => (b.clock_out! > a.clock_out! ? 1 : -1))
      const lastOutRow = clockedOutRows[0]
      if (!lastOutRow) continue
      const lastOutLoc = parseLocation(lastOutRow.location_out)
      if (!lastOutLoc || !locFilter('clocked_out')) continue
      const totalSeconds = userRecords.reduce((sum, row) => sum + parseIntervalToSeconds(row.total_time), 0)
      const totalDayLabel = formatSecondsAsTotal(totalSeconds)
      pins.push({
        state: 'clocked_out',
        type: 'out',
        lat: lastOutLoc.lat,
        lng: lastOutLoc.lng,
        name,
        pictureUrl: r.employee_picture_url ?? null,
        initial,
        clockTime: fmtTime(lastOutRow.clock_out),
        timeLabel: totalDayLabel,
        address: addressCache.value[`${lastOutLoc.lat.toFixed(6)},${lastOutLoc.lng.toFixed(6)}`] ?? null,
        record: lastOutRow,
        opacity: 1,
        borderColor: '#0ea5e9',
        isRunning: false
      })
    }
  }

  for (const uid of allEmployeeIds.value) {
    if (userIdsWithToday.has(uid)) continue
    const lastRow = lastByUser[uid] as MapRecord | undefined
    if (!lastRow || !locFilter('not_clocked_in')) continue
    const outLoc = parseLocation(lastRow.location_out)
    if (!outLoc) continue
    const modality = lastRow.work_modality ?? null
    if (filterModality.value === 'office' && modality !== 'office') continue
    if (filterModality.value === 'wfh' && modality !== 'wfh') continue
    const name = lastRow.employee_name || 'Unknown'
    const initial = (name.trim().slice(0, 1) || '?').toUpperCase()
    pins.push({
      state: 'not_clocked_in',
      type: 'out',
      lat: outLoc.lat,
      lng: outLoc.lng,
      name,
      pictureUrl: lastRow.employee_picture_url ?? null,
      initial,
      clockTime: fmtTime(lastRow.clock_out),
      timeLabel: `Last: ${fmtTime(lastRow.clock_out)}`,
      address: addressCache.value[`${outLoc.lat.toFixed(6)},${outLoc.lng.toFixed(6)}`] ?? null,
      record: lastRow,
      opacity: 0.5,
      borderColor: '#94a3b8',
      isRunning: false
    })
  }

  return pins
})

async function fetchMapData() {
  mapLoading.value = true
  mapError.value = null
  addressCache.value = {}

  const { data: employees, error: empErr } = await supabase
    .from('employee')
    .select('id, name, picture')
    .order('name')
  if (empErr) {
    mapError.value = empErr.message
    mapLoading.value = false
    return
  }
  const empList = (employees ?? []) as { id: string; name: string; picture: string | null }[]
  allEmployeeIds.value = empList.map(e => e.id)
  const empMap = new Map(empList.map(e => [e.id, { name: e.name ?? '', picture: e.picture ?? null }]))

  const start = `${mapDate.value}T00:00:00.000Z`
  const end = `${mapDate.value}T23:59:59.999Z`
  const { data: rows, error } = await supabase
    .from('attendance')
    .select('*')
    .gte('clock_in', start)
    .lte('clock_in', end)
    .order('clock_in', { ascending: false })

  if (error) {
    mapError.value = error.message
    mapLoading.value = false
    return
  }

  const attendances = (rows ?? []) as AttendanceRow[]
  const userIdsToday = new Set(attendances.map(a => a.user_id))
  const missingIds = empList.map(e => e.id).filter(id => !userIdsToday.has(id))

  const withEmp: MapRecord[] = []
  for (const r of attendances) {
    const emp = empMap.get(r.user_id)
    const picturePath = emp?.picture ?? null
    let pictureUrl: string | null = null
    if (picturePath) pictureUrl = await getSignedProfileUrl(picturePath)
    withEmp.push({
      ...r,
      employee_name: emp?.name ?? 'Unknown',
      employee_picture: picturePath,
      employee_picture_url: pictureUrl
    })
  }
  mapRecords.value = withEmp

  const lastByUser: Record<string, MapRecord> = {}
  if (missingIds.length > 0) {
    const { data: lastRows } = await supabase
      .from('attendance')
      .select('*')
      .in('user_id', missingIds)
      .not('clock_out', 'is', null)
      .order('clock_out', { ascending: false })
    const byUser = new Map<string, AttendanceRow>()
    for (const row of (lastRows ?? []) as AttendanceRow[]) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, row)
    }
    for (const [uid, row] of byUser) {
      const emp = empMap.get(uid)
      const picturePath = emp?.picture ?? null
      let pictureUrl: string | null = null
      if (picturePath) pictureUrl = await getSignedProfileUrl(picturePath)
      lastByUser[uid] = {
        ...row,
        employee_name: emp?.name ?? 'Unknown',
        employee_picture: picturePath,
        employee_picture_url: pictureUrl
      }
    }
  }
  lastClockOutByUser.value = lastByUser

  mapLoading.value = false
  nextTick(() => updateMapMarkers())
}

let markers: L.Marker[] = []

const LABEL_HEIGHT = 20

function createMarkerIcon(pin: MapPin): L.DivIcon {
  const pic = pin.pictureUrl
  const initial = escapeHtml(pin.initial)
  const imgHtml = pic
    ? `<img src="${escapeHtml(pic)}" alt="" class="admin-map-marker-img" />`
    : `<span class="admin-map-marker-initial">${initial}</span>`
  const borderColor = pin.borderColor
  const opacity = pin.opacity
  return L.divIcon({
    className: 'admin-map-marker',
    html: `<div class="admin-map-marker-with-label" style="opacity:${opacity}"><span class="admin-map-marker-name">${escapeHtml(pin.name)}</span><div class="admin-map-marker-wrap" style="border-color:${borderColor}">${imgHtml}</div></div>`,
    iconSize: [MARKER_SIZE + 40, MARKER_SIZE + LABEL_HEIGHT],
    iconAnchor: [(MARKER_SIZE + 40) / 2, MARKER_SIZE + LABEL_HEIGHT]
  })
}

function centroidLatLng(pins: MapPin[]): { lat: number; lng: number } {
  let lat = 0
  let lng = 0
  for (const p of pins) {
    lat += p.lat
    lng += p.lng
  }
  const n = pins.length
  return { lat: lat / n, lng: lng / n }
}

/**
 * Merge pins that overlap even slightly in screen space (union-find).
 * At any zoom, only markers whose icons touch or overlap are grouped; separated markers stay individual.
 */
function clusterPinsByOverlap(
  pins: MapPin[],
  map: L.Map
): Array<{ type: 'single'; pin: MapPin } | { type: 'cluster'; pins: MapPin[] }> {
  if (pins.length <= 1) {
    return pins.map((p) => ({ type: 'single' as const, pin: p }))
  }
  const layerPoints = pins.map((p) => ({
    pin: p,
    pt: map.latLngToLayerPoint(L.latLng(p.lat, p.lng))
  }))
  const n = layerPoints.length
  const parent = Array.from({ length: n }, (_, i) => i)
  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i])
    return parent[i]
  }
  function union(a: number, b: number) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  const r2 = CLUSTER_MERGE_PX * CLUSTER_MERGE_PX
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = layerPoints[i].pt.x - layerPoints[j].pt.x
      const dy = layerPoints[i].pt.y - layerPoints[j].pt.y
      if (dx * dx + dy * dy <= r2) union(i, j)
    }
  }
  const groups = new Map<number, MapPin[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(layerPoints[i].pin)
  }
  const out: Array<{ type: 'single'; pin: MapPin } | { type: 'cluster'; pins: MapPin[] }> = []
  for (const group of groups.values()) {
    if (group.length === 1) out.push({ type: 'single', pin: group[0] })
    else {
      group.sort((a, b) => a.name.localeCompare(b.name))
      out.push({ type: 'cluster', pins: group })
    }
  }
  return out
}

function createClusterIcon(pins: MapPin[]): L.DivIcon {
  const sorted = [...pins].sort((a, b) => a.name.localeCompare(b.name))
  const primary = sorted[0]
  const others = sorted.slice(1)
  const mini = sorted.slice(0, 3).map((p) => {
    const pic = p.pictureUrl
    const initial = escapeHtml(p.initial)
    const inner = pic
      ? `<img src="${escapeHtml(pic)}" alt="" class="admin-map-cluster-mini-img" />`
      : `<span class="admin-map-cluster-mini-initial">${initial}</span>`
    return `<div class="admin-map-cluster-mini" style="border-color:${escapeHtml(p.borderColor)}">${inner}</div>`
  })
  const opacity = primary.opacity
  const othersHint =
    others.length > 0
      ? `<span class="admin-map-cluster-others">+${others.length} other${others.length === 1 ? '' : 's'}</span>`
      : ''
  const w = CLUSTER_MARKER_W + 40
  const h = CLUSTER_MARKER_H + LABEL_HEIGHT
  return L.divIcon({
    className: 'admin-map-marker admin-map-marker-cluster',
    html: `<div class="admin-map-marker-with-label admin-map-cluster-with-label" style="opacity:${opacity}">
      <span class="admin-map-marker-name admin-map-cluster-name-line"><span class="admin-map-cluster-primary">${escapeHtml(primary.name)}</span>${othersHint}</span>
      <div class="admin-map-cluster-bubble">
        <div class="admin-map-cluster-avatars">${mini.join('')}</div>
        <span class="admin-map-cluster-badge" aria-hidden="true">${sorted.length}</span>
      </div>
    </div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h]
  })
}

/** Short status for detail modal (no “clock” wording). */
function shortKindLabel(state: MapPinState): string {
  switch (state) {
    case 'clocked_in':
      return 'In'
    case 'on_lunch':
      return 'Lunch'
    case 'clocked_out':
    case 'not_clocked_in':
      return 'Out'
    default:
      return '—'
  }
}

const mapDetailTimeDisplay = computed(() => {
  const p = mapDetailPin.value
  if (!p) return ''
  void tick.value
  if (p.isRunning) return getRunningElapsed(p.record)
  if (p.state === 'clocked_out') return `${p.timeLabel} total`
  return p.timeLabel
})

async function openMapEmployeeDetail(pin: MapPin) {
  mapClusterPickerPins.value = null
  mapDetailPin.value = pin
  mapDetailAddress.value = null
  mapDetailAddressLoading.value = true
  const addr = await reverseGeocode(pin.lat, pin.lng)
  mapDetailAddress.value = addr
  mapDetailAddressLoading.value = false
}

function closeMapDetailModal() {
  mapDetailPin.value = null
  mapDetailAddress.value = null
  mapDetailAddressLoading.value = false
}

function closeClusterPickerModal() {
  mapClusterPickerPins.value = null
}

function onPickClusterPerson(pin: MapPin) {
  mapClusterPickerPins.value = null
  void openMapEmployeeDetail(pin)
}

function updateMapMarkers(opts?: { fitBounds?: boolean }) {
  const fitBounds = opts?.fitBounds !== false
  if (!map) return
  markers.forEach((m) => m.remove())
  markers = []

  const pins = filteredPins.value
  if (pins.length === 0) return

  const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]))
  const groups = clusterPinsByOverlap(pins, map)

  for (const g of groups) {
    if (g.type === 'single') {
      const pin = g.pin
      const icon = createMarkerIcon(pin)
      const m = L.marker([pin.lat, pin.lng], { icon }).addTo(map!)
      m.on('click', () => {
        void openMapEmployeeDetail(pin)
      })
      markers.push(m)
    } else {
      const clusterPins = g.pins
      const c = centroidLatLng(clusterPins)
      const icon = createClusterIcon(clusterPins)
      const m = L.marker([c.lat, c.lng], { icon }).addTo(map!)
      m.on('click', () => {
        const maxZ = map!.getMaxZoom()
        const curZ = map!.getZoom()
        if (curZ < maxZ) {
          map!.setView([c.lat, c.lng], Math.min(curZ + 2, maxZ))
        } else {
          mapClusterPickerPins.value = [...clusterPins]
        }
      })
      markers.push(m)
    }
  }

  if (!fitBounds) return
  if (pins.length === 1) {
    map.setView([pins[0].lat, pins[0].lng], 15)
  } else if (pins.length > 1) {
    map.fitBounds(bounds.pad(0.1), { maxZoom: 14 })
  }
}

function initMap() {
  if (!mapContainer.value) return
  map = L.map(mapContainer.value, { zoomControl: false }).setView([14.5992, 120.9845], 11)
  L.control.zoom({ position: 'topright' }).addTo(map)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 20 }).addTo(map)
  mapZoomMoveHandler = () => updateMapMarkers({ fitBounds: false })
  map.on('zoomend', mapZoomMoveHandler)
  map.on('moveend', mapZoomMoveHandler)
  updateMapMarkers()
}

watch([filteredPins, filterLocationType, filterModality], () => {
  nextTick(() => updateMapMarkers())
}, { deep: true })

watch(mapContainer, (el) => {
  if (el && !map) initMap()
})

onMounted(async () => {
  fetchKpis()
  await fetchMapData()
  document.addEventListener('click', handleMapFilterClickOutside)
  tickInterval = setInterval(() => {
    tick.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  document.removeEventListener('click', handleMapFilterClickOutside)
  window.removeEventListener('scroll', positionLocationTypeDropdown, true)
  window.removeEventListener('resize', positionLocationTypeDropdown)
  window.removeEventListener('scroll', positionMapModalityDropdown, true)
  window.removeEventListener('resize', positionMapModalityDropdown)
  if (tickInterval) clearInterval(tickInterval)
  tickInterval = null
  if (map && mapZoomMoveHandler) {
    map.off('zoomend', mapZoomMoveHandler)
    map.off('moveend', mapZoomMoveHandler)
    mapZoomMoveHandler = null
  }
  markers.forEach((m) => m.remove())
  markers = []
  map?.remove()
  map = null
})
</script>

<template>
  <div class="page">
    <section class="admin-kpis">
      <div v-if="kpiLoading" class="admin-kpis-loading">Loading…</div>
      <template v-else>
        <div class="admin-kpi-card">
          <div class="admin-kpi-icon admin-kpi-icon-green" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          </div>
          <div class="admin-kpi-value">{{ kpiTotalPresent }}</div>
          <div class="admin-kpi-label">Total present</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-icon admin-kpi-icon-purple" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
          </div>
          <div class="admin-kpi-value">{{ kpiTotalAbsent }}</div>
          <div class="admin-kpi-label">Total absent</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-icon admin-kpi-icon-blue" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div class="admin-kpi-value">{{ formatKpiHours(kpiTotalWorkingHours) }}</div>
          <div class="admin-kpi-label">Total working hours</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-icon admin-kpi-icon-orange" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <div class="admin-kpi-value">{{ kpiOnLunch }}</div>
          <div class="admin-kpi-label">On lunch</div>
        </div>
      </template>
    </section>

    <section class="hero-map-section">
      <h2 class="hero-map-title fw-bold">Employee Locations</h2>
      <p class="muted intro mb-4">View employee locations below.</p>
      <div class="hero-map-header">
        <div class="hero-map-filters" role="group" aria-label="Map filters">
          <label class="filter-group">
            <span class="filter-label">Date</span>
            <input v-model="mapDate" type="date" class="hero-map-date" @change="fetchMapData" />
          </label>
          <div class="filter-group filter-group--map-menu">
            <span class="filter-label">Status</span>
            <div ref="locationTypeFilterTriggerRef" class="ts-filter-trigger-wrap">
              <button
                type="button"
                class="period-btn ts-filter-period-btn"
                aria-haspopup="listbox"
                :aria-expanded="showLocationTypeDropdown"
                :aria-label="`Status filter, ${locationTypeFilterLabel}`"
                @click.stop="toggleLocationTypeFilterMenu"
              >
                <ChevronDownIcon class="ts-period-chevron" aria-hidden="true" />
              </button>
              <Teleport to="body">
                <div
                  v-if="showLocationTypeDropdown"
                  class="ts-filter-dropdown-portal period-dropdown"
                  :style="locationTypeDropdownStyle"
                  role="listbox"
                  @click.stop
                >
                  <button
                    type="button"
                    class="period-option"
                    :class="{ active: filterLocationType === 'both' }"
                    role="option"
                    :aria-selected="filterLocationType === 'both'"
                    @click="selectLocationTypeFilter('both')"
                  >
                    All Records
                  </button>
                  <button
                    type="button"
                    class="period-option"
                    :class="{ active: filterLocationType === 'clock_in' }"
                    role="option"
                    :aria-selected="filterLocationType === 'clock_in'"
                    @click="selectLocationTypeFilter('clock_in')"
                  >
                    Clocked In
                  </button>
                  <button
                    type="button"
                    class="period-option"
                    :class="{ active: filterLocationType === 'clock_out' }"
                    role="option"
                    :aria-selected="filterLocationType === 'clock_out'"
                    @click="selectLocationTypeFilter('clock_out')"
                  >
                    Clocked Out
                  </button>
                </div>
              </Teleport>
            </div>
          </div>
          <div class="filter-group filter-group--map-menu">
            <span class="filter-label">Modality</span>
            <div ref="mapModalityFilterTriggerRef" class="ts-filter-trigger-wrap">
              <button
                type="button"
                class="period-btn ts-filter-period-btn"
                aria-haspopup="listbox"
                :aria-expanded="showMapModalityDropdown"
                :aria-label="`Modality filter, ${mapModalityFilterLabel}`"
                @click.stop="toggleMapModalityFilterMenu"
              >
                <ChevronDownIcon class="ts-period-chevron" aria-hidden="true" />
              </button>
              <Teleport to="body">
                <div
                  v-if="showMapModalityDropdown"
                  class="ts-filter-dropdown-portal period-dropdown"
                  :style="mapModalityDropdownStyle"
                  role="listbox"
                  @click.stop
                >
                  <button
                    type="button"
                    class="period-option"
                    :class="{ active: filterModality === 'all' }"
                    role="option"
                    :aria-selected="filterModality === 'all'"
                    @click="selectMapModalityFilter('all')"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class="period-option"
                    :class="{ active: filterModality === 'office' }"
                    role="option"
                    :aria-selected="filterModality === 'office'"
                    @click="selectMapModalityFilter('office')"
                  >
                    Office
                  </button>
                  <button
                    type="button"
                    class="period-option"
                    :class="{ active: filterModality === 'wfh' }"
                    role="option"
                    :aria-selected="filterModality === 'wfh'"
                    @click="selectMapModalityFilter('wfh')"
                  >
                    WFH
                  </button>
                </div>
              </Teleport>
            </div>
          </div>
        </div>
      </div>
      <div class="hero-map-wrap">
        <div ref="mapContainer" class="hero-map"></div>
        <div v-if="mapLoading" class="hero-map-loading">
          <span class="spinner" aria-hidden="true"></span>
          <span>Loading…</span>
        </div>
        <p v-if="mapError" class="hero-map-error">{{ mapError }}</p>
      </div>
    </section>

    <Teleport to="body">
      <div
        v-if="mapDetailPin"
        class="admin-map-modal-overlay"
        @click.self="closeMapDetailModal"
      >
        <div class="admin-map-modal" role="dialog" aria-modal="true" aria-labelledby="map-detail-name" @click.stop>
          <button type="button" class="admin-map-modal-close" aria-label="Close" @click="closeMapDetailModal">
            ×
          </button>
          <div class="admin-map-modal-avatar" :style="{ borderColor: mapDetailPin.borderColor }">
            <img v-if="mapDetailPin.pictureUrl" :src="mapDetailPin.pictureUrl" alt="" />
            <span v-else class="admin-map-modal-initial">{{ mapDetailPin.initial }}</span>
          </div>
          <h3 id="map-detail-name" class="admin-map-modal-name">{{ mapDetailPin.name }}</h3>
          <p class="admin-map-modal-meta">
            {{ shortKindLabel(mapDetailPin.state) }} · {{ mapDetailTimeDisplay }}
          </p>
          <p v-if="mapDetailAddressLoading" class="admin-map-modal-address admin-map-modal-address--muted">Loading address…</p>
          <p v-else class="admin-map-modal-address">{{ mapDetailAddress || '—' }}</p>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="mapClusterPickerPins?.length"
        class="admin-map-modal-overlay"
        @click.self="closeClusterPickerModal"
      >
        <div class="admin-map-modal admin-map-modal--picker" role="dialog" aria-modal="true" aria-labelledby="cluster-picker-title" @click.stop>
          <button type="button" class="admin-map-modal-close" aria-label="Close" @click="closeClusterPickerModal">
            ×
          </button>
          <h3 id="cluster-picker-title" class="admin-map-modal-picker-title">People at this spot</h3>
          <ul class="admin-map-modal-picker-list">
            <li v-for="p in mapClusterPickerPins" :key="p.record.attendance_id">
              <button type="button" class="admin-map-modal-picker-row" @click="onPickClusterPerson(p)">
                <span class="admin-map-modal-picker-avatar" :style="{ borderColor: p.borderColor }">
                  <img v-if="p.pictureUrl" :src="p.pictureUrl" alt="" />
                  <span v-else class="admin-map-modal-picker-initial">{{ p.initial }}</span>
                </span>
                <span class="admin-map-modal-picker-name">{{ p.name }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page { width: 100%; max-width: 100%; }
.page h1 { margin: 0 0 2rem; font-size: 1.5rem; font-weight: 600; }
.muted { color: var(--text-secondary); font-size: 0.9375rem; margin: 0 0 1rem; }
.intro { margin-bottom: 0.5rem; }

.admin-kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
@media (min-width: 900px) {
  .admin-kpis {
    grid-template-columns: repeat(4, 1fr);
  }
}
.admin-kpis-loading { grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 1.5rem; }
.admin-kpi-card { background: var(--bg-secondary); border: 1px solid var(--border-light); border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; }
.admin-kpi-icon { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
.admin-kpi-icon svg { width: 24px; height: 24px; color: currentColor; }
.admin-kpi-icon-green { background: rgba(34, 197, 94, 0.25); border: 1px solid rgba(34, 197, 94, 0.5); }
.admin-kpi-icon-purple { background: rgba(168, 85, 247, 0.25); border: 1px solid rgba(168, 85, 247, 0.5); }
.admin-kpi-icon-blue { background: rgba(59, 130, 246, 0.25); border: 1px solid rgba(59, 130, 246, 0.5); }
.admin-kpi-icon-orange { background: rgba(249, 115, 22, 0.25); border: 1px solid rgba(249, 115, 22, 0.5); }
.admin-kpi-value { font-size: 1.75rem; font-weight: 700; color: var(--text-primary); line-height: 1.2; }
.admin-kpi-label { font-size: 0.8125rem; color: var(--text-secondary); }

.hero-map-section { background: var(--bg-secondary); border: 1px solid var(--border-light); border-radius: 16px; padding: 1.25rem; margin-bottom: 1.5rem; }
.hero-map-header { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.hero-map-title { margin: 0; font-size: 1.125rem; font-weight: 600; color: var(--text-primary); }
.hero-map-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  flex: 1;
  min-width: 0;
}
.hero-map-date {
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.875rem;
  min-width: 0;
}
.filter-group { display: flex; flex-direction: row; align-items: center; gap: 0.35rem; min-width: 0; }
.filter-group.filter-check { gap: 0.5rem; }
.filter-group--map-menu { flex-wrap: nowrap; }
.filter-label { font-size: 0.8125rem; color: var(--text-secondary); font-weight: 500; white-space: nowrap; }

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

@media (max-width: 640px) {
  .hero-map-header { align-items: stretch; }
  .hero-map-filters {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 0.3rem;
  }
  .filter-group {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 0rem;
  }
  .hero-map-date {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .filter-group--map-menu {
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
  }
}
.filter-checkbox { width: 1rem; height: 1rem; accent-color: #38bdf8; }

.hero-map-wrap { position: relative; min-height: 380px; border-radius: 12px; overflow: visible; border: 1px solid var(--border-light); background: #f1f5f9; }
.hero-map { width: 100%; height: 380px; border-radius: 12px; overflow: hidden; }
.hero-map-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: rgba(15,23,42,0.5); color: #e2e8f0; font-size: 0.9375rem; z-index: 10; }
.spinner { width: 20px; height: 20px; border: 2px solid rgba(56,189,248,0.3); border-top-color: #38bdf8; border-radius: 50%; animation: admin-spin 0.7s linear infinite; }
@keyframes admin-spin { to { transform: rotate(360deg); } }
.hero-map-error { position: absolute; bottom: 0.75rem; left: 0.75rem; right: 0.75rem; margin: 0; padding: 0.5rem; background: rgba(248,113,113,0.2); color: #f87171; font-size: 0.875rem; border-radius: 8px; z-index: 10; }

:deep(.admin-map-marker) { background: none; border: none; }
:deep(.admin-map-marker-with-label) { display: flex; flex-direction: column; align-items: center; gap: 4px; }
:deep(.admin-map-marker-name) { font-size: 0.75rem; font-weight: 600; color: #0f172a; white-space: normal; text-align: center; text-shadow: 0 0 2px #fff, 0 1px 2px #fff; padding: 0 4px; max-width: 120px; line-height: 1.2; }
:deep(.admin-map-marker-wrap) { width: 44px; height: 44px; border-radius: 50%; overflow: hidden; border: 3px solid #0ea5e9; box-shadow: 0 2px 10px rgba(0,0,0,0.25); background: #e2e8f0; display: flex; align-items: center; justify-content: center; }
:deep(.admin-map-marker-img) { width: 100%; height: 100%; object-fit: cover; }
:deep(.admin-map-marker-initial) { font-size: 1.125rem; font-weight: 700; color: #0ea5e9; }
:deep(.admin-map-marker-cluster) { z-index: 650 !important; }
:deep(.admin-map-cluster-with-label) { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: 200px; }
:deep(.admin-map-cluster-name-line) { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 6px; max-width: 200px; }
:deep(.admin-map-cluster-primary) { font-weight: 700; color: #0f172a; text-shadow: 0 0 2px #fff, 0 1px 2px #fff; }
:deep(.admin-map-cluster-others) {
  font-size: 0.7rem;
  font-weight: 600;
  color: #334155;
  background: rgba(255,255,255,0.92);
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 2px 8px;
  cursor: inherit;
  text-shadow: none;
}
:deep(.admin-map-cluster-bubble) {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  min-height: 56px;
  padding: 6px 10px;
  border-radius: 16px;
  background: linear-gradient(145deg, #f8fafc, #e2e8f0);
  border: 3px solid #334155;
  box-shadow: 0 4px 14px rgba(0,0,0,0.28);
}
:deep(.admin-map-cluster-avatars) { display: flex; align-items: center; justify-content: center; margin: 0 -2px; padding: 0 4px; }
:deep(.admin-map-cluster-mini) {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid #fff;
  margin-left: -10px;
  background: #e2e8f0;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
:deep(.admin-map-cluster-mini:first-child) { margin-left: 0; }
:deep(.admin-map-cluster-mini-img) { width: 100%; height: 100%; object-fit: cover; }
:deep(.admin-map-cluster-mini-initial) { font-size: 0.875rem; font-weight: 700; color: #0ea5e9; }
:deep(.admin-map-cluster-badge) {
  position: absolute;
  bottom: -4px;
  right: -4px;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border-radius: 999px;
  background: #0f172a;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}
:deep(.admin-map-marker-with-label .admin-map-marker-wrap),
:deep(.admin-map-cluster-bubble) {
  transition: none;
}
:deep(.admin-map-marker-with-label:hover .admin-map-marker-wrap),
:deep(.admin-map-cluster-bubble:hover) {
  transform: none;
  filter: none;
}

.admin-map-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
}
.admin-map-modal {
  position: relative;
  width: min(100%, 360px);
  max-height: min(90vh, 520px);
  overflow: auto;
  padding: 1.5rem 1.25rem 1.25rem;
  border-radius: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
}
.admin-map-modal--picker {
  width: min(100%, 400px);
  padding-top: 1.25rem;
}
.admin-map-modal-close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}
.admin-map-modal-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.admin-map-modal-avatar {
  width: 72px;
  height: 72px;
  margin: 0 auto 1rem;
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid #0ea5e9;
  background: #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.admin-map-modal-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.admin-map-modal-initial {
  font-size: 1.5rem;
  font-weight: 700;
  color: #0ea5e9;
}
.admin-map-modal-name {
  margin: 0 0 0.5rem;
  font-size: 1.125rem;
  font-weight: 700;
  text-align: center;
  color: var(--text-primary);
}
.admin-map-modal-meta {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  text-align: center;
}
.admin-map-modal-address {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--text-primary);
  word-break: break-word;
}
.admin-map-modal-address--muted {
  color: var(--text-secondary);
}
.admin-map-modal-picker-title {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}
.admin-map-modal-picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: min(60vh, 360px);
  overflow-y: auto;
}
.admin-map-modal-picker-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.5rem 0.65rem;
  border-radius: 10px;
  border: 1px solid var(--border-light);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
}
.admin-map-modal-picker-row:hover {
  background: var(--bg-hover);
}
.admin-map-modal-picker-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid #0ea5e9;
  flex-shrink: 0;
  background: #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.admin-map-modal-picker-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.admin-map-modal-picker-initial {
  font-size: 1rem;
  font-weight: 700;
  color: #0ea5e9;
}
.admin-map-modal-picker-name {
  flex: 1;
  min-width: 0;
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
