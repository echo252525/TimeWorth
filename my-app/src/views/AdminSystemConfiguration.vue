<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PencilSquareIcon, TrashIcon, PlusCircleIcon } from '@heroicons/vue/24/outline'
import supabase from '../lib/supabaseClient'

/** Matches `public.geolocation` (see ALTER for `geolocation_status`). */
interface GeolocationRow {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_meters: number
  geolocation_status?: boolean
  created_at: string
  updated_at: string
}

const DEFAULT_GEO = { lat: 14.5992, lng: 120.9845 }
const geoMapContainer = ref<HTMLElement | null>(null)
let geoMap: L.Map | null = null
let geoMarker: L.Marker | null = null
let geoCircle: L.Circle | null = null
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
  const { data, error: qErr } = await supabase.from('position').select('*').order('title', { ascending: true })
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
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'TimeWorthAdmin/1.0' } }
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
    const stillEditing =
      previousMapRowId && geoRows.value.some((r) => r.id === previousMapRowId)
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
  geoRowId.value = r.id
  geoLat.value = r.latitude
  geoLng.value = r.longitude
  geoRadiusMeters.value = Math.max(1, r.radius_meters)
  initOrRefreshGeoMap()
}

async function setOfficeGeofence(targetId: string) {
  geoError.value = null
  geoOfficeSavingId.value = targetId
  const now = new Date().toISOString()
  try {
    const { error: clearErr } = await supabase.from('geolocation').update({ geolocation_status: false, updated_at: now }).neq('id', '00000000-0000-0000-0000-000000000000')
    if (clearErr) throw clearErr
    const { error: setErr } = await supabase
      .from('geolocation')
      .update({ geolocation_status: true, updated_at: now })
      .eq('id', targetId)
    if (setErr) throw setErr
    await loadGeofence()
  } catch (e) {
    geoError.value = e instanceof Error ? e.message : 'Failed to set office geofence'
  } finally {
    geoOfficeSavingId.value = null
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
    fillOpacity: 0.12
  }).addTo(geoMap)
}

function initOrRefreshGeoMap() {
  if (!geoMapContainer.value) return
  if (!geoMap) {
    geoMap = L.map(geoMapContainer.value, { zoomControl: true }).setView([geoLat.value, geoLng.value], 16)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© CARTO',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(geoMap)
    geoMap.on('click', (e: L.LeafletMouseEvent) => {
      geoLat.value = e.latlng.lat
      geoLng.value = e.latlng.lng
      placeGeoMarker()
      updateGeoCircle()
    })
  } else {
    geoMap.setView([geoLat.value, geoLng.value], geoMap.getZoom())
  }
  placeGeoMarker()
  updateGeoCircle()
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
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
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
          updated_at: now
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
          updated_at: now
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
  const { error: err } = await supabase.from('position').update({ title: t, updated_at: new Date().toISOString() }).eq('position_id', r.position_id)
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
      minute: '2-digit'
    })
  } catch {
    return iso
  }
}
</script>

<template>
  <div class="page">
    <h1>System configuration</h1>
    <p class="muted">Manage job positions available for employee signup and records.</p>

    <section class="geofence-section" aria-labelledby="geofence-heading">
      <h2 id="geofence-heading" class="section-title">Geofence</h2>
      <p class="muted section-desc">
        You can save many geofence rows; only one may have office enabled (column <code class="code-inline">geolocation_status</code> = true at a time). Set the center by clicking the map, dragging the marker, or using Current location. Then set radius and save. Use the table to mark which row is the office geofence.
      </p>
      <p v-if="geoError" class="banner-error">{{ geoError }}</p>
      <div v-if="geoLoading" class="loading-state">Loading map…</div>
      <div v-show="!geoLoading" class="geofence-map-wrap">
        <div ref="geoMapContainer" class="geofence-map" role="application" aria-label="Map: click to set geofence center" />
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
          {{ geoRowId ? 'Table: row highlighted = updating this location.' : 'Adding a new location — no row highlighted.' }}
        </p>
        <button type="button" class="btn-primary" :disabled="geoSaving" @click="saveGeofence">
          {{ geoSaving ? 'Saving…' : geoRowId ? 'Update geofence' : 'Save new geofence' }}
        </button>
      </div>

      <div class="geo-table-wrap">
        <div class="geo-table-header">
          <h3 class="geo-table-title">Saved geofences</h3>
          <button type="button" class="btn-add-location" @click="startNewGeofenceOnMap">
            Add new location
          </button>
        </div>
        <div v-if="geoTableLoading && !geoRows.length" class="loading-state muted">Loading list…</div>
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
                v-for="g in geoRows"
                :key="g.id"
                class="geo-row--clickable"
                :class="{
                  'geo-row--office': g.geolocation_status,
                  'geo-row--selected': geoRowId !== null && geoRowId === g.id
                }"
                tabindex="0"
                @click="editGeofenceOnMap(g)"
                @keydown.enter.prevent="editGeofenceOnMap(g)"
              >
                <td class="geo-name-cell">{{ g.name }}</td>
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
                    v-if="!g.geolocation_status"
                    type="button"
                    class="btn-mini btn-mini-accent"
                    :disabled="geoOfficeSavingId !== null || geoDeletingId !== null"
                    @click="setOfficeGeofence(g.id)"
                  >
                    {{ geoOfficeSavingId === g.id ? 'Setting…' : 'Set as office geofence' }}
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn-mini"
                    :disabled="geoOfficeSavingId !== null || geoDeletingId !== null"
                    @click="clearOfficeGeofence"
                  >
                    {{ geoOfficeSavingId === 'all' ? 'Clearing…' : 'Clear office' }}
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
        <p v-if="!geoRows.length && !geoTableLoading && !geoLoading" class="empty-hint">No geofences yet. Place a point on the map and save.</p>
      </div>
    </section>

    <p v-if="error" class="banner-error">{{ error }}</p>

    <div class="toolbar">
      <button type="button" class="btn-add" :disabled="loading || showNewRow" @click="openNew">
        <PlusCircleIcon class="btn-add-icon" aria-hidden="true" />
        Add position
      </button>
    </div>

    <div v-if="loading" class="loading-state">Loading…</div>

    <div v-else class="table-card">
      <div v-if="showNewRow" class="new-row">
        <input v-model="newTitle" type="text" class="input" placeholder="New position title" aria-label="New position title" @keyup.enter="saveNew" />
        <button type="button" class="btn-primary" :disabled="savingId === 'new'" @click="saveNew">{{ savingId === 'new' ? 'Saving…' : 'Save' }}</button>
        <button type="button" class="btn-ghost" :disabled="savingId === 'new'" @click="cancelNew">Cancel</button>
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Created</th>
              <th scope="col" class="th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.position_id" class="data-row">
              <td>
                <template v-if="editingId === r.position_id">
                  <input v-model="editTitle" type="text" class="input input-inline" :aria-label="`Edit title for ${r.title}`" @keyup.enter="saveEdit(r)" />
                </template>
                <template v-else>
                  {{ r.title }}
                </template>
              </td>
              <td class="td-muted">{{ formatDate(r.created_at) }}</td>
              <td class="td-actions">
                <template v-if="editingId === r.position_id">
                  <button type="button" class="btn-icon btn-save" :disabled="savingId === r.position_id" title="Save" @click="saveEdit(r)">
                    Save
                  </button>
                  <button type="button" class="btn-icon btn-cancel" :disabled="savingId === r.position_id" title="Cancel" @click="cancelEdit">Cancel</button>
                </template>
                <template v-else>
                  <button type="button" class="btn-icon" title="Edit title" :disabled="savingId !== null" @click="startEdit(r)">
                    <PencilSquareIcon class="icon" aria-hidden="true" />
                    <span class="sr-only">Edit</span>
                  </button>
                  <button type="button" class="btn-icon btn-danger" title="Remove" :disabled="savingId !== null" @click="removeRow(r)">
                    <TrashIcon class="icon" aria-hidden="true" />
                    <span class="sr-only">Remove</span>
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!rows.length && !showNewRow" class="empty-hint">No positions yet. Click “Add position” to create one.</p>
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
.table-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1rem;
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

.geofence-section {
  margin-bottom: 2rem;
  padding: 1.25rem;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
}
.section-title {
  margin: 0 0 0.35rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}
.section-desc {
  margin: 0 0 1rem;
  max-width: 52rem;
}
.section-desc .code-inline {
  font-size: 0.8125rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
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
  transition: background 0.2s, opacity 0.2s;
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

.geo-table-wrap {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border-color);
}
.geo-table-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.geo-table-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
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
  transition: background 0.2s, color 0.2s;
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
</style>
