<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useAttendance } from '../composables/useAttendance'
import supabase from '../lib/supabaseClient'
import type { AttendanceRow } from '../composables/useAttendance'
import { getLocalDateString, storedToRealInstant } from '../composables/useAttendance'

const router = useRouter()
const { user } = useAuth()
const { todayRecord, completedToday, isClockedIn, fetchToday } = useAttendance()

const reportPeriod = ref<'thisWeek' | 'lastWeek' | 'custom'>('thisWeek')
const reportRecords = ref<AttendanceRow[]>([])
const reportLoading = ref(false)
const reportError = ref<string | null>(null)
const timeFilter = ref<'all' | 'undertime' | 'on_time' | 'overtime'>('all')
const isMobile = ref(false)
const showPeriodDropdown = ref(false)
const showHoursFilterDropdown = ref(false)
const showCustomDatePicker = ref(false)
const reportPeriodSelectorRef = ref<HTMLElement | null>(null)
const customDatePickerRef = ref<HTMLElement | null>(null)
/** Open panel upward when there isn’t enough viewport space below the period control. */
const customDatePickerFlipUp = ref(false)

let customDatePickerPlacementListeners: (() => void) | null = null

function detachCustomDatePickerPlacementListeners() {
  customDatePickerPlacementListeners?.()
  customDatePickerPlacementListeners = null
}

async function updateCustomDatePickerPlacement() {
  await nextTick()
  const anchor = reportPeriodSelectorRef.value
  const panel = customDatePickerRef.value
  if (!anchor) return
  const margin = 12
  const anchorRect = anchor.getBoundingClientRect()
  const panelHeight = panel?.offsetHeight ?? 300
  const spaceBelow = window.innerHeight - anchorRect.bottom - margin
  const spaceAbove = anchorRect.top - margin
  const need = panelHeight + margin
  if (spaceBelow >= need) {
    customDatePickerFlipUp.value = false
  } else if (spaceAbove >= need) {
    customDatePickerFlipUp.value = true
  } else {
    customDatePickerFlipUp.value = spaceAbove > spaceBelow
  }
}

function attachCustomDatePickerPlacementListeners() {
  detachCustomDatePickerPlacementListeners()
  const bump = () => {
    void updateCustomDatePickerPlacement()
  }
  window.addEventListener('resize', bump)
  window.addEventListener('scroll', bump, true)
  customDatePickerPlacementListeners = () => {
    window.removeEventListener('resize', bump)
    window.removeEventListener('scroll', bump, true)
  }
}
const customStartDate = ref<string>('')
const customEndDate = ref<string>('')
const kpiRecords = ref<AttendanceRow[]>([])
const kpiPrevMonthRecords = ref<AttendanceRow[]>([])
const kpiLoading = ref(false)
const employeeName = ref<string | null>(null)
const employeePosition = ref<string | null>(null)
function checkMobile() {
  isMobile.value = window.innerWidth < 768
}

function parseHours(interval: string | null): number {
  if (!interval) return 0
  const m = interval.match(/^(\d+):(\d+):(\d+)/)
  if (m) {
    const h = Number(m[1])
    const min = Number(m[2])
    const s = Number(m[3])
    return h + min / 60 + s / 3600
  }
  return 0
}

const hoursToday = computed(() => {
  let total = completedToday.value.reduce((sum, r) => sum + parseHours(r.total_time), 0)
  if (isClockedIn.value && todayRecord.value?.clock_in) {
    const now = Date.now()
    const start = storedToRealInstant(todayRecord.value.clock_in)
    let lunchMs = 0
    const r = todayRecord.value
    if (r.lunch_break_start) {
      const end = r.lunch_break_end ? storedToRealInstant(r.lunch_break_end) : now
      lunchMs = end - storedToRealInstant(r.lunch_break_start)
    }
    total += Math.max(0, (now - start - lunchMs) / 3600000)
  }
  return total
})


function formatHours(h: number): string {
  if (h < 0.01) return '0h'
  if (h < 1) return `${Math.round(h * 60)}m`
  const whole = Math.floor(h)
  const min = Math.round((h - whole) * 60)
  return min ? `${whole}h ${min}m` : `${whole}h`
}

function formatHoursSimple(h: number): string {
  const whole = Math.floor(h)
  return `${whole}h`
}

function formatHoursDecimal(h: number): string {
  return h.toFixed(2)
}

function getCurrentMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

function getPreviousMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), 0)
  end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function fetchKPIData() {
  if (!user.value?.id) return
  kpiLoading.value = true
  const currentRange = getCurrentMonthRange()
  const prevRange = getPreviousMonthRange()
  
  const [currentRes, prevRes] = await Promise.all([
    supabase
      .from('attendance')
      .select('*')
      .eq('user_id', user.value.id)
      .gte('clock_in', currentRange.start)
      .lte('clock_in', currentRange.end)
      .order('clock_in', { ascending: false }),
    supabase
      .from('attendance')
      .select('*')
      .eq('user_id', user.value.id)
      .gte('clock_in', prevRange.start)
      .lte('clock_in', prevRange.end)
      .order('clock_in', { ascending: false })
  ])
  
  kpiLoading.value = false
  if (currentRes.error) { console.error('KPI fetch error:', currentRes.error); return }
  if (prevRes.error) { console.error('KPI prev fetch error:', prevRes.error); return }
  
  kpiRecords.value = (currentRes.data ?? []) as AttendanceRow[]
  kpiPrevMonthRecords.value = (prevRes.data ?? []) as AttendanceRow[]
}

const kpiByDay = computed(() => {
  const map: Record<string, AttendanceRow[]> = {}
  for (const r of kpiRecords.value) {
    const key = r.clock_in ? getLocalDateString(new Date(storedToRealInstant(r.clock_in))) : '—'
    if (!map[key]) map[key] = []
    map[key].push(r)
  }
  return map
})

const kpiPrevByDay = computed(() => {
  const map: Record<string, AttendanceRow[]> = {}
  for (const r of kpiPrevMonthRecords.value) {
    const key = r.clock_in ? getLocalDateString(new Date(storedToRealInstant(r.clock_in))) : '—'
    if (!map[key]) map[key] = []
    map[key].push(r)
  }
  return map
})

const totalWorkingHours = computed(() => {
  return kpiRecords.value.reduce((sum, r) => sum + parseHours(r.total_time), 0)
})

const totalWorkingHoursPrev = computed(() => {
  return kpiPrevMonthRecords.value.reduce((sum, r) => sum + parseHours(r.total_time), 0)
})

const totalOvertimeHours = computed(() => {
  const byDay = kpiByDay.value
  let overtime = 0
  for (const dateKey in byDay) {
    const dayRecords = byDay[dateKey]
    if (dayRecords) {
      const dayHours = dayRecords.reduce((sum, r) => sum + parseHours(r.total_time), 0)
      if (dayHours > 8) {
        overtime += dayHours - 8
      }
    }
  }
  return overtime
})

const totalOvertimeHoursPrev = computed(() => {
  const byDay = kpiPrevByDay.value
  let overtime = 0
  for (const dateKey in byDay) {
    const dayRecords = byDay[dateKey]
    if (dayRecords) {
      const dayHours = dayRecords.reduce((sum, r) => sum + parseHours(r.total_time), 0)
      if (dayHours > 8) {
        overtime += dayHours - 8
      }
    }
  }
  return overtime
})

const totalPresent = computed(() => {
  return Object.keys(kpiByDay.value).length
})

const totalPresentPrev = computed(() => {
  return Object.keys(kpiPrevByDay.value).length
})

function countWeekdaysBetween(start: Date, end: Date): number {
  const d = new Date(start)
  d.setHours(0, 0, 0, 0)
  const last = new Date(end)
  last.setHours(23, 59, 59, 999)
  let count = 0
  while (d <= last) {
    count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

const totalAbsent = computed(() => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const workingDays = countWeekdaysBetween(start, end)
  const presentWeekdays = Object.keys(kpiByDay.value).filter((key) => {
    const d = new Date(key)
    if (Number.isNaN(d.getTime())) return false
    return true
  }).length
  return Math.max(0, workingDays - presentWeekdays)
})

const totalAbsentPrev = computed(() => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 0)
  const workingDays = countWeekdaysBetween(start, end)
  const presentWeekdays = Object.keys(kpiPrevByDay.value).filter((key) => {
    const d = new Date(key)
    if (Number.isNaN(d.getTime())) return false
    return true
  }).length
  return Math.max(0, workingDays - presentWeekdays)
})

const workingHoursDiff = computed(() => totalWorkingHours.value - totalWorkingHoursPrev.value)
const overtimeHoursDiff = computed(() => totalOvertimeHours.value - totalOvertimeHoursPrev.value)
const presentDiff = computed(() => totalPresent.value - totalPresentPrev.value)
const absentDiff = computed(() => totalAbsent.value - totalAbsentPrev.value)

function formatComparison(diff: number, unit: 'Hrs' | 'days' | 'paid' = 'Hrs'): string {
  const absDiff = Math.abs(diff)
  const sign = diff >= 0 ? '+' : '-'
  if (unit === 'Hrs') {
    const word = diff >= 0 ? 'longer' : 'shorter'
    return `${sign}${absDiff.toFixed(0)}${unit} ${word} vs last month`
  } else if (unit === 'days') {
    return `${sign}${absDiff} ${unit} vs last month`
  } else {
    return `${sign}${absDiff} ${unit} vs last month`
  }
}

/** Parse `<input type="date">` value (YYYY-MM-DD) as a local calendar day (not UTC midnight). */
function dateKeyToLocalDate(ymd: string): Date {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date(ymd)
}

function localDayRangeIsoFromInputs(startYmd: string, endYmd: string): { start: string; end: string } {
  const customStart = dateKeyToLocalDate(startYmd)
  customStart.setHours(0, 0, 0, 0)
  const customEnd = dateKeyToLocalDate(endYmd)
  customEnd.setHours(23, 59, 59, 999)
  return { start: customStart.toISOString(), end: customEnd.toISOString() }
}

function getReportRange() {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  
  if (reportPeriod.value === 'custom' && customStartDate.value && customEndDate.value) {
    return localDayRangeIsoFromInputs(customStartDate.value, customEndDate.value)
  } else if (reportPeriod.value === 'thisWeek') {
    // Get Monday of current week
    const day = start.getDay()
    const diff = start.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
    start.setDate(diff)
    start.setHours(0, 0, 0, 0)
    return { start: start.toISOString(), end: end.toISOString() }
  } else if (reportPeriod.value === 'lastWeek') {
    // Get Monday of last week
    const day = start.getDay()
    const diff = start.getDate() - day + (day === 0 ? -6 : 1) - 7 // Go back 7 days from this week's Monday
    start.setDate(diff)
    start.setHours(0, 0, 0, 0)
    // End is Sunday of last week
    const lastWeekEnd = new Date(start)
    lastWeekEnd.setDate(start.getDate() + 6)
    lastWeekEnd.setHours(23, 59, 59, 999)
    return { start: start.toISOString(), end: lastWeekEnd.toISOString() }
  }
  
  // Fallback
  start.setDate(start.getDate() - 7)
  start.setHours(0, 0, 0, 0)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function fetchReport() {
  if (!user.value?.id) return
  reportLoading.value = true
  reportError.value = null
  const { start, end } = getReportRange()
  const { data, error: err } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', user.value.id)
    .gte('clock_in', start)
    .lte('clock_in', end)
    .order('clock_in', { ascending: false })
  reportLoading.value = false
  if (err) { reportError.value = err.message; return }
  reportRecords.value = (data ?? []) as AttendanceRow[]
}

const reportByDay = computed(() => {
  const map: Record<string, AttendanceRow[]> = {}
  for (const r of reportRecords.value) {
    const key = r.clock_in ? getLocalDateString(new Date(storedToRealInstant(r.clock_in))) : '—'
    if (!map[key]) map[key] = []
    map[key].push(r)
  }
  return map
})

const allDatesInPeriod = computed(() => {
  const { start, end } = getReportRange()
  const startDate = new Date(start)
  const endDate = new Date(end)
  
  // For custom range, divide into 5 equal periods
  if (reportPeriod.value === 'custom') {
    const periods: { start: Date; end: Date; label: string }[] = []
    const totalDays = Math.max(
      1,
      Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    )
    const daysPerPeriod = Math.ceil(totalDays / 5)
    
    for (let i = 0; i < 5; i++) {
      const periodStart = new Date(startDate)
      periodStart.setDate(periodStart.getDate() + (i * daysPerPeriod))
      const periodEnd = new Date(periodStart)
      periodEnd.setDate(periodEnd.getDate() + daysPerPeriod - 1)
      if (periodEnd > endDate) periodEnd.setTime(endDate.getTime())
      
      const label = periodStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      periods.push({ start: periodStart, end: periodEnd, label })
    }
    return periods
  }
  
  // For week views, show daily (excluding weekends)
  const list: { date: string }[] = []
  const current = new Date(startDate)
  
  while (current <= endDate) {
    list.push({ date: getLocalDateString(current) })
    current.setDate(current.getDate() + 1)
  }
  
  return list
})

const reportBarData = computed(() => {
  const byDay = reportByDay.value
  const today = getLocalDateString(new Date())
  const periods = allDatesInPeriod.value

  return periods.map((period, i) => {
    let hours = 0
    let label = ''

    if (reportPeriod.value === 'custom' && 'start' in period) {
      const periodStart = period.start
      const periodEnd = period.end
      const current = new Date(periodStart)

      while (current <= periodEnd) {
        const dateStr = getLocalDateString(current)
        const rows = byDay[dateStr] ?? []
        hours += rows.reduce((sum, r) => sum + parseHours(r.total_time), 0)
        current.setDate(current.getDate() + 1)
      }

      label = period.label
    } else if ('date' in period) {
      const dateStr = period.date
      const rows = byDay[dateStr] ?? []
      hours = rows.reduce((sum, r) => sum + parseHours(r.total_time), 0)
      const d = dateKeyToLocalDate(dateStr)
      label = !isNaN(d.getTime())
        ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : dateStr
    }

    // Apply time filter: undertime (<8h), on time (=8h), overtime (>8h)
    const filter = timeFilter.value
    const epsilon = 1e-6
    const matches =
      filter === 'all' ||
      (filter === 'undertime' && hours > 0 && hours < 8 - epsilon) ||
      (filter === 'on_time' && Math.abs(hours - 8) <= epsilon) ||
      (filter === 'overtime' && hours > 8 + epsilon)

    if (!matches) hours = 0

    return {
      label,
      hours,
      dayIndex: i,
      isToday: reportPeriod.value !== 'custom' && 'date' in period && period.date === today
    }
  })
})
const reportTotalHours = computed(() => reportBarData.value.reduce((s, b) => s + b.hours, 0))
const reportMaxHours = computed(() => Math.max(...reportBarData.value.map(b => b.hours), 1))

const chartScaleMax = computed(() => Math.ceil(reportMaxHours.value) || 8)

const timeFilterLabel = computed(() => {
  const f = timeFilter.value
  if (f === 'all') return 'All'
  if (f === 'undertime') return 'Undertime'
  if (f === 'on_time') return 'On time'
  return 'Overtime'
})

const periodLabel = computed(() => {
  if (reportPeriod.value === 'thisWeek') return 'This Week'
  if (reportPeriod.value === 'lastWeek') return 'Last Week'
  if (reportPeriod.value === 'custom') {
    if (customStartDate.value && customEndDate.value) {
      const start = dateKeyToLocalDate(customStartDate.value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      })
      const end = dateKeyToLocalDate(customEndDate.value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      })
      return `${start} - ${end}`
    }
    return 'Custom'
  }
  return 'This Week'
})

function applyCustomDateRange() {
  if (customStartDate.value && customEndDate.value) {
    const start = dateKeyToLocalDate(customStartDate.value)
    start.setHours(0, 0, 0, 0)
    const end = dateKeyToLocalDate(customEndDate.value)
    end.setHours(0, 0, 0, 0)
    if (start.getTime() <= end.getTime()) {
      reportError.value = null
      reportPeriod.value = 'custom'
      showCustomDatePicker.value = false
      fetchReport()
    } else {
      reportError.value = 'Start date must be before or equal to end date'
    }
  } else {
    reportError.value = 'Please select both start and end dates'
  }
}

function openCustomDatePicker() {
  if (!customStartDate.value || !customEndDate.value) {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 30)
    customEndDate.value = getLocalDateString(end)
    customStartDate.value = getLocalDateString(start)
  }
  if (reportPeriod.value !== 'custom') {
    reportPeriod.value = 'custom'
  }
  showCustomDatePicker.value = true
}



async function loadEmployeeData() {
  if (!user.value?.id) return
  const { data } = await supabase.from('employee').select('name, position_in_company').eq('id', user.value.id).maybeSingle()
  if (data) {
    employeeName.value = data.name
    employeePosition.value = data.position_in_company
  }
}

function getHoursColor(hours: number): string {
  if (hours <= 0) return '#fbbf24' // yellow
  if (hours >= 8) {
    if (hours > 8) {
      // Gradient from green to red for overtime (8hrs+)
      // Cap at 12hrs for the gradient calculation
      const overtimeHours = Math.min(hours - 8, 4) // 0-4hrs overtime
      const ratio = overtimeHours / 4 // 0 to 1
      const green = { r: 34, g: 197, b: 94 }
      const red = { r: 248, g: 113, b: 113 }
      const r = Math.round(green.r + (red.r - green.r) * ratio)
      const g = Math.round(green.g + (red.g - green.g) * ratio)
      const b = Math.round(green.b + (red.b - green.b) * ratio)
      return `rgb(${r}, ${g}, ${b})`
    }
    return '#22c55e' // green for exactly 8hrs
  }
  // Gradient between yellow and green (0-8hrs)
  const ratio = hours / 8
  const yellow = { r: 251, g: 191, b: 36 }
  const green = { r: 34, g: 197, b: 94 }
  const r = Math.round(yellow.r + (green.r - yellow.r) * ratio)
  const g = Math.round(yellow.g + (green.g - yellow.g) * ratio)
  const b = Math.round(yellow.b + (green.b - yellow.b) * ratio)
  return `rgb(${r}, ${g}, ${b})`
}

function handleClockIn() {
  router.push({ path: '/dashboard/timeclock', query: { clockin: 'true' } })
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (
    !target.closest('.report-period-selector') &&
    !target.closest('.hours-filter-selector')
  ) {
    showPeriodDropdown.value = false
    showHoursFilterDropdown.value = false
  }
  // Do not close `.custom-date-picker` here: native `<input type="date">` calendars render
  // outside this subtree, so picking a day would fire "outside" and dismiss before a date is chosen.
  // Close via × / Cancel / Apply, or when switching to This week / Last week.
}

onMounted(() => {
  fetchToday()
  fetchReport()
  fetchKPIData()
  loadEmployeeData()
  checkMobile()
  window.addEventListener('resize', checkMobile)
  document.addEventListener('click', handleClickOutside)
})
onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  document.removeEventListener('click', handleClickOutside)
  detachCustomDatePickerPlacementListeners()
})
watch(reportPeriod, () => fetchReport())

watch(showCustomDatePicker, async (open) => {
  if (open) {
    await updateCustomDatePickerPlacement()
    await nextTick()
    await updateCustomDatePickerPlacement()
    attachCustomDatePickerPlacementListeners()
  } else {
    detachCustomDatePickerPlacementListeners()
  }
})
</script>
<template>
  <div class="page">
    <div class="left">
      <!-- Hero Section at Top -->
      <header class="hero-section-top">
        <div class="hero-content-top">
          <h1 class="hero-welcome">Welcome, {{ employeeName || user?.email?.split('@')[0] || 'there' }}</h1>
          <p v-if="employeePosition" class="hero-position">{{ employeePosition }}</p>
          <div class="hero-hours-display" :style="{ color: getHoursColor(hoursToday) }">
            <span class="hero-hours-value">{{ formatHours(hoursToday) }}</span>
            <span class="hero-hours-label">today</span>
          </div>
          <button type="button" class="hero-cta-top" @click="handleClockIn">
            {{ isClockedIn ? 'Open Timeclock' : 'Clock in' }}
          </button>
        </div>
      </header>

      <section class="kpi-cards">
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon-green">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1H5C3.89 1 3 1.89 3 3V21C3 22.11 3.89 23 5 23H19C20.11 23 21 22.11 21 21V9H21ZM19 21H5V3H13V9H19V21Z" fill="currentColor"/>
              <circle cx="8" cy="14" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="14" r="1.5" fill="currentColor"/>
              <circle cx="16" cy="14" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="18" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="18" r="1.5" fill="currentColor"/>
              <circle cx="16" cy="18" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <div class="kpi-comparison" :class="workingHoursDiff >= 0 ? 'kpi-comparison-positive' : 'kpi-comparison-negative'">{{ formatComparison(workingHoursDiff, 'Hrs') }}</div>
          <div class="kpi-value">{{ formatHoursDecimal(totalWorkingHours) }}</div>
          <div class="kpi-label">Total working hours</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon kpi-icon-blue">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="kpi-comparison" :class="overtimeHoursDiff >= 0 ? 'kpi-comparison-positive' : 'kpi-comparison-negative'">{{ formatComparison(overtimeHoursDiff, 'Hrs') }}</div>
          <div class="kpi-value">{{ formatHoursDecimal(totalOvertimeHours) }}</div>
          <div class="kpi-label">Total overtime hours</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon kpi-icon-orange">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <path d="M12 8V12L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M8 12L12 8L16 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="kpi-comparison" :class="presentDiff >= 0 ? 'kpi-comparison-positive' : 'kpi-comparison-negative'">{{ formatComparison(presentDiff, 'days') }}</div>
          <div class="kpi-value">{{ totalPresent }}</div>
          <div class="kpi-label">Total present</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon kpi-icon-purple">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M16 13H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M16 17H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="kpi-comparison" :class="absentDiff >= 0 ? 'kpi-comparison-positive' : 'kpi-comparison-negative'">{{ formatComparison(absentDiff, 'days') }}</div>
          <div class="kpi-value">{{ totalAbsent }}</div>
          <div class="kpi-label">Total absent</div>
        </div>
      </section>

      <div class="hero-report-row">
        <section class="report-panel">
      <div class="report-header">
        <h2 class="report-title">Timesheet ({{ formatHoursSimple(reportTotalHours) }})</h2>
        <div class="report-header-right">
          <div class="hours-filter">
            <div class="hours-filter-selector">
              <button
                type="button"
                class="period-btn"
                aria-haspopup="listbox"
                :aria-expanded="showHoursFilterDropdown"
                aria-label="Filter timesheet by hours"
                @click="showPeriodDropdown = false; showHoursFilterDropdown = !showHoursFilterDropdown"
              >
                <span class="period-btn-label">{{ timeFilterLabel }}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <div v-if="showHoursFilterDropdown" class="period-dropdown" role="listbox">
                <button
                  type="button"
                  class="period-option"
                  :class="{ active: timeFilter === 'all' }"
                  role="option"
                  :aria-selected="timeFilter === 'all'"
                  @click="timeFilter = 'all'; showHoursFilterDropdown = false"
                >
                  All
                </button>
                <button
                  type="button"
                  class="period-option"
                  :class="{ active: timeFilter === 'undertime' }"
                  role="option"
                  :aria-selected="timeFilter === 'undertime'"
                  @click="timeFilter = 'undertime'; showHoursFilterDropdown = false"
                >
                  Undertime
                </button>
                <button
                  type="button"
                  class="period-option"
                  :class="{ active: timeFilter === 'on_time' }"
                  role="option"
                  :aria-selected="timeFilter === 'on_time'"
                  @click="timeFilter = 'on_time'; showHoursFilterDropdown = false"
                >
                  On time
                </button>
                <button
                  type="button"
                  class="period-option"
                  :class="{ active: timeFilter === 'overtime' }"
                  role="option"
                  :aria-selected="timeFilter === 'overtime'"
                  @click="timeFilter = 'overtime'; showHoursFilterDropdown = false"
                >
                  Overtime
                </button>
              </div>
            </div>
          </div>
          <div ref="reportPeriodSelectorRef" class="report-period-selector">
            <button type="button" class="period-btn" @click="showHoursFilterDropdown = false; showPeriodDropdown = !showPeriodDropdown">
              <span class="period-btn-label">{{ periodLabel }}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div v-if="showPeriodDropdown" class="period-dropdown">
              <button type="button" class="period-option" :class="{ active: reportPeriod === 'thisWeek' }" @click="reportPeriod = 'thisWeek'; showPeriodDropdown = false; showCustomDatePicker = false; fetchReport()">This Week</button>
              <button type="button" class="period-option" :class="{ active: reportPeriod === 'lastWeek' }" @click="reportPeriod = 'lastWeek'; showPeriodDropdown = false; showCustomDatePicker = false; fetchReport()">Last Week</button>
              <button type="button" class="period-option" :class="{ active: reportPeriod === 'custom' }" @click="showPeriodDropdown = false; openCustomDatePicker()">Custom</button>
            </div>
            <div
              v-if="showCustomDatePicker"
              ref="customDatePickerRef"
              class="custom-date-picker"
              :class="{ 'custom-date-picker--flip-up': customDatePickerFlipUp }"
              @click.stop
            >
              <div class="custom-date-header">
                <h3>Custom range</h3>
                <button type="button" class="close-btn" aria-label="Close" @click="showCustomDatePicker = false">×</button>
              </div>
              <p class="custom-date-hint">Pick a start date and an end date, then Apply.</p>
              <div class="custom-date-inputs">
                <div class="date-input-group">
                  <label for="dashboard-custom-start">Start date</label>
                  <input
                    id="dashboard-custom-start"
                    type="date"
                    v-model="customStartDate"
                    :max="customEndDate || undefined"
                  />
                </div>
                <div class="date-input-group">
                  <label for="dashboard-custom-end">End date</label>
                  <input
                    id="dashboard-custom-end"
                    type="date"
                    v-model="customEndDate"
                    :min="customStartDate || undefined"
                  />
                </div>
              </div>
              <div class="custom-date-actions">
                <button type="button" class="btn primary" @click="applyCustomDateRange">Apply</button>
                <button type="button" class="btn secondary" @click="showCustomDatePicker = false">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p v-if="reportError" class="report-error">{{ reportError }}</p>
      <div v-if="reportLoading" class="timesheet-chart-wrap timesheet-loading" aria-label="Loading timesheet data">
        <div class="bar-chart-container">
          <div class="chart-y-axis">
            <span v-for="i in 5" :key="i" class="y-axis-label">—</span>
          </div>
          <div class="chart-area">
            <div class="bars-wrapper">
              <div v-for="i in (reportPeriod === 'custom' ? 5 : 5)" :key="i" class="bar-item-wrapper">
                <div class="bar-item bar-skeleton" :style="{ height: `${20 + (i % 3) * 25}%` }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template v-else>
        <div v-if="reportBarData.length" class="timesheet-chart-wrap" role="img" :aria-label="`Hours worked, total ${formatHoursSimple(reportTotalHours)}`">
          <div class="bar-chart-container">
            <div class="chart-y-axis">
              <span v-for="i in 5" :key="i" class="y-axis-label">
                {{ Math.round(chartScaleMax * (1 - (i - 1) / 4)) }}h
              </span>
            </div>
            <div class="chart-area">
              <div class="bars-wrapper">
                <div
                  v-for="bar in reportBarData"
                  :key="bar.dayIndex"
                  class="bar-item-wrapper"
                >
                  <div
                    class="bar-item"
                    :class="{ 'bar-item-today': bar.isToday, 'bar-item-zero': bar.hours === 0 }"
                    :style="{ height: chartScaleMax > 0 ? `${(bar.hours / chartScaleMax) * 100}%` : '0%' }"
                    :title="`${bar.label}: ${bar.hours > 0 ? formatHours(bar.hours) : '0h'}`"
                  >
                    <span v-if="bar.hours > 0" class="bar-value">{{ formatHoursSimple(bar.hours) }}</span>
                  </div>
                </div>
              </div>
              <!-- Grid lines -->
              <svg class="grid-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                <g class="grid-lines">
                  <line v-for="i in 5" :key="i" :x1="0" :y1="(i - 1) * 25" :x2="100" :y2="(i - 1) * 25" class="grid-line" />
                </g>
              </svg>
            </div>
            <div class="chart-x-axis">
              <span
                v-for="bar in reportBarData"
                :key="bar.dayIndex"
                class="x-axis-label"
                :class="{ 'x-axis-label-today': bar.isToday }"
              >
                {{ bar.label }}
              </span>
            </div>
          </div>
        </div>
        <p v-else class="muted report-empty">No attendance in this period.</p>
      </template>
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
  overflow-x: hidden;
  box-sizing: border-box;
}
.left { min-width: 0; display: flex; flex-direction: column; gap: 1.5rem; width: 100%; }
.hero-report-row { display: grid; grid-template-columns: 1fr; gap: 1.5rem; width: 100%; }

/* Hero Section at Top */
.hero-section-top {
  position: relative;
  border-radius: 20px;
  overflow: hidden;
  min-height: 200px;
  padding: 2.5rem 2rem;
  background: linear-gradient(135deg, rgba(56,189,248,0.18) 0%, var(--bg-secondary) 50%, rgba(30,58,138,0.12) 100%);
  border: 1px solid var(--border-color);
}

.hero-content-top {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.hero-welcome {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.hero-position {
  margin: 0;
  font-size: 1.125rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.hero-hours-display {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0.5rem 0;
}

.hero-hours-value {
  font-size: 2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  transition: color 0.3s ease;
}

.hero-hours-label {
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.8;
}

.hero-cta-top {
  margin-top: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  background: var(--accent-light);
  color: #fff;
  transition: opacity 0.2s, transform 0.05s;
  align-self: flex-start;
}

.hero-cta-top:hover {
  opacity: 0.95;
}

.hero-cta-top:active {
  transform: scale(0.98);
}

.kpi-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
.kpi-card {
  position: relative;
  padding: 1.25rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  min-width: 0;
}
.kpi-icon { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 0.75rem; }
.kpi-icon-green { background: rgba(34,197,94,0.15); color: #22c55e; }
.kpi-icon-blue { background: rgba(59,130,246,0.15); color: #3b82f6; }
.kpi-icon-orange { background: rgba(249,115,22,0.15); color: #f97316; }
.kpi-icon-purple { background: rgba(168,85,247,0.15); color: #a855f7; border-radius: 12px; }
.kpi-comparison {
  font-size: 0.75rem;
  color: #22c55e;
  margin-bottom: 0.5rem;
  font-weight: 500;
  line-height: 1.35;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.kpi-comparison-positive { color: #22c55e; }
.kpi-comparison-negative { color: #f87171; }
.kpi-value { font-size: 2rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem; font-variant-numeric: tabular-nums; line-height: 1.2; }
.kpi-label { font-size: 0.875rem; color: var(--text-secondary); }
@media (max-width: 767px) {
  .kpi-cards { grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
  .kpi-card { padding: 1rem; }
  .kpi-icon { width: 40px; height: 40px; }
  .kpi-icon svg { width: 20px; height: 20px; }
  .kpi-value { font-size: 1.5rem; }
  .kpi-label { font-size: 0.8125rem; }
}

.report-panel { 
  padding: 1.25rem; 
  background: var(--bg-tertiary); 
  border: 1px solid var(--border-color); 
  border-radius: 16px; 
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.report-header { 
  display: flex; 
  flex-direction: column; 
  gap: 0.875rem; 
  margin-bottom: 1rem; 
}

.report-header-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-left: auto;
  min-width: 0;
  justify-content: flex-end;
}

.hours-filter {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.hours-filter-selector {
  position: relative;
}

.report-title { 
  margin: 0; 
  font-size: 1.125rem; 
  font-weight: 600; 
  color: var(--text-primary); 
  letter-spacing: -0.01em;
}

.report-summary { 
  display: flex; 
  flex-wrap: wrap; 
  gap: 0.625rem; 
  font-size: 0.8125rem; 
}

.summary-item { 
  padding: 0.5rem 0.875rem; 
  border-radius: 8px; 
  background: var(--bg-secondary); 
  border: 1px solid var(--border-color); 
  display: flex; 
  align-items: baseline; 
  gap: 0.5rem; 
  transition: background 0.2s, border-color 0.2s;
}

.summary-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-light);
}

.summary-label { 
  font-weight: 500; 
  color: var(--text-secondary); 
  font-size: 0.8125rem;
}

.summary-value { 
  font-weight: 600; 
  color: var(--text-primary); 
  font-variant-numeric: tabular-nums; 
  font-size: 0.875rem;
}
.report-period-selector { 
  display: flex; 
  align-items: center; 
  gap: 0.5rem; 
  position: relative; 
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
}

.period-btn:hover { 
  background: var(--bg-hover); 
  color: var(--text-primary); 
  border-color: var(--border-light);
}

.period-btn-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.period-btn svg {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  transition: transform 0.2s ease;
}

.period-btn:hover svg {
  transform: translateY(1px);
}

.period-dropdown {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  left: auto;
  background: var(--bg-primary);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.375rem;
  min-width: 150px;
  z-index: 10;
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
  background: rgba(56,189,248,0.15); 
  color: var(--accent); 
}

.report-error { 
  color: #f87171; 
  font-size: 0.875rem; 
  margin: 0 0 1rem; 
  padding: 0.75rem;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.2);
  border-radius: 8px;
}

.timesheet-chart-wrap { 
  margin-top: 0; 
  max-width: 100%; 
  overflow: hidden; 
}

.timesheet-loading { 
  pointer-events: none; 
  opacity: 0.6;
}

.bar-skeleton {
  background: linear-gradient(90deg, rgba(148,163,184,0.15) 25%, rgba(148,163,184,0.35) 50%, rgba(148,163,184,0.15) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 4px 4px 0 0;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

/* Bar Chart Styles - Clean & Minimalist */
.bar-chart-container {
  width: 100%;
  max-width: 100%;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: 1fr auto;
  gap: 0.375rem 0.5rem;
  padding: 0.75rem 0.75rem;
  min-height: 150px;
  box-sizing: border-box;
}

.chart-y-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  padding-right: 0.35rem;
  min-width: 38px;
}

.y-axis-label {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.chart-area {
  position: relative;
  width: 100%;
  min-height: 130px;
  overflow: visible;
}

.bars-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 130px;
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  gap: 0.5rem;
  padding: 0 0.25rem;
  z-index: 2;
}

.bar-item-wrapper {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  min-width: 0;
  height: 100%;
}

.bar-item {
  width: 100%;
  max-width: 48px;
  min-height: 2px;
  background: linear-gradient(to top, var(--accent-light), var(--accent));
  border-radius: 4px 4px 0 0;
  position: relative;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 0.25rem;
}

.bar-item:hover {
  opacity: 0.85;
  transform: translateY(-2px);
}

.bar-item-today {
  background: linear-gradient(to top, var(--accent-light), var(--accent));
  box-shadow: 0 2px 8px rgba(14, 165, 233, 0.3);
}

.bar-item-zero {
  background: rgba(148, 163, 184, 0.2);
  min-height: 2px;
}

.bar-value {
  font-size: 0.65rem;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.bar-item:hover .bar-value {
  opacity: 1;
}

.grid-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.grid-lines .grid-line {
  stroke: rgba(255, 255, 255, 0.04);
  stroke-width: 1;
}

.chart-x-axis {
  grid-column: 2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 0.5rem;
  margin-top: 0.25rem;
}

.x-axis-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-weight: 500;
  text-align: center;
  flex: 1;
  min-width: 0;
  line-height: 1.2;
}

.x-axis-label-today {
  color: var(--accent-light);
  font-weight: 600;
}

@media (max-width: 1024px) {
  .bar-chart-container {
    padding: 0.75rem 0.625rem;
    gap: 0.375rem 0.375rem;
    min-height: 150px;
  }
  
  .chart-area {
    min-height: 130px;
  }
  
  .bars-wrapper {
    min-height: 130px;
    gap: 0.375rem;
  }
  
  .bar-item {
    max-width: 40px;
  }
  
  .y-axis-label {
    font-size: 0.65rem;
  }
  
  .x-axis-label {
    font-size: 0.65rem;
  }
}

@media (max-width: 767px) {
  .report-panel {
    padding: 1.25rem 1rem;
  }
  
  .report-header {
    gap: 0.875rem;
    margin-bottom: 1.25rem;
  }
  
  .report-title {
    font-size: 1rem;
  }
  
  .report-summary {
    gap: 0.5rem;
  }
  
  .summary-item {
    padding: 0.4375rem 0.75rem;
    font-size: 0.75rem;
  }
  
  .summary-label {
    font-size: 0.75rem;
  }
  
  .summary-value {
    font-size: 0.8125rem;
  }
  
  .bar-chart-container {
    padding: 0.625rem 0.5rem;
    gap: 0.25rem 0.25rem;
    min-height: 140px;
  }
  
  .chart-y-axis {
    min-width: 32px;
    padding-right: 0.25rem;
  }
  
  .chart-area {
    min-height: 120px;
  }
  
  .bars-wrapper {
    min-height: 120px;
    gap: 0.25rem;
    padding: 0 0.125rem;
  }
  
  .bar-item {
    max-width: 32px;
  }
  
  .bar-value {
    font-size: 0.6rem;
  }
  
  .y-axis-label {
    font-size: 0.65rem;
  }
  
  .x-axis-label {
    font-size: 0.65rem;
    padding: 0 0.125rem;
  }
  
  .period-btn {
    padding: 0.4375rem 0.75rem;
    font-size: 0.75rem;
  }

  .period-dropdown {
    min-width: 140px;
    right: 0;
    left: auto;
  }
}

/* Custom Date Picker — right-aligned; vertical flip via .custom-date-picker--flip-up (see script) */
.custom-date-picker {
  position: absolute;
  top: calc(100% + 0.5rem);
  bottom: auto;
  right: 0;
  left: auto;
  width: min(300px, calc(100vw - 2rem));
  max-width: calc(100vw - 2rem);
  max-height: min(85dvh, calc(100vh - 2rem));
  overflow-y: auto;
  box-sizing: border-box;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.25rem;
  z-index: 20;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.custom-date-picker.custom-date-picker--flip-up {
  top: auto;
  bottom: calc(100% + 0.5rem);
}

.custom-date-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.custom-date-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.custom-date-hint {
  margin: 0 0 0.875rem;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--text-secondary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.2s, color 0.2s;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.custom-date-inputs {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.date-input-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.date-input-group label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.date-input-group input[type="date"] {
  width: 100%;
  box-sizing: border-box;
  min-height: 2.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: inherit;
}

.date-input-group input[type="date"]:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-hover);
}

.custom-date-actions {
  display: flex;
  gap: 0.5rem;
}

.custom-date-actions .btn {
  flex: 1;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s;
}

.custom-date-actions .btn.primary {
  background: var(--accent-light);
  color: #fff;
}

.custom-date-actions .btn.secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.custom-date-actions .btn:hover {
  opacity: 0.9;
}

@media (max-width: 767px) {
  .report-header {
    gap: 0.75rem;
  }

  .report-title {
    width: 100%;
    min-width: 0;
    padding-right: 0;
  }

  /* One row: hours filter | period — equal columns */
  .report-header-right {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: auto;
    gap: 0.5rem;
    width: 100%;
    margin-left: 0;
    align-items: stretch;
  }

  .hours-filter,
  .hours-filter-selector,
  .report-period-selector {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  .report-period-selector {
    justify-content: stretch;
  }

  .hours-filter .period-btn,
  .report-period-selector > .period-btn {
    width: 100%;
    min-width: 0;
    justify-content: space-between;
    overflow: hidden;
  }

  .hours-filter .period-btn {
    text-align: left;
  }

  /* Centered overlay: avoids clipping and `100vw` horizontal scroll next to scrollbars */
  .custom-date-picker,
  .custom-date-picker.custom-date-picker--flip-up {
    position: fixed;
    left: 50%;
    right: auto;
    top: 50%;
    bottom: auto;
    transform: translate(-50%, -50%);
    width: min(320px, calc(100vw - 2rem));
    max-width: calc(100vw - 2rem);
    z-index: 120;
    max-height: min(85dvh, calc(100vh - 4rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
  }
}
.muted { color: var(--text-tertiary); }
.report-empty { margin: 0.5rem 0; font-size: 0.875rem; }

/* Light Mode Overrides for Better Contrast */
:root.light-mode .hero-section-top,
body.light-mode .hero-section-top {
  background: linear-gradient(135deg, rgba(56,189,248,0.12) 0%, var(--bg-secondary) 50%, rgba(59,130,246,0.08) 100%);
}

:root.light-mode .period-dropdown,
body.light-mode .period-dropdown {
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

:root.light-mode .custom-date-picker,
body.light-mode .custom-date-picker {
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

:root.light-mode .period-option.active,
body.light-mode .period-option.active {
  background: rgba(56,189,248,0.2);
  color: #0284c7;
}

:root.light-mode .x-axis-label-today,
body.light-mode .x-axis-label-today {
  color: #0284c7;
}

/* Extra small-screen spacing tweaks (CSS only) */
@media (max-width: 767px) {
  .left {
    gap: 1rem;
  }

  .hero-report-row {
    gap: 1rem;
  }

  .hero-section-top {
    padding: 1.5rem 1rem;
    min-height: 160px;
    border-radius: 16px;
  }

  .hero-hours-display {
    margin: 0.35rem 0;
  }

  .hero-cta-top {
    width: 100%;
    align-self: stretch;
  }

  .kpi-cards {
    margin-bottom: 1rem;
  }
}
</style>
