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
  facial_verifications_id: string | null
  wfh_pic_url: string | null
  /** Shift output / accomplishments (stored on clock-out). */
  output?: string | null
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
  const t = s.trim()
  const [lat, lng] = t.split(',').map((x) => Number(String(x).trim()))
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
const OPEN_ROW_FETCH_GRACE_MS = 15000

/** Persist as `H:MM:SS` so all clients can parse totals consistently (matches clock-out + edit approval). */
function msToInterval(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function parseLegacyHumanDurationChunk(t: string): number {
  let sec = 0
  const hMatch = t.match(/(\d+)\s*hours?/i)
  const mMatch = t.match(/(\d+)\s*minutes?/i)
  const sMatch = t.match(/(\d+)\s*seconds?/i)
  if (hMatch) sec += Number(hMatch[1]) * 3600
  if (mMatch) sec += Number(mMatch[1]) * 60
  if (sMatch) sec += Number(sMatch[1])
  return sec
}

/**
 * Parse `total_time` from DB into seconds.
 * - App format: `H:MM:SS` (from `msToInterval`); optional fractional seconds from Postgres (`:SS.ffffff`)
 * - Postgres-style: `1 day 8:15:30` (hours in the time part may exceed 24)
 * - Legacy: human-readable strings, e.g. "8 hours 15 minutes 30 seconds"
 */
export function parseTotalTimeIntervalToSeconds(interval: string | null): number {
  if (!interval) return 0
  const raw = interval.trim()
  if (!raw) return 0

  function tryColon(s: string): number | null {
    const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/)
    if (!m) return null
    const h = Number(m[1])
    const mm = Number(m[2])
    const ss = Number(m[3])
    if ([h, mm, ss].some((n) => Number.isNaN(n))) return null
    return h * 3600 + mm * 60 + ss
  }

  const direct = tryColon(raw)
  if (direct !== null) return direct

  const dayPref = raw.match(/^(\d+)\s+days?\s+/i)
  if (dayPref) {
    const days = Number(dayPref[1])
    const rest = raw.slice(dayPref[0].length).trim()
    const c = tryColon(rest)
    if (c !== null) return days * 86400 + c
    return days * 86400 + parseLegacyHumanDurationChunk(rest)
  }

  return parseLegacyHumanDurationChunk(raw)
}

/**
 * Prefer parsed `total_time` for same-calendar-day sessions. For **overnight** shifts (clock-out on a
 * later local day than clock-in), the DB `total_time` is often wrong (legacy math or interval quirks),
 * so we **always recompute** from clock in/out + lunch when that flag is true.
 */
export function effectiveWorkSecondsFromAttendance(
  r: Pick<AttendanceRow, 'total_time' | 'clock_in' | 'clock_out' | 'lunch_break_start' | 'lunch_break_end'>
): number {
  const parsed = parseTotalTimeIntervalToSeconds(r.total_time)
  if (!r.clock_in || !r.clock_out) return parsed

  const recalculated = computeTotalTimeForEdit(
    r.clock_in,
    r.clock_out,
    r.lunch_break_start ?? null,
    r.lunch_break_end ?? null
  )
  const recSeconds = parseTotalTimeIntervalToSeconds(recalculated)

  if (isClockOutNextLocalDay(r.clock_in, r.clock_out)) {
    if (recSeconds > 0) return recSeconds
    return parsed > 0 ? parsed : 0
  }

  if (parsed > 0) return parsed
  return recSeconds
}

/** Same rules as clock-out: lunch window subtracted from clock_in→clock_out span. */
export function computeTotalTimeForEdit(
  clockIn: string | null,
  clockOut: string | null,
  lunchStart: string | null,
  lunchEnd: string | null
): string | null {
  if (!clockIn || !clockOut) return null
  const ci = storedToRealInstant(clockIn)
  let co = storedToRealInstant(clockOut)
  if (!ci || !co) return null
  /** Next-day clock-out sometimes stored with the wrong calendar date (out time before in time). Roll forward by whole days until the span is positive (cap for pathological data). */
  if (co <= ci) {
    const dayMs = 24 * 60 * 60 * 1000
    let guard = 0
    while (co <= ci && guard < 14) {
      co += dayMs
      guard += 1
    }
  }
  let lunchMs = 0
  if (lunchStart && lunchEnd)
    lunchMs = storedToRealInstant(lunchEnd) - storedToRealInstant(lunchStart)
  else if (lunchStart)
    lunchMs = co - storedToRealInstant(lunchStart)
  return msToInterval(co - ci - lunchMs)
}

/** Local date string YYYY-MM-DD (user's timezone). */
export function getLocalDateString(d: Date): string {
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * True when clock-out should be labeled "Next day" (overnight shift).
 * - Later local calendar date than clock-in, or
 * - Same local date but clock-out instant is **before** clock-in (e.g. 8:00 A.M. vs 11:42 P.M. on the
 *   same stored date) — common when the next-morning clock-out was saved with the wrong date.
 */
export function isClockOutNextLocalDay(clockIn: string | null, clockOut: string | null): boolean {
  if (!clockIn || !clockOut) return false
  const inMs = storedToRealInstant(clockIn)
  const outMs = storedToRealInstant(clockOut)
  if (!inMs || !outMs) return false
  const inKey = getLocalDateString(new Date(inMs))
  const outKey = getLocalDateString(new Date(outMs))
  if (outKey > inKey) return true
  if (inKey === outKey && outMs < inMs) return true
  return false
}

/** Start and end of the given local date (YYYY-MM-DD) as ISO strings for DB query. */
function getLocalDayRange(localDateStr: string): { start: string; end: string } {
  const startLocal = new Date(localDateStr + 'T00:00:00')
  const endLocal = new Date(localDateStr + 'T23:59:59.999')
  return { start: startLocal.toISOString(), end: endLocal.toISOString() }
}

/**
 * Current moment stored as local date + local time with "Z" suffix so the DB stores the correct
 * local calendar date (avoids off-by-one-day when viewing in UTC). Example: 07:30 March 16 local
 * → "2025-03-16T07:30:00.000Z" so the stored date is March 16.
 */
function getNowAsLocalDateTimeZ(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const h = d.getHours().toString().padStart(2, '0')
  const min = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  const ms = d.getMilliseconds().toString().padStart(3, '0')
  return `${y}-${m}-${day}T${h}:${min}:${s}.${ms}Z`
}

/**
 * True when the value includes a real numeric UTC offset (Postgres timestamptz, e.g. `...+08`, `...+08:00`).
 * `Date` already yields the correct instant; the fake-`Z` correction must not be applied.
 */
function hasExplicitUtcOffset(isoString: string): boolean {
  const s = isoString.trim()
  return /[+-]\d{2}(:\d{2})?$/.test(s)
}

/**
 * Convert a stored attendance timestamp to epoch ms for math and display.
 * - App-written values from `getNowAsLocalDateTimeZ()` use a trailing `Z` but encode **local** wall time;
 *   real instant = parsed UTC ms + local timezone offset.
 * - Postgres may normalize those same wall-time values to `+00:00`; treat zero-offset values like `Z`.
 * - Values with a non-zero explicit offset (`+08`, etc.) or without any zone suffix are parsed by `Date`
 *   as real instants — no extra offset.
 */
export function storedToRealInstant(isoString: string | null): number {
  if (!isoString) return 0
  const trimmed = isoString.trim()
  const storedMs = new Date(trimmed).getTime()
  if (Number.isNaN(storedMs)) return 0
  if (/Z\s*$/i.test(trimmed) || /[+-]00(?::00)?$/.test(trimmed)) {
    return storedMs + new Date().getTimezoneOffset() * 60 * 1000
  }
  if (hasExplicitUtcOffset(trimmed)) return storedMs
  return storedMs
}

export function useAttendance() {
  const userId = computed(() => user.value?.id ?? null)
  const today = computed(() => getLocalDateString(new Date()))
  const isClockedIn = computed(() => !!todayRecord.value?.clock_in && !todayRecord.value?.clock_out)
  const isOnLunch = computed(() => !!todayRecord.value?.lunch_break_start && !todayRecord.value?.lunch_break_end)
  const usedLunchBreak = computed(() => !!(todayRecord.value?.lunch_break_start && todayRecord.value?.lunch_break_end))
  let attendanceRealtimeChannel: ReturnType<typeof supabase.channel> | null = null

  function closeAttendanceRealtime() {
    if (attendanceRealtimeChannel) {
      supabase.removeChannel(attendanceRealtimeChannel)
      attendanceRealtimeChannel = null
    }
  }

  function startAttendanceRealtime(uid: string) {
    closeAttendanceRealtime()
    attendanceRealtimeChannel = supabase
      .channel(`attendance:${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance', filter: `user_id=eq.${uid}` },
        () => {
          // Keep attendance state synced across devices/tabs.
          void fetchToday()
        }
      )
      .subscribe()
  }

  const tick = ref(0)
  /** Tracks local calendar day while the live timer runs so we refetch when midnight passes (tab stays open). */
  let lastTrackedLocalDate = getLocalDateString(new Date())
  let tickInterval: ReturnType<typeof setInterval> | null = null
  function startTick() {
    if (tickInterval) {
      console.debug('[useAttendance] startTick skipped; interval already running', {
        attendanceId: todayRecord.value?.attendance_id ?? null
      })
      return
    }
    tick.value = Date.now()
    console.debug('[useAttendance] startTick', {
      attendanceId: todayRecord.value?.attendance_id ?? null,
      clockIn: todayRecord.value?.clock_in ?? null,
      tick: tick.value
    })
    tickInterval = setInterval(() => { tick.value = Date.now() }, 1000)
  }
  function stopTick() {
    if (tickInterval) {
      console.debug('[useAttendance] stopTick', {
        attendanceId: todayRecord.value?.attendance_id ?? null,
        clockOut: todayRecord.value?.clock_out ?? null
      })
      clearInterval(tickInterval)
    }
    tickInterval = null
  }
  watch(
    () => ({
      attendanceId: todayRecord.value?.attendance_id ?? null,
      clockIn: todayRecord.value?.clock_in ?? null,
      clockOut: todayRecord.value?.clock_out ?? null
    }),
    (state) => {
      const shouldTick = !!state.clockIn && !state.clockOut
      console.debug('[useAttendance] tick state changed', {
        ...state,
        shouldTick
      })
      if (shouldTick) startTick()
      else stopTick()
    },
    { immediate: true }
  )
  onUnmounted(() => {
    stopTick()
    closeAttendanceRealtime()
  })

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
    const start = storedToRealInstant(r.clock_in)
    let lunchMs = 0
    if (r.lunch_break_start) {
      const end = r.lunch_break_end ? storedToRealInstant(r.lunch_break_end) : now
      lunchMs = end - storedToRealInstant(r.lunch_break_start)
    }
    return formatMs(Math.max(0, now - start - lunchMs))
  })

  const lunchElapsedDisplay = computed(() => {
    const r = todayRecord.value
    if (!r?.lunch_break_start || r.lunch_break_end) return '0h 0m 0s'
    const now = tick.value || Date.now()
    const start = storedToRealInstant(r.lunch_break_start)
    return formatMs(Math.max(0, now - start))
  })

  async function fetchToday() {
    if (!userId.value) return
    isLoading.value = true
    error.value = null
    const dayStr = today.value
    const { start: startOfDay, end: endOfDay } = getLocalDayRange(dayStr)
    // Widen bounds so rows stored with odd "Z" local timestamps are not excluded at DB filter time.
    const padMs = 36 * 60 * 60 * 1000
    const startWide = new Date(new Date(startOfDay).getTime() - padMs).toISOString()
    const endWide = new Date(new Date(endOfDay).getTime() + padMs).toISOString()
    const [dayRes, openRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('*')
        .eq('user_id', userId.value)
        .gte('clock_in', startWide)
        .lte('clock_in', endWide)
        .order('clock_in', { ascending: false }),
      supabase
        .from('attendance')
        .select('*')
        .eq('user_id', userId.value)
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(1)
    ])
    isLoading.value = false
    const err = dayRes.error ?? openRes.error
    if (err) { error.value = err.message; return }
    let incoming = (dayRes.data ?? []) as AttendanceRow[]
    incoming = incoming.filter((r) => {
      if (!r.clock_in) return false
      const localD = getLocalDateString(new Date(storedToRealInstant(r.clock_in)))
      return localD === dayStr
    })
    const openRows = (openRes.data ?? []) as AttendanceRow[]
    const openFromDb = openRows[0] ?? null
    const prevOpen = todayRecords.value.find((r) => !r.clock_out)
    const ids = new Set(incoming.map((r) => r.attendance_id))
    /** Open shift from DB (any day) so overnight sessions survive midnight and cold reloads. */
    if (openFromDb && !ids.has(openFromDb.attendance_id)) {
      incoming = [openFromDb, ...incoming]
      ids.add(openFromDb.attendance_id)
    }
    // Fallback: keep in-memory open row if DB open query missed (e.g. race) and day query excluded it.
    if (prevOpen && !ids.has(prevOpen.attendance_id)) {
      todayRecords.value = [prevOpen, ...incoming.filter((r) => r.attendance_id !== prevOpen.attendance_id)]
      lastTrackedLocalDate = getLocalDateString(new Date())
      return
    }
    todayRecords.value = incoming
    lastTrackedLocalDate = getLocalDateString(new Date())
  }

  /** Refetch when the local date rolls over while still clocked in (timer has no midnight reset). */
  watch(tick, (t) => {
    if (!userId.value || !t) return
    const nowDay = getLocalDateString(new Date(t))
    if (nowDay !== lastTrackedLocalDate) void fetchToday()
  })

  watch(
    userId,
    (uid) => {
      closeAttendanceRealtime()
      if (!uid) {
        todayRecords.value = []
        return
      }
      void fetchToday()
      startAttendanceRealtime(uid)
    },
    { immediate: true }
  )

  async function clockIn(workModality: WorkModality, opts?: { branchLocation?: string; locationIn?: string; facialStatus?: string; facialVerificationId?: string; wfhPicUrl?: string }) {
    if (!userId.value) return
    isLoading.value = true
    error.value = null
    const now = getNowAsLocalDateTimeZ()
    const { data, error: err } = await supabase
      .from('attendance')
      .insert({
        user_id: userId.value,
        clock_in: now,
        facial_status: opts?.facialStatus ?? 'not verified',
        branch_location: opts?.branchLocation ?? null,
        location_in: opts?.locationIn ?? null,
        work_modality: workModality,
        facial_verifications_id: opts?.facialVerificationId ?? null,
        wfh_pic_url: opts?.wfhPicUrl ?? null,
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
    const now = getNowAsLocalDateTimeZ()
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
    const now = getNowAsLocalDateTimeZ()
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

  async function clockOut(locationOut?: string, output?: string | null) {
    if (!todayRecord.value?.attendance_id) return
    isLoading.value = true
    error.value = null
    const now = getNowAsLocalDateTimeZ()
    const ci = storedToRealInstant(todayRecord.value.clock_in!)
    const co = Date.now()
    let lunchMs = 0
    if (todayRecord.value.lunch_break_start && todayRecord.value.lunch_break_end)
      lunchMs = storedToRealInstant(todayRecord.value.lunch_break_end) - storedToRealInstant(todayRecord.value.lunch_break_start)
    else if (todayRecord.value.lunch_break_start)
      lunchMs = co - storedToRealInstant(todayRecord.value.lunch_break_start)
    const totalTimeInterval = msToInterval(co - ci - lunchMs)
    const { data, error: err } = await supabase
      .from('attendance')
      .update({
        clock_out: now,
        lunch_break_end: todayRecord.value.lunch_break_start && !todayRecord.value.lunch_break_end ? now : todayRecord.value.lunch_break_end,
        total_time: totalTimeInterval,
        location_out: locationOut ?? null,
        branch_location: todayRecord.value.branch_location ?? null,
        output: output ?? null,
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
