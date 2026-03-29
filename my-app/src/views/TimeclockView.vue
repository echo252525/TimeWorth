<script setup lang="ts">
import { onMounted, onUnmounted, nextTick, ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
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
  storedToRealInstant,
  type WorkModality,
  type Branch
} from '../composables/useAttendance'
import { useAuth } from '../composables/useAuth'
import supabase from '../lib/supabaseClient'

const route = useRoute()
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
const { user, getSignedProfileUrl } = useAuth()
const userProfileUrl = ref<string | null>(null)
const userInitial = ref<string>('?')

const workModality = ref<WorkModality>('office')
const selectedBranch = ref<Branch | null>(BRANCHES[0])
const step = ref<'idle' | 'choose_modality' | 'getting_location' | 'facial' | 'clocked_in' | 'facial_out'>('idle')
const liveLocation = ref<{ lat: number; lng: number } | null>(null)
const locationIn = ref<{ lat: number; lng: number } | null>(null)
const locationOut = ref<{ lat: number; lng: number } | null>(null)
const locationError = ref<string | null>(null)
const clockOutConfirm = ref<{ outsideOffice?: boolean; outsideWfh?: boolean } | null>(null)

// Liveness verification state
const livenessVerificationId = ref<string | null>(null)
const facialScanSuccess = ref(false)
const livenessLoading = ref(false)
const livenessError = ref<string | null>(null)
let livenessRealtimeChannel: ReturnType<typeof supabase.channel> | null = null

const wfhFetchingLocation = ref(false)
const officeFetchingLocation = ref(false)
const locationFetchedOnMount = ref(false)
const wfhAddress = ref<string | null>(null)
const officeUserAddress = ref<string | null>(null)
const mapContainer = ref<HTMLElement | null>(null)
const userEdgeIndicator = ref<HTMLElement | null>(null)
const branchEdgeIndicator = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let circle: L.Circle | null = null
let userMarker: L.Marker | null = null
let userLabelMarker: L.Marker | null = null
let centerMarker: L.Marker | null = null
let liveWatchId: number | null = null

const centerIcon = L.divIcon({
  className: 'map-center-icon',
  html: '<span class="center-pin" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0ea5e9" width="28" height="28"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></span>',
  iconSize: [28, 36],
  iconAnchor: [14, 36]
})

async function loadUserProfile() {
  if (!user.value?.id) return
  const { data } = await supabase.from('employee').select('name, picture').eq('id', user.value.id).maybeSingle()
  if (data?.name) userInitial.value = data.name.trim().slice(0, 1).toUpperCase()
  const pathOrUrl = data?.picture
  if (!pathOrUrl) return
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    userProfileUrl.value = pathOrUrl
  } else {
    userProfileUrl.value = await getSignedProfileUrl(pathOrUrl)
  }
}

const LIVENESS_RESUME_MAX_AGE_MS = 60 * 60 * 1000 // 1 hour

function resumeLivenessRow(row: { id: string }) {
  livenessVerificationId.value = row.id
  step.value = 'facial'
  livenessRealtimeChannel = supabase
    .channel(`facial:${row.id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'facial_verifications', filter: `id=eq.${row.id}` },
      (payload: { new: { facial_clock_in?: boolean } }) => {
        if (payload.new?.facial_clock_in === true) onFacialClockInVerified()
      }
    )
    .subscribe()
}

async function cancelLiveness() {
  const id = livenessVerificationId.value
  if (id) {
    await supabase.from('facial_verifications').delete().eq('id', id)
  }
  closeLivenessRealtime()
  livenessVerificationId.value = null
  livenessError.value = null
  step.value = 'choose_modality'
  locationIn.value = null
  locationError.value = null
}

onMounted(() => {
  fetchToday()
  loadUserProfile()
  nextTick(() => { if (mapContainer.value) initMap() })
  startLiveLocationWatch()
  fetchLocationOnce()
  // Check if we should auto-trigger clock in
  if (route.query.clockin === 'true' && !isClockedIn.value && step.value === 'idle') {
    nextTick(() => {
      onClockInClick()
    })
  }
})

onUnmounted(() => {
  closeLivenessRealtime()
  if (liveWatchId !== null && navigator.geolocation && 'clearWatch' in navigator.geolocation) {
    navigator.geolocation.clearWatch(liveWatchId)
    liveWatchId = null
  }
  centerMarker?.remove()
  userMarker?.remove()
  userLabelMarker?.remove()
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

const userLoc = computed(() => liveLocation.value ?? locationIn.value ?? locationOut.value ?? null)

const isOutsideOfficeRadius = computed(() => {
  // TEMPORARILY DISABLED FOR TESTING FACIAL RECOGNITION
  // TODO: Re-enable location check after testing
  return false
  // Original code:
  // return workModality.value === 'office' &&
  //   step.value === 'choose_modality' &&
  //   !!locationIn.value &&
  //   !!selectedBranch.value &&
  //   isOutsideBranch(locationIn.value, selectedBranch.value.id)
})

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
  if (map) return
  if (!mapContainer.value) return
  map = L.map(mapContainer.value, { zoomControl: false }).setView([mapCenter.value.lat, mapCenter.value.lng], 16)
  L.control.zoom({ position: 'topright' }).addTo(map!)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 20 }).addTo(map!)
  circle = L.circle([mapCenter.value.lat, mapCenter.value.lng], { radius: RADIUS_M, color: '#0ea5e9', weight: 2, fillColor: '#0ea5e9', fillOpacity: 0.08 })
  map.on('moveend zoomend', updateEdgeIndicators)
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

const USER_MARKER_SIZE = 40

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function createUserMarkerIcon(): L.DivIcon {
  const pic = userProfileUrl.value
  const initial = escapeHtml(userInitial.value)
  const imgHtml = pic
    ? `<img src="${escapeHtml(pic)}" alt="" class="map-user-marker-img" />`
    : `<span class="map-user-marker-initial">${initial}</span>`
  return L.divIcon({
    className: 'map-user-marker',
    html: `<div class="map-user-marker-wrap">${imgHtml}</div>`,
    iconSize: [USER_MARKER_SIZE, USER_MARKER_SIZE],
    iconAnchor: [USER_MARKER_SIZE / 2, USER_MARKER_SIZE]
  })
}

const userLabelIcon = L.divIcon({
  className: 'map-user-label-icon',
  html: '',
  iconSize: [0, 0],
  iconAnchor: [0, 0]
})

function updateUserMarker() {
  if (!map) return
  userMarker?.remove()
  userLabelMarker?.remove()
  const loc = userLoc.value
  if (loc) {
    const icon = createUserMarkerIcon()
    userMarker = L.marker([loc.lat, loc.lng], { icon }).addTo(map!)
    const fullAddress = workModality.value === 'wfh' && wfhAddress.value
      ? wfhAddress.value
      : (workModality.value === 'office' && officeUserAddress.value)
        ? officeUserAddress.value
        : `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`
    userMarker.bindTooltip(
      `<div class="map-tooltip-inner map-tooltip-you"><strong>You are here</strong><span class="map-tooltip-address" title="${escapeHtml(fullAddress)}">${escapeHtml(fullAddress)}</span></div>`,
      { permanent: false, direction: 'top', offset: [0, -USER_MARKER_SIZE - 8], className: 'map-bound-tooltip map-bound-tooltip-user', sticky: true }
    )
    userLabelMarker = L.marker([loc.lat, loc.lng], { icon: userLabelIcon }).addTo(map!)
    userLabelMarker.bindTooltip(
      `<div class="map-tooltip-inner map-tooltip-you-label"><strong>You are here</strong><span class="map-tooltip-address-hover">${escapeHtml(fullAddress)}</span></div>`,
      { permanent: true, direction: 'top', offset: [0, -USER_MARKER_SIZE - 12], className: 'map-bound-tooltip map-bound-tooltip-user-label', interactive: true }
    ).openTooltip()
  } else {
    userMarker = null
    userLabelMarker = null
  }
}

const DEFAULT_MAP_VIEW = { lat: 14.5995, lng: 120.9842, zoom: 13 }

function getEdgePosition(targetLat: number, targetLng: number): { visible: boolean; x: number; y: number; angle: number } | null {
  if (!map || !mapContainer.value) return null
  const bounds = map.getBounds()
  if (bounds.contains([targetLat, targetLng])) return { visible: true, x: 0, y: 0, angle: 0 }
  const containerRect = mapContainer.value.getBoundingClientRect()
  const center = map.getCenter()
  const centerPoint = map.latLngToContainerPoint(center)
  const targetPoint = map.latLngToContainerPoint([targetLat, targetLng])
  const dx = targetPoint.x - centerPoint.x
  const dy = targetPoint.y - centerPoint.y
  const angle = Math.atan2(dy, dx) * (180 / Math.PI)
  const w = containerRect.width
  const h = containerRect.height
  const halfW = w / 2
  const halfH = h / 2
  const slope = dy / dx
  let x = 0, y = 0
  if (Math.abs(dx) > Math.abs(dy)) {
    x = dx > 0 ? w - 24 : 24
    y = halfH + (x - halfW) * slope
    if (y < 24) y = 24
    if (y > h - 24) y = h - 24
  } else {
    y = dy > 0 ? h - 24 : 24
    x = halfW + (y - halfH) / slope
    if (x < 24) x = 24
    if (x > w - 24) x = w - 24
  }
  return { visible: false, x, y, angle }
}

function focusOnUserLocation() {
  if (!map || !userLoc.value) return
  map.setView([userLoc.value.lat, userLoc.value.lng], 17, { animate: true, duration: 0.5 })
}

function focusOnBranchLocation() {
  if (!map) return
  const branchLoc = workModality.value === 'office' && step.value !== 'idle' ? mapCenter.value : null
  if (!branchLoc) return
  map.setView([branchLoc.lat, branchLoc.lng], 17, { animate: true, duration: 0.5 })
}

function updateEdgeIndicators() {
  if (!map || !mapContainer.value) return
  const userLocVal = userLoc.value
  const branchLoc = workModality.value === 'office' && step.value !== 'idle' ? mapCenter.value : null
  if (userLocVal) {
    const pos = getEdgePosition(userLocVal.lat, userLocVal.lng)
    if (pos && !pos.visible && userEdgeIndicator.value) {
      userEdgeIndicator.value.style.display = 'block'
      userEdgeIndicator.value.style.left = `${pos.x}px`
      userEdgeIndicator.value.style.top = `${pos.y}px`
      userEdgeIndicator.value.style.transform = `translate(-50%, -50%) rotate(${pos.angle}deg)`
    } else if (userEdgeIndicator.value) {
      userEdgeIndicator.value.style.display = 'none'
    }
  } else if (userEdgeIndicator.value) {
    userEdgeIndicator.value.style.display = 'none'
  }
  if (branchLoc) {
    const pos = getEdgePosition(branchLoc.lat, branchLoc.lng)
    if (pos && !pos.visible && branchEdgeIndicator.value) {
      branchEdgeIndicator.value.style.display = 'block'
      branchEdgeIndicator.value.style.left = `${pos.x}px`
      branchEdgeIndicator.value.style.top = `${pos.y}px`
      branchEdgeIndicator.value.style.transform = `translate(-50%, -50%) rotate(${pos.angle}deg)`
    } else if (branchEdgeIndicator.value) {
      branchEdgeIndicator.value.style.display = 'none'
    }
  } else if (branchEdgeIndicator.value) {
    branchEdgeIndicator.value.style.display = 'none'
  }
}

function updateMapView() {
  if (!map) return
  if (step.value === 'idle') {
    circle?.remove()
    centerMarker?.remove()
    const live = userLoc.value
    if (live) {
      map.setView([live.lat, live.lng], 17)
    } else {
      map.setView([DEFAULT_MAP_VIEW.lat, DEFAULT_MAP_VIEW.lng], DEFAULT_MAP_VIEW.zoom)
    }
    updateUserMarker()
    return
  }
  if (workModality.value === 'wfh') {
    circle?.remove()
    updateCenterMarker()
    updateUserMarker()
    const c = mapCenter.value
    map.setView([c.lat, c.lng], 16)
    nextTick(() => updateEdgeIndicators())
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
  if (loc) {
    const branchPoint = L.latLng(c.lat, c.lng)
    const userPoint = L.latLng(loc.lat, loc.lng)
    const bounds = L.latLngBounds([branchPoint, userPoint]).pad(0.15)
    map.fitBounds(bounds, { maxZoom: 17, padding: [24, 24] })
  } else {
    map.setView([c.lat, c.lng], 16)
  }
  nextTick(() => updateEdgeIndicators())
}

watch([mapCenter, userLoc, workModality, activeBranch, step, locationIn, wfhAddress, officeUserAddress, userProfileUrl], () => {
  updateMapView()
  nextTick(() => updateEdgeIndicators())
}, { flush: 'post' })

function fetchLocationOnce() {
  if (locationFetchedOnMount.value) {
    console.log('[Timeclock] fetchLocationOnce skipped (already fetched on mount)')
    return
  }
  console.log('[Timeclock] fetchLocationOnce starting (single fetch when timeclock page renders)')
  locationFetchedOnMount.value = true
  locationIn.value = null
  wfhAddress.value = null
  officeUserAddress.value = null
  officeFetchingLocation.value = true
  wfhFetchingLocation.value = true
  getLocation()
    .then((loc) => {
      locationIn.value = loc
      console.log('[Timeclock] location fetched', { lat: loc.lat, lng: loc.lng })
      nextTick(() => updateMapView())
      reverseGeocode(loc.lat, loc.lng).then((addr) => {
        officeUserAddress.value = addr
        wfhAddress.value = addr
      })
    })
    .catch((err) => {
      console.warn('[Timeclock] getLocation failed', err)
    })
    .finally(() => {
      officeFetchingLocation.value = false
      wfhFetchingLocation.value = false
      console.log('[Timeclock] fetchLocationOnce done, loading flags cleared')
    })
}

watch(workModality, () => {
  console.log('[Timeclock] workModality changed', { to: workModality.value, locationIn: !!locationIn.value, officeFetching: officeFetchingLocation.value, wfhFetching: wfhFetchingLocation.value })
  if (step.value === 'choose_modality' && locationIn.value) nextTick(() => updateMapView())
})

watch(step, (s) => {
  console.log('[Timeclock] step changed', { to: s, locationFetchedOnMount: locationFetchedOnMount.value })
})

watch(
  () => todayRecord.value?.work_modality,
  (m) => {
    if (m === 'office' || m === 'wfh') workModality.value = m
  },
  { immediate: true }
)

watch(
  isClockedIn,
  (in_) => {
    if (in_ && step.value === 'idle') step.value = 'clocked_in'
  },
  { immediate: true }
)

watch(
  () => ({ in: isClockedIn.value, el: elapsedDisplay.value, id: todayRecord.value?.attendance_id }),
  (v) => {
    if (v.in && v.id) console.debug('[Timeclock] timer', { elapsedDisplay: v.el, attendanceId: v.id })
  }
)

watch(step, async (s, prev) => {
  const verificationId = livenessVerificationId.value ?? todayRecord.value?.liveness_verifications_id ?? null
  if (s === 'facial_out' && verificationId) {
    if (!livenessVerificationId.value && todayRecord.value?.liveness_verifications_id) {
      livenessVerificationId.value = todayRecord.value.liveness_verifications_id
    }
    closeLivenessRealtime()
    const id = verificationId
    // User has clicked Clock out and facial-out flow is starting:
    // mark that this clock-out attempt is via facial verification
    await supabase
      .from('facial_verifications')
      .update({ facial_clock_out_indicator: true })
      .eq('id', id)
    livenessRealtimeChannel = supabase
      .channel(`facial-out:${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'facial_verifications',
          filter: `id=eq.${id}`
        },
        async (payload: { new: { facial_clock_out?: boolean } }) => {
          if (payload.new?.facial_clock_out !== true) return
          facialScanSuccess.value = true
          try {
            const loc = await getLocation()
            locationOut.value = loc
            const locStr = locationString(loc)
            if (locStr) await clockOut(locStr)
            else await clockOut()
          } catch {
            await clockOut()
          }
          setTimeout(() => {
            closeLivenessRealtime()
            livenessVerificationId.value = null
            facialScanSuccess.value = false
            step.value = 'idle'
            locationOut.value = null
            fetchToday()
          }, 1800)
        }
      )
      .subscribe()
  } else if (prev === 'facial_out' && s !== 'facial_out') {
    closeLivenessRealtime()
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

function startLiveLocationWatch() {
  if (!navigator.geolocation) return
  try {
    liveWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        liveLocation.value = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        }
        nextTick(() => {
          updateMapView()
        })
      },
      () => {
        // ignore errors for live preview; user may deny permission
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )
  } catch {
    liveWatchId = null
  }
}

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
  } catch (e) {
    locationError.value = e instanceof Error ? e.message : 'Location failed'
    step.value = 'choose_modality'
    return
  }
  if (workModality.value === 'office' && branch) {
    await startLivenessVerification()
  }
}

function closeLivenessRealtime() {
  if (livenessRealtimeChannel) {
    supabase.removeChannel(livenessRealtimeChannel)
    livenessRealtimeChannel = null
  }
}

async function startLivenessVerification() {
  if (!user.value?.id) return
  livenessLoading.value = true
  livenessError.value = null
  closeLivenessRealtime()

  try {
    const oneHourAgo = new Date(Date.now() - LIVENESS_RESUME_MAX_AGE_MS).toISOString()
    const { data: existingRow } = await supabase
      .from('facial_verifications')
      .select('id')
      .eq('user_id', user.value.id)
      .or('facial_clock_in.is.null,facial_clock_in.eq.false')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingRow?.id) {
      livenessLoading.value = false
      resumeLivenessRow(existingRow)
      return
    }

    const { data: row, error: insertError } = await supabase
      .from('facial_verifications')
      .insert({ user_id: user.value.id })
      .select('id')
      .single()

    if (insertError) {
      console.error('Facial verification insert error:', insertError)
      throw insertError
    }
    if (!row?.id) throw new Error('No verification row returned')

    livenessVerificationId.value = row.id
    step.value = 'facial'
    livenessLoading.value = false

    livenessRealtimeChannel = supabase
      .channel(`facial:${row.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'facial_verifications',
          filter: `id=eq.${row.id}`
        },
        (payload: { new: { facial_clock_in?: boolean } }) => {
          if (payload.new?.facial_clock_in === true) {
            onFacialClockInVerified()
          }
        }
      )
      .subscribe()
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Failed to start facial verification'
    console.error('Facial verification error:', e)
    livenessError.value = errorMessage
    step.value = 'choose_modality'
  } finally {
    livenessLoading.value = false
  }
}

async function onFacialClockInVerified() {
  facialScanSuccess.value = true
  let locStr: string | undefined = locationString(locationIn.value) ?? undefined
  if (workModality.value === 'office' && !locStr) {
    try {
      const loc = await getLocation()
      locationIn.value = loc
      locStr = locationString(loc) ?? undefined
    } catch {
      locationError.value = 'Location required to clock in'
      facialScanSuccess.value = false
      return
    }
  }
  const branchId = workModality.value === 'office' ? selectedBranch.value?.id : undefined
  await clockIn(workModality.value, { locationIn: locStr, facialStatus: 'verified', branchLocation: branchId, livenessVerificationId: livenessVerificationId.value ?? undefined })
  // Match WFH: enter clocked-in state immediately so the live timer is visible (not hidden under step==='facial').
  step.value = 'clocked_in'
  closeLivenessRealtime()
  setTimeout(() => {
    facialScanSuccess.value = false
    locationIn.value = null
    fetchToday()
    // keep livenessVerificationId for clock-out facial scan
  }, 1800)
}

async function cancelFacialModal() {
  if (step.value === 'facial') {
    const id = livenessVerificationId.value
    if (id) {
      await supabase.from('facial_verifications').delete().eq('id', id)
    }
    closeLivenessRealtime()
    livenessVerificationId.value = null
    step.value = 'choose_modality'
    locationIn.value = null
  } else {
    step.value = 'clocked_in'
    closeLivenessRealtime()
  }
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
function fmtStored(t: string | null) {
  return t ? new Date(storedToRealInstant(t)).toLocaleTimeString() : '—'
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

function parseIntervalSeconds(interval: string | null): number {
  if (!interval) return 0
  const timeMatch = interval.match(/^(\d+):(\d+):(\d+)/)
  if (timeMatch) {
    const [, hStr, mStr, sStr] = timeMatch
    const h = Number(hStr) || 0
    const m = Number(mStr) || 0
    const s = Number(sStr) || 0
    return h * 3600 + m * 60 + s
  }
  const match = interval.match(/(\d+)\s*hours?|(\d+)\s*minutes?|(\d+)\s*seconds?/gi)
  if (!match) return 0
  let h = 0, m = 0, s = 0
  match.forEach((p) => {
    const n = parseInt(p, 10)
    if (p.toLowerCase().includes('hour')) h = n
    else if (p.toLowerCase().includes('minute')) m = n
    else if (p.toLowerCase().includes('second')) s = n
  })
  return h * 3600 + m * 60 + s
}

const TARGET_DAY_SECONDS = 8 * 3600
// Radius used for the minimalist time-left ring indicator
const timeLeftRadius = 14
const timeLeftCircumference = 2 * Math.PI * timeLeftRadius

const workedSecondsToday = computed(() => {
  return completedToday.value.reduce(
    (sum, r) => sum + parseIntervalSeconds((r as { total_time: string | null }).total_time ?? null),
    0
  )
})

const remainingSecondsToday = computed(() => {
  return Math.max(0, TARGET_DAY_SECONDS - workedSecondsToday.value)
})

const remainingHoursLabel = computed(() => {
  if (remainingSecondsToday.value <= 0) return '0h'
  const hours = remainingSecondsToday.value / 3600
  if (hours >= 1) {
    const rounded = Math.round(hours * 10) / 10
    return `${rounded}h`
  }
  const mins = Math.max(1, Math.round(remainingSecondsToday.value / 60))
  return `${mins}m`
})

const timeLeftProgressFraction = computed(() => {
  if (TARGET_DAY_SECONDS <= 0) return 0
  return Math.max(0, Math.min(1, remainingSecondsToday.value / TARGET_DAY_SECONDS))
})

const timeLeftDashOffset = computed(() => {
  return (1 - timeLeftProgressFraction.value) * timeLeftCircumference
})

/** Elapsed work fraction (0 = start, 1 = 8h, >1 = overtime) for timer color. */
const elapsedFractionForColor = computed(() => {
  if (TARGET_DAY_SECONDS <= 0) return 0
  return workedSecondsToday.value / TARGET_DAY_SECONDS
})

/** CSS color for the circular timer progress stroke: Blue → Green → Red by elapsed time. */
const timeLeftProgressColor = computed(() => {
  const t = elapsedFractionForColor.value
  const blue = { r: 14, g: 165, b: 233 }
  const green = { r: 34, g: 197, b: 94 }
  const red = { r: 248, g: 113, b: 113 }
  let r: number, g: number, b: number
  if (t <= 0.5) {
    r = blue.r; g = blue.g; b = blue.b
  } else if (t <= 1) {
    const u = (t - 0.5) / 0.5
    r = Math.round(blue.r + (green.r - blue.r) * u)
    g = Math.round(blue.g + (green.g - blue.g) * u)
    b = Math.round(blue.b + (green.b - blue.b) * u)
  } else {
    const u = Math.min(1, (t - 1) / 0.5)
    r = Math.round(green.r + (red.r - green.r) * u)
    g = Math.round(green.g + (red.g - green.g) * u)
    b = Math.round(green.b + (red.b - green.b) * u)
  }
  return `rgb(${r}, ${g}, ${b})`
})

const cancelFacialLoading = ref(false)
async function handleCancelFacial() {
  cancelFacialLoading.value = true
  try {
    await cancelFacialModal()
  } finally {
    cancelFacialLoading.value = false
  }
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
          <div v-if="todayRecord && !todayRecord.clock_out" class="hero-card hero-idle">
            <div v-if="step === 'facial_out'" class="confirm-wrap facial-out-wrap">
              <p class="muted">Face verification in progress…</p>
            </div>
            <div v-else-if="clockOutConfirm" class="confirm-wrap">
              <p class="confirm-msg">
                {{ clockOutConfirm.outsideOffice
                  ? 'Are you sure you want to clock out outside the office location? You will be flagged as travel.'
                  : 'Are you sure you want to clock out outside your WFH radius? You will be flagged as possible travel.' }}
              </p>
              <div class="actions">
                <button type="button" class="btn primary" :disabled="isLoading" @click="confirmClockOutOutside">
                  <span v-if="isLoading" class="btn-loading-wrap">
                    <span class="btn-loading-spinner" aria-hidden="true"></span>
                    <span>Clocking out…</span>
                  </span>
                  <span v-else>Yes, clock out</span>
                </button>
                <button type="button" class="btn secondary" @click="cancelClockOutConfirm">Cancel</button>
              </div>
            </div>
            <template v-else>
              <!-- Same layout as idle card: left = ticking timer, right = 8h ring — so office/WFH match -->
              <div class="hero-sub-row clocked-hero-row">
                <div class="clocked-hero-left">
                  <template v-if="isOnLunch">
                    <p class="timer-label">Lunch break</p>
                    <div class="timer lunch-timer timer-hero-main">{{ lunchElapsedDisplay }}</div>
                    <p class="muted sub">Work: {{ elapsedDisplay }}</p>
                  </template>
                  <template v-else>
                    <p class="muted hero-sub clocked-hero-label">Working · {{ todayRecord.work_modality ?? '—' }}</p>
                    <div class="timer timer-hero-main" aria-live="polite">{{ elapsedDisplay }}</div>
                    <p class="muted clocked-hero-meta">In at {{ fmtStored(todayRecord.clock_in) }}</p>
                  </template>
                </div>
                <div
                  v-if="remainingHoursLabel"
                  class="time-left-badge"
                  :aria-label="isOnLunch ? 'Time left in work day' : 'Time left before 8h target'"
                >
                  <svg class="time-left-icon" viewBox="0 0 40 40" aria-hidden="true">
                    <circle class="time-left-track" cx="20" cy="20" r="14" fill="none" />
                    <circle
                      class="time-left-progress"
                      cx="20"
                      cy="20"
                      r="14"
                      fill="none"
                      :stroke-dasharray="timeLeftCircumference"
                      :stroke-dashoffset="timeLeftDashOffset"
                      :stroke="timeLeftProgressColor"
                    />
                    <text x="20" y="23" class="time-left-number time-left-number-pulse" text-anchor="middle">
                      {{ remainingHoursLabel }}
                    </text>
                  </svg>
                </div>
              </div>
              <div v-if="todayRecord.lunch_break_start" class="lunch-info">
                <span class="muted">Lunch {{ isOnLunch ? 'started' : 'ended' }} at {{ isOnLunch ? fmtStored(todayRecord.lunch_break_start) : fmtStored(todayRecord.lunch_break_end) }}</span>
              </div>
              <div class="actions">
                <template v-if="!usedLunchBreak">
                  <button v-if="!isOnLunch" type="button" class="btn secondary" :disabled="isLoading" @click="startLunchBreak">
                    <span v-if="isLoading" class="btn-loading-wrap">
                      <span class="btn-loading-spinner" aria-hidden="true"></span>
                      <span>Starting…</span>
                    </span>
                    <span v-else>Start lunch</span>
                  </button>
                  <button v-else type="button" class="btn secondary" :disabled="isLoading" @click="endLunchBreak">
                    <span v-if="isLoading" class="btn-loading-wrap">
                      <span class="btn-loading-spinner" aria-hidden="true"></span>
                      <span>Ending…</span>
                    </span>
                    <span v-else>End lunch</span>
                  </button>
                </template>
                <button type="button" class="btn primary btn-clockout" :disabled="isLoading" @click="doClockOut">
                  <span v-if="isLoading" class="btn-loading-wrap">
                    <span class="btn-loading-spinner" aria-hidden="true"></span>
                    <span>Clocking out…</span>
                  </span>
                  <span v-else>Clock out</span>
                </button>
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
            <p v-if="(officeFetchingLocation || wfhFetchingLocation) && !locationIn" class="muted">
              Getting location…
            </p>
            <p v-if="isOutsideOfficeRadius" class="block-msg">You are outside the location of the branch so you cannot continue.</p>
            <div class="actions">
              <button
                type="button"
                class="btn primary"
                :disabled="isLoading || ((officeFetchingLocation || wfhFetchingLocation) && !locationIn)"
                @click="selectModalityAndStart(workModality)"
              >
                <span v-if="isLoading">Continuing…</span>
                <span v-else-if="(officeFetchingLocation || wfhFetchingLocation) && !locationIn">Getting location…</span>
                <span v-else>Continue</span>
              </button>
              <button type="button" class="btn secondary" @click="step = 'idle'">Cancel</button>
            </div>
          </div>
          <!-- Office facial: message shown in modal -->
          <div v-else-if="step === 'facial' && workModality === 'office'" class="hero-card">
            <p class="muted">Face verification in progress…</p>
          </div>
          <!-- Idle: start -->
          <div v-else class="hero-card hero-idle">
            <div class="hero-sub-row">
              <p class="muted hero-sub">
                Track location to clock in
              </p>
              <div v-if="remainingHoursLabel" class="time-left-badge" aria-label="Time left before clock out">
                <svg class="time-left-icon" viewBox="0 0 40 40" aria-hidden="true">
                  <circle
                    class="time-left-track"
                    cx="20"
                    cy="20"
                    r="14"
                    fill="none"
                  />
                  <circle
                    class="time-left-progress"
                    cx="20"
                    cy="20"
                    r="14"
                    fill="none"
                    :stroke-dasharray="timeLeftCircumference"
                    :stroke-dashoffset="timeLeftDashOffset"
                    :stroke="timeLeftProgressColor"
                  />
                  <text
                    x="20"
                    y="23"
                    class="time-left-number time-left-number-pulse"
                    text-anchor="middle"
                  >
                    {{ remainingHoursLabel }}
                  </text>
                </svg>
              </div>
            </div>
            <button type="button" class="btn hero-cta" :disabled="isLoading" @click="onClockInClick">Clock in</button>
            <div v-if="completedToday.length" class="completed-list">
              <p class="muted small">Today</p>
              <div v-for="r in completedToday" :key="r.attendance_id" class="completed-row">
                {{ fmtStored(r.clock_in) }} – {{ fmtStored(r.clock_out) }} · {{ formatTotalTime(r.total_time) }} · {{ r.work_modality ?? '—' }}
              </div>
            </div>
          </div>
        </template>
      </div>
      <!-- Right: Map -->
      <aside class="map-aside">
        <div class="map-wrap-wrapper">
          <div v-if="(officeFetchingLocation || wfhFetchingLocation) && !locationIn" class="map-loading-overlay" aria-live="polite">
            <span class="map-loading-spinner" aria-hidden="true"></span>
            <span class="map-loading-text">Getting location…</span>
          </div>
          <div ref="mapContainer" class="map-wrap"></div>
          <div ref="userEdgeIndicator" class="map-edge-indicator map-edge-user" aria-label="Your location direction" title="Click to focus on your location" @click="focusOnUserLocation">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L8 10L12 8L16 10L12 2Z"/>
            </svg>
          </div>
          <div ref="branchEdgeIndicator" class="map-edge-indicator map-edge-branch" aria-label="Branch location direction" title="Click to focus on branch location" @click="focusOnBranchLocation">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L8 10L12 8L16 10L12 2Z"/>
            </svg>
          </div>
        </div>
        <p class="map-caption muted">
          <span v-if="userLoc" class="you-are-here">You are here</span>
          <template v-if="userLoc"> · </template>
          {{ workModality === 'office' && activeBranch ? activeBranch.address : (workModality === 'wfh' && wfhAddress ? wfhAddress : 'Location') }}{{ workModality === 'office' ? ` · ${RADIUS_M}m radius` : '' }}
        </p>
      </aside>
    </div>

    <!-- Face scanning modal (clock in / clock out). Include facialScanSuccess so success overlay can show after step is clocked_in (timer visible behind lighter overlay). -->
    <div
      v-if="step === 'facial' || step === 'facial_out' || facialScanSuccess"
      class="liveness-modal-overlay"
      :class="{ 'liveness-modal-overlay--post-clock-in': facialScanSuccess && step === 'clocked_in' }"
      aria-modal="true"
      role="dialog"
      aria-labelledby="facial-modal-title"
    >
      <div class="liveness-modal facial-scan-modal">
        <video
          v-if="!facialScanSuccess"
          class="liveness-icon liveness-face-id-video"
          src="/face-id.webm"
          autoplay
          loop
          muted
          playsinline
          aria-hidden="true"
        />
        <div v-else class="facial-success-block">
          <span class="facial-success-icon" aria-hidden="true">✓</span>
          <p class="facial-success-msg">Scanned successfully</p>
        </div>
        <h2 id="facial-modal-title" class="liveness-title">{{ facialScanSuccess ? 'Success' : 'Face verification' }}</h2>
        <p class="liveness-description">
          {{ facialScanSuccess
            ? (step === 'facial_out' ? 'Clocking out…' : 'Proceeding to timer…')
            : (step === 'facial' ? 'Verify at facial to clock in.' : 'Verify at facial to clock out.') }}
        </p>
        <button v-if="!facialScanSuccess" type="button" class="btn liveness-cancel-btn" :disabled="cancelFacialLoading" @click="handleCancelFacial">
          <span v-if="cancelFacialLoading" class="btn-loading-wrap">
            <span class="btn-loading-spinner liveness-cancel-spinner" aria-hidden="true"></span>
            <span>Cancelling…</span>
          </span>
          <span v-else>Cancel</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeclock-page { padding: 0; width: 100%; }
.timeclock-layout { display: grid; grid-template-columns: 1fr 400px; gap: 2rem; align-items: start; }
@media (min-width: 1200px) { .timeclock-layout { grid-template-columns: 1fr 520px; gap: 2.5rem; } }
@media (max-width: 900px) { .timeclock-layout { grid-template-columns: 1fr; } }
.hero-section { min-width: 0; max-width: 560px; }
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
.btn-loading-wrap { display: inline-flex; align-items: center; gap: 0.5rem; }
.btn-loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: map-spin 0.7s linear infinite;
}
.confirm-wrap { margin: 0; }
.confirm-msg { color: #fbbf24; margin: 0 0 1rem; font-size: 0.9375rem; }
.facial-placeholder { text-align: center; padding: 0.5rem 0; }
.facial-icon { font-size: 3rem; display: block; margin-bottom: 0.5rem; }
.facial-placeholder p { margin: 0 0 1rem; color: #94a3b8; }
.facial-btns { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
.liveness-modal-overlay { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 1.5rem; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.liveness-modal-overlay--post-clock-in { background: rgba(15, 23, 42, 0.28); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.liveness-modal { text-align: center; padding: 2rem; max-width: 420px; width: 100%; background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
.liveness-modal .liveness-icon { display: block; margin: 0 auto 0.75rem; }
.liveness-modal .liveness-face-id-video { width: 140px; height: 140px; object-fit: contain; }
.facial-scan-modal .liveness-description { margin-bottom: 1rem; }
.facial-success-block { margin: 0 auto 0.75rem; text-align: center; }
.facial-success-icon { display: inline-flex; align-items: center; justify-content: center; width: 80px; height: 80px; border-radius: 50%; background: #22c55e; color: #fff; font-size: 2.5rem; font-weight: 700; }
.facial-success-msg { margin: 0; font-size: 1.125rem; font-weight: 500; color: #38bdf8; }
.liveness-modal .liveness-title { font-size: 1.25rem; font-weight: 600; color: #e2e8f0; margin: 0 0 0.5rem; }
.liveness-modal .liveness-description { font-size: 0.9375rem; color: #94a3b8; margin: 0 0 1.5rem; line-height: 1.5; }
.liveness-modal .error { margin-top: 1rem; }
.liveness-cancel-btn { margin-top: 1.5rem; background: rgba(255,255,255,0.1); color: #94a3b8; width: 100%; }
.liveness-cancel-btn:hover { background: rgba(248,113,113,0.2); color: #f87171; }
.completed-list { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.08); }
.completed-list .small { font-size: 0.75rem; margin-bottom: 0.5rem; }
.completed-row { font-size: 0.8125rem; color: #94a3b8; padding: 0.25rem 0; }
.map-aside { display: flex; flex-direction: column; gap: 0.5rem; }
.map-wrap-wrapper {
  position: relative;
  min-height: 320px;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  background:
    radial-gradient(circle at top, rgba(56,189,248,0.22), rgba(15,23,42,0.98)),
    linear-gradient(135deg, rgba(15,23,42,1), rgba(15,23,42,0.92));
  box-shadow: 0 18px 40px rgba(15,23,42,0.7);
}
.map-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  background: rgba(15, 23, 42, 0.75);
  border-radius: 16px;
  color: var(--text-secondary, #94a3b8);
  font-size: 0.9375rem;
}
.map-loading-overlay .map-loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(14, 165, 233, 0.3);
  border-top-color: #0ea5e9;
  border-radius: 50%;
  animation: map-spin 0.7s linear infinite;
}
.map-loading-overlay .map-loading-text {
  font-weight: 500;
}
.map-edge-indicator { position: absolute; display: none; z-index: 1000; width: 48px; height: 48px; cursor: pointer; transition: opacity 0.2s ease, filter 0.2s ease; }
.map-edge-indicator:hover { opacity: 0.9; filter: drop-shadow(0 3px 8px rgba(0,0,0,0.4)) brightness(1.1); }
.map-edge-user { color: #0ea5e9; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.3)); }
.map-edge-branch { color: #6366f1; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.3)); }
.map-edge-indicator svg { width: 100%; height: 100%; }
@media (min-width: 1200px) { .map-wrap-wrapper { min-height: 420px; } }
.map-wrap-wrapper :deep(.map-center-icon) { background: none; border: none; }
.map-wrap-wrapper :deep(.map-center-icon .center-pin) { display: block; line-height: 0; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25)); }
.map-wrap-wrapper :deep(.map-center-icon .center-pin svg) { display: block; }
.map-wrap-wrapper :deep(.map-bound-tooltip) { background: rgba(255,255,255,0.97); border: 1px solid rgba(0,0,0,0.08); border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); padding: 0; font-size: 0.8125rem; color: #334155; white-space: nowrap; }
.map-wrap-wrapper :deep(.map-user-marker) { background: none; border: none; }
.map-wrap-wrapper :deep(.map-user-marker-wrap) { width: 40px; height: 40px; border-radius: 50%; overflow: hidden; border: 3px solid #0ea5e9; box-shadow: 0 2px 10px rgba(0,0,0,0.25); background: #e2e8f0; display: flex; align-items: center; justify-content: center; }
.map-wrap-wrapper :deep(.map-user-marker-img) { width: 100%; height: 100%; object-fit: cover; }
.map-wrap-wrapper :deep(.map-user-marker-initial) { font-size: 1.125rem; font-weight: 700; color: #0ea5e9; }
.map-wrap-wrapper :deep(.map-user-label-icon) { background: none; border: none; }
.map-wrap-wrapper :deep(.map-bound-tooltip-user) { white-space: normal; max-width: 260px; text-align: center; }
.map-wrap-wrapper :deep(.map-bound-tooltip-user-label) { white-space: normal; max-width: 280px; text-align: center; }
.map-wrap-wrapper :deep(.map-tooltip-you strong) { display: block; margin-bottom: 4px; }
.map-wrap-wrapper :deep(.map-tooltip-you-label strong) { display: block; margin-bottom: 0; color: #0f172a; font-weight: 600; font-size: 0.8125rem; }
.map-wrap-wrapper :deep(.map-tooltip-address-hover) { color: #64748b; font-size: 0.75rem; white-space: normal; word-break: break-word; max-width: 240px; display: block; opacity: 0; max-height: 0; overflow: hidden; transition: opacity 0.2s ease, max-height 0.3s ease, margin-top 0.2s ease; margin-top: 0; }
.map-wrap-wrapper :deep(.map-bound-tooltip-user-label:hover .map-tooltip-address-hover) { opacity: 1; max-height: 300px; margin-top: 6px; }
.map-wrap-wrapper :deep(.map-bound-tooltip-user-label) { cursor: pointer; }
.map-wrap-wrapper :deep(.map-tooltip-address[title]) { cursor: help; }
.you-are-here { font-weight: 600; color: #0ea5e9; }
.map-wrap-wrapper :deep(.map-bound-tooltip::before) { border-top-color: rgba(255,255,255,0.97); }
.map-wrap-wrapper :deep(.map-tooltip-inner) { padding: 8px 12px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.map-wrap-wrapper :deep(.map-tooltip-inner strong) { color: #0f172a; font-weight: 600; font-size: 0.8125rem; }
.map-wrap-wrapper :deep(.map-tooltip-inner span) { color: #64748b; font-size: 0.75rem; }
.map-wrap { width: 100%; height: 320px; border-radius: 12px; }
@media (min-width: 1200px) { .map-wrap { height: 420px; } }
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
.hero-sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.clocked-hero-row { align-items: flex-start; }
.clocked-hero-left { min-width: 0; flex: 1; }
.clocked-hero-label { margin: 0 0 0.25rem !important; }
.timer-hero-main {
  font-size: 2rem;
  font-weight: 700;
  color: #38bdf8;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  margin: 0.15rem 0 0.35rem;
}
.clocked-hero-meta { margin: 0 !important; font-size: 0.8125rem; }

.time-left-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  background: rgba(15,23,42,0.92);
  border: 1px solid rgba(56,189,248,0.7);
  box-shadow: 0 6px 18px rgba(15,23,42,0.7);
  transform-origin: center;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.time-left-icon {
  width: 32px;
  height: 32px;
}

.time-left-track {
  stroke: rgba(148,163,184,0.6);
  stroke-width: 3;
}

.time-left-progress {
  stroke-width: 3;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  transition: stroke-dashoffset 0.45s cubic-bezier(0.3, 0.7, 0.3, 1), stroke 0.5s ease;
}

.time-left-number {
  font-size: 0.9rem;
  font-weight: 700;
  fill: #e5f2ff;
}

@keyframes time-left-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.82; }
}

.time-left-number-pulse {
  animation: time-left-pulse 1.8s ease-in-out infinite;
}

.liveness-cancel-spinner {
  border-color: rgba(148, 163, 184, 0.3);
  border-top-color: #94a3b8;
}

.time-left-badge:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(15,23,42,0.85);
  border-color: #38bdf8;
}
</style>