<script setup lang="ts">
import { onMounted, onUnmounted, nextTick, ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  useAttendance,
  BRANCHES,
  RADIUS_M,
  getBranch,
  parseLocation,
  isOutsideWfhRadius,
  distanceMeters,
  storedToRealInstant,
  isClockOutNextLocalDay,
  type WorkModality,
  type Branch,
} from '../composables/useAttendance'
import { useAuth } from '../composables/useAuth'
import supabase from '../lib/supabaseClient'

const route = useRoute()
const {
  todayRecord,
  todayRecords,
  isClockedIn,
  isOnLunch,
  usedLunchBreak,
  isLoading,
  error,
  fetchToday,
  clockIn,
  clockOut,
  startLunchBreak,
  endLunchBreak,
  elapsedDisplay,
  lunchElapsedDisplay,
} = useAttendance()
const { user, getSignedProfileUrl } = useAuth()
const userProfileUrl = ref<string | null>(null)
const userInitial = ref<string>('?')

const workModality = ref<WorkModality>('office')
const selectedBranch = ref<Branch | null>(BRANCHES[0])
const step = ref<
  | 'idle'
  | 'choose_modality'
  | 'getting_location'
  | 'wfh_photo'
  | 'facial'
  | 'clocked_in'
  | 'facial_out'
>('idle')
const liveLocation = ref<{ lat: number; lng: number } | null>(null)
const locationIn = ref<{ lat: number; lng: number } | null>(null)
const locationOut = ref<{ lat: number; lng: number } | null>(null)
const locationError = ref<string | null>(null)
const clockOutConfirm = ref<{ outsideOffice?: boolean; outsideWfh?: boolean } | null>(null)
const showClockOutOutputPanel = ref(false)
const clockOutOutputDraft = ref('')
const clockOutOutputToSave = ref<string | null>(null)
const WFH_PICTURE_BUCKET = 'wfh_employee_picture'
/** Face enrollment images; presence determines `employee.isregistered` (synced in this view). */
const REGISTERED_FACE_BUCKET = 'registered_user_face'
const wfhPhotoFile = ref<File | null>(null)
const wfhPhotoPreviewUrl = ref<string | null>(null)
const wfhPhotoError = ref<string | null>(null)
const wfhPhotoUploading = ref(false)
const wfhVideoRef = ref<HTMLVideoElement | null>(null)
const wfhCameraStream = ref<MediaStream | null>(null)
const wfhCameraStarting = ref(false)
const wfhVideoMetaReady = ref(false)
/** Available video inputs (filled after permission + enumerate). */
const wfhVideoInputs = ref<MediaDeviceInfo[]>([])
const wfhSelectedDeviceId = ref<string | null>(null)

function wfhLabelSuggestsFront(label: string): boolean {
  return /front|user|face|selfie/i.test(label)
}
function wfhLabelSuggestsBack(label: string): boolean {
  return /back|rear|environment|wide|world/i.test(label)
}

async function refreshWfhVideoInputList(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    wfhVideoInputs.value = []
    return
  }
  let list = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === 'videoinput' && d.deviceId,
  )
  if (list.length && !list.some((d) => d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      s.getTracks().forEach((t) => t.stop())
      list = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'videoinput' && d.deviceId,
      )
    } catch {
      /* keep unlabeled list */
    }
  }
  wfhVideoInputs.value = list
}

function pickDefaultWfhDeviceId(inputs: MediaDeviceInfo[]): string | null {
  if (!inputs.length) return null
  if (inputs.length === 1) return inputs[0].deviceId
  const front = inputs.find((d) => wfhLabelSuggestsFront(d.label))
  if (front) return front.deviceId
  return inputs[0].deviceId
}

const wfhShowCameraPicker = computed(() => {
  if (wfhPhotoFile.value) return false
  return wfhVideoInputs.value.length > 1
})

/** When labels distinguish front vs back, show two buttons; otherwise use dropdown. */
const wfhFrontBackPair = computed(() => {
  const inputs = wfhVideoInputs.value
  if (inputs.length < 2) return null
  const front = inputs.find((d) => wfhLabelSuggestsFront(d.label))
  const back = inputs.find((d) => wfhLabelSuggestsBack(d.label))
  if (front && back && front.deviceId !== back.deviceId) {
    return { frontId: front.deviceId, backId: back.deviceId }
  }
  return null
})

function selectWfhCameraDevice(deviceId: string) {
  if (!deviceId || wfhSelectedDeviceId.value === deviceId) return
  wfhSelectedDeviceId.value = deviceId
  void startWfhCamera()
}

function onWfhCameraSelectChange(ev: Event) {
  const id = (ev.target as HTMLSelectElement).value
  selectWfhCameraDevice(id)
}
// Liveness verification state
const livenessVerificationId = ref<string | null>(null)
const facialScanSuccess = ref(false)
/** Success overlay after remote facial terminal triggers clock-out (poll detects `facial_clock_out`). */
const autoFacialClockOutSuccess = ref(false)
/** Whether `location_out` was saved from GPS for that auto clock-out. */
const autoFacialClockOutSavedLocation = ref(false)
const livenessLoading = ref(false)
const livenessError = ref<string | null>(null)
const clockOutLoading = ref(false)
/** While clocked in with a facial row, poll for remote clock-out flag (hardware / facial terminal). */
let facialAutoClockOutPollId: number | null = null
const facialAutoClockOutInFlight = ref(false)
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
let userMarkerAnimRaf: number | null = null
let userMarkerLastIconSig = ''
const USER_MARKER_MOVE_MS = 400
/** Outer icon box (pulse rings + avatar); inner avatar is 40px in CSS. */
const USER_MARKER_ICON_PX = 56
let liveLocationIntervalId: number | null = null
let livePollInFlight = false
/** Previous live fix for movement heading (bearing). */
let lastGpsForHeading: { lat: number; lng: number } | null = null
/** Degrees clockwise from north; null when not moving meaningfully between samples. */
const userMovementHeadingDeg = ref<number | null>(null)

function bearingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const φ1 = toRad(from.lat)
  const φ2 = toRad(to.lat)
  const Δλ = toRad(to.lng - from.lng)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  return ((θ * 180) / Math.PI + 360) % 360
}

interface OfficeGeofenceRow {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_meters: number
  have_facial?: boolean
}
const officeGeofences = ref<OfficeGeofenceRow[]>([])
const officeGeofenceLoading = ref(true)
const officeGeofenceHoverAddress = ref<Record<string, string | null>>({})

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'TimeWorthApp/1.0' } },
    )
    const data = await res.json()
    return data?.display_name ?? null
  } catch {
    return null
  }
}

async function loadOfficeGeofences() {
  officeGeofenceLoading.value = true
  officeGeofenceHoverAddress.value = {}
  const { data, error } = await supabase
    .from('geolocation')
    .select('id, name, latitude, longitude, radius_meters, have_facial')
    .eq('geolocation_status', true)
  officeGeofenceLoading.value = false
  if (error) {
    officeGeofences.value = []
    return
  }
  officeGeofences.value = (data as OfficeGeofenceRow[]) ?? []
  for (const row of officeGeofences.value) {
    const addr = await reverseGeocode(row.latitude, row.longitude)
    officeGeofenceHoverAddress.value[row.id] = addr?.trim() || null
  }
  nextTick(() => {
    if (map && circle) bindGeofenceCircleTooltip()
  })
}

const centerIcon = L.divIcon({
  className: 'map-center-icon',
  html: '<span class="center-pin" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4285F4" width="28" height="28"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></span>',
  iconSize: [28, 36],
  iconAnchor: [14, 36],
})

async function loadUserProfile() {
  if (!user.value?.id) return
  const { data } = await supabase
    .from('employee')
    .select('name, picture')
    .eq('id', user.value.id)
    .maybeSingle()
  if (data?.name) userInitial.value = data.name.trim().slice(0, 1).toUpperCase()
  const pathOrUrl = data?.picture
  if (!pathOrUrl) return
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    userProfileUrl.value = pathOrUrl
  } else {
    userProfileUrl.value = await getSignedProfileUrl(pathOrUrl)
  }
}

function joinStoragePath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name
}

/** True if at least one file exists under `userId/`; false if empty; null if listing failed. */
async function registeredFaceBucketHasAnyFile(userId: string): Promise<boolean | null> {
  const queue: string[] = [userId]
  while (queue.length) {
    const folder = queue.shift() ?? ''
    let offset = 0
    while (true) {
      const { data, error: listError } = await supabase.storage
        .from(REGISTERED_FACE_BUCKET)
        .list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      if (listError) {
        console.warn('[Timeclock] registered_user_face list failed', listError.message)
        return null
      }
      const rows = data ?? []
      for (const entry of rows) {
        const fullPath = joinStoragePath(folder, entry.name)
        if (entry.id) return true
        queue.push(fullPath)
      }
      if (rows.length < 100) break
      offset += rows.length
    }
  }
  return false
}

/** Align `employee.isregistered` with storage (not the previous column value). */
async function syncEmployeeIsregisteredFromFaceBucket(): Promise<void> {
  const uid = user.value?.id
  if (!uid) return
  const hasFace = await registeredFaceBucketHasAnyFile(uid)
  if (hasFace === null) return
  const { error } = await supabase.from('employee').update({ isregistered: hasFace }).eq('id', uid)
  if (error) console.error('[Timeclock] sync isregistered from face bucket', error.message)
}

const LIVENESS_RESUME_MAX_AGE_MS = 60 * 60 * 1000 // 1 hour

function resumeLivenessRow(row: { id: string }) {
  livenessVerificationId.value = row.id
  step.value = 'facial'
  livenessRealtimeChannel = supabase
    .channel(`facial:${row.id}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'facial_verifications',
        filter: `id=eq.${row.id}`,
      },
      (payload: { new: { facial_clock_in?: boolean } }) => {
        if (payload.new?.facial_clock_in === true) onFacialClockInVerified()
      },
    )
    .subscribe()
}

function stopWfhCamera() {
  wfhVideoMetaReady.value = false
  if (wfhCameraStream.value) {
    for (const t of wfhCameraStream.value.getTracks()) t.stop()
    wfhCameraStream.value = null
  }
  const el = wfhVideoRef.value
  if (el) el.srcObject = null
}

async function startWfhCamera() {
  wfhPhotoError.value = null
  wfhVideoMetaReady.value = false
  stopWfhCamera()
  if (!navigator.mediaDevices?.getUserMedia) {
    wfhPhotoError.value = 'Camera is not supported in this browser.'
    return
  }
  wfhCameraStarting.value = true
  try {
    await refreshWfhVideoInputList()
    const inputs = wfhVideoInputs.value
    let deviceId = wfhSelectedDeviceId.value
    if (!deviceId || !inputs.some((d) => d.deviceId === deviceId)) {
      deviceId = pickDefaultWfhDeviceId(inputs)
      wfhSelectedDeviceId.value = deviceId
    }
    let stream: MediaStream | null = null
    if (deviceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: false,
        })
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { ideal: deviceId } },
            audio: false,
          })
        } catch {
          stream = null
        }
      }
    }
    if (!stream) {
      const constraintsList: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: 'user' } }, audio: false },
        { video: { facingMode: 'user' }, audio: false },
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        { video: true, audio: false },
      ]
      for (const c of constraintsList) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(c)
          break
        } catch {
          /* try next */
        }
      }
    }
    if (!stream) throw new Error('Could not access camera.')
    wfhCameraStream.value = stream
    await nextTick()
    const el = wfhVideoRef.value
    if (el) {
      el.srcObject = stream
      await el.play().catch(() => {})
    }
  } catch (e) {
    wfhPhotoError.value =
      e instanceof Error
        ? e.message
        : 'Could not access camera. Allow camera permission and try again.'
  } finally {
    wfhCameraStarting.value = false
  }
}

function retakeWfhPhoto() {
  if (wfhPhotoPreviewUrl.value) {
    URL.revokeObjectURL(wfhPhotoPreviewUrl.value)
    wfhPhotoPreviewUrl.value = null
  }
  wfhPhotoFile.value = null
  wfhPhotoError.value = null
  void startWfhCamera()
}

function captureWfhPhotoFromCamera() {
  const el = wfhVideoRef.value
  if (!el || !el.videoWidth) {
    wfhPhotoError.value = 'Camera is not ready yet.'
    return
  }
  const vw = el.videoWidth
  const vh = el.videoHeight
  const maxW = 1600
  const scale = Math.min(1, maxW / vw)
  const cw = Math.round(vw * scale)
  const ch = Math.round(vh * scale)
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    wfhPhotoError.value = 'Could not capture image.'
    return
  }
  ctx.drawImage(el, 0, 0, vw, vh, 0, 0, cw, ch)
  canvas.toBlob(
    (blob) => {
      if (!blob) {
        wfhPhotoError.value = 'Could not capture image.'
        return
      }
      if (blob.size > 100 * 1024 * 1024) {
        wfhPhotoError.value = 'Photo must be 100MB or smaller. Try again.'
        return
      }
      if (wfhPhotoPreviewUrl.value) URL.revokeObjectURL(wfhPhotoPreviewUrl.value)
      const name = `wfh-${Date.now()}.jpg`
      wfhPhotoFile.value = new File([blob], name, { type: 'image/jpeg' })
      wfhPhotoPreviewUrl.value = URL.createObjectURL(blob)
      wfhPhotoError.value = null
      stopWfhCamera()
    },
    'image/jpeg',
    0.88,
  )
}

watch(
  () => step.value,
  (s, prev) => {
    if (s === 'wfh_photo') {
      nextTick(() => void startWfhCamera())
    } else if (prev === 'wfh_photo') {
      stopWfhCamera()
    }
  },
)

onMounted(() => {
  fetchToday()
  void loadOfficeGeofences()
  loadUserProfile()
  void syncEmployeeIsregisteredFromFaceBucket()
  nextTick(() => {
    if (mapContainer.value) initMap()
  })
  startLiveLocationWatch()
  fetchLocationOnce()

  if (route.query.clockin === 'true' && !isClockedIn.value && step.value === 'idle') {
    nextTick(() => {
      onClockInClick()
    })
  }
})

onUnmounted(() => {
  stopFacialClockOutPoll()
  autoFacialClockOutSuccess.value = false
  autoFacialClockOutSavedLocation.value = false
  closeLivenessRealtime()
  cancelUserMarkerMoveAnimation()
  if (liveLocationIntervalId !== null) {
    clearInterval(liveLocationIntervalId)
    liveLocationIntervalId = null
  }
  centerMarker?.remove()
  userMarker?.remove()
  userLabelMarker?.remove()
  circle?.remove()
  map?.remove()
  map = null
  if (wfhPhotoPreviewUrl.value) {
    URL.revokeObjectURL(wfhPhotoPreviewUrl.value)
    wfhPhotoPreviewUrl.value = null
  }
  stopWfhCamera()
})

const activeBranch = computed(() => {
  if (workModality.value === 'office' && selectedBranch.value) return selectedBranch.value
  const br = todayRecord.value?.branch_location
    ? getBranch(todayRecord.value.branch_location)
    : null
  return br ?? selectedBranch.value ?? BRANCHES[0]
})

/** Map / geofence circle center for office mode uses the first geofence the user is inside, or the first geofence, or branch. */
const mapCenter = computed(() => {
  if (workModality.value === 'office' && officeGeofences.value.length) {
    const pos = userLoc.value ?? locationIn.value
    // Try to center on the geofence the user is inside
    const inside =
      pos &&
      officeGeofences.value.find(
        (g) => distanceMeters(pos, { lat: g.latitude, lng: g.longitude }) <= g.radius_meters,
      )
    const g = inside || officeGeofences.value[0]
    return { lat: g.latitude, lng: g.longitude }
  }
  if (workModality.value === 'office') {
    const b = activeBranch.value
    return { lat: b.lat, lng: b.lng }
  }
  const locStr = locationIn.value
    ? `${locationIn.value.lat},${locationIn.value.lng}`
    : todayRecord.value?.location_in
  const p = parseLocation(locStr ?? null)
  return p ?? (locationIn.value || { lat: activeBranch.value.lat, lng: activeBranch.value.lng })
})

const userLoc = computed(() => liveLocation.value ?? locationIn.value ?? locationOut.value ?? null)

/** Prefer live GPS so geofence + Continue react in real time while moving. */
const officeGeofenceCheckPos = computed(() => {
  if (workModality.value !== 'office' || step.value !== 'choose_modality') return null
  return userLoc.value ?? locationIn.value ?? null
})

// Returns true if user is outside ALL office geofences
const isOutsideOfficeRadius = computed(() => {
  if (workModality.value !== 'office' || step.value !== 'choose_modality') return false
  if (!officeGeofences.value.length) return false
  const pos = officeGeofenceCheckPos.value
  if (!pos) return false
  // User is inside at least one geofence
  return !officeGeofences.value.some(
    (g) => distanceMeters(pos, { lat: g.latitude, lng: g.longitude }) <= g.radius_meters,
  )
})

const chooseModalityContinueDisabled = computed(() => {
  if (isLoading.value) return true
  const pos = userLoc.value ?? locationIn.value
  if ((officeFetchingLocation.value || wfhFetchingLocation.value) && !pos) return true
  if (workModality.value !== 'office') return false
  if (officeGeofenceLoading.value) return true
  if (!officeGeofences.value.length) return true
  if (!pos) return true
  return isOutsideOfficeRadius.value
})

/** Office session with any admin geofence — used for map colors / clock-out gate while clocked in. */
function isOfficeClockedInSessionForGeofenceUi(): boolean {
  const tr = todayRecord.value
  return !!(tr && !tr.clock_out && tr.work_modality === 'office' && officeGeofences.value.length)
}

/** Outside ALL office geofences while clocked in (office), not on lunch; needs live position. */
function isOfficeClockedInOutsideGeofence(): boolean {
  if (!isOfficeClockedInSessionForGeofenceUi()) return false
  if (isOnLunch.value) return false
  const pos = userLoc.value
  if (!pos) return false
  // If inside any geofence, not outside
  return !officeGeofences.value.some(
    (g) => distanceMeters(pos, { lat: g.latitude, lng: g.longitude }) <= g.radius_meters,
  )
}

const clockOutDisabledByGeofence = computed(() => isOfficeClockedInOutsideGeofence())

/** Short label under the map. Full street address appears only on map hover (profile marker or geofence circle tooltips). */
const mapCaptionShort = computed(() => {
  if (workModality.value === 'office' && officeGeofences.value.length) {
    const pos = userLoc.value ?? locationIn.value
    const inside =
      pos &&
      officeGeofences.value.find(
        (g) => distanceMeters(pos, { lat: g.latitude, lng: g.longitude }) <= g.radius_meters,
      )
    return inside?.name?.trim() || officeGeofences.value[0]?.name?.trim() || activeBranch.value.name
  }
  if (workModality.value === 'office' && activeBranch.value) {
    return activeBranch.value.name
  }
  if (workModality.value === 'wfh') {
    return wfhAddress.value ? 'Work from home' : 'Location'
  }
  return 'Location'
})

watch(
  () =>
    [
      isOutsideOfficeRadius.value,
      step.value,
      workModality.value,
      isOnLunch.value,
      clockOutDisabledByGeofence.value,
      userLoc.value?.lat,
      userLoc.value?.lng,
    ] as const,
  () => {
    if (
      step.value === 'choose_modality' &&
      workModality.value === 'office' &&
      !isOutsideOfficeRadius.value &&
      locationError.value &&
      (locationError.value.includes('geofence') || locationError.value.includes('Move closer'))
    ) {
      locationError.value = null
    }
    nextTick(() => {
      syncUserMarkerGeofenceBorder()
      syncGeofenceCircleStyle()
    })
  },
)

function initMap() {
  if (map) return
  if (!mapContainer.value) return
  map = L.map(mapContainer.value, { zoomControl: false }).setView(
    [mapCenter.value.lat, mapCenter.value.lng],
    16,
  )
  L.control.zoom({ position: 'topright' }).addTo(map!)
  /* Carto Voyager: bright cyan water, pale green land use, light grey base — closest free raster to Google Maps default palette; refined via CSS below. */
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map!)
  circle = L.circle([mapCenter.value.lat, mapCenter.value.lng], {
    radius: RADIUS_M,
    ...geofenceCircleLeafletStyle(),
  }).addTo(map!)
  syncGeofenceCircleStyle()
  bindGeofenceCircleTooltip()
  map.on('moveend zoomend', updateEdgeIndicators)
  updateMapView()
}

function updateCenterMarker() {
  if (!map) return
  centerMarker?.remove()
  if (workModality.value === 'office' && step.value !== 'idle' && officeGeofences.value.length) {
    const c = mapCenter.value
    const pos = userLoc.value ?? locationIn.value
    const inside =
      pos &&
      officeGeofences.value.find(
        (g) => distanceMeters(pos, { lat: g.latitude, lng: g.longitude }) <= g.radius_meters,
      )
    const g = inside || officeGeofences.value[0]
    const geoName = g?.name?.trim() ?? ''
    let label = geoName && geoName.length <= 48 ? geoName : ''
    if (label.toLowerCase().includes('earnshaw')) label = ''
    centerMarker = L.marker([c.lat, c.lng], { icon: L.divIcon({className: ''}) }).addTo(map!)
    centerMarker.bindTooltip(
      `<div class="map-tooltip-inner"><strong>${escapeHtml(label)}</strong></div>`,
      {
        permanent: false,
        direction: 'top',
        offset: [0, -12],
        className: 'map-bound-tooltip map-bound-tooltip-branch',
        sticky: true,
      },
    )
  } else centerMarker = null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const GEOFENCE_CIRCLE_STYLE_DEFAULT = {
  color: '#4285F4',
  fillColor: '#4285F4',
  fillOpacity: 0.14,
  weight: 3,
} as const

const GEOFENCE_CIRCLE_STYLE_OUT = {
  color: '#ea4335',
  fillColor: '#ea4335',
  fillOpacity: 0.14,
  weight: 3,
} as const

const GEOFENCE_CIRCLE_STYLE_IN = {
  color: '#34a853',
  fillColor: '#34a853',
  fillOpacity: 0.14,
  weight: 3,
} as const

function geofenceCircleLeafletStyle(): L.PathOptions {
  // This function is now only used for the legacy single circle, but all geofences are drawn in updateMapView
  return { ...GEOFENCE_CIRCLE_STYLE_DEFAULT }
}

function syncGeofenceCircleStyle() {
  if (!circle) return
  circle.setStyle(geofenceCircleLeafletStyle())
}

/** Full office site address for geofence circle tooltip (hover boundary only). When admin geofence exists, use reverse geocode of its lat/lng (not default branch). */
function geofenceCircleTooltipText(): string | null {
  if (workModality.value !== 'office' || step.value === 'idle') return null
  // Use the first geofence for tooltip
  const g = officeGeofences.value[0]
  if (g) {
    const resolved = officeGeofenceHoverAddress.value?.[g.id]?.trim()
    if (resolved) return resolved
    const name = g.name?.trim()
    if (name) return name
    return `${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)}`
  }
  const addr = activeBranch.value?.address?.trim()
  if (addr) return addr
  return activeBranch.value?.name ?? null
}

function bindGeofenceCircleTooltip() {
  if (!circle) return
  circle.unbindTooltip()
  const text = geofenceCircleTooltipText()
  if (!text) return
  circle.bindTooltip(
    `<div class="map-tooltip-inner map-tooltip-geofence-bind">${escapeHtml(text)}</div>`,
    {
      permanent: false,
      direction: 'auto',
      sticky: true,
      className: 'map-bound-tooltip map-bound-tooltip-geofence',
    },
  )
}

/** Office: choose_modality or clocked-in (not on lunch) — red outside, green inside; lunch uses default blue. */
function userMarkerRootGeofenceClass(): string {
  if (workModality.value !== 'office' || !officeGeofences.value.length) return ''
  if (step.value === 'choose_modality') {
    return isOutsideOfficeRadius.value
      ? 'map-user-marker-root--geofence-out'
      : 'map-user-marker-root--geofence-in'
  }
  if (isOfficeClockedInSessionForGeofenceUi() && !isOnLunch.value && userLoc.value) {
    return isOfficeClockedInOutsideGeofence()
      ? 'map-user-marker-root--geofence-out'
      : 'map-user-marker-root--geofence-in'
  }
  return ''
}

function createUserMarkerIcon(): L.DivIcon {
  const pic = userProfileUrl.value
  const initial = escapeHtml(userInitial.value)
  const imgHtml = pic
    ? `<img src="${escapeHtml(pic)}" alt="" class="map-user-marker-img" />`
    : `<span class="map-user-marker-initial">${initial}</span>`
  const h = userMovementHeadingDeg.value
  const showArrow = h != null
  const arrowHtml = `<div class="map-user-marker-arrow-wrap" style="display:${showArrow ? 'block' : 'none'}"><div class="map-user-marker-arrow" style="transform:rotate(${h ?? 0}deg)" aria-hidden="true"><svg class="map-user-marker-arrow-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 3L4 20h16L12 3z" fill="currentColor"/></svg></div></div>`
  const half = USER_MARKER_ICON_PX / 2
  const gfRoot = userMarkerRootGeofenceClass()
  return L.divIcon({
    className: 'map-user-marker',
    html: `<div class="map-user-marker-root ${gfRoot}">
      <span class="map-user-marker-pulse" aria-hidden="true"></span>
      <span class="map-user-marker-pulse map-user-marker-pulse--delay" aria-hidden="true"></span>
      <div class="map-user-marker-wrap">${imgHtml}</div>
      ${arrowHtml}
    </div>`,
    iconSize: [USER_MARKER_ICON_PX, USER_MARKER_ICON_PX],
    iconAnchor: [half, half],
  })
}

function syncUserMarkerHeadingElement() {
  const el = userMarker?.getElement?.()
  if (!el) return
  const wrap = el.querySelector('.map-user-marker-arrow-wrap') as HTMLElement | null
  const arrow = el.querySelector('.map-user-marker-arrow') as HTMLElement | null
  const h = userMovementHeadingDeg.value
  if (wrap) wrap.style.display = h == null ? 'none' : 'block'
  if (!arrow) return
  if (h == null) return
  arrow.style.transform = `rotate(${h}deg)`
}

function syncUserMarkerGeofenceBorder() {
  const el = userMarker?.getElement?.()
  if (!el) return
  const root = el.querySelector('.map-user-marker-root') as HTMLElement | null
  if (!root) return
  root.classList.remove('map-user-marker-root--geofence-out', 'map-user-marker-root--geofence-in')
  const next = userMarkerRootGeofenceClass()
  if (next) root.classList.add(next)
}

function cancelUserMarkerMoveAnimation() {
  if (userMarkerAnimRaf != null) {
    cancelAnimationFrame(userMarkerAnimRaf)
    userMarkerAnimRaf = null
  }
}

function bindUserMarkerTooltip(mark: L.Marker) {
  const loc = userLoc.value
  if (!loc) return
  const fullAddress =
    workModality.value === 'wfh' && wfhAddress.value
      ? wfhAddress.value
      : workModality.value === 'office' && officeUserAddress.value
        ? officeUserAddress.value
        : `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`
  mark.bindTooltip(
    `<div class="map-tooltip-inner map-tooltip-you"><span class="map-tooltip-address-only">${escapeHtml(fullAddress)}</span></div>`,
    {
      permanent: false,
      direction: 'top',
      offset: [0, -USER_MARKER_ICON_PX - 8],
      className: 'map-bound-tooltip map-bound-tooltip-user',
      sticky: true,
    },
  )
}

function animateUserMarkerTo(targetLat: number, targetLng: number, onDone?: () => void) {
  if (!userMarker || !map) {
    onDone?.()
    return
  }
  const start = userMarker.getLatLng()
  const startLat = start.lat
  const startLng = start.lng
  const jumpM = distanceMeters({ lat: startLat, lng: startLng }, { lat: targetLat, lng: targetLng })
  if (jumpM < 0.5) {
    onDone?.()
    return
  }
  if (jumpM > 50_000) {
    cancelUserMarkerMoveAnimation()
    userMarker.setLatLng([targetLat, targetLng])
    onDone?.()
    return
  }
  cancelUserMarkerMoveAnimation()
  const t0 = performance.now()
  const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
  const frame = (now: number) => {
    if (!userMarker) {
      userMarkerAnimRaf = null
      onDone?.()
      return
    }
    const u = Math.min(1, (now - t0) / USER_MARKER_MOVE_MS)
    const eased = easeInOutQuad(u)
    const lat = startLat + (targetLat - startLat) * eased
    const lng = startLng + (targetLng - startLng) * eased
    userMarker.setLatLng([lat, lng])
    if (u < 1) {
      userMarkerAnimRaf = requestAnimationFrame(frame)
    } else {
      userMarkerAnimRaf = null
      onDone?.()
    }
  }
  userMarkerAnimRaf = requestAnimationFrame(frame)
}

function updateUserMarker(animateMove = false) {
  if (!map) return
  const loc = userLoc.value
  const iconSig = `${userProfileUrl.value ?? ''}|${userInitial.value}`
  if (!loc) {
    cancelUserMarkerMoveAnimation()
    userMarker?.remove()
    userLabelMarker?.remove()
    userMarker = null
    userLabelMarker = null
    userMarkerLastIconSig = ''
    lastGpsForHeading = null
    userMovementHeadingDeg.value = null
    return
  }
  if (!userMarker) {
    cancelUserMarkerMoveAnimation()
    const icon = createUserMarkerIcon()
    userMarker = L.marker([loc.lat, loc.lng], { icon }).addTo(map!)
    userMarkerLastIconSig = iconSig
    bindUserMarkerTooltip(userMarker)
    syncUserMarkerHeadingElement()
    syncUserMarkerGeofenceBorder()
    return
  }
  if (iconSig !== userMarkerLastIconSig) {
    cancelUserMarkerMoveAnimation()
    userMarker.remove()
    const icon = createUserMarkerIcon()
    userMarker = L.marker([loc.lat, loc.lng], { icon }).addTo(map!)
    userMarkerLastIconSig = iconSig
    bindUserMarkerTooltip(userMarker)
    syncUserMarkerHeadingElement()
    syncUserMarkerGeofenceBorder()
    return
  }
  if (animateMove) {
    animateUserMarkerTo(loc.lat, loc.lng, () => {
      bindUserMarkerTooltip(userMarker!)
      syncUserMarkerHeadingElement()
      syncUserMarkerGeofenceBorder()
    })
    return
  }
  cancelUserMarkerMoveAnimation()
  userMarker.setLatLng([loc.lat, loc.lng])
  bindUserMarkerTooltip(userMarker)
  syncUserMarkerHeadingElement()
  syncUserMarkerGeofenceBorder()
}

const DEFAULT_MAP_VIEW = { lat: 14.5995, lng: 120.9842, zoom: 13 }

function getEdgePosition(
  targetLat: number,
  targetLng: number,
): { visible: boolean; x: number; y: number; angle: number } | null {
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
  let x = 0,
    y = 0
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
  const branchLoc =
    workModality.value === 'office' && step.value !== 'idle' ? mapCenter.value : null
  if (!branchLoc) return
  map.setView([branchLoc.lat, branchLoc.lng], 17, { animate: true, duration: 0.5 })
}

function updateEdgeIndicators() {
  if (!map || !mapContainer.value) return
  const userLocVal = userLoc.value
  const branchLoc =
    workModality.value === 'office' && step.value !== 'idle' ? mapCenter.value : null
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

/**
 * @param preserveViewport When true (e.g. live GPS poll), update layers/markers only — do not setView/fitBounds so user zoom/pan is kept.
 * @param animateUserMove When true with preserveViewport, ease the user marker between positions (live GPS).
 */
function updateMapView(preserveViewport = false, animateUserMove = false) {
  if (!map) return
  // Remove previous office geofence circles
  map.eachLayer((layer) => {
    if (layer instanceof L.Circle && (layer as any)._isOfficeGeofence) {
      map.removeLayer(layer)
    }
    if (layer instanceof L.Marker && (layer as any)._isOfficeGeofenceMarker) {
      map.removeLayer(layer)
    }
  })
  if (step.value === 'idle') {
    centerMarker?.remove()
    // No automatic recentering
    updateUserMarker(animateUserMove)
    return
  }
  if (workModality.value === 'wfh') {
    updateCenterMarker()
    updateUserMarker(animateUserMove)
    // No automatic recentering
    nextTick(() => updateEdgeIndicators())
    return
  }
  // Draw office geofence circles and markers
  officeGeofences.value.forEach((g) => {
    const circle = L.circle([g.latitude, g.longitude], {
      radius: Math.max(1, g.radius_meters),
      color: '#0ea5e9', // blue for all offices
      fillColor: '#0ea5e9',
      fillOpacity: 0.13,
      weight: 2,
    }) as any
    circle._isOfficeGeofence = true
    circle.addTo(map)
    // Add a second green circle if facial is enabled
    if (g.have_facial) {
      // Draw a green dashed circle just outside the main radius (e.g. +3 meters)
      const facialCircle = L.circle([g.latitude, g.longitude], {
        radius: Math.max(1, g.radius_meters) + 3,
        color: '#22c55e', // green
        fillColor: '#22c55e',
        fillOpacity: 0.07,
        weight: 2,
        dashArray: '6 6',
      }) as any
      facialCircle._isOfficeGeofence = true
      facialCircle.addTo(map)
    }
    // Use a location icon for all office markers, no facial icon
    const icon = L.divIcon({
      className: 'office-marker',
      html: `<div style="display:flex;align-items:center;justify-content:center;align-items:center;width:28px;height:28px;">
        <span style="display:inline-block;width:28px;height:28px;background:#fff;border-radius:50%;box-shadow:0 2px 8px rgba(34,197,94,0.18);display:flex;align-items:center;justify-content:center;">
          <svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"#0ea5e9\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z\"/></svg>
        </span>
      </div>`,
    })
    const marker = L.marker([g.latitude, g.longitude], { icon }) as any
    marker._isOfficeGeofenceMarker = true
    marker.addTo(map)
    marker.bindTooltip(`${g.name}${g.have_facial ? ' (Facial Scanner)' : ''}`)
  })
  updateCenterMarker()
  updateUserMarker(animateUserMove)
  // No automatic recentering
  nextTick(() => updateEdgeIndicators())
}

watch(
  [
    mapCenter,
    workModality,
    activeBranch,
    step,
    locationIn,
    locationOut,
    wfhAddress,
    officeUserAddress,
    userProfileUrl,
    officeGeofenceHoverAddress,
    isOnLunch,
  ],
  () => {
    updateMapView()
    nextTick(() => updateEdgeIndicators())
  },
  { flush: 'post' },
)

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
  void (async () => {
    try {
      const loc = await getLocationInitialQuick()
      if (!locationIn.value) {
        locationIn.value = loc
        console.log('[Timeclock] location fetched', { lat: loc.lat, lng: loc.lng })
        nextTick(() => updateMapView())
        void reverseGeocode(loc.lat, loc.lng).then((addr) => {
          officeUserAddress.value = addr
          wfhAddress.value = addr
        })
      }
    } catch (err) {
      console.warn('[Timeclock] getLocationInitialQuick failed', err)
    } finally {
      officeFetchingLocation.value = false
      wfhFetchingLocation.value = false
      console.log('[Timeclock] fetchLocationOnce done, loading flags cleared')
    }
  })()
}

/** First paint / UI unblock: one high-accuracy fix with a short timeout (not the long multi-sample `getLocation`). */
function getLocationInitialQuick(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 6000 },
    )
  })
}

watch(
  () => liveLocation.value,
  (loc) => {
    if (!loc) return
    if (!officeFetchingLocation.value && !wfhFetchingLocation.value) return
    if (locationIn.value) return
    locationIn.value = loc
    nextTick(() => updateMapView())
    void reverseGeocode(loc.lat, loc.lng).then((addr) => {
      officeUserAddress.value = addr
      wfhAddress.value = addr
    })
    officeFetchingLocation.value = false
    wfhFetchingLocation.value = false
  },
  { immediate: true },
)

watch(workModality, () => {
  console.log('[Timeclock] workModality changed', {
    to: workModality.value,
    locationIn: !!locationIn.value,
    officeFetching: officeFetchingLocation.value,
    wfhFetching: wfhFetchingLocation.value,
  })
  if (step.value === 'choose_modality' && locationIn.value) nextTick(() => updateMapView())
})

watch(step, (s) => {
  console.log('[Timeclock] step changed', {
    to: s,
    locationFetchedOnMount: locationFetchedOnMount.value,
  })
})

watch(
  () => todayRecord.value?.work_modality,
  (m) => {
    if (m === 'office' || m === 'wfh') workModality.value = m
  },
  { immediate: true },
)

function stopFacialClockOutPoll() {
  if (facialAutoClockOutPollId != null) {
    clearInterval(facialAutoClockOutPollId)
    facialAutoClockOutPollId = null
  }
}

async function tryAutoClockOutFromFacialFlag() {
  if (facialAutoClockOutInFlight.value || isLoading.value) return
  if (!isClockedIn.value) return
  if (step.value === 'facial_out') return
  const tr = todayRecord.value
  if (!tr?.facial_verifications_id) return
  const { data, error: qErr } = await supabase
    .from('facial_verifications')
    .select('facial_clock_out')
    .eq('id', tr.facial_verifications_id)
    .maybeSingle()
  if (qErr || !data) return
  if ((data as { facial_clock_out?: boolean }).facial_clock_out !== true) return
  facialAutoClockOutInFlight.value = true
  try {
    let savedLocation = false
    try {
      const loc = await getLocation()
      locationOut.value = loc
      const locStr = locationString(loc)
      if (locStr) {
        await clockOut(locStr, null)
        savedLocation = true
      } else {
        await clockOut(undefined, null)
      }
    } catch {
      await clockOut(undefined, null)
    }
    if (isClockedIn.value) return
    step.value = 'idle'
    clockOutOutputDraft.value = ''
    clockOutOutputToSave.value = null
    showClockOutOutputPanel.value = false
    clockOutConfirm.value = null
    autoFacialClockOutSavedLocation.value = savedLocation
    autoFacialClockOutSuccess.value = true
    setTimeout(() => {
      autoFacialClockOutSuccess.value = false
      autoFacialClockOutSavedLocation.value = false
      locationOut.value = null
    }, 1800)
  } finally {
    facialAutoClockOutInFlight.value = false
  }
}

watch(
  [isClockedIn, () => todayRecord.value?.facial_verifications_id ?? null],
  ([clocked, vid]) => {
    if (clocked && step.value === 'idle') step.value = 'clocked_in'
    stopFacialClockOutPoll()
    if (clocked && vid) {
      facialAutoClockOutPollId = window.setInterval(() => {
        void tryAutoClockOutFromFacialFlag()
      }, 1000)
    }
  },
  { immediate: true },
)

watch(step, async (s, prev) => {
  const verificationId =
    livenessVerificationId.value ?? todayRecord.value?.facial_verifications_id ?? null
  if (s === 'facial_out' && verificationId) {
    if (!livenessVerificationId.value && todayRecord.value?.facial_verifications_id) {
      livenessVerificationId.value = todayRecord.value.facial_verifications_id
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
          filter: `id=eq.${id}`,
        },
        async (payload: { new: { facial_clock_out?: boolean } }) => {
          if (payload.new?.facial_clock_out !== true) return
          facialScanSuccess.value = true
          const out = clockOutOutputToSave.value
          try {
            const loc = await getLocation()
            locationOut.value = loc
            const locStr = locationString(loc)
            if (locStr) await clockOut(locStr, out)
            else await clockOut(undefined, out)
          } catch {
            await clockOut(undefined, out)
          }
          setTimeout(() => {
            closeLivenessRealtime()
            livenessVerificationId.value = null
            facialScanSuccess.value = false
            step.value = 'idle'
            locationOut.value = null
            clockOutOutputToSave.value = null
            clockOutOutputDraft.value = ''
            void fetchToday()
          }, 1800)
        },
      )
      .subscribe()
  } else if (prev === 'facial_out' && s !== 'facial_out') {
    closeLivenessRealtime()
  }
})

watch(
  () => (workModality.value === 'wfh' ? locationIn.value || todayRecord.value?.location_in : null),
  (loc) => {
    if (!loc || wfhFetchingLocation.value) return
    const coords = typeof loc === 'string' ? parseLocation(loc) : loc
    if (coords)
      reverseGeocode(coords.lat, coords.lng).then((addr) => {
        wfhAddress.value = addr
      })
  },
  { immediate: true },
)

watch(mapContainer, (el) => {
  if (el && !map) initMap()
})

/** Map preview: faster poll (same accuracy options); marker + heading update more often. */
const LIVE_LOCATION_POLL_MS = 600
const GEO_LIVE_POLL_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 2000,
}

/** GMaps-style: refresh GPS (same accuracy as live poll) and recenter on you. */
function onMapLocateMeClick() {
  if (!navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      if (lastGpsForHeading) {
        const moved = distanceMeters(lastGpsForHeading, next)
        if (moved >= 2) {
          userMovementHeadingDeg.value = bearingDegrees(lastGpsForHeading, next)
        } else {
          userMovementHeadingDeg.value = null
        }
      } else {
        userMovementHeadingDeg.value = null
      }
      lastGpsForHeading = next
      liveLocation.value = next
      nextTick(() => {
        updateMapView(true, true)
        nextTick(() => {
          updateEdgeIndicators()
          focusOnUserLocation()
        })
      })
    },
    () => {
      focusOnUserLocation()
    },
    GEO_LIVE_POLL_OPTIONS,
  )
}

function startLiveLocationWatch() {
  if (!navigator.geolocation) return
  if (liveLocationIntervalId !== null) {
    clearInterval(liveLocationIntervalId)
    liveLocationIntervalId = null
  }
  const tick = () => {
    if (livePollInFlight) return
    livePollInFlight = true
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        livePollInFlight = false
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        if (lastGpsForHeading) {
          const moved = distanceMeters(lastGpsForHeading, next)
          if (moved >= 2) {
            userMovementHeadingDeg.value = bearingDegrees(lastGpsForHeading, next)
          } else {
            userMovementHeadingDeg.value = null
          }
        } else {
          userMovementHeadingDeg.value = null
        }
        lastGpsForHeading = next
        liveLocation.value = next
        console.log('[Timeclock] live GPS update', {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        })
        nextTick(() => {
          updateMapView(true, true)
          nextTick(() => updateEdgeIndicators())
        })
      },
      (err) => {
        livePollInFlight = false
        console.warn('[Timeclock] live GPS error', err.code, err.message)
      },
      GEO_LIVE_POLL_OPTIONS,
    )
  }
  tick()
  try {
    liveLocationIntervalId = window.setInterval(tick, LIVE_LOCATION_POLL_MS)
  } catch {
    liveLocationIntervalId = null
  }
}

function locationString(loc: { lat: number; lng: number } | null) {
  if (!loc) return null
  return `${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`
}

/**
 * Best available fix: high accuracy, no stale cache, sample until accuracy is good or timeout,
 * then use the reading with the smallest reported accuracy (meters).
 */
function getLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'))
      return
    }
    const sampleOpts: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    }
    /** Early exit when horizontal accuracy is at or below this (meters). */
    const GOOD_ENOUGH_ACCURACY_M = 50
    /** Shorter cap than before so resolves faster while still sampling for best accuracy. */
    const MAX_SAMPLE_MS = 18000

    let best: GeolocationPosition | null = null
    let watchId: number | null = null
    let settled = false

    const cleanup = () => {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId)
        watchId = null
      }
    }

    const resolveFrom = (pos: GeolocationPosition) => {
      if (settled) return
      settled = true
      cleanup()
      clearTimeout(timer)
      resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    }

    const consider = (pos: GeolocationPosition) => {
      const acc = pos.coords.accuracy
      if (
        !best ||
        !Number.isFinite(best.coords.accuracy) ||
        (Number.isFinite(acc) && acc < best.coords.accuracy)
      ) {
        best = pos
      }
      if (Number.isFinite(acc) && acc > 0 && acc <= GOOD_ENOUGH_ACCURACY_M) {
        resolveFrom(pos)
      }
    }

    const timer = window.setTimeout(() => {
      if (settled) return
      cleanup()
      if (best) {
        resolveFrom(best)
        return
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolveFrom(pos),
        (err) => reject(err),
        sampleOpts,
      )
    }, MAX_SAMPLE_MS)

    watchId = navigator.geolocation.watchPosition(
      (pos) => consider(pos),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          clearTimeout(timer)
          cleanup()
          if (!settled) reject(err)
        }
      },
      sampleOpts,
    )
  })
}

function clearWfhPhotoSelection() {
  stopWfhCamera()
  if (wfhPhotoPreviewUrl.value) {
    URL.revokeObjectURL(wfhPhotoPreviewUrl.value)
    wfhPhotoPreviewUrl.value = null
  }
  wfhPhotoFile.value = null
  wfhPhotoError.value = null
}

async function uploadWfhPhoto(): Promise<string> {
  if (!user.value?.id || !wfhPhotoFile.value) throw new Error('Missing WFH photo.')
  const ext = (wfhPhotoFile.value.name.split('.').pop() || 'jpg').toLowerCase()
  const safeExt = ext.replace(/[^a-z0-9]/g, '') || 'jpg'
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
  const storagePath = `${user.value.id}/${fileName}`
  const { error: uploadError } = await supabase.storage
    .from(WFH_PICTURE_BUCKET)
    .upload(storagePath, wfhPhotoFile.value, {
      upsert: false,
      contentType: wfhPhotoFile.value.type || 'image/jpeg',
    })
  if (uploadError) throw uploadError
  return storagePath
}

async function submitWfhClockIn() {
  if (!wfhPhotoFile.value) {
    wfhPhotoError.value = 'Take a photo before clocking in.'
    return
  }
  wfhPhotoUploading.value = true
  wfhPhotoError.value = null
  locationError.value = null
  try {
    const loc = locationIn.value ?? (await getLocation())
    const picturePath = await uploadWfhPhoto()
    if (!loc) return
    locationIn.value = loc
    nextTick(() => updateMapView())
    const locStr = locationString(loc)
    await clockIn('wfh', { locationIn: locStr ?? undefined, wfhPicUrl: picturePath })
    step.value = 'clocked_in'
    clearWfhPhotoSelection()
    locationIn.value = null
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to upload WFH photo.'
    wfhPhotoError.value = msg
    locationError.value = msg
    step.value = 'wfh_photo'
  } finally {
    wfhPhotoUploading.value = false
  }
}

function cancelWfhPhotoFlow() {
  clearWfhPhotoSelection()
  step.value = 'choose_modality'
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
    step.value = 'wfh_photo'
    return
  }
  if (mod === 'office') {
    if (officeGeofenceLoading.value) return
    if (!officeGeofences.value.length) {
      locationError.value =
        'Office location is not configured yet. Please contact your administrator.'
      return
    }
  }
  step.value = 'getting_location'
  try {
    const loc = userLoc.value ?? locationIn.value ?? (await getLocation())
    if (!loc) return
    locationIn.value = loc
    nextTick(() => updateMapView())
  } catch (e) {
    locationError.value = e instanceof Error ? e.message : 'Location failed'
    step.value = 'choose_modality'
    return
  }
  if (mod === 'office' && officeGeofences.value.length) {
    // Find the geofence the user is inside
    const insideGeofence = officeGeofences.value.find(
      (g) =>
        distanceMeters(locationIn.value!, { lat: g.latitude, lng: g.longitude }) <= g.radius_meters,
    )
    if (!insideGeofence) {
      locationError.value =
        'You must be within the office geofence to clock in. Move closer and try again.'
      step.value = 'choose_modality'
      return
    }
    if (insideGeofence.have_facial) {
      await syncEmployeeIsregisteredFromFaceBucket()
      await startLivenessVerification()
    } else {
      await clockIn('office', { locationIn: locationString(locationIn.value!) })
      step.value = 'clocked_in'
      locationIn.value = null
    }
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
          filter: `id=eq.${row.id}`,
        },
        (payload: { new: { facial_clock_in?: boolean } }) => {
          if (payload.new?.facial_clock_in === true) {
            onFacialClockInVerified()
          }
        },
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
  const branchLocation =
    workModality.value === 'office'
      ? officeGeofences.value[0]?.name?.trim() || selectedBranch.value?.id
      : undefined
  await clockIn(workModality.value, {
    locationIn: locStr,
    facialStatus: 'verified',
    branchLocation,
    facialVerificationId: livenessVerificationId.value ?? undefined,
  })
  // Match WFH: enter clocked-in state immediately so the live timer is visible (not hidden under step==='facial').
  step.value = 'clocked_in'
  closeLivenessRealtime()
  await fetchToday()
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
    if (step.value === 'facial_out') {
      const id = livenessVerificationId.value ?? todayRecord.value?.facial_verifications_id ?? null
      if (id) {
        try {
          await supabase
            .from('facial_verifications')
            .update({ facial_clock_out_indicator: false })
            .eq('id', id)
        } catch {
          /* still return to clocked-in UI */
        }
      }
      clockOutOutputToSave.value = null
      clockOutOutputDraft.value = ''
      showClockOutOutputPanel.value = false
    }
    step.value = 'clocked_in'
    closeLivenessRealtime()
  }
}

function clearClockOutOutputState() {
  clockOutOutputToSave.value = null
  clockOutOutputDraft.value = ''
  showClockOutOutputPanel.value = false
}

function openClockOutOutputPanel() {
  if (clockOutDisabledByGeofence.value) return
  clockOutOutputDraft.value = ''
  showClockOutOutputPanel.value = true
}

function cancelClockOutOutputPanel() {
  showClockOutOutputPanel.value = false
  clockOutOutputDraft.value = ''
}


function beginOfficeClockOut() {
  if (clockOutDisabledByGeofence.value) return
  clockOutOutputDraft.value = ''
  clockOutOutputToSave.value = null
  showClockOutOutputPanel.value = false
  clockOutLoading.value = true
  try {
    // Find the geofence the user is inside
    const pos = userLoc.value ?? locationIn.value
    const insideGeofence =
      pos && officeGeofences.value.find(
        (g) => distanceMeters(pos, { lat: g.latitude, lng: g.longitude }) <= g.radius_meters,
      )
    if (insideGeofence && insideGeofence.have_facial) {
      step.value = 'facial_out'
    } else {
      // If no facial required, just clock out directly
      // Do not recenter or restrict map
      clockOutLoading.value = true
      ;(async () => {
        try {
          const loc = await getLocation()
          locationOut.value = loc
          const locStr = locationString(loc)!
          await clockOut(locStr, null)
          step.value = 'idle'
          locationOut.value = null
          clearClockOutOutputState()
        } catch {
          await clockOut(undefined, null)
          step.value = 'idle'
          clearClockOutOutputState()
        } finally {
          clockOutLoading.value = false
        }
      })()
    }
  } finally {
    if (step.value === 'facial_out') clockOutLoading.value = false
  }
}

/** WFH: open output panel first. Office: skip output and go straight to facial clock-out. */
function onClockOutClick() {
  if (clockOutDisabledByGeofence.value) return
  if (todayRecord.value?.work_modality === 'wfh') {
    openClockOutOutputPanel()
    return
  }
  beginOfficeClockOut()
}

async function submitClockOutOutput() {
  if (clockOutDisabledByGeofence.value) return
  const out = clockOutOutputDraft.value.trim() || null
  clockOutOutputToSave.value = out
  showClockOutOutputPanel.value = false
  await executeWfhClockOut()
}

async function executeWfhClockOut() {
  clockOutLoading.value = true
  locationError.value = null
  locationOut.value = null
  try {
    const loc = await getLocation()
    locationOut.value = loc
    const locStr = locationString(loc)!
    if (todayRecord.value?.location_in && isOutsideWfhRadius(loc, todayRecord.value.location_in)) {
      clockOutConfirm.value = { outsideWfh: true }
      return
    }
    await clockOut(locStr, clockOutOutputToSave.value)
    step.value = 'idle'
    locationOut.value = null
    clearClockOutOutputState()
  } catch {
    await clockOut(undefined, clockOutOutputToSave.value)
    step.value = 'idle'
    clearClockOutOutputState()
  } finally {
    clockOutLoading.value = false
  }
}

function confirmClockOutOutside() {
  const loc = locationString(locationOut.value)
  if (!loc) return
  clockOut(loc, clockOutOutputToSave.value).then(() => {
    step.value = 'idle'
    clockOutConfirm.value = null
    locationOut.value = null
    clearClockOutOutputState()
  })
}

function cancelClockOutConfirm() {
  clockOutConfirm.value = null
  locationOut.value = null
  clockOutOutputToSave.value = null
}

function fmtStored(t: string | null) {
  return t ? new Date(storedToRealInstant(t)).toLocaleTimeString() : '—'
}

/** UI label for `work_modality` (DB stores lowercase e.g. wfh). */
function formatWorkModalityLabel(m: string | null | undefined): string {
  if (m == null || m === '') return '—'
  const v = String(m).trim().toLowerCase()
  if (v === 'wfh') return 'WFH'
  if (v === 'office') return 'Office'
  return String(m).trim()
}

/** Chronological events for today (clock in/out, lunch start/end) for the activity panel. */
const todayTimelineEvents = computed(() => {
  type Ev = { key: string; label: string; time: string; displayTime: string; modality?: string }
  const raw: Ev[] = []
  for (const r of todayRecords.value) {
    if (r.clock_in) {
      raw.push({
        key: `${r.attendance_id}-in`,
        label: 'Clock in',
        time: r.clock_in,
        displayTime: fmtStored(r.clock_in),
        modality: formatWorkModalityLabel(r.work_modality),
      })
    }
    if (r.lunch_break_start) {
      raw.push({
        key: `${r.attendance_id}-lunch-start`,
        label: 'Lunch break started',
        time: r.lunch_break_start,
        displayTime: fmtStored(r.lunch_break_start),
      })
    }
    if (r.lunch_break_end) {
      raw.push({
        key: `${r.attendance_id}-lunch-end`,
        label: 'Lunch break ended',
        time: r.lunch_break_end,
        displayTime: fmtStored(r.lunch_break_end),
      })
    }
    if (r.clock_out) {
      const base = fmtStored(r.clock_out)
      const displayTime = isClockOutNextLocalDay(r.clock_in, r.clock_out)
        ? `${base} (Next day)`
        : base
      raw.push({
        key: `${r.attendance_id}-out`,
        label: 'Clock out',
        time: r.clock_out,
        displayTime,
        modality: formatWorkModalityLabel(r.work_modality),
      })
    }
  }
  return raw.sort((a, b) => storedToRealInstant(a.time) - storedToRealInstant(b.time))
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
            <div
              v-if="showClockOutOutputPanel && todayRecord?.work_modality === 'wfh'"
              class="confirm-wrap clock-out-output-wrap"
            >
              <p class="muted clock-out-output-label">What did you accomplish during this shift?</p>
              <textarea
                v-model="clockOutOutputDraft"
                class="clock-out-output-textarea"
                rows="5"
                placeholder="Describe the output you accomplished for this clock-in…"
                aria-label="Work output for this shift"
              />
              <div class="actions">
                <button
                  type="button"
                  class="btn primary"
                  :disabled="clockOutLoading"
                  @click="submitClockOutOutput"
                >
                  <span v-if="clockOutLoading" class="btn-loading-wrap">
                    <span class="btn-loading-spinner" aria-hidden="true"></span>
                    <span>Continuing…</span>
                  </span>
                  <span v-else>Clock out</span>
                </button>
                <button
                  type="button"
                  class="btn secondary"
                  :disabled="clockOutLoading"
                  @click="cancelClockOutOutputPanel"
                >
                  Cancel
                </button>
              </div>
            </div>
            <div v-else-if="step === 'facial_out'" class="confirm-wrap facial-out-wrap">
              <p class="muted">Face verification in progress… Saving your clock-out…</p>
            </div>
            <div v-else-if="clockOutConfirm" class="confirm-wrap">
              <p class="confirm-msg">
                {{
                  clockOutConfirm.outsideOffice
                    ? 'Are you sure you want to clock out outside the office location? You will be flagged as travel.'
                    : 'Are you sure you want to clock out outside your WFH radius? You will be flagged as possible travel.'
                }}
              </p>
              <div class="actions">
                <button
                  type="button"
                  class="btn primary"
                  :disabled="isLoading"
                  @click="confirmClockOutOutside"
                >
                  <span v-if="isLoading" class="btn-loading-wrap">
                    <span class="btn-loading-spinner" aria-hidden="true"></span>
                    <span>Clocking out…</span>
                  </span>
                  <span v-else>Yes, clock out</span>
                </button>
                <button type="button" class="btn secondary" @click="cancelClockOutConfirm">
                  Cancel
                </button>
              </div>
            </div>
            <template v-else>
              <div class="hero-sub-row clocked-hero-row">
                <div class="clocked-hero-left">
                  <template v-if="isOnLunch">
                    <p class="timer-label">Lunch break</p>
                    <div class="timer lunch-timer timer-hero-main">{{ lunchElapsedDisplay }}</div>
                    <p class="muted sub">Work: {{ elapsedDisplay }}</p>
                  </template>
                  <template v-else>
                    <p class="muted hero-sub clocked-hero-label">
                      Working · {{ formatWorkModalityLabel(todayRecord.work_modality) }}
                    </p>
                    <div class="timer timer-hero-main" aria-live="polite">{{ elapsedDisplay }}</div>
                    <p class="muted clocked-hero-meta">
                      In at {{ fmtStored(todayRecord.clock_in) }}
                    </p>
                  </template>
                </div>
              </div>
              <div v-if="todayRecord.lunch_break_start" class="lunch-info">
                <span class="muted"
                  >Lunch {{ isOnLunch ? 'started' : 'ended' }} at
                  {{
                    isOnLunch
                      ? fmtStored(todayRecord.lunch_break_start)
                      : fmtStored(todayRecord.lunch_break_end)
                  }}</span
                >
              </div>
              <div class="actions">
                <template v-if="!usedLunchBreak">
                  <button
                    v-if="!isOnLunch"
                    type="button"
                    class="btn secondary"
                    :disabled="isLoading"
                    @click="startLunchBreak"
                  >
                    <span v-if="isLoading" class="btn-loading-wrap">
                      <span class="btn-loading-spinner" aria-hidden="true"></span>
                      <span>Starting…</span>
                    </span>
                    <span v-else>Start lunch</span>
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn secondary"
                    :disabled="isLoading"
                    @click="endLunchBreak"
                  >
                    <span v-if="isLoading" class="btn-loading-wrap">
                      <span class="btn-loading-spinner" aria-hidden="true"></span>
                      <span>Ending…</span>
                    </span>
                    <span v-else>End lunch</span>
                  </button>
                </template>
                <button
                  v-if="!isOnLunch"
                  type="button"
                  class="btn primary btn-clockout"
                  :disabled="isLoading || clockOutLoading || clockOutDisabledByGeofence"
                  @click="onClockOutClick"
                >
                  <span v-if="isLoading || clockOutLoading" class="btn-loading-wrap">
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
            <div class="modality-heading">
              <h2 class="modality-heading-title">Select your work modality</h2>
              <p class="muted modality-heading-sub">
                Choose whether you are working from the office or remotely.
              </p>
            </div>
            <div
              class="modality-btns modality-toggle"
              :class="{ 'is-office': workModality === 'office', 'is-wfh': workModality === 'wfh' }"
              role="group"
              aria-label="Work modality"
            >
              <span class="modality-toggle-indicator" aria-hidden="true"></span>
              <button
                type="button"
                class="btn modality-toggle-btn"
                :class="{
                  primary: workModality === 'office',
                  secondary: workModality !== 'office',
                }"
                :aria-pressed="workModality === 'office'"
                @click="workModality = 'office'"
              >
                <span class="modality-toggle-btn-inner">
                  <svg
                    class="modality-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M3 21h18v-8H3v8zm2-2v-4h14v4H5zM3 10h18V3H3v7zm2-2V5h14v3H5z" />
                  </svg>
                  <span>Office</span>
                </span>
              </button>
              <button
                type="button"
                class="btn modality-toggle-btn"
                :class="{ primary: workModality === 'wfh', secondary: workModality !== 'wfh' }"
                :aria-pressed="workModality === 'wfh'"
                @click="workModality = 'wfh'"
              >
                <span class="modality-toggle-btn-inner">
                  <svg
                    class="modality-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8h5z" />
                  </svg>
                  <span>WFH</span>
                </span>
              </button>
            </div>
            <p v-if="(officeFetchingLocation || wfhFetchingLocation) && !locationIn" class="muted">
              Getting location…
            </p>
            <p v-if="workModality === 'office' && officeGeofenceLoading" class="muted">
              Loading office location…
            </p>
            <p
              v-if="workModality === 'office' && !officeGeofenceLoading && officeGeofences.length === 0"
              class="block-msg"
            >
              Office location is not set up yet. Please contact your administrator.
            </p>
            <div class="actions">
              <button
                type="button"
                class="btn primary"
                :disabled="chooseModalityContinueDisabled"
                @click="selectModalityAndStart(workModality)"
              >
                <span v-if="isLoading">Continuing…</span>
                <span v-else-if="(officeFetchingLocation || wfhFetchingLocation) && !locationIn"
                  >Getting location…</span
                >
                <span v-else-if="workModality === 'office' && officeGeofenceLoading">Loading…</span>
                <span v-else>Continue</span>
              </button>
              <button type="button" class="btn secondary" @click="step = 'idle'">Cancel</button>
            </div>
            <div
              v-if="todayTimelineEvents.length"
              class="today-activity-panel"
              aria-label="Today's activity"
            >
              <h3 class="today-activity-panel-title">Today's activity</h3>
              <ol class="today-activity-list">
                <li v-for="ev in todayTimelineEvents" :key="ev.key" class="today-activity-item">
                  <span class="today-activity-dot" aria-hidden="true"></span>
                  <div class="today-activity-body">
                    <span class="today-activity-label">{{ ev.label }}</span>
                    <time class="today-activity-time" :datetime="ev.time">{{
                      ev.displayTime
                    }}</time>
                    <span v-if="ev.modality" class="today-activity-modality">{{
                      ev.modality
                    }}</span>
                  </div>
                </li>
              </ol>
            </div>
          </div>
          <div v-else-if="step === 'wfh_photo'" class="hero-card wfh-photo-card">
            <p class="muted">Use your camera to take a proof photo, then submit to clock in.</p>
            <div
              v-if="wfhFrontBackPair && wfhShowCameraPicker"
              class="wfh-camera-switch wfh-camera-switch--front-back"
              role="group"
              aria-label="Choose camera"
            >
              <span class="wfh-camera-switch-label muted small">Camera</span>
              <div class="wfh-camera-switch-btns">
                <button
                  type="button"
                  class="btn secondary wfh-camera-switch-btn"
                  :class="{ primary: wfhSelectedDeviceId === wfhFrontBackPair.frontId }"
                  :disabled="wfhCameraStarting"
                  @click="selectWfhCameraDevice(wfhFrontBackPair.frontId)"
                >
                  Front
                </button>
                <button
                  type="button"
                  class="btn secondary wfh-camera-switch-btn"
                  :class="{ primary: wfhSelectedDeviceId === wfhFrontBackPair.backId }"
                  :disabled="wfhCameraStarting"
                  @click="selectWfhCameraDevice(wfhFrontBackPair.backId)"
                >
                  Back
                </button>
              </div>
            </div>
            <div v-else-if="wfhShowCameraPicker" class="wfh-camera-switch">
              <label class="wfh-camera-switch-label muted small" for="wfh-camera-select"
                >Camera</label
              >
              <select
                id="wfh-camera-select"
                class="wfh-camera-select"
                :value="wfhSelectedDeviceId ?? ''"
                :disabled="wfhCameraStarting"
                @change="onWfhCameraSelectChange"
              >
                <option v-for="(d, idx) in wfhVideoInputs" :key="d.deviceId" :value="d.deviceId">
                  {{ d.label?.trim() || `Camera ${idx + 1}` }}
                </option>
              </select>
            </div>
            <div class="wfh-photo-camera">
              <video
                v-show="!wfhPhotoFile"
                ref="wfhVideoRef"
                class="wfh-photo-video"
                playsinline
                muted
                @loadedmetadata="wfhVideoMetaReady = true"
              />
              <div v-if="wfhPhotoPreviewUrl && wfhPhotoFile" class="wfh-photo-preview-wrap">
                <img :src="wfhPhotoPreviewUrl" alt="WFH proof preview" class="wfh-photo-preview" />
              </div>
              <p v-if="wfhCameraStarting" class="muted small wfh-camera-status">Starting camera…</p>
              <div v-if="!wfhPhotoFile" class="wfh-photo-camera-actions">
                <button
                  type="button"
                  class="btn secondary"
                  :disabled="wfhCameraStarting || !wfhVideoMetaReady"
                  @click="captureWfhPhotoFromCamera"
                >
                  Capture photo
                </button>
              </div>
              <div v-else class="wfh-photo-camera-actions">
                <button
                  type="button"
                  class="btn secondary"
                  :disabled="wfhPhotoUploading"
                  @click="retakeWfhPhoto"
                >
                  Retake
                </button>
              </div>
              <p v-if="wfhPhotoError" class="error wfh-photo-error">{{ wfhPhotoError }}</p>
            </div>
            <div class="actions">
              <button
                type="button"
                class="btn primary"
                :disabled="isLoading || wfhPhotoUploading || !wfhPhotoFile || wfhCameraStarting"
                @click="submitWfhClockIn"
              >
                <span v-if="wfhPhotoUploading">Uploading…</span>
                <span v-else>Submit and clock in</span>
              </button>
              <button
                type="button"
                class="btn secondary"
                :disabled="wfhPhotoUploading"
                @click="cancelWfhPhotoFlow"
              >
                Cancel
              </button>
            </div>
          </div>
          <!-- Office facial: message shown in modal -->
          <div v-else-if="step === 'facial' && workModality === 'office'" class="hero-card">
            <p class="muted">Face verification in progress…</p>
          </div>
          <!-- Idle: start -->
          <div v-else class="hero-card hero-idle">
            <div class="hero-sub-row">
              <p class="muted hero-sub">Clock in and out here to track your daily attendance.</p>
            </div>
            <button
              type="button"
              class="btn hero-cta"
              :disabled="isLoading"
              @click="onClockInClick"
            >
              Clock in
            </button>
            <div
              v-if="todayTimelineEvents.length"
              class="today-activity-panel"
              aria-label="Today's activity"
            >
              <h3 class="today-activity-panel-title">Today's activity</h3>
              <ol class="today-activity-list">
                <li v-for="ev in todayTimelineEvents" :key="ev.key" class="today-activity-item">
                  <span class="today-activity-dot" aria-hidden="true"></span>
                  <div class="today-activity-body">
                    <span class="today-activity-label">{{ ev.label }}</span>
                    <time class="today-activity-time" :datetime="ev.time">{{
                      ev.displayTime
                    }}</time>
                    <span v-if="ev.modality" class="today-activity-modality">{{
                      ev.modality
                    }}</span>
                  </div>
                </li>
              </ol>
            </div>
          </div>
        </template>
      </div>
      <!-- Right: Map -->
      <aside class="map-aside">
        <div class="map-wrap-wrapper">
          <div
            v-if="(officeFetchingLocation || wfhFetchingLocation) && !locationIn"
            class="map-loading-overlay"
            aria-live="polite"
          >
            <span class="map-loading-spinner" aria-hidden="true"></span>
            <span class="map-loading-text">Getting location…</span>
          </div>
          <div ref="mapContainer" class="map-wrap"></div>
          <div
            v-if="
              (workModality === 'office' && step === 'choose_modality' && isOutsideOfficeRadius) ||
              clockOutDisabledByGeofence
            "
            class="map-geofence-float"
            role="status"
          >
            {{
              clockOutDisabledByGeofence
                ? 'You are outside the office geofence. Move back inside to clock out.'
                : 'You are outside the office geofence. Move closer to clock in.'
            }}
          </div>
          <button
            type="button"
            class="map-locate-me-btn"
            aria-label="Refresh location and center map on you"
            title="Refresh location and center map on you"
            @click="onMapLocateMeClick"
          >
            <svg
              class="map-locate-me-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"
              />
            </svg>
          </button>
          <div
            ref="userEdgeIndicator"
            class="map-edge-indicator map-edge-user"
            aria-label="Your location direction"
            title="Click to focus on your location"
            @click="focusOnUserLocation"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L8 10L12 8L16 10L12 2Z" />
            </svg>
          </div>
          <div
            ref="branchEdgeIndicator"
            class="map-edge-indicator map-edge-branch"
            aria-label="Branch location direction"
            title="Click to focus on branch location"
            @click="focusOnBranchLocation"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L8 10L12 8L16 10L12 2Z" />
            </svg>
          </div>
        </div>
        <p class="map-caption muted">
          <span v-if="userLoc" class="you-are-here">Your current location</span>
          <template v-if="userLoc"> · </template>
          {{ mapCaptionShort }}
          <template v-if="workModality === 'office'">
            {{
              officeGeofences.length
                ? ` · ${Math.round((userLoc && officeGeofences.find((g) => distanceMeters(userLoc, { lat: g.latitude, lng: g.longitude }) <= g.radius_meters))?.radius_meters || officeGeofences[0].radius_meters)}m radius`
                : ` · ${RADIUS_M}m radius`
            }}
          </template>
        </p>
      </aside>
    </div>

    <!-- Face scanning modal (clock in / clock out). Include facialScanSuccess so success overlay can show after step is clocked_in (timer visible behind lighter overlay). -->
    <div
      v-if="
        step === 'facial' || step === 'facial_out' || facialScanSuccess || autoFacialClockOutSuccess
      "
      class="liveness-modal-overlay"
      :class="{
        'liveness-modal-overlay--post-clock-in': facialScanSuccess && step === 'clocked_in',
      }"
      aria-modal="true"
      role="dialog"
      aria-labelledby="facial-modal-title"
    >
      <div class="liveness-modal facial-scan-modal">
        <video
          v-if="!facialScanSuccess && !autoFacialClockOutSuccess"
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
          <p class="facial-success-msg">
            {{ autoFacialClockOutSuccess ? 'Successfully clocked out' : 'Scanned successfully' }}
          </p>
        </div>
        <h2 id="facial-modal-title" class="liveness-title">
          {{ facialScanSuccess || autoFacialClockOutSuccess ? 'Success' : 'Face verification' }}
        </h2>
        <p class="liveness-description">
          {{
            autoFacialClockOutSuccess
              ? autoFacialClockOutSavedLocation
                ? 'Your clock-out was recorded with your current location.'
                : 'Your clock-out has been recorded.'
              : facialScanSuccess
                ? step === 'facial_out'
                  ? 'Clocking out…'
                  : 'Proceeding to timer…'
                : step === 'facial'
                  ? 'Verify at facial to clock in.'
                  : 'Verify at facial to clock out.'
          }}
        </p>
        <button
          v-if="!facialScanSuccess && !autoFacialClockOutSuccess"
          type="button"
          class="btn liveness-cancel-btn"
          :disabled="cancelFacialLoading"
          @click="handleCancelFacial"
        >
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
.timeclock-page {
  padding: 0;
  width: 100%;
}

.timeclock-layout {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 2rem;
  align-items: start;
}

@media (min-width: 1200px) {
  .timeclock-layout {
    grid-template-columns: 1fr 520px;
    gap: 2.5rem;
  }
}

@media (max-width: 900px) {
  .timeclock-layout {
    grid-template-columns: 1fr;
  }
}

/* Mobile spacing tweaks (CSS only) */
@media (max-width: 767px) {
  .timeclock-layout {
    gap: 1rem;
  }

  .hero-section {
    max-width: 100%;
  }

  .hero-title {
    font-size: 1.5rem;
    margin-bottom: 0.25rem;
  }

  .hero-card,
  .hero-idle {
    padding: 1rem;
    border-radius: 14px;
  }

  .actions {
    gap: 0.5rem;
  }

  .actions .btn {
    width: 100%;
    justify-content: center;
  }

  .modality-toggle {
    width: 100%;
  }

  .modality-toggle-btn {
    min-width: 0;
    width: 50%;
    padding: 0.6rem 0.75rem;
  }

  .map-wrap-wrapper {
    min-height: 260px;
    border-radius: 14px;
  }

  .map-wrap {
    height: 260px;
    border-radius: 10px;
  }

  .map-caption {
    font-size: 0.6875rem;
  }
}

.hero-section {
  min-width: 0;
  max-width: 560px;
}

.hero-title {
  margin: 0 0 0.5rem;
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.hero-sub {
  margin: 0 0 1rem;
  font-size: 0.9375rem;
}

.hero-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid #9ee2ff;
  border-radius: 16px;
  padding: 1rem 2rem;
  margin-top: 0.5rem;
}

.hero-idle {
  padding: 1rem 2rem;
  box-shadow:
    rgba(0, 0, 0, 0.1) 0px 1px 3px 0px,
    rgba(0, 0, 0, 0.06) 0px 1px 2px 0px;
}

.hero-cta {
  padding: 0.875rem 2rem;
  font-size: 1.125rem;
  font-weight: 600;
}

.error {
  color: #f87171;
  font-size: 0.875rem;
  margin: 0 0 0.5rem;
}

.muted {
  color: #64748b;
  font-size: 0.875rem;
  margin: 0.5rem 0;
}

.block-msg {
  color: #fbbf24;
  margin: 0 0 1rem;
}

.timer-wrap {
  margin-bottom: 0.25rem;
}

.timer-label {
  margin: 0 0 0.25rem;
  font-size: 0.875rem;
  color: #94a3b8;
}

.timer {
  font-size: 2.25rem;
  font-weight: 700;
  color: #38bdf8;
  font-variant-numeric: tabular-nums;
}

.timer.lunch-timer {
  color: #fbbf24;
}

.timer-wrap .sub {
  margin-top: 0.5rem;
  font-size: 0.8125rem;
}

.lunch-info {
  margin: 0.25rem 0;
}

.modality-btns {
  display: flex;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

.modality-heading {
  margin-bottom: 0.75rem;
}

.modality-heading-title {
  margin: 0 0 0.35rem;
  font-size: 1.0625rem;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.modality-heading-sub {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.modality-toggle-btn-inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
}

.modality-icon {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
  transition:
    transform 0.32s cubic-bezier(0.34, 1.45, 0.64, 1),
    opacity 0.2s ease;
  opacity: 0.88;
}

.modality-toggle-btn.primary .modality-icon {
  transform: scale(1.1);
  opacity: 1;
}

/* Segmented toggle (work modality) */
.modality-toggle {
  position: relative;
  gap: 0;
  padding: 6px;
  border-radius: 999px;
  background: rgba(16, 179, 255, 0.144);
  box-shadow: none;
  width: fit-content;
  overflow: hidden;
}

.modality-toggle-indicator {
  position: absolute;
  top: 6px;
  left: 6px;
  width: calc(50% - 6px);
  height: calc(100% - 12px);
  border-radius: 999px;
  background: #0ea5e9;
  box-shadow: none;
  transform: translateX(0%);
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.modality-toggle.is-wfh .modality-toggle-indicator {
  transform: translateX(100%);
}

.modality-toggle-btn {
  position: relative;
  z-index: 1;
  flex: 1 1 0;
  border-radius: 999px;
  padding: 0.6rem 1.2rem;
  min-width: 140px;
  justify-content: center;
  font-weight: 600;
  letter-spacing: 0.01em;
  border: 0;
  background: transparent;
  transition:
    color 220ms ease,
    transform 0.12s ease;
}

.modality-toggle-btn.secondary {
  color: #0ea5e9;
  border: 0;
}

.modality-toggle-btn.primary {
  color: #ffffff;
}

.modality-toggle-btn:focus-visible {
  outline: none;
}

.modality-toggle-btn:active:not(:disabled) {
  transform: scale(0.99);
}

@media (prefers-reduced-motion: reduce) {
  .modality-toggle-indicator,
  .modality-toggle-btn,
  .modality-icon {
    transition: none;
  }

  .modality-toggle-btn.primary .modality-icon {
    transform: none;
  }
}

.today-activity-panel {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(148, 163, 184, 0.35);
}

.today-activity-panel-title {
  margin: 0 0 0.65rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.today-activity-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.today-activity-item {
  position: relative;
  display: flex;
  gap: 0.65rem;
  padding: 0.45rem 0 0.45rem 0.15rem;
  border-left: 2px solid rgba(14, 165, 233, 0.35);
  margin-left: 0.35rem;
  padding-left: 0.85rem;
}

.today-activity-item:last-child {
  padding-bottom: 0;
}

.today-activity-dot {
  position: absolute;
  left: -0.4rem;
  top: 0.65rem;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #0ea5e9;
  box-shadow: 0 0 0 2px #fff;
}

.today-activity-body {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.65rem;
  min-width: 0;
}

.today-activity-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #0f172a;
}

.today-activity-time {
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: #64748b;
}

.today-activity-modality {
  font-size: 0.75rem;
  font-weight: 600;
  color: #0ea5e9;
  padding: 0.1rem 0.45rem;
  border-radius: 6px;
  background: rgba(14, 165, 233, 0.12);
}

/* Today's activity: hardcoded slate colors above are illegible on dark hero cards */
body.dark-mode .timeclock-page .today-activity-panel {
  border-top-color: var(--border-light);
}

body.dark-mode .timeclock-page .today-activity-panel-title {
  color: var(--text-secondary);
}

body.dark-mode .timeclock-page .today-activity-label {
  color: var(--text-primary);
}

body.dark-mode .timeclock-page .today-activity-time {
  color: var(--text-secondary);
}

body.dark-mode .timeclock-page .today-activity-dot {
  box-shadow: 0 0 0 2px var(--bg-secondary);
}

body.dark-mode .timeclock-page .today-activity-modality {
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.15);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}

.btn {
  padding: 0.5rem 1rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
  background: #0ea5e9;
  color: #fff;
}

.btn.primary {
  background: #0ea5e9;
  color: #fff;
}

.btn.secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #0ea5e9;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-loading-wrap {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: map-spin 0.7s linear infinite;
}

.confirm-wrap {
  margin: 0;
}

.confirm-msg {
  color: #fbbf24;
  margin: 0 0 1rem;
  font-size: 0.9375rem;
}

.facial-placeholder {
  text-align: center;
  padding: 0.5rem 0;
}

.facial-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 0.5rem;
}

.facial-placeholder p {
  margin: 0 0 1rem;
  color: #94a3b8;
}

.facial-btns {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

.liveness-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.liveness-modal-overlay--post-clock-in {
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.liveness-modal {
  text-align: center;
  padding: 2rem;
  max-width: 420px;
  width: 100%;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.liveness-modal .liveness-icon {
  display: block;
  margin: 0 auto 0.75rem;
}

.liveness-modal .liveness-face-id-video {
  width: 140px;
  height: 140px;
  object-fit: contain;
}

.facial-scan-modal .liveness-description {
  margin-bottom: 1rem;
}

.facial-success-block {
  margin: 0 auto 0.75rem;
  text-align: center;
}

.facial-success-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #22c55e;
  color: #fff;
  font-size: 2.5rem;
  font-weight: 700;
}

.facial-success-msg {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 500;
  color: #38bdf8;
}

.liveness-modal .liveness-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #e2e8f0;
  margin: 0 0 0.5rem;
}

.liveness-modal .liveness-description {
  font-size: 0.9375rem;
  color: #94a3b8;
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

.liveness-modal .error {
  margin-top: 1rem;
}

.liveness-cancel-btn {
  margin-top: 1.5rem;
  background: rgba(255, 255, 255, 0.1);
  color: #94a3b8;
  width: 100%;
}

.liveness-cancel-btn:hover {
  background: rgba(248, 113, 113, 0.2);
  color: #f87171;
}

.map-aside {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* Google Maps–style chrome: land #F1F3F4, subtle borders, Material-like elevation */
.map-wrap-wrapper {
  position: relative;
  min-height: 320px;
  border-radius: 20px;
  overflow: hidden;
  isolation: isolate;
  border: 1px solid rgba(32, 33, 36, 0.12);
  background: linear-gradient(180deg, #ffffff 0%, #f8f9fa 35%, #f1f3f4 100%);
  box-shadow:
    0 1px 2px rgba(60, 64, 67, 0.28),
    0 2px 6px rgba(60, 64, 67, 0.15),
    0 8px 24px rgba(60, 64, 67, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  animation: map-frame-ambient 14s ease-in-out infinite;
}

@keyframes map-frame-ambient {
  0%,
  100% {
    box-shadow:
      0 1px 2px rgba(60, 64, 67, 0.28),
      0 2px 6px rgba(60, 64, 67, 0.15),
      0 8px 24px rgba(60, 64, 67, 0.08),
      0 0 40px rgba(66, 133, 244, 0.06),
      inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }
  50% {
    box-shadow:
      0 1px 2px rgba(60, 64, 67, 0.3),
      0 3px 8px rgba(60, 64, 67, 0.16),
      0 10px 28px rgba(60, 64, 67, 0.1),
      0 0 52px rgba(66, 133, 244, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.95);
  }
}

@media (prefers-reduced-motion: reduce) {
  .map-wrap-wrapper {
    animation: none;
  }
}

.map-wrap-wrapper::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 14;
  pointer-events: none;
  border-radius: inherit;
  background: radial-gradient(
    ellipse 100% 95% at 50% 40%,
    transparent 55%,
    rgba(32, 33, 36, 0.05) 100%
  );
  mix-blend-mode: multiply;
}

.map-wrap-wrapper::after {
  content: '';
  position: absolute;
  top: 0;
  left: 8%;
  right: 8%;
  height: 4px;
  z-index: 16;
  pointer-events: none;
  border-radius: 0 0 999px 999px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.55) 50%,
    transparent 100%
  );
  opacity: 0.65;
  filter: blur(0.5px);
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
  background:
    radial-gradient(ellipse 80% 60% at 50% 40%, rgba(59, 130, 246, 0.25) 0%, transparent 55%),
    linear-gradient(165deg, rgba(15, 23, 42, 0.82) 0%, rgba(30, 41, 59, 0.88) 100%);
  border-radius: 20px;
  color: var(--text-secondary, #cbd5e1);
  font-size: 0.9375rem;
}

.map-loading-overlay .map-loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(66, 133, 244, 0.3);
  border-top-color: #4285f4;
  border-right-color: rgba(66, 133, 244, 0.55);
  border-radius: 50%;
  animation: map-spin 0.7s linear infinite;
  box-shadow: 0 0 18px rgba(66, 133, 244, 0.2);
}

.map-loading-overlay .map-loading-text {
  font-weight: 500;
}

.map-locate-me-btn {
  position: absolute;
  z-index: 35;
  right: 10px;
  bottom: 10px;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: #fff;
  color: #5f6368;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 1px 4px rgba(60, 64, 67, 0.32),
    0 2px 6px rgba(60, 64, 67, 0.15);
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.map-locate-me-btn:hover {
  background: #f8f9fa;
  color: #202124;
  box-shadow:
    0 2px 6px rgba(60, 64, 67, 0.28),
    0 4px 12px rgba(60, 64, 67, 0.12);
}

.map-locate-me-btn:active {
  background: #f1f3f4;
}

.map-locate-me-btn:focus-visible {
  outline: 2px solid #4285f4;
  outline-offset: 2px;
}

.map-locate-me-icon {
  width: 22px;
  height: 22px;
  display: block;
}

.map-edge-indicator {
  position: absolute;
  display: none;
  z-index: 30;
  width: 48px;
  height: 48px;
  cursor: pointer;
  transition:
    opacity 0.2s ease,
    filter 0.2s ease;
}

.map-edge-indicator:hover {
  opacity: 0.9;
  filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.4)) brightness(1.1);
}

.map-edge-user {
  color: #4285f4;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.3));
}

.map-edge-branch {
  color: #6366f1;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.3));
}

.map-edge-indicator svg {
  width: 100%;
  height: 100%;
}

@media (min-width: 1200px) {
  .map-wrap-wrapper {
    min-height: 420px;
  }
}

.map-wrap-wrapper :deep(.map-center-icon) {
  background: none;
  border: none;
}

.map-wrap-wrapper :deep(.map-center-icon .center-pin) {
  display: block;
  line-height: 0;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.25));
}

.map-wrap-wrapper :deep(.map-center-icon .center-pin svg) {
  display: block;
}

.map-wrap-wrapper :deep(.map-bound-tooltip) {
  background: #fff;
  border: 1px solid rgba(32, 33, 36, 0.1);
  border-radius: 10px;
  box-shadow:
    0 1px 2px rgba(60, 64, 67, 0.28),
    0 2px 8px rgba(60, 64, 67, 0.12);
  padding: 0;
  font-size: 0.8125rem;
  color: #3c4043;
  /* nowrap caused Leaflet to measure tooltips at ~0 width; long addresses then stacked one character per line */
  white-space: normal;
  box-sizing: border-box;
}

.map-wrap-wrapper :deep(.map-user-marker) {
  background: none;
  border: none;
}

.map-wrap-wrapper :deep(.map-user-marker-root) {
  position: relative;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.map-wrap-wrapper :deep(.map-user-marker-pulse) {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid rgba(66, 133, 244, 0.7);
  animation: map-marker-pulse 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  pointer-events: none;
}

.map-wrap-wrapper :deep(.map-user-marker-pulse--delay) {
  animation-delay: 0.9s;
}

@keyframes map-marker-pulse {
  0% {
    transform: scale(1);
    opacity: 0.9;
  }
  100% {
    transform: scale(2.15);
    opacity: 0;
  }
}

.map-wrap-wrapper :deep(.map-user-marker-wrap) {
  position: relative;
  z-index: 1;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid #4285f4;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.22),
    0 0 0 1px rgba(255, 255, 255, 0.9) inset;
  background: #e8f0fe;
  display: flex;
  align-items: center;
  justify-content: center;
}

.map-wrap-wrapper :deep(.map-user-marker-arrow-wrap) {
  position: absolute;
  bottom: -2px;
  left: 50%;
  width: 22px;
  height: 22px;
  margin-left: -11px;
  z-index: 2;
  pointer-events: none;
}

.map-wrap-wrapper :deep(.map-user-marker-arrow) {
  width: 100%;
  height: 100%;
  color: #4285f4;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
  transform-origin: 50% 50%;
}

.map-wrap-wrapper :deep(.map-user-marker-arrow-svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.map-wrap-wrapper :deep(.map-user-marker-root--geofence-out .map-user-marker-wrap) {
  border-color: #ea4335;
  box-shadow:
    0 2px 8px rgba(234, 67, 53, 0.35),
    0 0 0 1px rgba(255, 255, 255, 0.9) inset;
}

.map-wrap-wrapper :deep(.map-user-marker-root--geofence-in .map-user-marker-wrap) {
  border-color: #34a853;
  box-shadow:
    0 2px 8px rgba(52, 168, 83, 0.3),
    0 0 0 1px rgba(255, 255, 255, 0.9) inset;
}

.map-wrap-wrapper :deep(.map-user-marker-root--geofence-out .map-user-marker-pulse) {
  border-color: rgba(234, 67, 53, 0.65);
}

.map-wrap-wrapper :deep(.map-user-marker-root--geofence-in .map-user-marker-pulse) {
  border-color: rgba(52, 168, 83, 0.58);
}

.map-wrap-wrapper :deep(.map-user-marker-root--geofence-out .map-user-marker-initial) {
  color: #c5221f;
}

.map-wrap-wrapper :deep(.map-user-marker-root--geofence-in .map-user-marker-initial) {
  color: #137333;
}

.map-wrap-wrapper :deep(.map-user-marker-root--geofence-out .map-user-marker-arrow) {
  color: #ea4335;
}

.map-wrap-wrapper :deep(.map-user-marker-root--geofence-in .map-user-marker-arrow) {
  color: #34a853;
}

.map-geofence-float {
  position: absolute;
  z-index: 40;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  max-width: min(360px, calc(100% - 24px));
  padding: 0.65rem 1rem;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.35;
  color: #3c4043;
  background: #fff;
  border-radius: 8px;
  border-left: 4px solid #ea4335;
  box-shadow:
    0 1px 2px rgba(60, 64, 67, 0.28),
    0 4px 14px rgba(60, 64, 67, 0.12);
  pointer-events: none;
  text-align: center;
}

.map-wrap-wrapper :deep(.map-user-marker-img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.map-wrap-wrapper :deep(.map-user-marker-initial) {
  font-size: 1.125rem;
  font-weight: 700;
  color: #1967d2;
}

.map-wrap-wrapper :deep(.map-user-label-icon) {
  background: none;
  border: none;
}

.map-wrap-wrapper :deep(.map-bound-tooltip-user) {
  white-space: normal;
  width: 280px;
  text-align: center;
}

.map-wrap-wrapper :deep(.map-tooltip-you strong) {
  display: block;
  margin-bottom: 4px;
}

.map-wrap-wrapper :deep(.map-tooltip-you-label strong) {
  display: block;
  margin-bottom: 0;
  color: #0f172a;
  font-weight: 600;
  font-size: 0.8125rem;
}

.map-wrap-wrapper :deep(.map-tooltip-you .map-tooltip-address-only) {
  display: block;
  color: #5f6368;
  font-size: 0.75rem;
  font-weight: 400;
  white-space: normal;
  word-break: break-word;
  max-width: 260px;
  text-align: center;
}

.map-wrap-wrapper :deep(.map-bound-tooltip-geofence) {
  min-width: min(280px, calc(100vw - 48px));
  max-width: min(320px, calc(100vw - 48px));
  text-align: left;
}

.map-wrap-wrapper :deep(.map-bound-tooltip-geofence .map-tooltip-inner) {
  align-items: stretch;
  width: 100%;
}

.map-wrap-wrapper :deep(.map-tooltip-geofence-bind) {
  display: block;
  width: 100%;
  color: #5f6368;
  font-size: 0.75rem;
  line-height: 1.4;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: normal;
  text-align: center;
}

.you-are-here {
  font-weight: 600;
  color: #1a73e8;
}

.map-wrap-wrapper :deep(.map-bound-tooltip::before) {
  border-top-color: rgba(255, 255, 255, 0.97);
}

.map-wrap-wrapper :deep(.map-tooltip-inner) {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.map-wrap-wrapper :deep(.map-tooltip-inner strong) {
  color: #202124;
  font-weight: 600;
  font-size: 0.8125rem;
}

.map-wrap-wrapper :deep(.map-tooltip-inner span) {
  color: #5f6368;
  font-size: 0.75rem;
}

.map-wrap {
  width: 100%;
  height: 320px;
  border-radius: 12px;
  transform: translateZ(0);
  backface-visibility: hidden;
}

/* Land chrome ~#F1F3F4; water reads cyan ~#AADAFF after tile + filter (Voyager + tuning). */
.map-wrap-wrapper :deep(.leaflet-container) {
  background: #f1f3f4;
  font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

/*
 * Push raster tiles toward Google Maps default: light land, bright cyan water (#AADAFF-ish),
 * pastel park green (#C6E9AF-ish), crisp white roads.
 */
.map-wrap-wrapper :deep(.leaflet-tile-pane img.leaflet-tile) {
  filter: brightness(1.08) saturate(1.26) contrast(1.04) hue-rotate(352deg);
  image-rendering: auto;
}

@media (min-width: 1200px) {
  .map-wrap {
    height: 420px;
  }
}

.map-branch-label {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  font-size: 0.8125rem;
  color: #334155;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  pointer-events: none;
  text-align: center;
  z-index: 30;
  max-width: calc(100% - 24px);
}

/* Keep Leaflet from overlapping the mobile sidebar/navbar.
   The app layout sidebar uses a relatively low z-index (e.g. 50),
   while Leaflet defaults can go higher via panes/controls.
   We cap Leaflet + map overlays below the nav stack. */
.timeclock-page :deep(.leaflet-pane),
.timeclock-page :deep(.leaflet-map-pane),
.timeclock-page :deep(.leaflet-tile-pane),
.timeclock-page :deep(.leaflet-overlay-pane),
.timeclock-page :deep(.leaflet-shadow-pane),
.timeclock-page :deep(.leaflet-marker-pane) {
  z-index: 1;
}
.timeclock-page :deep(.leaflet-control),
.timeclock-page :deep(.leaflet-control-container) {
  z-index: 20;
}
.timeclock-page :deep(.leaflet-top),
.timeclock-page :deep(.leaflet-bottom) {
  z-index: 20;
}
.timeclock-page :deep(.leaflet-control-zoom),
.timeclock-page :deep(.leaflet-control-attribution) {
  z-index: 20;
}

.timeclock-page :deep(.leaflet-control-zoom) {
  border: none;
  border-radius: 8px;
  overflow: hidden;
  box-shadow:
    0 1px 4px rgba(60, 64, 67, 0.28),
    0 2px 8px rgba(60, 64, 67, 0.12);
}

.timeclock-page :deep(.leaflet-control-zoom a) {
  width: 40px;
  height: 40px;
  line-height: 38px;
  font-size: 20px;
  font-weight: 400;
  color: #5f6368;
  background: #fff;
  border-bottom: 1px solid #e8eaed;
}

.timeclock-page :deep(.leaflet-control-zoom a:last-child) {
  border-bottom: none;
}

.timeclock-page :deep(.leaflet-control-zoom a:hover) {
  background: #f8f9fa;
  color: #202124;
}

.timeclock-page :deep(.leaflet-bar a.leaflet-disabled) {
  opacity: 0.35;
}
.timeclock-page :deep(.leaflet-tooltip.map-bound-tooltip) {
  /* Leaflet sets white-space: nowrap on .leaflet-tooltip — breaks multi-line addresses into a narrow strip */
  white-space: normal;
  max-width: none;
}
.timeclock-page :deep(.leaflet-tooltip),
.timeclock-page :deep(.leaflet-popup) {
  z-index: 25;
}

.map-branch-label strong {
  color: #0f172a;
  font-weight: 600;
}

.map-branch-label span {
  color: #64748b;
  font-size: 0.75rem;
  letter-spacing: 0.02em;
}

.map-loading-label {
  flex-direction: row;
  gap: 8px;
  align-items: center;
}

.map-loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(14, 165, 233, 0.3);
  border-top-color: #0ea5e9;
  border-radius: 50%;
  animation: map-spin 0.7s linear infinite;
}

@keyframes map-spin {
  to {
    transform: rotate(360deg);
  }
}

.map-wfh-address {
  align-items: center;
}

.map-address-text {
  font-size: 0.75rem;
  color: #475569;
  line-height: 1.3;
  max-width: 260px;
  white-space: normal;
  word-break: break-word;
}

.map-caption {
  font-size: 0.75rem;
  margin: 0;
  padding: 0.5rem 0.85rem 0.55rem;
  border-radius: 999px;
  background: #fff;
  border: 1px solid rgba(32, 33, 36, 0.1);
  box-shadow:
    0 1px 2px rgba(60, 64, 67, 0.28),
    0 2px 8px rgba(60, 64, 67, 0.12);
  line-height: 1.35;
  color: #3c4043;
}

.branch-select {
  margin: 0.75rem 0 0;
}

.branch-select .small {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.8125rem;
}

.branch-btns {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.branch-btn {
  text-align: left;
  justify-content: flex-start;
}

.facial-out-wrap .facial-placeholder {
  padding: 0.5rem 0;
}

.hero-sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.3rem;
}

.clocked-hero-row {
  align-items: flex-start;
}

.clocked-hero-left {
  min-width: 0;
  flex: 1;
}

.clocked-hero-label {
  margin: 0 0 0.25rem !important;
}

.timer-hero-main {
  font-size: 2rem;
  font-weight: 700;
  color: #38bdf8;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  margin: 0.15rem 0 0.35rem;
}

.clocked-hero-meta {
  margin: 0 !important;
  font-size: 0.8125rem;
}

.wfh-photo-card {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.wfh-photo-camera {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.wfh-camera-switch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.wfh-camera-switch--front-back {
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
}

.wfh-camera-switch-label {
  font-size: 0.8125rem;
  margin: 0;
}

.wfh-camera-switch-btns {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.wfh-camera-switch-btn.primary {
  box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.35);
}

.wfh-camera-select {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.9rem;
}

.wfh-photo-video {
  display: block;
  width: 100%;
  max-height: 280px;
  border-radius: 12px;
  background: #0f172a;
  object-fit: cover;
  aspect-ratio: 4 / 3;
}

.wfh-photo-camera-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.wfh-camera-status {
  margin: 0;
}

.wfh-photo-preview-wrap {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-secondary);
}

.wfh-photo-preview {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
}

.wfh-photo-error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--error);
}

.clock-out-output-wrap .clock-out-output-label {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
}

.clock-out-output-textarea {
  width: 100%;
  min-height: 7rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  line-height: 1.45;
  resize: vertical;
  box-sizing: border-box;
}

.clock-out-output-textarea::placeholder {
  color: var(--text-secondary);
  opacity: 0.85;
}

.liveness-cancel-spinner {
  border-color: rgba(148, 163, 184, 0.3);
  border-top-color: #94a3b8;
}
</style>
