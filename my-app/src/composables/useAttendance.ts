import { ref, computed, watch, onUnmounted } from 'vue'
import supabase from '../lib/supabaseClient'
import { user } from './useAuth'

export type WorkModality = 'wfh' | 'office'

export interface AttendanceRow {
  attendance_id: string
  user_id: string
  clock_in: string | null
  clock_out: string | null
  facial_status: string | null
  lunch_break_start: string | null
  lunch_break_end: string | null
  total_time: string | null
  location_in: string | null
  location_out: string | null
  branch_location: string | null
  work_modality: WorkModality | null
  created_at: string
  updated_at: string
}

export const RADIUS_M = 50

export interface Branch {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

export const BRANCHES: Branch[] = [
  { id: 'earnshaw', name: 'Earnshaw Branch', address: '618 M. Earnshaw St. Sampaloc Manila', lat: 14.5992, lng: 120.9845 },
  { id: 'alabang', name: 'Alabang Branch', address: '2nd Flr. Mega Accent Bldg. 479 Alabang-Zapote Road, Brgy. Almanza Uno, Las Piñas City', lat: 14.4516, lng: 121.026 },
  { id: 'pcworth-qc', name: 'PC Worth Experience (Quezon City)', address: '2nd Floor, LE-EL Building 5, 7 JP Rizal corner Malong St., Marilag, Quezon City', lat: 14.6091, lng: 121.0223 }
]

export function getBranch(idOrName: string | null): Branch | null {
  if (!idOrName) return null
  const k = idOrName.toLowerCase()
  return BRANCHES.find(b => b.id === k || b.name.toLowerCase().includes(k)) ?? null
}

export function parseLocation(s: string | null): { lat: number; lng: number } | null {
  if (!s) return null
  const [lat, lng] = s.split(',').map(Number)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  return { lat, lng }
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

export function isOutsideBranch(loc: { lat: number; lng: number }, branchIdOrName: string | null): boolean {
  const branch = getBranch(branchIdOrName)
  if (!branch) return true
  return distanceMeters(loc, { lat: branch.lat, lng: branch.lng }) > RADIUS_M
}

export function isOutsideWfhRadius(locOut: { lat: number; lng: number }, locationInStr: string | null): boolean {
  const inLoc = parseLocation(locationInStr)
  if (!inLoc) return false
  return distanceMeters(locOut, inLoc) > RADIUS_M
}

export function isTravelFlagged(r: AttendanceRow): 'travel' | 'possible_travel' | null {
  const outLoc = parseLocation(r.location_out)
  if (!outLoc) return null
  if (r.work_modality === 'office') return isOutsideBranch(outLoc, r.branch_location) ? 'travel' : null
  if (r.work_modality === 'wfh') return isOutsideWfhRadius(outLoc, r.location_in) ? 'possible_travel' : null
  return null
}

const todayRecords = ref<AttendanceRow[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const todayRecord = computed(() => todayRecords.value.find(r => !r.clock_out) ?? null)
const completedToday = computed(() => todayRecords.value.filter(r => r.clock_out))

function msToInterval(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts = []
  if (h) parts.push(`${h} hours`)
  if (m) parts.push(`${m} minutes`)
  if (sec || !parts.length) parts.push(`${sec} seconds`)
  return parts.join(' ')
}

export function useAttendance() {
  const userId = computed(() => user.value?.id ?? null)
  const today = computed(() => new Date().toISOString().slice(0, 10))
  const isClockedIn = computed(() => !!todayRecord.value?.clock_in && !todayRecord.value?.clock_out)
  const isOnLunch = computed(() => !!todayRecord.value?.lunch_break_start && !todayRecord.value?.lunch_break_end)
  const usedLunchBreak = computed(() => !!(todayRecord.value?.lunch_break_start && todayRecord.value?.lunch_break_end))

  const tick = ref(0)
  let tickInterval: ReturnType<typeof setInterval> | null = null
  function startTick() {
    if (tickInterval) return
    tick.value = Date.now()
    tickInterval = setInterval(() => { tick.value = Date.now() }, 1000)
  }
  function stopTick() {
    if (tickInterval) clearInterval(tickInterval)
    tickInterval = null
  }
  watch(isClockedIn, (v) => { if (v) startTick(); else stopTick() }, { immediate: true })
  onUnmounted(stopTick)

  function formatMs(ms: number) {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h}h ${m}m ${sec}s`
  }

  const elapsedDisplay = computed(() => {
    const r = todayRecord.value
    if (!r?.clock_in || r.clock_out) return '0h 0m 0s'
    const now = tick.value || Date.now()
    const start = new Date(r.clock_in).getTime()
    let lunchMs = 0
    if (r.lunch_break_start) {
      const end = r.lunch_break_end ? new Date(r.lunch_break_end).getTime() : now
      lunchMs = end - new Date(r.lunch_break_start).getTime()
    }
    return formatMs(Math.max(0, now - start - lunchMs))
  })

  const lunchElapsedDisplay = computed(() => {
    const r = todayRecord.value
    if (!r?.lunch_break_start || r.lunch_break_end) return '0h 0m 0s'
    const now = tick.value || Date.now()
    const start = new Date(r.lunch_break_start).getTime()
    return formatMs(Math.max(0, now - start))
  })

  async function fetchToday() {
    if (!userId.value) return
    isLoading.value = true
    error.value = null
    const startOfDay = `${today.value}T00:00:00.000Z`
    const endOfDay = `${today.value}T23:59:59.999Z`
    const { data, error: err } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', userId.value)
      .gte('clock_in', startOfDay)
      .lte('clock_in', endOfDay)
      .order('clock_in', { ascending: false })
    isLoading.value = false
    if (err) { error.value = err.message; return }
    todayRecords.value = (data ?? []) as AttendanceRow[]
  }

  async function clockIn(workModality: WorkModality, opts?: { branchLocation?: string; locationIn?: string; facialStatus?: string }) {
    if (!userId.value) return
    isLoading.value = true
    error.value = null
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('attendance')
      .insert({
        user_id: userId.value,
        clock_in: now,
        facial_status: opts?.facialStatus ?? 'not verified',
        branch_location: opts?.branchLocation ?? null,
        location_in: opts?.locationIn ?? null,
        work_modality: workModality,
        updated_at: now
      })
      .select()
      .single()
    isLoading.value = false
    if (err) { error.value = err.message; return }
    todayRecords.value = [data as AttendanceRow, ...todayRecords.value]
  }

  async function startLunchBreak() {
    if (!todayRecord.value?.attendance_id || usedLunchBreak.value) return
    isLoading.value = true
    error.value = null
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('attendance')
      .update({ lunch_break_start: now, updated_at: now })
      .eq('attendance_id', todayRecord.value.attendance_id)
      .select()
      .single()
    isLoading.value = false
    if (err) { error.value = err.message; return }
    const idx = todayRecords.value.findIndex(r => r.attendance_id === todayRecord.value?.attendance_id)
    if (idx >= 0) todayRecords.value[idx] = data as AttendanceRow
  }

  async function endLunchBreak() {
    if (!todayRecord.value?.attendance_id) return
    isLoading.value = true
    error.value = null
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('attendance')
      .update({ lunch_break_end: now, updated_at: now })
      .eq('attendance_id', todayRecord.value.attendance_id)
      .select()
      .single()
    isLoading.value = false
    if (err) { error.value = err.message; return }
    const idx = todayRecords.value.findIndex(r => r.attendance_id === todayRecord.value?.attendance_id)
    if (idx >= 0) todayRecords.value[idx] = data as AttendanceRow
  }

  async function clockOut(locationOut?: string) {
    if (!todayRecord.value?.attendance_id) return
    isLoading.value = true
    error.value = null
    const now = new Date().toISOString()
    const ci = new Date(todayRecord.value.clock_in!).getTime()
    const co = new Date(now).getTime()
    let lunchMs = 0
    if (todayRecord.value.lunch_break_start && todayRecord.value.lunch_break_end)
      lunchMs = new Date(todayRecord.value.lunch_break_end).getTime() - new Date(todayRecord.value.lunch_break_start).getTime()
    else if (todayRecord.value.lunch_break_start)
      lunchMs = new Date(now).getTime() - new Date(todayRecord.value.lunch_break_start).getTime()
    const totalTimeInterval = msToInterval(co - ci - lunchMs)
    const { data, error: err } = await supabase
      .from('attendance')
      .update({
        clock_out: now,
        lunch_break_end: todayRecord.value.lunch_break_start && !todayRecord.value.lunch_break_end ? now : todayRecord.value.lunch_break_end,
        total_time: totalTimeInterval,
        location_out: locationOut ?? null,
        updated_at: now
      })
      .eq('attendance_id', todayRecord.value.attendance_id)
      .select()
      .single()
    isLoading.value = false
    if (err) { error.value = err.message; return }
    const idx = todayRecords.value.findIndex(r => r.attendance_id === todayRecord.value?.attendance_id)
    if (idx >= 0) todayRecords.value[idx] = data as AttendanceRow
    await fetchToday()
  }

  return {
    todayRecord,
    completedToday,
    todayRecords,
    today,
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
  }
}
