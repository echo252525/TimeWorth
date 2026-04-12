<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  PencilSquareIcon,
  TrashIcon,
  PlusCircleIcon,
  MapPinIcon,
  BriefcaseIcon,
  MagnifyingGlassIcon,
} from '@heroicons/vue/24/outline'
import supabase from '../lib/supabaseClient'

type ActiveSection = 'geofence' | 'positions'
const activeSection = ref<ActiveSection>('geofence')
const geofenceSearch = ref('')
const positionSearch = ref('')

/** Matches `public.geolocation` (see ALTER for `geolocation_status`). */
interface GeolocationRow {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_meters: number
  geolocation_status?: boolean
  have_facial?: boolean
  created_at: string
  updated_at: string
}

const DEFAULT_GEO = { lat: 14.5992, lng: 120.9845 }
const geoMapContainer = ref<HTMLElement | null>(null)
let geoMap: L.Map | null = null
let geoMarker: L.Marker | null = null
let geoCircle: L.Circle | null = null
let geoOfficeMarkers: L.Marker[] = []
const geoRowId = ref<string | null>(null)
const geoLat = ref(DEFAULT_GEO.lat)
const geoLng = ref(DEFAULT_GEO.lng)
const geoRadiusMeters = ref(200)
const geoLoading = ref(true)
const geoSaving = ref(false)
const geoError = ref<string | null>(null)
const geoRows = ref<GeolocationRow[]>([])
const geoTableLoading = ref(false)
const geoOfficeSavingId = ref<string | null>(null)
const geoDeletingId = ref<string | null>(null)
const geoLocating = ref(false)

interface PositionRow {
  position_id: string
  title: string
  created_at: string
  updated_at: string
}

const rows = ref<PositionRow[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const savingId = ref<string | 'new' | null>(null)
const editingId = ref<string | null>(null)
const editTitle = ref('')
const newTitle = ref('')
const showNewRow = ref(false)

async function load() {
  loading.value = true
  error.value = null
  const { data, error: qErr } = await supabase
    .from('position')
    .select('*')
    .order('title', { ascending: true })
  loading.value = false
  if (qErr) {
    error.value = qErr.message
    return
  }
  rows.value = (data ?? []) as PositionRow[]
}

async function reverseGeocodeAddress(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'TimeWorthAdmin/1.0' } },
    )
    const data = await res.json()
    const name = typeof data?.display_name === 'string' ? data.display_name.trim() : ''
    return name || `Location ${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `Location ${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

async function loadGeofence() {
  const previousMapRowId = geoRowId.value
  geoLoading.value = true
  geoTableLoading.value = true
  geoError.value = null
  const { data, error: qErr } = await supabase
    .from('geolocation')
    .select('*')
    .order('updated_at', { ascending: false })
  geoTableLoading.value = false
  if (qErr) {
    geoError.value = qErr.message
    geoRowId.value = null
    geoRows.value = []
  } else {
    geoRows.value = (data ?? []) as GeolocationRow[]
    const stillEditing = previousMapRowId && geoRows.value.some((r) => r.id === previousMapRowId)
    if (stillEditing) {
      const row = geoRows.value.find((r) => r.id === previousMapRowId)!
      geoRowId.value = row.id
      geoLat.value = row.latitude
      geoLng.value = row.longitude
      geoRadiusMeters.value = Math.max(1, row.radius_meters)
    } else {
      const office = geoRows.value.find((r) => r.geolocation_status === true)
      const first = geoRows.value[0]
      const pick = office ?? first
      if (pick) {
        geoRowId.value = pick.id
        geoLat.value = pick.latitude
        geoLng.value = pick.longitude
        geoRadiusMeters.value = Math.max(1, pick.radius_meters)
      } else {
        geoRowId.value = null
        geoLat.value = DEFAULT_GEO.lat
        geoLng.value = DEFAULT_GEO.lng
        geoRadiusMeters.value = 200
      }
    }
  }
  geoLoading.value = false
  await nextTick()
  initOrRefreshGeoMap()
}

function startNewGeofenceOnMap() {
  geoRowId.value = null
  geoLat.value = DEFAULT_GEO.lat
  geoLng.value = DEFAULT_GEO.lng
  geoRadiusMeters.value = 200
  initOrRefreshGeoMap()
}

function editGeofenceOnMap(r: GeolocationRow) {
  if (geoRowId.value === r.id) {
    // Deselect if already selected
    geoRowId.value = null
    geoLat.value = DEFAULT_GEO.lat
    geoLng.value = DEFAULT_GEO.lng
    geoRadiusMeters.value = 200
  } else {
    geoRowId.value = r.id
    geoLat.value = r.latitude
    geoLng.value = r.longitude
    geoRadiusMeters.value = Math.max(1, r.radius_meters)
  }
  initOrRefreshGeoMap()
}

async function setOfficeGeofence(targetId: string, value: boolean) {
  geoError.value = null
  geoOfficeSavingId.value = targetId
  const now = new Date().toISOString()
  try {
    const { error: setErr } = await supabase
      .from('geolocation')
      .update({ geolocation_status: value, updated_at: now })
      .eq('id', targetId)
    if (setErr) throw setErr
    await loadGeofence()
  } catch (e) {
    geoError.value = e instanceof Error ? e.message : 'Failed to set office geofence'
  } finally {
    geoOfficeSavingId.value = null
  }
}

async function toggleFacialScanner(targetId: string, value: boolean) {
  geoError.value = null
  const now = new Date().toISOString()
  try {
    const { error: setErr } = await supabase
      .from('geolocation')
      .update({ have_facial: value, updated_at: now })
      .eq('id', targetId)
    if (setErr) throw setErr
    await loadGeofence()
  } catch (e) {
    geoError.value = e instanceof Error ? e.message : 'Failed to set facial scanner'
  }
}

async function clearOfficeGeofence() {
  geoError.value = null
  geoOfficeSavingId.value = 'all'
  try {
    const { error: uErr } = await supabase
      .from('geolocation')
      .update({ geolocation_status: false, updated_at: new Date().toISOString() })
      .eq('geolocation_status', true)
    if (uErr) throw uErr
    await loadGeofence()
  } catch (e) {
    geoError.value = e instanceof Error ? e.message : 'Failed to clear office geofence'
  } finally {
    geoOfficeSavingId.value = null
  }
}

async function deleteGeofenceRow(r: GeolocationRow) {
  if (!confirm(`Remove geofence "${r.name}"?`)) return
  geoError.value = null
  geoDeletingId.value = r.id
  try {
    const { error: dErr } = await supabase.from('geolocation').delete().eq('id', r.id)
    if (dErr) throw dErr
    if (geoRowId.value === r.id) geoRowId.value = null
    await loadGeofence()
  } catch (e) {
    geoError.value = e instanceof Error ? e.message : 'Failed to delete geofence'
  } finally {
    geoDeletingId.value = null
  }
}

function teardownGeoMap() {
  geoCircle?.remove()
  geoCircle = null
  geoMarker?.remove()
  geoMarker = null
  geoOfficeMarkers.forEach((m) => m.remove())
  geoOfficeMarkers = []
  geoMap?.remove()
  geoMap = null
}

function updateGeoCircle() {
  if (!geoMap) return
  geoCircle?.remove()
  const r = Math.max(1, geoRadiusMeters.value)
  geoCircle = L.circle([geoLat.value, geoLng.value], {
    radius: r,
    color: '#0ea5e9',
    weight: 2,
    fillColor: '#0ea5e9',
    fillOpacity: 0.12,
  }).addTo(geoMap)
}

function initOrRefreshGeoMap() {
  if (!geoMapContainer.value) return
  if (!geoMap) {
    geoMap = L.map(geoMapContainer.value, { zoomControl: true }).setView(
      [geoLat.value, geoLng.value],
      16,
    )
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(geoMap)
    geoMap.on('click', (e: L.LeafletMouseEvent) => {
      // Deselect if clicking on the same location
      if (geoRowId.value) {
        geoRowId.value = null
        geoLat.value = DEFAULT_GEO.lat
        geoLng.value = DEFAULT_GEO.lng
        geoRadiusMeters.value = 200
        placeGeoMarker()
        updateGeoCircle()
      }
    })
  } else {
    geoMap.setView([geoLat.value, geoLng.value], geoMap.getZoom())
  }
  // Remove previous markers
  geoOfficeMarkers.forEach((m) => m.remove())
  geoOfficeMarkers = []
  // Show all office geofences with circle and improved icon
  geoRows.value.forEach((row) => {
    if (row.geolocation_status) {
      const icon = L.divIcon({
        className: 'office-marker',
        html: `
          <div style="display:flex;align-items:center;gap:2px;">
            <span style="display:inline-block;width:28px;height:28px;background:linear-gradient(135deg,#22c55e 60%,#0ea5e9 100%);border-radius:50%;box-shadow:0 2px 8px rgba(34,197,94,0.18);display:flex;align-items:center;justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="7" width="12" height="9" rx="2" fill="white"/><rect x="7" y="4" width="6" height="3" rx="1.5" fill="white"/><rect x="9" y="10" width="2" height="3" rx="1" fill="#22c55e"/></svg>
            </span>
            ${row.have_facial ? `<span style=\"display:inline-block;width:22px;height:22px;background:#fff;border-radius:50%;box-shadow:0 1px 4px rgba(14,165,233,0.13);margin-left:-8px;display:flex;align-items:center;justify-content:center;\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 20 20\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><circle cx=\"10\" cy=\"10\" r=\"7\" fill=\"#0ea5e9\"/><circle cx=\"10\" cy=\"10\" r=\"3\" fill=\"#fff\"/></svg></span>` : ''}
          </div>
        `,
      })
      const marker = L.marker([row.latitude, row.longitude], { icon }).addTo(geoMap!)
      marker.bindTooltip(`${row.name}${row.have_facial ? ' (Facial Scanner)' : ''}`)
      geoOfficeMarkers.push(marker)
      // Draw circle for each office geofence
      const circle = L.circle([row.latitude, row.longitude], {
        radius: Math.max(1, row.radius_meters),
        color: '#22c55e',
        weight: 2,
        fillColor: '#22c55e',
        fillOpacity: 0.1,
      }).addTo(geoMap!)
      geoOfficeMarkers.push(circle)
    }
  })
  // Show selected marker if any
  if (geoRowId.value) {
    placeGeoMarker()
    updateGeoCircle()
  } else {
    geoMarker?.remove()
    geoMarker = null
    geoCircle?.remove()
    geoCircle = null
  }
}

function placeGeoMarker() {
  if (!geoMap) return
  geoMarker?.remove()
  geoMarker = L.marker([geoLat.value, geoLng.value], { draggable: true }).addTo(geoMap)
  geoMarker.on('dragend', () => {
    const ll = geoMarker?.getLatLng()
    if (!ll) return
    geoLat.value = ll.lat
    geoLng.value = ll.lng
    updateGeoCircle()
  })
}

function recenterMapOnCurrentLocation() {
  if (!navigator.geolocation) {
    geoError.value = 'Geolocation is not supported in this browser.'
    return
  }
  geoError.value = null
  geoLocating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      geoLat.value = pos.coords.latitude
      geoLng.value = pos.coords.longitude
      geoLocating.value = false
      if (geoMap) {
        geoMap.setView([geoLat.value, geoLng.value], 17, { animate: true, duration: 0.35 })
      }
      placeGeoMarker()
      updateGeoCircle()
    },
    (err) => {
      geoLocating.value = false
      geoError.value = err?.message || 'Could not get your current location.'
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  )
}

watch(geoRadiusMeters, () => {
  updateGeoCircle()
})

async function saveGeofence() {
  geoError.value = null
  geoSaving.value = true
  const lat = geoLat.value
  const lng = geoLng.value
  const radius = Math.max(1, Number(geoRadiusMeters.value) || 1)
  const now = new Date().toISOString()
  const addressName = await reverseGeocodeAddress(lat, lng)
  try {
    if (geoRowId.value) {
      const { error: uErr } = await supabase
        .from('geolocation')
        .update({
          name: addressName,
          latitude: lat,
          longitude: lng,
          radius_meters: radius,
          updated_at: now,
        })
        .eq('id', geoRowId.value)
      if (uErr) throw uErr
    } else {
      const { data: ins, error: iErr } = await supabase
        .from('geolocation')
        .insert({
          name: addressName,
          latitude: lat,
          longitude: lng,
          radius_meters: radius,
          geolocation_status: false,
          updated_at: now,
        })
        .select('id')
        .single()
      if (iErr) throw iErr
      if (ins?.id) geoRowId.value = ins.id as string
    }
    await loadGeofence()
  } catch (e) {
    geoError.value = e instanceof Error ? e.message : 'Failed to save geofence'
  } finally {
    geoSaving.value = false
  }
}

onMounted(() => {
  void load()
  void loadGeofence()
})

onUnmounted(() => {
  teardownGeoMap()
})

function startEdit(r: PositionRow) {
  editingId.value = r.position_id
  editTitle.value = r.title
}

function cancelEdit() {
  editingId.value = null
  editTitle.value = ''
}

async function saveEdit(r: PositionRow) {
  const t = editTitle.value.trim()
  if (!t) {
    error.value = 'Title is required'
    return
  }
  error.value = null
  savingId.value = r.position_id
  const { error: err } = await supabase
    .from('position')
    .update({ title: t, updated_at: new Date().toISOString() })
    .eq('position_id', r.position_id)
  savingId.value = null
  if (err) {
    error.value = err.message
    return
  }
  editingId.value = null
  await load()
}

async function removeRow(r: PositionRow) {
  if (!confirm(`Remove position "${r.title}"?`)) return
  error.value = null
  savingId.value = r.position_id
  const { error: err } = await supabase.from('position').delete().eq('position_id', r.position_id)
  savingId.value = null
  if (err) {
    error.value = err.message
    return
  }
  await load()
}

function openNew() {
  showNewRow.value = true
  newTitle.value = ''
  error.value = null
}

function cancelNew() {
  showNewRow.value = false
  newTitle.value = ''
}

async function saveNew() {
  const t = newTitle.value.trim()
  if (!t) {
    error.value = 'Title is required'
    return
  }
  error.value = null
  savingId.value = 'new'
  const { error: err } = await supabase.from('position').insert({ title: t })
  savingId.value = null
  if (err) {
    error.value = err.message
    return
  }
  showNewRow.value = false
  newTitle.value = ''
  await load()
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const filteredGeoRows = computed(() => {
  const q = geofenceSearch.value.trim().toLowerCase()
  if (!q) return geoRows.value
  return geoRows.value.filter(
    (g) =>
      g.name.toLowerCase().includes(q) ||
      String(g.latitude).includes(q) ||
      String(g.longitude).includes(q) ||
      String(Math.round(g.radius_meters)).includes(q),
  )
})

const filteredPositionRows = computed(() => {
  const q = positionSearch.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((r) => r.title.toLowerCase().includes(q))
})

watch(activeSection, async (s) => {
  if (s === 'geofence') {
    await nextTick()
    initOrRefreshGeoMap()
  } else {
    teardownGeoMap()
  }
})
</script>

<template>
  <div class="page admin-system-config-page">
    <header class="sys-config-page-header">
      <h1>System configuration</h1>
      <p class="muted page-lead">
        Choose a category from the left. Use search to narrow lists. Geofence and job positions are
        organized as separate settings areas.
      </p>
    </header>

    <div class="sys-config-shell">
      <nav class="sys-config-nav" aria-label="Configuration categories">
        <button
          type="button"
          class="sys-config-nav-item"
          :class="{ 'sys-config-nav-item--active': activeSection === 'geofence' }"
          :aria-current="activeSection === 'geofence' ? 'page' : undefined"
          @click="activeSection = 'geofence'"
        >
          <MapPinIcon class="sys-config-nav-icon" aria-hidden="true" />
          <span class="sys-config-nav-label">Geofence</span>
        </button>
        <button
          type="button"
          class="sys-config-nav-item"
          :class="{ 'sys-config-nav-item--active': activeSection === 'positions' }"
          :aria-current="activeSection === 'positions' ? 'page' : undefined"
          @click="activeSection = 'positions'"
        >
          <BriefcaseIcon class="sys-config-nav-icon" aria-hidden="true" />
          <span class="sys-config-nav-label">Job positions</span>
        </button>
      </nav>

      <div class="sys-config-main">
        <section
          v-if="activeSection === 'geofence'"
          class="sys-config-panel"
          aria-labelledby="geofence-panel-title"
        >
          <h2 id="geofence-panel-title" class="sys-config-panel-title">Geofence</h2>
          <p class="muted sys-config-panel-lead">
            Define where attendance may be validated. Multiple rows can exist; only one may be
            marked as the office geofence (<code class="code-inline">geolocation_status</code>).
            Search applies to the saved list below.
          </p>

          <div class="sys-config-search" role="search">
            <MagnifyingGlassIcon class="sys-config-search-icon" aria-hidden="true" />
            <input
              v-model="geofenceSearch"
              type="search"
              class="sys-config-search-input"
              placeholder="Search saved geofences by name or coordinates…"
              aria-label="Search geofences"
              autocomplete="off"
            />
          </div>

          <p v-if="geoError" class="banner-error">{{ geoError }}</p>

          <article class="config-item">
            <h3 class="config-item-title">Geofence center and radius</h3>
            <p class="config-item-key">geolocation.center · geolocation.radius_meters</p>
            <p class="config-item-desc">
              Click the map or drag the pin to set the center. Use
              <strong>Current location</strong> to jump to your device GPS, then adjust radius and
              save.
            </p>
            <div class="config-item-control">
              <div v-if="geoLoading" class="loading-state">Loading map…</div>
              <div v-show="!geoLoading" class="geofence-map-wrap">
                <div
                  ref="geoMapContainer"
                  class="geofence-map"
                  role="application"
                  aria-label="Map: click to set geofence center"
                />
                <button
                  type="button"
                  class="geo-locate-btn"
                  :disabled="geoLocating"
                  title="Center map on your current location"
                  @click="recenterMapOnCurrentLocation"
                >
                  {{ geoLocating ? 'Locating…' : 'Current location' }}
                </button>
              </div>
              <div v-if="!geoLoading" class="geofence-controls">
                <label class="radius-label">
                  <span>Radius (meters)</span>
                  <input
                    v-model.number="geoRadiusMeters"
                    type="number"
                    min="1"
                    max="500000"
                    step="1"
                    class="input radius-input"
                    aria-label="Geofence radius in meters"
                  />
                </label>
                <div class="geo-coords muted" aria-live="polite">
                  {{ geoLat.toFixed(6) }}, {{ geoLng.toFixed(6) }}
                </div>
                <p class="geo-mode-hint muted" aria-live="polite">
                  {{
                    geoRowId
                      ? 'Table: row highlighted = updating this location.'
                      : 'Adding a new location — no row highlighted.'
                  }}
                </p>
                <button
                  type="button"
                  class="btn-primary"
                  :disabled="geoSaving"
                  @click="saveGeofence"
                >
                  {{ geoSaving ? 'Saving…' : geoRowId ? 'Update geofence' : 'Save new geofence' }}
                </button>
              </div>
            </div>
            <p class="config-item-note">
              Saving reverse-geocodes the center for the row label. Office designation is managed in
              the table setting.
            </p>
          </article>

          <article class="config-item">
            <h3 class="config-item-title">Saved geofences</h3>
            <p class="config-item-key">geolocation.records</p>
            <p class="config-item-desc">
              Select a row to load it on the map. Mark one row as the office geofence, or clear the
              office flag.
            </p>
            <div class="config-item-control">
              <div class="geo-table-header">
                <button type="button" class="btn-add-location" @click="startNewGeofenceOnMap">
                  Add new location
                </button>
              </div>
              <div v-if="geoTableLoading && !geoRows.length" class="loading-state muted">
                Loading list…
              </div>
              <div v-else class="table-scroll geo-table-scroll">
                <table class="data-table geo-data-table">
                  <thead>
                    <tr>
                      <th scope="col">Location (address)</th>
                      <th scope="col">Latitude</th>
                      <th scope="col">Longitude</th>
                      <th scope="col">Radius (m)</th>
                      <th scope="col">Office geofence</th>
                      <th scope="col" class="th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="g in filteredGeoRows"
                      :key="g.id"
                      class="geo-row--clickable"
                      :class="{
                        'geo-row--office': g.geolocation_status,
                        'geo-row--selected': geoRowId !== null && geoRowId === g.id,
                      }"
                      tabindex="0"
                      @click="editGeofenceOnMap(g)"
                      @keydown.enter.prevent="editGeofenceOnMap(g)"
                    >
                      <td class="geo-name-cell">
                        {{ g.name }}
                        <span
                          v-if="g.geolocation_status"
                          style="margin-left: 0.2em; vertical-align: middle"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 20 20"
                            fill="none"
                            style="vertical-align: middle"
                          >
                            <rect x="4" y="7" width="12" height="9" rx="2" fill="#22c55e" />
                            <rect x="7" y="4" width="6" height="3" rx="1.5" fill="#22c55e" />
                            <rect x="9" y="10" width="2" height="3" rx="1" fill="#fff" />
                          </svg>
                        </span>
                        <span
                          v-if="g.have_facial"
                          title="Facial scanner enabled"
                          style="margin-left: 0.15em; vertical-align: middle"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 20 20"
                            fill="none"
                            style="vertical-align: middle"
                          >
                            <circle cx="10" cy="10" r="7" fill="#0ea5e9" />
                            <circle cx="10" cy="10" r="3" fill="#fff" />
                          </svg>
                        </span>
                      </td>
                      <td class="td-muted">{{ g.latitude?.toFixed(6) }}</td>
                      <td class="td-muted">{{ g.longitude?.toFixed(6) }}</td>
                      <td class="td-muted">{{ Math.round(g.radius_meters) }}</td>
                      <td>
                        <span v-if="g.geolocation_status" class="office-badge">Office</span>
                        <span v-else class="muted">—</span>
                      </td>
                      <td class="td-actions geo-actions" @click.stop>
                        <button
                          type="button"
                          class="btn-mini"
                          :disabled="geoOfficeSavingId !== null || geoDeletingId !== null"
                          @click="editGeofenceOnMap(g)"
                        >
                          Edit on map
                        </button>
                        <button
                          type="button"
                          class="btn-mini btn-mini-accent"
                          :disabled="geoOfficeSavingId !== null || geoDeletingId !== null"
                          @click="setOfficeGeofence(g.id, !g.geolocation_status)"
                        >
                          {{
                            g.geolocation_status
                              ? geoOfficeSavingId === g.id
                                ? 'Unsetting…'
                                : 'Unset office'
                              : geoOfficeSavingId === g.id
                                ? 'Setting…'
                                : 'Set as office'
                          }}
                        </button>
                        <button
                          type="button"
                          class="btn-mini"
                          :disabled="geoOfficeSavingId !== null || geoDeletingId !== null"
                          @click="toggleFacialScanner(g.id, !g.have_facial)"
                        >
                          {{ g.have_facial ? 'Unset facial scanner' : 'Set facial scanner' }}
                        </button>
                        <button
                          type="button"
                          class="btn-mini btn-mini-danger"
                          :disabled="geoDeletingId !== null || geoOfficeSavingId !== null"
                          @click="deleteGeofenceRow(g)"
                        >
                          {{ geoDeletingId === g.id ? '…' : 'Delete' }}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="!geoRows.length && !geoTableLoading && !geoLoading" class="empty-hint">
                No geofences yet. Place a point on the map and save.
              </p>
              <p v-else-if="geoRows.length && !filteredGeoRows.length" class="empty-hint">
                No geofences match your search.
              </p>
            </div>
            <p class="config-item-note">
              The current office row is the one with geolocation_status true in the database.
            </p>
          </article>
        </section>

        <section v-else class="sys-config-panel" aria-labelledby="positions-panel-title">
          <h2 id="positions-panel-title" class="sys-config-panel-title">Job positions</h2>
          <p class="muted sys-config-panel-lead">
            Titles appear wherever employees pick a position. Search filters the list below.
          </p>

          <div class="sys-config-search" role="search">
            <MagnifyingGlassIcon class="sys-config-search-icon" aria-hidden="true" />
            <input
              v-model="positionSearch"
              type="search"
              class="sys-config-search-input"
              placeholder="Search positions by title…"
              aria-label="Search positions"
              autocomplete="off"
            />
          </div>

          <p v-if="error" class="banner-error">{{ error }}</p>

          <article class="config-item">
            <h3 class="config-item-title">Add position</h3>
            <p class="config-item-key">position.create</p>
            <p class="config-item-desc">
              Create a new job title for signup and attendance records.
            </p>
            <div class="config-item-control">
              <div class="toolbar">
                <button
                  type="button"
                  class="btn-add"
                  :disabled="loading || showNewRow"
                  @click="openNew"
                >
                  <PlusCircleIcon class="btn-add-icon" aria-hidden="true" />
                  Add position
                </button>
              </div>
              <div v-if="showNewRow" class="new-row">
                <input
                  v-model="newTitle"
                  type="text"
                  class="input"
                  placeholder="New position title"
                  aria-label="New position title"
                  @keyup.enter="saveNew"
                />
                <button
                  type="button"
                  class="btn-primary"
                  :disabled="savingId === 'new'"
                  @click="saveNew"
                >
                  {{ savingId === 'new' ? 'Saving…' : 'Save' }}
                </button>
                <button
                  type="button"
                  class="btn-ghost"
                  :disabled="savingId === 'new'"
                  @click="cancelNew"
                >
                  Cancel
                </button>
              </div>
            </div>
            <p class="config-item-note">
              New rows are stored in the <code class="code-inline">position</code> table.
            </p>
          </article>

          <article class="config-item">
            <h3 class="config-item-title">Saved positions</h3>
            <p class="config-item-key">position.list</p>
            <p class="config-item-desc">
              Edit titles in place or remove positions that are no longer offered.
            </p>
            <div class="config-item-control">
              <div v-if="loading" class="loading-state">Loading…</div>
              <div v-else class="table-scroll">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Created</th>
                      <th scope="col" class="th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in filteredPositionRows" :key="r.position_id" class="data-row">
                      <td>
                        <template v-if="editingId === r.position_id">
                          <input
                            v-model="editTitle"
                            type="text"
                            class="input input-inline"
                            :aria-label="`Edit title for ${r.title}`"
                            @keyup.enter="saveEdit(r)"
                          />
                        </template>
                        <template v-else>
                          {{ r.title }}
                        </template>
                      </td>
                      <td class="td-muted">{{ formatDate(r.created_at) }}</td>
                      <td class="td-actions">
                        <template v-if="editingId === r.position_id">
                          <button
                            type="button"
                            class="btn-icon btn-save"
                            :disabled="savingId === r.position_id"
                            title="Save"
                            @click="saveEdit(r)"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            class="btn-icon btn-cancel"
                            :disabled="savingId === r.position_id"
                            title="Cancel"
                            @click="cancelEdit"
                          >
                            Cancel
                          </button>
                        </template>
                        <template v-else>
                          <button
                            type="button"
                            class="btn-icon"
                            title="Edit title"
                            :disabled="savingId !== null"
                            @click="startEdit(r)"
                          >
                            <PencilSquareIcon class="icon" aria-hidden="true" />
                            <span class="sr-only">Edit</span>
                          </button>
                          <button
                            type="button"
                            class="btn-icon btn-danger"
                            title="Remove"
                            :disabled="savingId !== null"
                            @click="removeRow(r)"
                          >
                            <TrashIcon class="icon" aria-hidden="true" />
                            <span class="sr-only">Remove</span>
                          </button>
                        </template>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="!rows.length && !loading && !showNewRow" class="empty-hint">
                No positions yet. Use “Add position” above to create one.
              </p>
              <p v-else-if="rows.length && !filteredPositionRows.length" class="empty-hint">
                No positions match your search.
              </p>
            </div>
            <p class="config-item-note">
              Edits update <code class="code-inline">position.title</code> for the selected row.
            </p>
          </article>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

/* Reclaim AdminLayout .main-content horizontal padding (1.5rem) on narrow screens */
@media (max-width: 767px) {
  .page.admin-system-config-page {
    margin-left: -0.75rem;
    margin-right: -0.75rem;
    width: calc(100% + 1.5rem);
    max-width: none;
  }
}

.sys-config-page-header .page-lead {
  max-width: 42rem;
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

.sys-config-shell {
  display: flex;
  align-items: stretch;
  gap: 0;
  min-height: min(70vh, 720px);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
  overflow: hidden;
}

.sys-config-nav {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 0.75rem;
  border-right: 1px solid var(--border-color);
  background: var(--bg-primary);
  min-width: 7.5rem;
}

.sys-config-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 0.75rem 0.5rem;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}

.sys-config-nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sys-config-nav-item--active {
  background: rgba(56, 189, 248, 0.12);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.25);
}

.sys-config-nav-icon {
  width: 1.5rem;
  height: 1.5rem;
  color: currentColor;
}

.sys-config-nav-label {
  text-align: center;
  line-height: 1.2;
  max-width: 5.5rem;
}

.sys-config-main {
  flex: 1;
  min-width: 0;
  padding: 1.25rem 1.25rem 1.5rem;
  overflow: auto;
}

.sys-config-panel-title {
  margin: 0 0 0.35rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.sys-config-panel-lead {
  margin: 0 0 1rem;
  max-width: 48rem;
  line-height: 1.5;
}

.sys-config-panel-lead .code-inline {
  font-size: 0.8125rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
}

.sys-config-search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  max-width: 36rem;
}

.sys-config-search-icon {
  width: 1.125rem;
  height: 1.125rem;
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.sys-config-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
}

.sys-config-search-input::placeholder {
  color: var(--text-tertiary);
}

.config-item {
  margin-bottom: 1.5rem;
  padding: 1.1rem 1rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--border-light);
  background: var(--bg-primary);
}

.config-item:last-child {
  margin-bottom: 0;
}

.config-item-title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.config-item-key {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-style: italic;
  color: var(--text-tertiary);
  font-family: ui-monospace, monospace;
}

.config-item-desc {
  margin: 0 0 0.85rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.45;
  max-width: 48rem;
}

.config-item-desc strong {
  font-weight: 600;
  color: var(--text-primary);
}

.config-item-control {
  margin-bottom: 0.65rem;
}

.config-item-note {
  margin: 0;
  font-size: 0.75rem;
  font-style: italic;
  color: var(--text-tertiary);
  line-height: 1.4;
}

.config-item-note .code-inline {
  font-size: 0.7rem;
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  font-style: normal;
  font-family: ui-monospace, monospace;
}

@media (max-width: 640px) {
  .sys-config-shell {
    flex-direction: column;
    min-height: 0;
  }
  .sys-config-nav {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    padding: 0.75rem;
  }
  .sys-config-nav-item {
    flex: 1 1 auto;
    min-width: 44%;
    flex-direction: row;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.75rem;
  }
  .sys-config-nav-label {
    max-width: none;
  }
}
.banner-error {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.12);
  color: var(--error, #f87171);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
.toolbar {
  margin-bottom: 1rem;
}
.btn-add {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-add:hover:not(:disabled) {
  background: var(--bg-hover);
}
.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-add-icon {
  width: 1.25rem;
  height: 1.25rem;
}
.loading-state {
  color: var(--text-tertiary);
  padding: 1rem 0;
}
.new-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}
.input {
  flex: 1;
  min-width: 200px;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.9375rem;
}
.input-inline {
  min-width: 0;
  width: 100%;
  max-width: 320px;
}
.input:focus {
  outline: none;
  border-color: var(--accent);
}
.table-scroll {
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.data-table th,
.data-table td {
  padding: 0.65rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}
.data-table th {
  color: var(--text-tertiary);
  font-weight: 600;
}
.th-actions {
  width: 7rem;
  text-align: right;
}
.td-muted {
  color: var(--text-secondary);
}
.td-actions {
  text-align: right;
  white-space: nowrap;
}
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem;
  margin-left: 0.25rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  vertical-align: middle;
}
.btn-icon:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.12);
}
.btn-icon .icon {
  width: 1.25rem;
  height: 1.25rem;
}
.btn-danger {
  color: var(--error, #f87171);
}
.btn-danger:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.12);
}
.btn-save,
.btn-cancel {
  font-size: 0.8125rem;
  padding: 0.35rem 0.6rem;
  margin-left: 0.35rem;
}
.btn-primary {
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  border: none;
  background: var(--accent);
  color: #fff;
  font-weight: 500;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-ghost {
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.empty-hint {
  margin: 1rem 0 0;
  color: var(--text-tertiary);
  font-size: 0.875rem;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.geofence-map-wrap {
  position: relative;
  margin-bottom: 1rem;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}
.geofence-map {
  width: 100%;
  height: 320px;
  border-radius: 10px;
  overflow: hidden;
}
@media (min-width: 900px) {
  .geofence-map {
    height: 400px;
  }
}
.geo-locate-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1001;
  padding: 0.45rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: rgba(15, 23, 42, 0.92);
  color: var(--text-primary);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition:
    background 0.2s,
    opacity 0.2s;
}
.geo-locate-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}
.geo-locate-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}
.geofence-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem;
}
.radius-label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}
.radius-input {
  width: 8rem;
}
.geo-coords {
  font-size: 0.8125rem;
  align-self: center;
  font-variant-numeric: tabular-nums;
}

.geo-table-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.btn-add-location {
  padding: 0.45rem 0.9rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: rgba(56, 189, 248, 0.12);
  color: var(--accent);
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;
}
.btn-add-location:hover {
  background: rgba(56, 189, 248, 0.2);
  color: var(--text-primary);
}
.geo-mode-hint {
  width: 100%;
  margin: 0;
  font-size: 0.8125rem;
  flex-basis: 100%;
}
.geo-table-scroll {
  max-height: 420px;
  overflow: auto;
}
.geo-data-table .geo-name-cell {
  max-width: 280px;
  word-break: break-word;
  font-size: 0.8125rem;
  line-height: 1.35;
}
.geo-row--office {
  background: rgba(56, 189, 248, 0.06);
}
.geo-data-table tr.geo-row--clickable {
  cursor: pointer;
}
.geo-data-table tr.geo-row--clickable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.geo-data-table tr.geo-row--selected {
  background: rgba(56, 189, 248, 0.14);
  box-shadow: inset 4px 0 0 0 var(--accent);
}
.geo-data-table tr.geo-row--office.geo-row--selected {
  background: rgba(34, 197, 94, 0.1);
  box-shadow: inset 4px 0 0 0 var(--accent);
}
.office-badge {
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}
.geo-actions {
  text-align: left;
  white-space: normal;
}
.geo-actions .btn-mini {
  display: inline-block;
  margin: 0.15rem 0.35rem 0.15rem 0;
  padding: 0.3rem 0.5rem;
  font-size: 0.75rem;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
}
.geo-actions .btn-mini:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.geo-actions .btn-mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.geo-actions .btn-mini-accent {
  border-color: rgba(56, 189, 248, 0.4);
  color: var(--accent);
}
.geo-actions .btn-mini-danger {
  border-color: rgba(248, 113, 113, 0.35);
  color: var(--error, #f87171);
}

@media (max-width: 640px) {
  .page h1 {
    font-size: 1.25rem;
    margin: 0 0 0.35rem;
  }

  .muted {
    font-size: 0.8125rem;
    margin: 0 0 0.65rem;
    line-height: 1.4;
  }

  .sys-config-page-header .page-lead {
    max-width: none;
  }

  .sys-config-shell {
    flex-direction: column;
    min-height: 0;
    border-radius: 10px;
  }

  .sys-config-nav {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    padding: 0.55rem 0.5rem;
    gap: 0.2rem;
  }

  .sys-config-nav-item {
    flex: 1 1 auto;
    min-width: 44%;
    flex-direction: row;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.55rem 0.45rem;
    font-size: 0.7rem;
  }

  .sys-config-nav-label {
    max-width: none;
  }

  .sys-config-main {
    padding: 0.75rem 0.65rem 0.9rem;
  }

  .sys-config-panel-title {
    font-size: 1rem;
  }

  .sys-config-panel-lead {
    margin: 0 0 0.65rem;
    font-size: 0.8125rem;
  }

  .sys-config-search {
    margin-bottom: 0.85rem;
    padding: 0.4rem 0.55rem;
    max-width: none;
  }

  .sys-config-search-input {
    font-size: 0.8125rem;
  }

  .config-item {
    margin-bottom: 1rem;
    padding: 0.75rem 0.65rem 0.85rem;
    border-radius: 10px;
  }

  .config-item-title {
    font-size: 0.9375rem;
  }

  .config-item-desc {
    margin: 0 0 0.65rem;
    font-size: 0.8125rem;
  }

  .config-item-control {
    margin-bottom: 0.5rem;
  }

  .banner-error {
    padding: 0.5rem 0.65rem;
    margin-bottom: 0.65rem;
    font-size: 0.8125rem;
  }

  .toolbar {
    margin-bottom: 0.65rem;
  }

  .btn-add {
    padding: 0.45rem 0.75rem;
    font-size: 0.8125rem;
  }

  .loading-state {
    padding: 0.65rem 0;
    font-size: 0.8125rem;
  }

  .new-row {
    gap: 0.4rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
  }

  .input {
    min-width: 0;
    padding: 0.45rem 0.65rem;
    font-size: 0.875rem;
  }

  .data-table th,
  .data-table td {
    padding: 0.45rem 0.5rem;
    font-size: 0.8125rem;
  }

  .th-actions {
    width: 6rem;
  }

  .empty-hint {
    margin: 0.65rem 0 0;
    font-size: 0.8125rem;
  }

  .btn-primary {
    padding: 0.4rem 0.7rem;
    font-size: 0.8125rem;
  }

  .btn-ghost {
    padding: 0.4rem 0.7rem;
    font-size: 0.8125rem;
  }

  .geofence-map {
    height: 260px;
  }

  .geofence-map-wrap {
    margin-bottom: 0.75rem;
    border-radius: 8px;
  }

  .geo-locate-btn {
    top: 8px;
    right: 8px;
    padding: 0.35rem 0.55rem;
    font-size: 0.75rem;
  }

  .geofence-controls {
    gap: 0.65rem;
  }

  .geo-table-header {
    margin-bottom: 0.5rem;
    gap: 0.5rem;
  }

  .btn-add-location {
    padding: 0.38rem 0.75rem;
    font-size: 0.8125rem;
  }

  .geo-table-scroll {
    max-height: min(50vh, 360px);
  }

  .geo-data-table .geo-name-cell {
    max-width: 200px;
    font-size: 0.75rem;
  }

  .geo-actions .btn-mini {
    font-size: 0.6875rem;
    padding: 0.25rem 0.4rem;
    margin: 0.1rem 0.25rem 0.1rem 0;
  }

  .btn-icon {
    padding: 0.3rem;
    margin-left: 0.15rem;
  }

  .btn-save,
  .btn-cancel {
    font-size: 0.75rem;
    padding: 0.3rem 0.5rem;
    margin-left: 0.25rem;
  }
}
</style>
