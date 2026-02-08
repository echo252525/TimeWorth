<script setup lang="ts">
import { onMounted, onUnmounted, nextTick, ref, computed, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: string })._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: markerIconUrl, iconRetinaUrl: markerIcon2xUrl, shadowUrl: markerShadowUrl })
import {
  useAttendance,
  BRANCHES,
  RADIUS_M,
  getBranch,
  parseLocation,
  isOutsideBranch,
  isOutsideWfhRadius,
  type WorkModality,
  type Branch
} from '../composables/useAttendance'

const {
  todayRecord,
  completedToday,
  isClockedIn,
  isOnLunch,
  usedLunchBreak,
  elapsedDisplay,
  lunchElapsedDisplay,
  isLoading,
  error,
  fetchToday,
  clockIn,
  clockOut,
  startLunchBreak,
  endLunchBreak
} = useAttendance()

const workModality = ref<WorkModality>('office')
const selectedBranch = ref<Branch | null>(BRANCHES[0])
const step = ref<'idle' | 'choose_modality' | 'getting_location' | 'facial' | 'clocked_in' | 'facial_out'>('idle')
const locationIn = ref<{ lat: number; lng: number } | null>(null)
const locationOut = ref<{ lat: number; lng: number } | null>(null)
const locationError = ref<string | null>(null)
const clockOutConfirm = ref<{ outsideOffice?: boolean; outsideWfh?: boolean } | null>(null)
const wfhFetchingLocation = ref(false)
const officeFetchingLocation = ref(false)
const wfhAddress = ref<string | null>(null)
const mapContainer = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let circle: L.Circle | null = null
let userMarker: L.Marker | null = null
let centerMarker: L.Marker | null = null

const centerIcon = L.divIcon({
  className: 'map-center-icon',
  html: '<span class="center-pin" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0ea5e9" width="28" height="28"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></span>',
  iconSize: [28, 36],
  iconAnchor: [14, 36]
})

onMounted(() => {
  fetchToday()
  nextTick(() => { if (mapContainer.value) initMap() })
})

onUnmounted(() => {
  centerMarker?.remove()
  userMarker?.remove()
  circle?.remove()
  map?.remove()
  map = null
})

const activeBranch = computed(() => {
  if (workModality.value === 'office' && selectedBranch.value) return selectedBranch.value
  const br = todayRecord.value?.branch_location ? getBranch(todayRecord.value.branch_location) : null
  return br ?? selectedBranch.value ?? BRANCHES[0]
})

const mapCenter = computed(() => {
  if (workModality.value === 'office') {
    const b = activeBranch.value
    return { lat: b.lat, lng: b.lng }
  }
  const locStr = locationIn.value ? `${locationIn.value.lat},${locationIn.value.lng}` : todayRecord.value?.location_in
  const p = parseLocation(locStr ?? null)
  return p ?? (locationIn.value || { lat: activeBranch.value.lat, lng: activeBranch.value.lng })
})

const userLoc = computed(() => locationIn.value ?? locationOut.value ?? null)

const isOutsideOfficeRadius = computed(() =>
  workModality.value === 'office' &&
  step.value === 'choose_modality' &&
  !!locationIn.value &&
  !!selectedBranch.value &&
  isOutsideBranch(locationIn.value, selectedBranch.value.id)
)

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'TimeWorthApp/1.0' } }
    )
    const data = await res.json()
    return data?.display_name ?? null
  } catch {
    return null
  }
}

function initMap() {
  if (!mapContainer.value) return
  map = L.map(mapContainer.value, { zoomControl: false }).setView([mapCenter.value.lat, mapCenter.value.lng], 16)
  L.control.zoom({ position: 'topright' }).addTo(map!)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 20 }).addTo(map!)
  circle = L.circle([mapCenter.value.lat, mapCenter.value.lng], { radius: RADIUS_M, color: '#0ea5e9', weight: 2, fillColor: '#0ea5e9', fillOpacity: 0.08 })
  updateMapView()
}

function updateCenterMarker() {
  if (!map) return
  centerMarker?.remove()
  if (workModality.value === 'office' && step.value !== 'idle') {
    const c = mapCenter.value
    const branch = activeBranch.value
    centerMarker = L.marker([c.lat, c.lng], { icon: centerIcon }).addTo(map!)
    centerMarker.bindTooltip(
      `<div class="map-tooltip-inner"><strong>${branch.name}</strong><span>${RADIUS_M}m radius</span></div>`,
      { permanent: true, direction: 'top', offset: [0, -12], className: 'map-bound-tooltip map-bound-tooltip-branch' }
    ).openTooltip()
  } else centerMarker = null
}

const WFH_ADDRESS_MAX_LEN = 45

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function updateUserMarker() {
  if (!map) return
  userMarker?.remove()
  const loc = userLoc.value
  if (loc) {
    userMarker = L.marker([loc.lat, loc.lng]).addTo(map!)
    const fullLabel = workModality.value === 'wfh' && wfhAddress.value ? wfhAddress.value : 'Your location'
    const displayLabel = fullLabel.length > WFH_ADDRESS_MAX_LEN ? fullLabel.slice(0, WFH_ADDRESS_MAX_LEN) + '…' : fullLabel
    const titleAttr = fullLabel !== displayLabel ? ` title="${escapeHtml(fullLabel)}"` : ''
    userMarker.bindTooltip(
      `<div class="map-tooltip-inner"><strong${titleAttr} class="map-tooltip-address">${escapeHtml(displayLabel)}</strong></div>`,
      { permanent: true, direction: 'top', offset: [0, -28], className: 'map-bound-tooltip map-bound-tooltip-user' }
    ).openTooltip()
  } else userMarker = null
}

const DEFAULT_MAP_VIEW = { lat: 14.5995, lng: 120.9842, zoom: 13 }

function updateMapView() {
  if (!map) return
  if (step.value === 'idle') {
    circle?.remove()
    centerMarker?.remove()
    map.setView([DEFAULT_MAP_VIEW.lat, DEFAULT_MAP_VIEW.lng], DEFAULT_MAP_VIEW.zoom)
    updateUserMarker()
    return
  }
  if (!circle) return
  const c = mapCenter.value
  circle.setLatLng([c.lat, c.lng])
  circle.setRadius(RADIUS_M)
  if (!map.hasLayer(circle)) circle.addTo(map!)
  updateCenterMarker()
  updateUserMarker()
  const loc = userLoc.value
  if (workModality.value === 'office' && loc) {
    const branchPoint = L.latLng(c.lat, c.lng)
    const userPoint = L.latLng(loc.lat, loc.lng)
    const bounds = L.latLngBounds([branchPoint, userPoint]).pad(0.15)
    map.fitBounds(bounds, { maxZoom: 17, padding: [24, 24] })
  } else {
    map.setView([c.lat, c.lng], 16)
  }
}

watch([mapCenter, userLoc, workModality, activeBranch, step, locationIn, wfhAddress], () => updateMapView(), { flush: 'post' })

function fetchUserLocationForOffice() {
  if (workModality.value !== 'office' || step.value !== 'choose_modality') return
  locationIn.value = null
  wfhAddress.value = null
  officeFetchingLocation.value = true
  getLocation()
    .then((loc) => {
      locationIn.value = loc
      nextTick(() => updateMapView())
    })
    .catch(() => {})
    .finally(() => { officeFetchingLocation.value = false })
}

watch(workModality, (mod) => {
  if (mod === 'wfh' && step.value === 'choose_modality') {
    locationIn.value = null
    locationError.value = null
    wfhAddress.value = null
    wfhFetchingLocation.value = true
    getLocation()
      .then((loc) => {
        locationIn.value = loc
        nextTick(() => updateMapView())
        reverseGeocode(loc.lat, loc.lng).then((addr) => { wfhAddress.value = addr })
      })
      .catch(() => {})
      .finally(() => { wfhFetchingLocation.value = false })
  } else if (mod === 'office' && step.value === 'choose_modality') {
    fetchUserLocationForOffice()
  }
})

watch(step, (s) => {
  if (s === 'choose_modality' && workModality.value === 'office') {
    fetchUserLocationForOffice()
  }
})

watch(
  () => (workModality.value === 'wfh' ? (locationIn.value || todayRecord.value?.location_in) : null),
  (loc) => {
    if (!loc || wfhFetchingLocation.value) return
    const coords = typeof loc === 'string' ? parseLocation(loc) : loc
    if (coords) reverseGeocode(coords.lat, coords.lng).then((addr) => { wfhAddress.value = addr })
  },
  { immediate: true }
)

watch(mapContainer, (el) => {
  if (el && !map) initMap()
})

function locationString(loc: { lat: number; lng: number } | null) {
  if (!loc) return null
  return `${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`
}

function getLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  })
}

function onClockInClick() {
  workModality.value = 'office'
  selectedBranch.value = BRANCHES[0]
  step.value = 'choose_modality'
  locationError.value = null
}

async function selectModalityAndStart(mod: WorkModality) {
  workModality.value = mod
  const branch = mod === 'office' ? selectedBranch.value : null
  if (mod === 'office' && !branch) return
  locationError.value = null
  if (mod === 'wfh') {
    try {
      const loc = locationIn.value ?? await getLocation()
      if (!loc) return
      locationIn.value = loc
      nextTick(() => updateMapView())
      const locStr = locationString(loc)
      clockIn('wfh', { locationIn: locStr ?? undefined })
      step.value = 'clocked_in'
      locationIn.value = null
    } catch (e) {
      locationError.value = e instanceof Error ? e.message : 'Location failed'
      step.value = 'choose_modality'
    }
    return
  }
  step.value = 'getting_location'
  try {
    const loc = locationIn.value ?? await getLocation()
    if (!loc) return
    locationIn.value = loc
    nextTick(() => updateMapView())
    if (workModality.value === 'office' && branch) {
      step.value = 'facial'
    }
  } catch (e) {
    locationError.value = e instanceof Error ? e.message : 'Location failed'
    step.value = 'choose_modality'
  }
}

function onFacialRecognized() {
  const loc = locationString(locationIn.value)
  const branchId = workModality.value === 'office' ? selectedBranch.value?.id : undefined
  clockIn(workModality.value, { locationIn: loc ?? undefined, facialStatus: 'verified', branchLocation: branchId })
  step.value = 'clocked_in'
  locationIn.value = null
}

function onFacialNotRecognized() {
  step.value = 'choose_modality'
  locationIn.value = null
}

async function doClockOut() {
  locationError.value = null
  locationOut.value = null
  const mod = todayRecord.value?.work_modality
  if (mod === 'office') {
    step.value = 'facial_out'
    return
  }
  try {
    const loc = await getLocation()
    locationOut.value = loc
    const locStr = locationString(loc)!
    if (mod === 'wfh' && todayRecord.value?.location_in && isOutsideWfhRadius(loc, todayRecord.value.location_in)) {
      clockOutConfirm.value = { outsideWfh: true }
      return
    }
    await clockOut(locStr)
    step.value = 'idle'
    locationOut.value = null
  } catch {
    await clockOut()
    step.value = 'idle'
  }
}

function onFacialOutRecognized() {
  step.value = 'clocked_in'
  doClockOutAfterFacial()
}

function onFacialOutNotRecognized() {
  step.value = 'clocked_in'
}

async function doClockOutAfterFacial() {
  locationError.value = null
  locationOut.value = null
  try {
    const loc = await getLocation()
    locationOut.value = loc
    const locStr = locationString(loc)!
    const mod = todayRecord.value?.work_modality
    const branchId = todayRecord.value?.branch_location ?? null
    if (mod === 'office' && isOutsideBranch(loc, branchId)) {
      clockOutConfirm.value = { outsideOffice: true }
      return
    }
    await clockOut(locStr)
    step.value = 'idle'
    locationOut.value = null
  } catch {
    await clockOut()
    step.value = 'idle'
  }
}

function confirmClockOutOutside() {
  const loc = locationString(locationOut.value)
  if (!loc) return
  clockOut(loc).then(() => {
    step.value = 'idle'
    clockOutConfirm.value = null
    locationOut.value = null
  })
}

function cancelClockOutConfirm() {
  clockOutConfirm.value = null
  locationOut.value = null
}

function cancelFlow() {
  step.value = 'idle'
  locationIn.value = null
  locationError.value = null
  if (!isClockedIn) step.value = 'idle'
}

function backToModality() {
  step.value = 'choose_modality'
  locationIn.value = null
  locationError.value = null
}

function fmt(t: string | null) {
  return t ? new Date(t).toLocaleTimeString() : '—'
}
function formatTotalTime(interval: string | null) {
  if (!interval) return '—'
  const timeMatch = interval.match(/^(\d+):(\d+):(\d+)/)
  if (timeMatch) {
    const [, h, m, s] = timeMatch.map(Number)
    const parts = []
    if (h) parts.push(`${h}h`)
    if (m) parts.push(`${m}m`)
    if (s || !parts.length) parts.push(`${s}s`)
    return parts.join(' ')
  }
  const match = interval.match(/(\d+)\s*hours?|(\d+)\s*minutes?|(\d+)\s*seconds?/gi)
  if (!match) return interval
  let h = 0, m = 0, s = 0
  match.forEach((p) => {
    const n = parseInt(p, 10)
    if (p.toLowerCase().includes('hour')) h = n
    else if (p.toLowerCase().includes('minute')) m = n
    else if (p.toLowerCase().includes('second')) s = n
  })
  const parts = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s || !parts.length) parts.push(`${s}s`)
  return parts.join(' ')
}
</script>

<template>
  <div class="timeclock-page">
    <div class="timeclock-layout">
      <!-- Left: Hero timeclock -->
      <div class="hero-section">
        <h1 class="hero-title">Timeclock</h1>
        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="locationError" class="error">{{ locationError }}</p>
        <div v-if="isLoading && !todayRecord && step === 'idle'" class="muted">Loading…</div>
        <template v-else>
          <!-- Active session -->
          <div v-if="todayRecord && !todayRecord.clock_out" class="hero-card">
            <div v-if="step === 'facial_out'" class="confirm-wrap facial-out-wrap">
              <div class="facial-placeholder">
                <span class="facial-icon" aria-hidden="true">👤</span>
                <p>Verify at facial to clock out</p>
                <div class="facial-btns">
                  <button type="button" class="btn secondary" @click="onFacialOutNotRecognized">Cancel</button>
                  <button type="button" class="btn primary" :disabled="isLoading" @click="onFacialOutRecognized">Recognized</button>
                </div>
              </div>
            </div>
            <div v-else-if="clockOutConfirm" class="confirm-wrap">
              <p class="confirm-msg">
                {{ clockOutConfirm.outsideOffice
                  ? 'Are you sure you want to clock out outside the office location? You will be flagged as travel.'
                  : 'Are you sure you want to clock out outside your WFH radius? You will be flagged as possible travel.' }}
              </p>
              <div class="actions">
                <button type="button" class="btn primary" :disabled="isLoading" @click="confirmClockOutOutside">Yes, clock out</button>
                <button type="button" class="btn secondary" @click="cancelClockOutConfirm">Cancel</button>
              </div>
            </div>
            <template v-else>
              <div v-if="isOnLunch" class="timer-wrap">
                <p class="timer-label">Lunch break</p>
                <div class="timer lunch-timer">{{ lunchElapsedDisplay }}</div>
                <p class="muted sub">Work: {{ elapsedDisplay }}</p>
              </div>
              <div v-else class="timer-wrap">
                <div class="timer">{{ elapsedDisplay }}</div>
                <p class="muted">In at {{ fmt(todayRecord.clock_in) }} · {{ todayRecord.work_modality ?? '—' }}</p>
              </div>
              <div v-if="todayRecord.lunch_break_start" class="lunch-info">
                <span class="muted">Lunch {{ isOnLunch ? 'started' : 'ended' }} at {{ isOnLunch ? fmt(todayRecord.lunch_break_start) : fmt(todayRecord.lunch_break_end) }}</span>
              </div>
              <div class="actions">
                <template v-if="!usedLunchBreak">
                  <button v-if="!isOnLunch" type="button" class="btn secondary" :disabled="isLoading" @click="startLunchBreak">Start lunch</button>
                  <button v-else type="button" class="btn secondary" :disabled="isLoading" @click="endLunchBreak">End lunch</button>
                </template>
                <button type="button" class="btn primary" :disabled="isLoading" @click="doClockOut">Clock out</button>
              </div>
            </template>
          </div>
          <!-- Choose modality (after Clock in click) -->
          <div v-else-if="step === 'choose_modality'" class="hero-card">
            <p class="muted">Where are you working?</p>
            <div class="modality-btns">
              <button type="button" class="btn" :class="{ primary: workModality === 'office', secondary: workModality !== 'office' }" @click="workModality = 'office'">Office</button>
              <button type="button" class="btn" :class="{ primary: workModality === 'wfh', secondary: workModality !== 'wfh' }" @click="workModality = 'wfh'">WFH</button>
            </div>
            <div v-if="workModality === 'office'" class="branch-select">
              <span class="muted small">Branch</span>
              <div class="branch-btns">
                <button v-for="b in BRANCHES" :key="b.id" type="button" class="btn branch-btn" :class="{ primary: selectedBranch?.id === b.id, secondary: selectedBranch?.id !== b.id }" @click="selectedBranch = b">{{ b.name }}</button>
              </div>
            </div>
            <p v-if="isOutsideOfficeRadius" class="block-msg">You are outside the location of the branch so you cannot continue.</p>
            <div class="actions">
              <button type="button" class="btn primary" :disabled="isLoading || (workModality === 'office' && (!selectedBranch || officeFetchingLocation || !locationIn || isOutsideOfficeRadius)) || (workModality === 'wfh' && wfhFetchingLocation)" @click="selectModalityAndStart(workModality)">Continue</button>
              <button type="button" class="btn secondary" @click="step = 'idle'">Cancel</button>
            </div>
          </div>
          <!-- Getting location -->
          <div v-else-if="step === 'getting_location'" class="hero-card">
            <p class="muted">Getting your location…</p>
            <button type="button" class="btn secondary" @click="backToModality">Cancel</button>
          </div>
          <!-- Office facial -->
          <div v-else-if="step === 'facial' && workModality === 'office'" class="hero-card">
            <div class="facial-placeholder">
              <span class="facial-icon" aria-hidden="true">👤</span>
              <p>Verify at facial</p>
              <div class="facial-btns">
                <button type="button" class="btn secondary" @click="onFacialNotRecognized">Not recognized</button>
                <button type="button" class="btn primary" :disabled="isLoading" @click="onFacialRecognized">Recognized</button>
              </div>
            </div>
          </div>
          <!-- Idle: start -->
          <div v-else class="hero-card hero-idle">
            <p class="muted hero-sub">Track location to clock in</p>
            <button type="button" class="btn hero-cta" :disabled="isLoading" @click="onClockInClick">Clock in</button>
            <div v-if="completedToday.length" class="completed-list">
              <p class="muted small">Today</p>
              <div v-for="r in completedToday" :key="r.attendance_id" class="completed-row">
                {{ fmt(r.clock_in) }} – {{ fmt(r.clock_out) }} · {{ formatTotalTime(r.total_time) }} · {{ r.work_modality ?? '—' }}
              </div>
            </div>
          </div>
        </template>
      </div>
      <!-- Right: Map -->
      <aside class="map-aside">
        <div class="map-wrap-wrapper">
          <div ref="mapContainer" class="map-wrap"></div>
          <div v-if="(workModality === 'wfh' && wfhFetchingLocation) || (workModality === 'office' && officeFetchingLocation)" class="map-branch-label map-loading-label">
            <span class="map-loading-spinner" aria-hidden="true"></span>
            <strong>Getting your location…</strong>
          </div>
        </div>
        <p class="map-caption muted">{{ workModality === 'office' && activeBranch ? activeBranch.address : (workModality === 'wfh' && wfhAddress ? wfhAddress : 'Location') }} · {{ RADIUS_M }}m radius</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.timeclock-page { padding: 0; }
.timeclock-layout { display: grid; grid-template-columns: 1fr 400px; gap: 2rem; align-items: start; }
@media (max-width: 900px) { .timeclock-layout { grid-template-columns: 1fr; } }
.hero-section { min-width: 0; }
.hero-title { margin: 0 0 0.5rem; font-size: 1.75rem; font-weight: 600; letter-spacing: -0.02em; }
.hero-sub { margin: 0 0 1rem; font-size: 0.9375rem; }
.hero-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 2rem; margin-top: 0.5rem; }
.hero-idle { padding: 2.5rem; }
.hero-cta { padding: 0.875rem 2rem; font-size: 1.125rem; font-weight: 600; border-radius: 12px; }
.error { color: #f87171; font-size: 0.875rem; margin: 0 0 0.5rem; }
.muted { color: #64748b; font-size: 0.875rem; margin: 0.5rem 0; }
.block-msg { color: #fbbf24; margin: 0 0 1rem; }
.timer-wrap { margin-bottom: 0.25rem; }
.timer-label { margin: 0 0 0.25rem; font-size: 0.875rem; color: #94a3b8; }
.timer { font-size: 2.25rem; font-weight: 700; color: #38bdf8; font-variant-numeric: tabular-nums; }
.timer.lunch-timer { color: #fbbf24; }
.timer-wrap .sub { margin-top: 0.5rem; font-size: 0.8125rem; }
.lunch-info { margin: 0.25rem 0; }
.modality-btns { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
.actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
.btn { padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.9375rem; font-weight: 500; cursor: pointer; border: none; transition: opacity 0.2s; }
.btn.primary { background: #0ea5e9; color: #fff; }
.btn.secondary { background: rgba(255,255,255,0.1); color: #e2e8f0; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.confirm-wrap { margin: 0; }
.confirm-msg { color: #fbbf24; margin: 0 0 1rem; font-size: 0.9375rem; }
.facial-placeholder { text-align: center; padding: 0.5rem 0; }
.facial-icon { font-size: 3rem; display: block; margin-bottom: 0.5rem; }
.facial-placeholder p { margin: 0 0 1rem; color: #94a3b8; }
.facial-btns { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
.completed-list { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.08); }
.completed-list .small { font-size: 0.75rem; margin-bottom: 0.5rem; }
.completed-row { font-size: 0.8125rem; color: #94a3b8; padding: 0.25rem 0; }
.map-aside { display: flex; flex-direction: column; gap: 0.5rem; }
.map-wrap-wrapper { position: relative; min-height: 320px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: #f1f5f9; }
.map-wrap-wrapper :deep(.map-center-icon) { background: none; border: none; }
.map-wrap-wrapper :deep(.map-center-icon .center-pin) { display: block; line-height: 0; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25)); }
.map-wrap-wrapper :deep(.map-center-icon .center-pin svg) { display: block; }
.map-wrap-wrapper :deep(.map-bound-tooltip) { background: rgba(255,255,255,0.97); border: 1px solid rgba(0,0,0,0.08); border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); padding: 0; font-size: 0.8125rem; color: #334155; white-space: nowrap; }
.map-wrap-wrapper :deep(.map-bound-tooltip-user) { white-space: normal; max-width: 220px; text-align: center; }
.map-wrap-wrapper :deep(.map-tooltip-address[title]) { cursor: help; }
.map-wrap-wrapper :deep(.map-bound-tooltip::before) { border-top-color: rgba(255,255,255,0.97); }
.map-wrap-wrapper :deep(.map-tooltip-inner) { padding: 8px 12px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.map-wrap-wrapper :deep(.map-tooltip-inner strong) { color: #0f172a; font-weight: 600; font-size: 0.8125rem; }
.map-wrap-wrapper :deep(.map-tooltip-inner span) { color: #64748b; font-size: 0.75rem; }
.map-wrap { width: 100%; height: 320px; border-radius: 12px; }
.map-branch-label { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); padding: 10px 18px; border-radius: 12px; background: rgba(255,255,255,0.96); box-shadow: 0 4px 20px rgba(0,0,0,0.12); font-size: 0.8125rem; color: #334155; display: flex; flex-direction: column; align-items: center; gap: 3px; pointer-events: none; text-align: center; z-index: 1000; max-width: calc(100% - 24px); }
.map-branch-label strong { color: #0f172a; font-weight: 600; }
.map-branch-label span { color: #64748b; font-size: 0.75rem; letter-spacing: 0.02em; }
.map-loading-label { flex-direction: row; gap: 8px; align-items: center; }
.map-loading-spinner { width: 18px; height: 18px; border: 2px solid rgba(14, 165, 233, 0.3); border-top-color: #0ea5e9; border-radius: 50%; animation: map-spin 0.7s linear infinite; }
@keyframes map-spin { to { transform: rotate(360deg); } }
.map-wfh-address { align-items: center; }
.map-address-text { font-size: 0.75rem; color: #475569; line-height: 1.3; max-width: 260px; white-space: normal; word-break: break-word; }
.map-caption { font-size: 0.75rem; margin: 0; }
.branch-select { margin: 0.75rem 0 0; }
.branch-select .small { display: block; margin-bottom: 0.35rem; font-size: 0.8125rem; }
.branch-btns { display: flex; flex-direction: column; gap: 0.4rem; }
.branch-btn { text-align: left; justify-content: flex-start; }
.facial-out-wrap .facial-placeholder { padding: 0.5rem 0; }
</style>
