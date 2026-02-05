import { ref, computed, watch, onUnmounted } from 'vue'
import supabase from '../lib/supabaseClient'
import { user } from './useAuth'

export interface AttendanceRow {
  attendance_id: string
  user_id: string
  clock_in: string | null
  clock_out: string | null
  facial_status: string | null
  lunch_break_start: string | null
  lunch_break_end: string | null
  total_hours: number | null
  location_in: string | null
  location_out: string | null
  branch_location: string | null
  status: string | null
  created_at: string
  updated_at: string
}

const todayRecord = ref<AttendanceRow | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)

function toHours(ms: number) {
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100
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
      .maybeSingle()
    isLoading.value = false
    if (err) { error.value = err.message; return }
    todayRecord.value = data as AttendanceRow | null
  }

  async function clockIn(branchLocation?: string) {
    if (!userId.value) return
    isLoading.value = true
    error.value = null
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('attendance')
      .insert({
        user_id: userId.value,
        clock_in: now,
        facial_status: 'not verified',
        branch_location: branchLocation ?? null,
        location_in: null,
        updated_at: now
      })
      .select()
      .single()
    isLoading.value = false
    if (err) { error.value = err.message; return }
    todayRecord.value = data as AttendanceRow
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
    todayRecord.value = data as AttendanceRow
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
    todayRecord.value = data as AttendanceRow
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
    const totalHours = toHours(co - ci - lunchMs)
    const { data, error: err } = await supabase
      .from('attendance')
      .update({
        clock_out: now,
        lunch_break_end: todayRecord.value.lunch_break_start && !todayRecord.value.lunch_break_end ? now : todayRecord.value.lunch_break_end,
        total_hours: totalHours,
        location_out: locationOut ?? null,
        status: 'completed',
        updated_at: now
      })
      .eq('attendance_id', todayRecord.value.attendance_id)
      .select()
      .single()
    isLoading.value = false
    if (err) { error.value = err.message; return }
    todayRecord.value = data as AttendanceRow
  }

  return {
    todayRecord,
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
