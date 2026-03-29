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
const runningMarkers = ref<{ marker: L.Marker; pin: MapPin }[]>([])

// Filters
const filterLocationType = ref<'clock_in' | 'clock_out' | 'both'>('both')
const filterModality = ref<'all' | 'office' | 'wfh'>('all')

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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

function buildTooltipHtml(pin: MapPin, addr: string | null): string {
  const stateLabels: Record<MapPinState, string> = {
    not_clocked_in: 'Last clock out',
    clocked_in: 'Clock in (working)',
    on_lunch: 'On lunch',
    clocked_out: 'Clock out'
  }
  const label = stateLabels[pin.state]
  const displayAddr = addr || `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`
  const timeLine = pin.state === 'clocked_out' ? `Total: <strong>${escapeHtml(pin.timeLabel)}</strong>` : `Time: <strong>${escapeHtml(pin.timeLabel)}</strong>`
  return `<div class="admin-map-tooltip"><strong>${escapeHtml(pin.name)}</strong> ${escapeHtml(label)} · ${timeLine}<span class="admin-map-tooltip-address" title="${escapeHtml(displayAddr)}">${escapeHtml(displayAddr)}</span></div>`
}

function updateRunningTooltips() {
  runningMarkers.value.forEach(({ marker, pin }) => {
    const updatedLabel = getRunningElapsed(pin.record)
    const updatedPin = { ...pin, timeLabel: updatedLabel }
    const tip = marker.getTooltip()
    if (tip) tip.setContent(buildTooltipHtml(updatedPin, pin.address || null))
  })
}

function updateMapMarkers() {
  if (!map) return
  markers.forEach(m => m.remove())
  markers = []
  runningMarkers.value = []

  const pins = filteredPins.value
  if (pins.length === 0) return

  const bounds = L.latLngBounds(pins.map(p => [p.lat, p.lng] as [number, number]))
  pins.forEach(pin => {
    const icon = createMarkerIcon(pin)
    const m = L.marker([pin.lat, pin.lng], { icon }).addTo(map!)
    m.bindTooltip(
      buildTooltipHtml(pin, pin.address || null),
      { permanent: false, direction: 'top', offset: [0, -MARKER_SIZE - LABEL_HEIGHT - 4], className: 'admin-map-tooltip-wrap', sticky: true }
    )
    m.on('mouseover', async () => {
      const key = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`
      if (addressCache.value[key]) return
      const resolved = await reverseGeocode(pin.lat, pin.lng)
      if (resolved) {
        addressCache.value[key] = resolved
        const tip = m.getTooltip()
        if (tip) tip.setContent(buildTooltipHtml(pin, resolved))
      }
    })
    markers.push(m)
    if (pin.isRunning) runningMarkers.value.push({ marker: m, pin })
  })

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
  tickInterval = setInterval(() => {
    tick.value = Date.now()
    updateRunningTooltips()
  }, 1000)
})

onUnmounted(() => {
  if (tickInterval) clearInterval(tickInterval)
  tickInterval = null
  markers.forEach(m => m.remove())
  markers = []
  runningMarkers.value = []
  map?.remove()
  map = null
})
</script>

<template>
  <div class="page">
    <h1 class="fw-bold">Welcome, Admin {{ adminProfile?.name ?? adminProfile?.email }}.</h1>
    
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

    <h2 class="hero-map-title fw-bold">Employee Locations</h2>
    <p class="muted intro">View employee locations below.</p>
    <section class="hero-map-section">
      <div class="hero-map-header">
        <div class="hero-map-filters" role="group" aria-label="Map filters">
          <label class="filter-group">
            <span class="filter-label">Date</span>
            <input v-model="mapDate" type="date" class="hero-map-date" @change="fetchMapData" />
          </label>
          <label class="filter-group">
            <span class="filter-label">Status</span>
            <select v-model="filterLocationType" class="filter-select">
              <option value="both">All Records</option>
              <option value="clock_in">Clocked In</option>
              <option value="clock_out">Clocked Out</option>
            </select>
          </label>
          <label class="filter-group">
            <span class="filter-label">Modality</span>
            <select v-model="filterModality" class="filter-select">
              <option value="all">All</option>
              <option value="office">Office</option>
              <option value="wfh">WFH</option>
            </select>
          </label>
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
  </div>
</template>

<style scoped>
.page { width: 100%; max-width: 100%; }
.page h1 { margin: 0 0 2rem; font-size: 1.5rem; font-weight: 600; }
.muted { color: var(--text-secondary); font-size: 0.9375rem; margin: 0 0 1rem; }
.intro { margin-bottom: 0.5rem; }

.admin-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
@media (max-width: 900px) { .admin-kpis { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .admin-kpis { grid-template-columns: repeat(2, 1fr); } }
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
.filter-label { font-size: 0.8125rem; color: var(--text-secondary); font-weight: 500; white-space: nowrap; }
.filter-select {
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.8125rem;
  min-width: 7.5rem;
  max-width: 100%;
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
  .filter-select,
  .hero-map-date {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
}
.filter-checkbox { width: 1rem; height: 1rem; accent-color: #38bdf8; }

.hero-map-wrap { position: relative; min-height: 380px; border-radius: 12px; overflow: hidden; border: 1px solid var(--border-light); background: #f1f5f9; }
.hero-map { width: 100%; height: 380px; border-radius: 12px; }
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
:deep(.admin-map-tooltip-wrap) { padding: 0; border: none; background: transparent; box-shadow: none; }
:deep(.admin-map-tooltip) { padding: 8px 12px; background: rgba(15,23,42,0.95); border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); font-size: 0.8125rem; color: #e2e8f0; max-width: 280px; }
:deep(.admin-map-tooltip strong) { display: block; margin-bottom: 4px; color: #fff; }
:deep(.admin-map-tooltip-address) { display: block; margin-top: 6px; color: #94a3b8; font-size: 0.75rem; line-height: 1.3; word-break: break-word; }
</style>
