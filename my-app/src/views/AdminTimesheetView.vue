<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import supabase from '../lib/supabaseClient'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'
import { getSignedProfileUrl } from '../composables/useAuth'
import {
  storedToRealInstant,
  getLocalDateString,
  getBranch,
  parseLocation,
  type AttendanceRow
} from '../composables/useAttendance'

const ATTENDANCE_SELECT =
  'attendance_id,user_id,clock_in,clock_out,facial_status,lunch_break_start,lunch_break_end,total_time,location_in,location_out,branch_location,created_at,updated_at,work_modality,facial_verifications_id,wfh_pic_url,output'

interface EmpLite {
  id: string
  name: string
  email: string
  position_in_company: string | null
  employee_no: string | null
  picture: string | null
}

const employees = ref<EmpLite[]>([])
const loadingEmployees = ref(true)

const error = ref<string | null>(null)

/** Checked rows only — bulk “current month” PDF requires at least one selection. */
const selectedEmployeeIds = ref<Record<string, boolean>>({})
const employeeSearch = ref('')
const employeePage = ref(1)
const EMPLOYEES_PER_PAGE = 25

// Modal (per-employee history)
const activeEmployee = ref<EmpLite | null>(null)
const activeProfileUrl = ref<string | null>(null)
const historyLoading = ref(false)
const historyError = ref<string | null>(null)
const historyRows = ref<AttendanceRow[]>([])
const downloadBusy = ref(false)
const bulkDownloadBusy = ref(false)

type HistoryDateFilter = 'all' | 'today' | 'yesterday' | 'lastWeek' | 'lastMonth' | 'custom'

const historyDateFilter = ref<HistoryDateFilter>('all')
const historyCustomStartDate = ref<string>('')
const historyCustomEndDate = ref<string>('')

/** Modal date period: chevron + teleported menu (same pattern as TimesheetView table filters) */
const showHistoryDateDropdown = ref(false)
const historyDateFilterTriggerRef = ref<HTMLElement | null>(null)
const historyDateDropdownStyle = ref<Record<string, string>>({})
/** Above modal overlay (z-index 2147483647) so the menu is visible and clickable */
const HISTORY_DATE_MENU_Z = '2147483647'

const historyDateFilterLabel = computed(() => {
  switch (historyDateFilter.value) {
    case 'all':
      return 'All'
    case 'today':
      return 'Today'
    case 'yesterday':
      return 'Yesterday'
    case 'lastWeek':
      return 'Last Week'
    case 'lastMonth':
      return 'Last Month'
    case 'custom':
      if (historyCustomStartDate.value && historyCustomEndDate.value) {
        return `${historyCustomStartDate.value} – ${historyCustomEndDate.value}`
      }
      return 'Custom Range'
    default:
      return 'All'
  }
})

function positionHistoryDateDropdown() {
  const el = historyDateFilterTriggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const minW = Math.max(r.width, 180)
  const left = Math.min(Math.max(8, r.left), window.innerWidth - minW - 8)
  const top = r.bottom + 6
  const spaceBelow = window.innerHeight - top - 8
  const estimatedH = 280
  const openUp = spaceBelow < estimatedH && r.top > spaceBelow
  historyDateDropdownStyle.value = {
    position: 'fixed',
    top: openUp ? `${Math.max(8, r.top - 6 - estimatedH)}px` : `${top}px`,
    left: `${left}px`,
    minWidth: `${minW}px`,
    zIndex: HISTORY_DATE_MENU_Z
  }
}

function toggleHistoryDateMenu() {
  showHistoryDateDropdown.value = !showHistoryDateDropdown.value
  if (showHistoryDateDropdown.value) void nextTick(() => positionHistoryDateDropdown())
}

function selectHistoryDateFilter(v: HistoryDateFilter) {
  showHistoryDateDropdown.value = false
  historyDateFilter.value = v
}

function handleHistoryDateFilterClickOutside(event: MouseEvent) {
  if (!showHistoryDateDropdown.value) return
  const target = event.target as HTMLElement
  if (target.closest('.history-date-filter-trigger') || target.closest('.history-date-filter-portal')) return
  showHistoryDateDropdown.value = false
}

watch(showHistoryDateDropdown, (open) => {
  if (open) {
    void nextTick(() => positionHistoryDateDropdown())
    window.addEventListener('scroll', positionHistoryDateDropdown, true)
    window.addEventListener('resize', positionHistoryDateDropdown)
  } else {
    window.removeEventListener('scroll', positionHistoryDateDropdown, true)
    window.removeEventListener('resize', positionHistoryDateDropdown)
  }
})

const WFH_PHOTO_BUCKET = 'wfh_employee_picture'
/** 8h target for undertime / on-time / overtime (per session). */
const TARGET_WORK_SEC = 8 * 3600
const ON_TIME_TOLERANCE_SEC = 120

function parseIntervalToSeconds(interval: string | null): number {
  if (!interval) return 0
  const m = interval.match(/^(\d+):(\d+):(\d+)/)
  if (m) {
    const h = Number(m[1])
    const min = Number(m[2])
    const s = Number(m[3])
    return h * 3600 + min * 60 + s
  }
  return 0
}

function formatTotalTime(interval: string | null): string {
  if (!interval) return '—'
  const sec = parseIntervalToSeconds(interval)
  if (sec > 0 && sec < 60) return `${sec}s`
  const m = interval.match(/^(\d+):(\d+):(\d+)/)
  if (m) {
    const [, h, min] = m.map(Number)
    if (h) return `${h}h ${min}m`
    return `${min}m`
  }
  return interval
}

type TimeCompliance = 'undertime' | 'enough' | 'overtime'

function timeComplianceCategory(r: AttendanceRow): TimeCompliance {
  const sec = parseIntervalToSeconds(r.total_time)
  if (sec < TARGET_WORK_SEC - ON_TIME_TOLERANCE_SEC) return 'undertime'
  if (sec > TARGET_WORK_SEC + ON_TIME_TOLERANCE_SEC) return 'overtime'
  return 'enough'
}

type ModalityFilter = 'all' | 'office' | 'wfh'
type TimeComplianceFilter = 'all' | TimeCompliance

const modalityFilter = ref<ModalityFilter>('all')
const timeComplianceFilter = ref<TimeComplianceFilter>('all')

const filteredHistoryRows = computed(() => {
  let rows = historyRows.value
  if (modalityFilter.value !== 'all') {
    rows = rows.filter((r) => r.work_modality === modalityFilter.value)
  }
  if (timeComplianceFilter.value !== 'all') {
    rows = rows.filter((r) => timeComplianceCategory(r) === timeComplianceFilter.value)
  }
  return rows
})

const sortedFilteredHistoryRows = computed(() =>
  [...filteredHistoryRows.value].sort((a, b) => {
    const ta = a.clock_in ? storedToRealInstant(a.clock_in) : 0
    const tb = b.clock_in ? storedToRealInstant(b.clock_in) : 0
    return tb - ta
  })
)

const HISTORY_ENTRIES_PER_PAGE = 10
const historyDayPage = ref(1)

const historyEntryTotalPages = computed(() =>
  Math.max(1, Math.ceil(sortedFilteredHistoryRows.value.length / HISTORY_ENTRIES_PER_PAGE))
)

const paginatedHistoryRows = computed(() => {
  const list = sortedFilteredHistoryRows.value
  const start = (historyDayPage.value - 1) * HISTORY_ENTRIES_PER_PAGE
  return list.slice(start, start + HISTORY_ENTRIES_PER_PAGE)
})

const detailAttendanceRow = ref<AttendanceRow | null>(null)
const detailMapEl = ref<HTMLElement | null>(null)
let detailMapInstance: L.Map | null = null

function destroyDetailMap() {
  if (detailMapInstance) {
    detailMapInstance.remove()
    detailMapInstance = null
  }
}

function makeClockLabelIcon(label: string, variant: 'in' | 'out'): L.DivIcon {
  return L.divIcon({
    className: 'admin-leaflet-div-marker',
    html: `<div class="admin-map-pin admin-map-pin--${variant}"><span>${label}</span></div>`,
    iconSize: [128, 36],
    iconAnchor: [64, 36]
  })
}

function initDetailMap() {
  destroyDetailMap()
  const r = detailAttendanceRow.value
  const el = detailMapEl.value
  if (!r || !el || !el.isConnected) return
  if (r.work_modality !== 'office') return
  const pIn = parseLocation(r.location_in)
  const pOut = parseLocation(r.location_out)
  if (!pIn && !pOut) return

  detailMapInstance = L.map(el, { scrollWheelZoom: true })
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(detailMapInstance)

  const bounds = L.latLngBounds([])
  if (pIn) {
    L.marker([pIn.lat, pIn.lng], { icon: makeClockLabelIcon('Clock in', 'in') }).addTo(detailMapInstance)
    bounds.extend([pIn.lat, pIn.lng])
  }
  if (pOut) {
    L.marker([pOut.lat, pOut.lng], { icon: makeClockLabelIcon('Clock out', 'out') }).addTo(detailMapInstance)
    bounds.extend([pOut.lat, pOut.lng])
  }
  if (pIn && pOut) {
    L.polyline(
      [
        [pIn.lat, pIn.lng],
        [pOut.lat, pOut.lng]
      ],
      { color: '#2563eb', weight: 3, opacity: 0.85 }
    ).addTo(detailMapInstance)
  }
  if (bounds.isValid()) {
    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    if (ne.lat === sw.lat && ne.lng === sw.lng) {
      detailMapInstance.setView([ne.lat, ne.lng], 16)
    } else {
      detailMapInstance.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 })
    }
  }
  void nextTick(() => detailMapInstance?.invalidateSize())
}

function openAttendanceDetail(r: AttendanceRow) {
  detailAttendanceRow.value = r
}

function closeAttendanceDetail() {
  destroyDetailMap()
  detailAttendanceRow.value = null
}

watch(
  [detailAttendanceRow, detailMapEl],
  async () => {
    await nextTick()
    initDetailMap()
  },
  { flush: 'post' }
)

function officeLocationLabel(r: AttendanceRow): string {
  const b = r.branch_location ? getBranch(r.branch_location) : null
  const parts: string[] = []
  if (b) parts.push(b.name)
  const pin = parseLocation(r.location_in)
  const pout = parseLocation(r.location_out)
  if (pin) parts.push(`In ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`)
  if (pout) parts.push(`Out ${pout.lat.toFixed(5)}, ${pout.lng.toFixed(5)}`)
  return parts.length ? parts.join(' · ') : '—'
}

const wfhSignedUrls = ref<Record<string, string | null>>({})

/** 12-hour times for PDF/UI: `H:MM A.M.` / `P.M.` */
function formatTime12hApm(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const isAm = h < 12
  const h12 = h % 12 || 12
  return `${h12}:${m.toString().padStart(2, '0')} ${isAm ? 'A.M.' : 'P.M.'}`
}

function formatTime12hApmFromStored(stored: string | null): string {
  if (!stored) return '—'
  return formatTime12hApm(new Date(storedToRealInstant(stored)).toISOString())
}

function formatLocalDateFromStored(stored: string | null): string {
  if (!stored) return '—'
  const ms = storedToRealInstant(stored)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  return getLocalDateString(d)
}

function safeFileSlug(s: string): string {
  return (
    s
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'employee'
  )
}

function employeeListInitial(name: string): string {
  return (name || '?').trim().slice(0, 1).toUpperCase() || '?'
}

function publicAssetUrl(file: string): string {
  return `/${file}`.replace(/\/{2,}/g, '/')
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load: ${src}`))
    img.src = src
  })
}

/** Rounded-rectangle clip (~5px radius) with object-fit cover for jsPDF letterhead logos. */
function imageToRoundedLogoPngDataUrl(
  img: HTMLImageElement,
  pixelSize = 256,
  cornerRadiusPx = 5
): string {
  const canvas = document.createElement('canvas')
  canvas.width = pixelSize
  canvas.height = pixelSize
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read logo image')
  const rad = Math.min(cornerRadiusPx, pixelSize / 2 - 0.5)
  ctx.clearRect(0, 0, pixelSize, pixelSize)
  ctx.save()
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, pixelSize, pixelSize, rad)
  } else {
    const x = 0
    const y = 0
    const w = pixelSize
    const h = pixelSize
    const r = rad
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
  }
  ctx.closePath()
  ctx.clip()
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  const scale = Math.max(pixelSize / iw, pixelSize / ih)
  const dw = iw * scale
  const dh = ih * scale
  const dx = (pixelSize - dw) / 2
  const dy = (pixelSize - dh) / 2
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.restore()
  return canvas.toDataURL('image/png')
}

async function loadRoundedLogoDataUrl(src: string): Promise<string> {
  const img = await loadImageElement(src)
  return imageToRoundedLogoPngDataUrl(img)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Modal date range using local calendar days (YYYY-MM-DD).
 * Must match DB convention for `clock_in`: local calendar date + literal `Z` suffix
 * (see useAttendance / AdminEmployeesView `loadAttendanceSnapshot`).
 */
interface HistoryDateBounds {
  startDay: string
  endDay: string
  label: string
}

function getHistoryDateRangeBounds(): HistoryDateBounds | null {
  const today = new Date()

  if (historyDateFilter.value === 'custom') {
    if (!historyCustomStartDate.value || !historyCustomEndDate.value) return null
    const a = new Date(historyCustomStartDate.value + 'T12:00:00')
    const b = new Date(historyCustomEndDate.value + 'T12:00:00')
    const s = a <= b ? a : b
    const e = a <= b ? b : a
    const startDay = getLocalDateString(s)
    const endDay = getLocalDateString(e)
    return { startDay, endDay, label: `${startDay} - ${endDay}` }
  }

  if (historyDateFilter.value === 'all') {
    const endDay = getLocalDateString(today)
    const s = new Date(today)
    s.setFullYear(s.getFullYear() - 3)
    const startDay = getLocalDateString(s)
    return { startDay, endDay, label: `${startDay} - ${endDay}` }
  }

  if (historyDateFilter.value === 'today') {
    const d = getLocalDateString(today)
    return { startDay: d, endDay: d, label: `${d} - ${d}` }
  }

  if (historyDateFilter.value === 'yesterday') {
    const y = new Date(today)
    y.setDate(y.getDate() - 1)
    const d = getLocalDateString(y)
    return { startDay: d, endDay: d, label: `${d} - ${d}` }
  }

  if (historyDateFilter.value === 'lastWeek') {
    const endDay = getLocalDateString(today)
    const s = new Date(today)
    s.setDate(s.getDate() - 6)
    const startDay = getLocalDateString(s)
    return { startDay, endDay, label: `${startDay} - ${endDay}` }
  }

  if (historyDateFilter.value === 'lastMonth') {
    const y = today.getFullYear()
    const m = today.getMonth()
    const monthStart = new Date(y, m - 1, 1)
    const monthEnd = new Date(y, m, 0)
    const startDay = getLocalDateString(monthStart)
    const endDay = getLocalDateString(monthEnd)
    return { startDay, endDay, label: `${startDay} - ${endDay}` }
  }

  return null
}

function localDayRangeToMs(startDay: string, endDay: string): { startMs: number; endMs: number } {
  const startMs = new Date(startDay + 'T00:00:00').getTime()
  const endMs = new Date(endDay + 'T23:59:59.999').getTime()
  return { startMs, endMs }
}

function clockInDbZRange(startDay: string, endDay: string): { dbStart: string; dbEnd: string } {
  return {
    dbStart: `${startDay}T00:00:00.000Z`,
    dbEnd: `${endDay}T23:59:59.999Z`
  }
}

function addCalendarDaysYmd(day: string, delta: number): string {
  const d = new Date(day + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return getLocalDateString(d)
}

const historyDateRangeValid = computed(() => getHistoryDateRangeBounds() !== null)

async function fetchAttendanceForUserInRange(userId: string, bounds: HistoryDateBounds): Promise<AttendanceRow[]> {
  const { startMs, endMs } = localDayRangeToMs(bounds.startDay, bounds.endDay)

  function inRange(row: AttendanceRow): boolean {
    if (!row.clock_in) return false
    const realMs = storedToRealInstant(row.clock_in)
    return realMs >= startMs && realMs <= endMs
  }

  async function queryRange(startDay: string, endDay: string) {
    const { dbStart, dbEnd } = clockInDbZRange(startDay, endDay)
    return supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('user_id', userId)
      .gte('clock_in', dbStart)
      .lte('clock_in', dbEnd)
      .order('clock_in', { ascending: false })
  }

  let { data, error: err } = await queryRange(bounds.startDay, bounds.endDay)
  if (err) throw err

  let raw = (data ?? []) as AttendanceRow[]
  let filtered = raw.filter(inRange)

  if (filtered.length === 0) {
    const wideStart = addCalendarDaysYmd(bounds.startDay, -7)
    const wideEnd = addCalendarDaysYmd(bounds.endDay, 7)
    const fb = await queryRange(wideStart, wideEnd)
    if (fb.error) throw fb.error
    raw = (fb.data ?? []) as AttendanceRow[]
    filtered = raw.filter(inRange)
  }

  if (filtered.length === 0) {
    const lastResort = await supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('user_id', userId)
      .order('clock_in', { ascending: false })
      .limit(2500)
    if (lastResort.error) throw lastResort.error
    raw = (lastResort.data ?? []) as AttendanceRow[]
    filtered = raw.filter(inRange)
  }

  return filtered
}

/** First through last local calendar day of the current month (bulk Download Timesheet). */
function getCurrentCalendarMonthBounds(): HistoryDateBounds {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const monthStart = new Date(y, m, 1)
  const monthEnd = new Date(y, m + 1, 0)
  const startDay = getLocalDateString(monthStart)
  const endDay = getLocalDateString(monthEnd)
  return { startDay, endDay, label: `${startDay} - ${endDay}` }
}

function buildAttendanceTableBodyFromRows(rows: AttendanceRow[]): string[][] {
  const map: Record<
    string,
    Array<{
      date: string
      clockIn: string
      clockOut: string
      lunchIn: string
      lunchOut: string
      total: string
      modality: string
      output: string
    }>
  > = {}

  for (const r of rows) {
    const dateKey = r.clock_in ? getLocalDateString(new Date(storedToRealInstant(r.clock_in))) : '—'
    if (!map[dateKey]) map[dateKey] = []
    map[dateKey].push({
      date: dateKey,
      clockIn: formatTime12hApmFromStored(r.clock_in),
      clockOut: formatTime12hApmFromStored(r.clock_out),
      lunchIn: formatTime12hApmFromStored(r.lunch_break_start),
      lunchOut: formatTime12hApmFromStored(r.lunch_break_end),
      total: formatTotalTime(r.total_time),
      modality: r.work_modality ? String(r.work_modality).toLowerCase() : '—',
      output: (r.output && String(r.output).trim()) || '—'
    })
  }

  const exportRows: Array<[string, string, string, string, string, string, string, string]> = []
  for (const [dateKey, groupRows] of Object.entries(map).sort(([a], [b]) =>
    a === '—' ? 1 : b === '—' ? -1 : new Date(b).getTime() - new Date(a).getTime()
  )) {
    for (const r of groupRows) {
      exportRows.push([dateKey, r.clockIn, r.clockOut, r.lunchIn, r.lunchOut, r.total, r.modality, r.output])
    }
  }

  return exportRows.map(([date, clockIn, clockOut, lunchIn, lunchOut, total, modality, output]) => [
    date,
    clockIn,
    clockOut,
    lunchIn,
    lunchOut,
    total,
    modality,
    output
  ])
}

/** Letterhead copy for exported PDFs (matches company timesheet template). */
const PDF_LETTERHEAD = {
  brand: 'PCWorth',
  ownedByLabel: 'Owned and Operated by:',
  legalName: 'DRJ TECHNOLOGIES TRADING CORP.',
  address: '618 M Earnshaw Street, Sampaloc, Manila, Metro Manila 1008'
} as const

function createTimesheetPdfDocument(
  emp: EmpLite,
  tableBody: string[][],
  dateCoveredLabel: string,
  pcDataUrl: string,
  twDataUrl: string
): jsPDF {
  const marginMm = 14
  const logoMm = 20
  const logoTopMm = 8
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const cx = pageW / 2

  doc.setTextColor(0, 0, 0)
  doc.addImage(pcDataUrl, 'PNG', marginMm, logoTopMm, logoMm, logoMm)
  doc.addImage(twDataUrl, 'PNG', pageW - marginMm - logoMm, logoTopMm, logoMm, logoMm)

  const addressMaxW = pageW - marginMm * 2 - logoMm * 2 - 8
  /** Uniform compact baseline step for letterhead (mm). */
  const letterLineMm = 3.6
  const titleTopGapMm = 12
  const titleBottomGapMm = 10

  let hy = logoTopMm + 3

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text(PDF_LETTERHEAD.brand, cx, hy, { align: 'center' })
  hy += letterLineMm

  doc.setFontSize(9)
  doc.text(PDF_LETTERHEAD.ownedByLabel, cx, hy, { align: 'center' })
  hy += letterLineMm

  doc.setFontSize(10)
  doc.text(PDF_LETTERHEAD.legalName, cx, hy, { align: 'center' })
  hy += letterLineMm

  doc.setFontSize(8.5)
  for (const line of doc.splitTextToSize(PDF_LETTERHEAD.address, addressMaxW)) {
    doc.text(line, cx, hy, { align: 'center' })
    hy += letterLineMm
  }

  const headerBottomY = Math.max(logoTopMm + logoMm, hy) + titleTopGapMm

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('EMPLOYEE TIMESHEET', cx, headerBottomY, { align: 'center' })

  const col1X = marginMm
  const col2X = cx + 6
  const empId = emp.employee_no?.trim() || emp.id
  const position = emp.position_in_company?.trim() || '—'
  let ey = headerBottomY + titleBottomGapMm

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Name: ${emp.name?.trim() || '—'}`, col1X, ey)
  doc.text(`Position: ${position}`, col2X, ey)
  ey += 6
  doc.text(`Email: ${emp.email?.trim() || '—'}`, col1X, ey)
  doc.text(`Date Covered: ${dateCoveredLabel}`, col2X, ey)
  ey += 6
  doc.text(`Employee ID: ${empId}`, col1X, ey)

  const tableStartY = ey + 8

  autoTable(doc, {
    head: [['Date', 'Clock in', 'Clock out', 'Lunch In', 'Lunch Out', 'Total Hours', 'Modality', 'Output']],
    body: tableBody,
    startY: tableStartY,
    styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak', textColor: 0 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: marginMm, right: marginMm },
    tableWidth: pageW - marginMm * 2
  })

  return doc
}

async function downloadBulkCurrentMonthPdf() {
  if (bulkDownloadBusy.value || loadingEmployees.value || !employees.value.length) return
  const ids = employees.value.map((e) => e.id).filter((id) => selectedEmployeeIds.value[id])
  if (!ids.length) return
  bulkDownloadBusy.value = true
  error.value = null
  try {
    const bounds = getCurrentCalendarMonthBounds()
    const emps = employees.value.filter((e) => ids.includes(e.id))
    if (!emps.length) return

    const [pcDataUrl, twDataUrl] = await Promise.all([
      loadRoundedLogoDataUrl(publicAssetUrl('PCWorthLogo.jpg')),
      loadRoundedLogoDataUrl(publicAssetUrl('TimeWorthLogo.png'))
    ])

    const shouldZip = emps.length >= 2
    const zip = shouldZip ? new JSZip() : null

    for (const emp of emps) {
      const rows = await fetchAttendanceForUserInRange(emp.id, bounds)
      const tableBody = buildAttendanceTableBodyFromRows(rows)
      const doc = createTimesheetPdfDocument(emp, tableBody, bounds.label, pcDataUrl, twDataUrl)
      const today = new Date().toISOString().slice(0, 10)
      const pdfName = `timesheet-${safeFileSlug(emp.name)}-${emp.id.slice(0, 8)}-${today}.pdf`
      if (!shouldZip) {
        doc.save(pdfName)
      } else {
        zip!.file(pdfName, doc.output('blob'))
      }
    }

    if (zip) {
      const today = new Date().toISOString().slice(0, 10)
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, `timesheets-current-month-${today}.zip`)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unable to download timesheets.'
  } finally {
    bulkDownloadBusy.value = false
  }
}

async function loadEmployees() {
  loadingEmployees.value = true
  const { data, error: err } = await supabase
    .from('employee')
    .select('id, name, email, position_in_company, employee_no, picture')
    .order('name')
  loadingEmployees.value = false
  if (err) {
    error.value = err.message
    employees.value = []
    return
  }
  employees.value = (data ?? []) as EmpLite[]
  const nextSel: Record<string, boolean> = {}
  for (const e of employees.value) {
    if (selectedEmployeeIds.value[e.id]) nextSel[e.id] = true
  }
  selectedEmployeeIds.value = nextSel
}

const filteredEmployees = computed(() => {
  const q = employeeSearch.value.trim().toLowerCase()
  let rows = employees.value
  if (q) {
    rows = rows.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.position_in_company || '').toLowerCase().includes(q)
    )
  }
  return rows
})

const employeeTotalPages = computed(() =>
  Math.max(1, Math.ceil(filteredEmployees.value.length / EMPLOYEES_PER_PAGE))
)

/** Display-only: calendar month for bulk Download Timesheet (local timezone). */
const currentMonthDisplay = computed(() => {
  const d = new Date()
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
})
const currentMonthIso = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})

const pagedEmployees = computed(() => {
  const list = filteredEmployees.value
  const start = (employeePage.value - 1) * EMPLOYEES_PER_PAGE
  return list.slice(start, start + EMPLOYEES_PER_PAGE)
})

const selectedEmployeeCount = computed(
  () => Object.values(selectedEmployeeIds.value).filter(Boolean).length
)

const allVisibleOnPageSelected = computed(() => {
  const page = pagedEmployees.value
  if (!page.length) return false
  return page.every((e) => !!selectedEmployeeIds.value[e.id])
})

const someVisibleOnPageSelected = computed(() => {
  const page = pagedEmployees.value
  if (!page.length) return false
  return page.some((e) => !!selectedEmployeeIds.value[e.id])
})

function toggleEmployeeSelected(id: string, on: boolean) {
  selectedEmployeeIds.value = { ...selectedEmployeeIds.value, [id]: on }
}

function onSelectPageCheckboxChange(ev: Event) {
  const t = ev.target as HTMLInputElement
  toggleSelectPage(t.checked)
}

function onEmployeeCheckboxChange(id: string, ev: Event) {
  const t = ev.target as HTMLInputElement
  toggleEmployeeSelected(id, t.checked)
}

function toggleSelectPage(on: boolean) {
  const map = { ...selectedEmployeeIds.value }
  for (const e of pagedEmployees.value) map[e.id] = on
  selectedEmployeeIds.value = map
}

watch([filteredEmployees, employeeSearch], () => {
  employeePage.value = 1
})

async function openEmployeeModal(emp: EmpLite) {
  activeEmployee.value = emp
  historyError.value = null
  error.value = null
  historyRows.value = []
  activeProfileUrl.value = null
  historyDateFilter.value = 'all'
  historyCustomStartDate.value = ''
  historyCustomEndDate.value = ''
  modalityFilter.value = 'all'
  timeComplianceFilter.value = 'all'
  historyDayPage.value = 1
  wfhSignedUrls.value = {}
  destroyDetailMap()
  detailAttendanceRow.value = null
  historyLoading.value = true
  try {
    activeProfileUrl.value = await getSignedProfileUrl(emp.picture)
  } finally {
    historyLoading.value = false
  }
  void loadActiveEmployeeHistory()
}

function closeEmployeeModal() {
  showHistoryDateDropdown.value = false
  destroyDetailMap()
  detailAttendanceRow.value = null
  activeEmployee.value = null
  activeProfileUrl.value = null
  historyRows.value = []
  historyError.value = null
  downloadBusy.value = false
  wfhSignedUrls.value = {}
}

async function loadActiveEmployeeHistory() {
  const emp = activeEmployee.value
  if (!emp) return
  historyError.value = null
  const bounds = getHistoryDateRangeBounds()
  if (!bounds) {
    historyRows.value = []
    historyLoading.value = false
    return
  }
  historyLoading.value = true
  try {
    historyRows.value = await fetchAttendanceForUserInRange(emp.id, bounds)
  } catch (e) {
    historyError.value = e instanceof Error ? e.message : 'Unable to load attendance history.'
    historyRows.value = []
  } finally {
    historyLoading.value = false
  }
}

watch(
  [activeEmployee, historyDateFilter, historyCustomStartDate, historyCustomEndDate],
  () => {
    if (!activeEmployee.value) return
    void loadActiveEmployeeHistory()
  }
)

async function downloadActiveEmployeePdf() {
  const emp = activeEmployee.value
  if (!emp || downloadBusy.value || !historyDateRangeValid.value) return
  downloadBusy.value = true
  historyError.value = null
  try {
    const boundsPdf = getHistoryDateRangeBounds()
    if (!boundsPdf) return

    const [pcDataUrl, twDataUrl] = await Promise.all([
      loadRoundedLogoDataUrl(publicAssetUrl('PCWorthLogo.jpg')),
      loadRoundedLogoDataUrl(publicAssetUrl('TimeWorthLogo.png'))
    ])

    const tableBody = buildAttendanceTableBodyFromRows(filteredHistoryRows.value)
    const doc = createTimesheetPdfDocument(emp, tableBody, boundsPdf.label, pcDataUrl, twDataUrl)

    const today = new Date().toISOString().slice(0, 10)
    const rangeSlug = `${boundsPdf.startDay}_to_${boundsPdf.endDay}`
    doc.save(`timesheet-${safeFileSlug(emp.name)}-${rangeSlug}-${today}.pdf`)
  } catch (e) {
    historyError.value = e instanceof Error ? e.message : 'Unable to download timesheet.'
  } finally {
    downloadBusy.value = false
  }
}

watch(
  filteredHistoryRows,
  async (rows) => {
    const prev = wfhSignedUrls.value
    const next: Record<string, string | null> = {}
    for (const r of rows) {
      if (r.work_modality !== 'wfh' || !r.wfh_pic_url) continue
      if (prev[r.attendance_id]) {
        next[r.attendance_id] = prev[r.attendance_id]
        continue
      }
      const { data, error: err } = await supabase.storage
        .from(WFH_PHOTO_BUCKET)
        .createSignedUrl(r.wfh_pic_url, 3600)
      next[r.attendance_id] = err ? null : data?.signedUrl ?? null
    }
    wfhSignedUrls.value = next
  },
  { deep: true }
)

watch([sortedFilteredHistoryRows, modalityFilter, timeComplianceFilter], () => {
  historyDayPage.value = 1
})

onMounted(async () => {
  await loadEmployees()
  document.addEventListener('click', handleHistoryDateFilterClickOutside)
})

onUnmounted(() => {
  destroyDetailMap()
  document.removeEventListener('click', handleHistoryDateFilterClickOutside)
  window.removeEventListener('scroll', positionHistoryDateDropdown, true)
  window.removeEventListener('resize', positionHistoryDateDropdown)
})
</script>

<template>
  <div class="page admin-ts-page">
    <p v-if="error" class="banner-error">{{ error }}</p>

    <div class="admin-ts-layout">
      <aside class="admin-ts-sidebar" aria-label="Employee list">
        <div class="admin-ts-sidebar-card">
          <div class="admin-ts-sidebar-head">
            <h1 class="admin-ts-sidebar-title">Employees</h1>
            <time
              class="panel-month-badge"
              :datetime="currentMonthIso"
              title="Calendar month used for bulk Download Timesheet"
            >
              {{ currentMonthDisplay }}
            </time>
          </div>
          <p class="admin-ts-sidebar-hint">
            Use checkboxes to choose who is included in <strong>Download Timesheet</strong> (current month). Click a name to view their entries on the right.
          </p>
          <input
            v-model="employeeSearch"
            type="search"
            class="employee-search"
            placeholder="Search name, email, position…"
            autocomplete="off"
            aria-label="Search employees"
          />
          <div class="admin-ts-select-row">
            <input
              type="checkbox"
              :checked="allVisibleOnPageSelected"
              :indeterminate.prop="someVisibleOnPageSelected && !allVisibleOnPageSelected"
              aria-label="Select all on this page"
              @change="onSelectPageCheckboxChange"
            />
            <span class="admin-ts-select-label">Select all on page</span>
          </div>

          <div v-if="loadingEmployees" class="loading-state">Loading employees…</div>
          <ul v-else class="admin-ts-emp-list" role="list">
            <li
              v-for="e in pagedEmployees"
              :key="e.id"
              class="admin-ts-emp-item"
              :class="{ 'is-active': activeEmployee?.id === e.id }"
              role="listitem"
              @click="openEmployeeModal(e)"
            >
              <input
                type="checkbox"
                :checked="!!selectedEmployeeIds[e.id]"
                :aria-label="`Include ${e.name} in bulk download`"
                class="admin-ts-emp-check"
                @click.stop
                @change="onEmployeeCheckboxChange(e.id, $event)"
              />
              <div class="admin-ts-emp-avatar" aria-hidden="true">
                {{ employeeListInitial(e.name) }}
              </div>
              <span class="admin-ts-emp-name">{{ e.name }}</span>
            </li>
          </ul>
          <p v-if="!pagedEmployees.length && !loadingEmployees" class="empty-hint admin-ts-empty">No employees match your search.</p>

          <div v-if="filteredEmployees.length > EMPLOYEES_PER_PAGE" class="pager admin-ts-pager">
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="employeePage <= 1"
              @click="employeePage = Math.max(1, employeePage - 1)"
            >
              Previous
            </button>
            <span class="pager-info">
              {{ employeePage }} / {{ employeeTotalPages }}
            </span>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="employeePage >= employeeTotalPages"
              @click="employeePage = Math.min(employeeTotalPages, employeePage + 1)"
            >
              Next
            </button>
          </div>

          <div class="admin-ts-sidebar-actions">
            <button
              type="button"
              class="btn btn-secondary btn-toolbar-refresh"
              :disabled="loadingEmployees || bulkDownloadBusy"
              @click="loadEmployees"
            >
              {{ loadingEmployees ? 'Refreshing…' : 'Refresh' }}
            </button>
            <button
              type="button"
              class="btn btn-primary bulk-pdf-btn"
              :disabled="loadingEmployees || bulkDownloadBusy || !employees.length || !selectedEmployeeCount"
              @click="downloadBulkCurrentMonthPdf"
            >
              {{ bulkDownloadBusy ? 'Preparing…' : 'Download Timesheet' }}
            </button>
          </div>
        </div>
      </aside>

      <main class="admin-ts-main">
        <div v-if="!activeEmployee" class="admin-ts-placeholder">
          <p class="admin-ts-placeholder-title">Select an employee</p>
          <p class="admin-ts-placeholder-text">Choose someone from the list to see their clock entries, dates, and output for the selected period.</p>
        </div>

        <div v-else class="admin-ts-detail-card">
          <div class="admin-ts-detail-head">
            <div class="modal-head">
              <div class="modal-avatar">
                <img v-if="activeProfileUrl" :src="activeProfileUrl" alt="" class="avatar-img" />
                <span v-else class="avatar-fallback">{{ (activeEmployee.name || '?').slice(0, 1).toUpperCase() }}</span>
              </div>
              <div class="modal-head-meta">
                <h2 class="modal-title">{{ activeEmployee.name }}</h2>
                <p class="modal-sub">
                  <span class="pill">ID: {{ activeEmployee.employee_no ?? activeEmployee.id }}</span>
                  <span class="pill">{{ activeEmployee.email }}</span>
                  <span class="pill">{{ activeEmployee.position_in_company || '—' }}</span>
                </p>
              </div>
            </div>
            <button type="button" class="admin-ts-clear-btn" @click="closeEmployeeModal">Close</button>
          </div>

          <p v-if="historyError" class="banner-error admin-ts-banner-tight">{{ historyError }}</p>

          <div class="modal-controls">
            <div class="control control--date-period">
              <span class="control-label">Date</span>
              <div ref="historyDateFilterTriggerRef" class="ts-filter-trigger-wrap history-date-filter-trigger">
                <button
                  type="button"
                  class="period-btn ts-filter-period-btn"
                  aria-haspopup="listbox"
                  :aria-expanded="showHistoryDateDropdown"
                  :aria-label="`Date range, ${historyDateFilterLabel}`"
                  @click.stop="toggleHistoryDateMenu"
                >
                  <ChevronDownIcon class="ts-period-chevron" aria-hidden="true" />
                </button>
                <Teleport to="body">
                  <div
                    v-if="showHistoryDateDropdown"
                    class="history-date-filter-portal ts-filter-dropdown-portal period-dropdown"
                    :style="historyDateDropdownStyle"
                    role="listbox"
                    @click.stop
                  >
                    <button
                      type="button"
                      class="period-option"
                      :class="{ active: historyDateFilter === 'all' }"
                      role="option"
                      :aria-selected="historyDateFilter === 'all'"
                      @click="selectHistoryDateFilter('all')"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      class="period-option"
                      :class="{ active: historyDateFilter === 'today' }"
                      role="option"
                      :aria-selected="historyDateFilter === 'today'"
                      @click="selectHistoryDateFilter('today')"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      class="period-option"
                      :class="{ active: historyDateFilter === 'yesterday' }"
                      role="option"
                      :aria-selected="historyDateFilter === 'yesterday'"
                      @click="selectHistoryDateFilter('yesterday')"
                    >
                      Yesterday
                    </button>
                    <button
                      type="button"
                      class="period-option"
                      :class="{ active: historyDateFilter === 'lastWeek' }"
                      role="option"
                      :aria-selected="historyDateFilter === 'lastWeek'"
                      @click="selectHistoryDateFilter('lastWeek')"
                    >
                      Last Week
                    </button>
                    <button
                      type="button"
                      class="period-option"
                      :class="{ active: historyDateFilter === 'lastMonth' }"
                      role="option"
                      :aria-selected="historyDateFilter === 'lastMonth'"
                      @click="selectHistoryDateFilter('lastMonth')"
                    >
                      Last Month
                    </button>
                    <button
                      type="button"
                      class="period-option"
                      :class="{ active: historyDateFilter === 'custom' }"
                      role="option"
                      :aria-selected="historyDateFilter === 'custom'"
                      @click="selectHistoryDateFilter('custom')"
                    >
                      Custom Range
                    </button>
                  </div>
                </Teleport>
              </div>
            </div>
            <template v-if="historyDateFilter === 'custom'">
              <label class="control">
                <span class="control-label">Start</span>
                <input v-model="historyCustomStartDate" type="date" class="control-input" />
              </label>
              <label class="control">
                <span class="control-label">End</span>
                <input v-model="historyCustomEndDate" type="date" class="control-input" />
              </label>
            </template>
          </div>
          <div class="admin-ts-filters-row">
            <label class="control control--inline">
              <span class="control-label">Modality</span>
              <select v-model="modalityFilter" class="control-input admin-ts-filter-select">
                <option value="all">All</option>
                <option value="office">Office</option>
                <option value="wfh">WFH</option>
              </select>
            </label>
            <label class="control control--inline">
              <span class="control-label">Hours vs 8h</span>
              <select v-model="timeComplianceFilter" class="control-input admin-ts-filter-select">
                <option value="all">All</option>
                <option value="undertime">Undertime</option>
                <option value="enough">On time</option>
                <option value="overtime">Overtime</option>
              </select>
            </label>
          </div>
          <p v-if="historyDateFilter === 'custom' && !historyDateRangeValid" class="muted modal-muted">
            Select a valid start and end date.
          </p>

          <div class="admin-ts-entries-wrap">
            <div v-if="historyLoading" class="loading-state">Loading…</div>
            <template v-else-if="filteredHistoryRows.length">
              <div class="admin-ts-entry-table" role="table" aria-label="Attendance sessions">
                <div class="admin-ts-entry-table-head" role="row">
                  <span role="columnheader">Date</span>
                  <span role="columnheader">Clock in</span>
                  <span role="columnheader">Clock out</span>
                </div>
                <button
                  v-for="r in paginatedHistoryRows"
                  :key="r.attendance_id"
                  type="button"
                  class="admin-ts-entry-row"
                  role="row"
                  @click="openAttendanceDetail(r)"
                >
                  <span class="admin-ts-entry-cell" role="cell">{{ formatLocalDateFromStored(r.clock_in) }}</span>
                  <span class="admin-ts-entry-cell" role="cell">{{ formatTime12hApmFromStored(r.clock_in) }}</span>
                  <span class="admin-ts-entry-cell" role="cell">{{ formatTime12hApmFromStored(r.clock_out) }}</span>
                </button>
              </div>
              <div v-if="historyEntryTotalPages > 1" class="pager admin-ts-history-pager">
                <button
                  type="button"
                  class="btn btn-secondary"
                  :disabled="historyDayPage <= 1"
                  @click="historyDayPage = Math.max(1, historyDayPage - 1)"
                >
                  Previous
                </button>
                <span class="pager-info">
                  {{ historyDayPage }} / {{ historyEntryTotalPages }}
                </span>
                <button
                  type="button"
                  class="btn btn-secondary"
                  :disabled="historyDayPage >= historyEntryTotalPages"
                  @click="historyDayPage = Math.min(historyEntryTotalPages, historyDayPage + 1)"
                >
                  Next
                </button>
              </div>
            </template>
            <p v-else class="empty-hint">No attendance records for this period.</p>
          </div>

          <div class="admin-ts-detail-actions">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="historyLoading || downloadBusy || bulkDownloadBusy || !historyDateRangeValid"
              @click="downloadActiveEmployeePdf"
            >
              {{ downloadBusy ? 'Preparing…' : 'Download Timesheet' }}
            </button>
          </div>
        </div>
      </main>
    </div>

    <Teleport to="body">
      <div
        v-if="detailAttendanceRow"
        class="admin-att-detail-overlay"
        @click.self="closeAttendanceDetail"
      >
        <div
          class="admin-att-detail-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-att-detail-title"
          @click.stop
        >
          <button
            type="button"
            class="admin-att-detail-close"
            aria-label="Close"
            @click="closeAttendanceDetail"
          >
            ×
          </button>
          <h3 id="admin-att-detail-title" class="admin-att-detail-title">Attendance details</h3>
          <template v-if="detailAttendanceRow">
            <div
              v-if="detailAttendanceRow.work_modality === 'wfh' && wfhSignedUrls[detailAttendanceRow.attendance_id]"
              class="admin-att-detail-wfh"
            >
              <img
                :src="wfhSignedUrls[detailAttendanceRow.attendance_id] || undefined"
                alt="WFH verification photo"
                class="admin-wfh-photo"
              />
            </div>
            <div
              v-if="
                detailAttendanceRow.work_modality === 'office' &&
                (parseLocation(detailAttendanceRow.location_in) || parseLocation(detailAttendanceRow.location_out))
              "
              class="admin-detail-map-wrap"
            >
              <div ref="detailMapEl" class="admin-detail-map" />
              <p class="admin-detail-map-caption">{{ officeLocationLabel(detailAttendanceRow) }}</p>
            </div>
            <div class="admin-entry-grid admin-entry-grid--detail">
              <div class="admin-entry-field">
                <span class="admin-entry-lbl">Date</span>
                <span class="admin-entry-val">{{ formatLocalDateFromStored(detailAttendanceRow.clock_in) }}</span>
              </div>
              <div class="admin-entry-field">
                <span class="admin-entry-lbl">Clock in</span>
                <span class="admin-entry-val">{{ formatTime12hApmFromStored(detailAttendanceRow.clock_in) }}</span>
              </div>
              <div class="admin-entry-field">
                <span class="admin-entry-lbl">Clock out</span>
                <span class="admin-entry-val">{{ formatTime12hApmFromStored(detailAttendanceRow.clock_out) }}</span>
              </div>
              <div class="admin-entry-field">
                <span class="admin-entry-lbl">Lunch in</span>
                <span class="admin-entry-val">{{ formatTime12hApmFromStored(detailAttendanceRow.lunch_break_start) }}</span>
              </div>
              <div class="admin-entry-field">
                <span class="admin-entry-lbl">Lunch out</span>
                <span class="admin-entry-val">{{ formatTime12hApmFromStored(detailAttendanceRow.lunch_break_end) }}</span>
              </div>
              <div class="admin-entry-field">
                <span class="admin-entry-lbl">Total hours</span>
                <span class="admin-entry-val">{{ formatTotalTime(detailAttendanceRow.total_time) }}</span>
              </div>
              <div class="admin-entry-field">
                <span class="admin-entry-lbl">Modality</span>
                <span class="admin-entry-val">{{
                  detailAttendanceRow.work_modality ? String(detailAttendanceRow.work_modality).toLowerCase() : '—'
                }}</span>
              </div>
              <div class="admin-entry-field">
                <span class="admin-entry-lbl">Facial status</span>
                <span class="admin-entry-val">{{ detailAttendanceRow.facial_status?.trim() || '—' }}</span>
              </div>
              <div
                v-if="
                  detailAttendanceRow.work_modality === 'office' &&
                  !parseLocation(detailAttendanceRow.location_in) &&
                  !parseLocation(detailAttendanceRow.location_out)
                "
                class="admin-entry-field admin-entry-field--wide"
              >
                <span class="admin-entry-lbl">Location</span>
                <span class="admin-entry-val">{{ officeLocationLabel(detailAttendanceRow) }}</span>
              </div>
            </div>
            <div class="admin-entry-output">
              <span class="admin-entry-lbl">Output</span>
              <p class="admin-entry-output-text">{{ detailAttendanceRow.output?.trim() || '—' }}</p>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 100%;
}

.admin-ts-page {
  min-height: calc(100vh - 120px);
}

.admin-ts-layout {
  display: flex;
  gap: 1.25rem;
  align-items: stretch;
  max-width: 1600px;
  margin: 0 auto;
}

.admin-ts-sidebar {
  flex: 0 0 min(320px, 34vw);
  min-width: 0;
}

.admin-ts-sidebar-card {
  background: var(--bg-secondary, #fff);
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 14px;
  padding: 1rem 0.9rem 1rem;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 420px;
}

.admin-ts-sidebar-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.admin-ts-sidebar-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
}

.admin-ts-sidebar-hint {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--text-secondary);
}

.admin-ts-select-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.admin-ts-select-row input {
  cursor: pointer;
}

.admin-ts-select-label {
  user-select: none;
}

.admin-ts-emp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(52vh, 420px);
  overflow-y: auto;
}

.admin-ts-emp-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.5rem;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.admin-ts-emp-item:hover {
  background: rgba(148, 163, 184, 0.12);
}

.admin-ts-emp-item.is-active {
  background: rgba(148, 163, 184, 0.22);
}

.admin-ts-emp-check {
  flex-shrink: 0;
  cursor: pointer;
}

.admin-ts-emp-avatar {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: linear-gradient(145deg, #64748b, #475569);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.admin-ts-emp-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-ts-empty {
  padding: 0.5rem 0;
}

.admin-ts-pager {
  margin-top: 0;
  padding-top: 0.5rem;
  border-top: none;
}

.admin-ts-sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}

.admin-ts-main {
  flex: 1;
  min-width: 0;
}

.admin-ts-placeholder {
  background: var(--bg-secondary, #fff);
  border: 1px dashed var(--border-light, #cbd5e1);
  border-radius: 14px;
  padding: 2.5rem 1.5rem;
  text-align: center;
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.admin-ts-placeholder-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.admin-ts-placeholder-text {
  margin: 0;
  max-width: 28rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.admin-ts-detail-card {
  background: var(--bg-secondary, #fff);
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 14px;
  padding: 1rem 1.1rem 1.25rem;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.admin-ts-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}

.admin-ts-clear-btn {
  flex-shrink: 0;
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.admin-ts-clear-btn:hover {
  background: rgba(148, 163, 184, 0.15);
}

.admin-ts-banner-tight {
  margin: 0.5rem 0 0;
}

.admin-ts-entries-wrap {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.admin-entry-card {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 12px;
  padding: 0.85rem 1rem;
  background: var(--bg-tertiary, #f8fafc);
}

.admin-entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.65rem 1rem;
}

.admin-entry-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.admin-entry-field--wide {
  grid-column: 1 / -1;
}

.admin-entry-lbl {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary, #64748b);
}

.admin-entry-val {
  font-size: 0.8125rem;
  color: var(--text-primary);
  word-break: break-word;
}

.admin-entry-output {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-light, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.admin-entry-output-text {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.admin-ts-filters-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  margin-top: 0.75rem;
  align-items: flex-end;
}

.admin-ts-filter-select {
  min-width: 10rem;
}

.control--inline {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.admin-ts-entry-table {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
}

.admin-ts-entry-table-head {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary, #f1f5f9);
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary, #64748b);
}

.admin-ts-entry-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.5rem;
  width: 100%;
  padding: 0.65rem 0.75rem;
  border: none;
  border-top: 1px solid var(--border-light, #e2e8f0);
  background: var(--bg-tertiary, #f8fafc);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--text-primary);
  transition: background 0.15s ease;
}

.admin-ts-entry-row:hover {
  background: rgba(148, 163, 184, 0.12);
}

.admin-ts-entry-cell {
  font-size: 0.8125rem;
  word-break: break-word;
}

.admin-wfh-photo {
  max-width: 100%;
  max-height: 200px;
  border-radius: 10px;
  object-fit: contain;
  border: 1px solid var(--border-light);
  background: var(--bg-secondary);
}

.admin-att-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.admin-att-detail-dialog {
  position: relative;
  max-width: 36rem;
  width: 100%;
  max-height: min(90vh, 720px);
  overflow-y: auto;
  background: var(--bg-secondary, #fff);
  border-radius: 14px;
  padding: 1.25rem 1.35rem 1.35rem;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-light, #e2e8f0);
}

.admin-att-detail-close {
  position: absolute;
  top: 0.65rem;
  right: 0.65rem;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 8px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary, #f1f5f9);
  color: var(--text-secondary);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.admin-att-detail-close:hover {
  background: rgba(148, 163, 184, 0.2);
}

.admin-att-detail-title {
  margin: 0 0 1rem;
  padding-right: 2.5rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.admin-att-detail-wfh {
  margin-bottom: 1rem;
}

.admin-detail-map-wrap {
  margin-bottom: 1rem;
}

.admin-detail-map {
  height: 220px;
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border-light);
  background: #e2e8f0;
}

.admin-detail-map :deep(.admin-leaflet-div-marker) {
  background: transparent;
  border: none;
}

.admin-detail-map :deep(.admin-map-pin) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.28rem 0.55rem;
  border-radius: 8px;
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.admin-detail-map :deep(.admin-map-pin--in) {
  background: #16a34a;
  color: #fff;
}

.admin-detail-map :deep(.admin-map-pin--out) {
  background: #dc2626;
  color: #fff;
}

.admin-detail-map-caption {
  margin: 0.4rem 0 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--text-secondary);
  word-break: break-word;
}

.admin-entry-grid--detail {
  margin-top: 0;
}

.admin-ts-history-pager {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}

.admin-ts-detail-actions {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}

@media (max-width: 960px) {
  .admin-ts-layout {
    flex-direction: column;
  }

  .admin-ts-sidebar {
    flex: none;
    width: 100%;
    max-width: none;
  }

  .admin-ts-emp-list {
    max-height: 280px;
  }
}

.employee-panel {
  margin-bottom: 1rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 14px;
  padding: 0.9rem 1rem 1rem;
}
.panel-head {
  margin-bottom: 0.75rem;
}
.panel-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 0.85rem;
  margin-bottom: 0.35rem;
}
.panel-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}
.panel-month-badge {
  display: inline-block;
  flex-shrink: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  font-variant-numeric: tabular-nums;
}
.panel-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
.employee-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.employee-search {
  flex: 1;
  min-width: 200px;
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.875rem;
}
.employee-table-wrap {
  overflow-x: auto;
}
.data-table--compact th,
.data-table--compact td {
  padding: 0.5rem 0.65rem;
  font-size: 0.8125rem;
}
.th-check,
.td-check {
  width: 2.25rem;
  text-align: center;
  vertical-align: middle;
}
.th-view,
.td-view {
  width: 3.25rem;
  text-align: center;
  vertical-align: middle;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 28px;
  border-radius: 10px;
  border: 1px solid var(--border-light);
  background: none;
  color: var(--text-primary);
  cursor: pointer;
}
.icon-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.icon-16 {
  width: 16px;
  height: 16px;
}
.th-check input,
.td-check input {
  cursor: pointer;
}
.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color);
}
.pager-info {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}
.employee-table-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color);
}
.banner-error {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  background: rgba(248, 113, 113, 0.12);
  color: var(--error, #f87171);
  border: 1px solid rgba(248, 113, 113, 0.18);
}
.controls {
  margin-bottom: 1rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 14px;
  padding: 0.9rem 1rem;
}
.controls-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}
.control {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 160px;
}
.control-label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-weight: 600;
}
.control-input {
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.875rem;
}
.btn {
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-weight: 700;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-secondary {
  background: var(--bg-secondary, #e2e8f0);
  color: var(--text-primary, #334155);
}
.btn-secondary:hover:not(:disabled) {
  opacity: 0.9;
}
/* Match TimesheetView.vue "Download PDF" primary action */
.btn-primary {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  border: none;
  background: var(--accent, #0d9488);
  color: #fff;
  transition: opacity 0.2s;
}
.btn-primary:hover:not(:disabled) {
  opacity: 0.92;
}
.btn-primary:disabled {
  opacity: 0.5;
}
/* Toolbar refresh: same metrics as Download Timesheet (.btn-primary), secondary colors */
.btn-toolbar-refresh.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
}
.muted {
  margin: 0.5rem 0 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
}
.modal-muted {
  margin: 0.35rem 0 0;
}
.loading-state {
  padding: 1.25rem 1rem;
  color: var(--text-secondary);
}
.table-card {
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.table-scroll {
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.data-table th {
  text-align: left;
  padding: 0.75rem 1rem;
  color: var(--text-tertiary);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}
.data-table td {
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
}
.data-row:last-child td {
  border-bottom: none;
}
.td-muted {
  color: var(--text-secondary);
}
.th-name,
.cell-name {
  min-width: 13rem;
}
.cell-name {
  font-weight: 700;
  color: var(--text-primary);
}
.cell-email {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  margin-top: 0.15rem;
}
.empty-hint {
  margin: 0;
  padding: 0.75rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 2147483647;
  background: rgba(0, 0, 0, 0.45);
}
.modal-panel {
  width: 100%;
  max-width: 980px;
  max-height: 92vh;
  overflow: auto;
  border-radius: 16px;
  border: 1px solid var(--border-light);
  background: var(--bg-secondary);
  padding: 1rem 1rem 1.25rem;
  position: relative;
}
.modal-close {
  position: absolute;
  right: 10px;
  top: 10px;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}
.modal-head {
  display: flex;
  gap: 0.9rem;
  align-items: center;
}
.modal-avatar {
  width: 54px;
  height: 54px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  overflow: hidden;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-fallback {
  font-weight: 800;
  color: var(--text-primary);
}
.modal-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--text-primary);
}
.modal-sub {
  margin: 0.25rem 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.pill {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.modal-controls {
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
}

.control--date-period {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.ts-filter-trigger-wrap {
  position: relative;
  flex: 0 0 auto;
}

.ts-filter-period-btn.period-btn {
  width: auto;
  min-width: 1.75rem;
  justify-content: center;
  padding: 0.35rem;
  font-size: 0.75rem;
  border-radius: 8px;
  border: none;
  background: transparent;
  box-shadow: none;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.ts-filter-period-btn.period-btn:hover,
.ts-filter-period-btn.period-btn:focus,
.ts-filter-period-btn.period-btn:focus-visible,
.ts-filter-period-btn.period-btn:active {
  background: transparent;
  border: none;
  box-shadow: none;
  outline: none;
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
  box-sizing: border-box;
}

.period-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-light);
}

.ts-period-chevron {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  color: var(--text-secondary);
  transition: transform 0.2s ease;
}

.period-btn:hover .ts-period-chevron {
  color: var(--text-primary);
  transform: translateY(1px);
}

.ts-filter-dropdown-portal.period-dropdown {
  box-sizing: border-box;
  margin: 0;
  padding: 0.375rem;
  background: var(--bg-primary);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  min-width: 150px;
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
  background: rgba(56, 189, 248, 0.15);
  color: var(--accent);
}

.history-table-card {
  margin-top: 0.75rem;
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.history-table-card .table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.modal-timesheet-table {
  width: max-content;
  min-width: 100%;
  table-layout: auto;
}
.modal-timesheet-table th,
.modal-timesheet-table td {
  white-space: nowrap;
  padding: 0.55rem 0.75rem;
}
.modal-timesheet-table td.td-activity {
  white-space: normal;
  max-width: 14rem;
  min-width: 7rem;
  word-break: break-word;
  line-height: 1.35;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  padding: 0.9rem 1rem 1rem;
  border-top: 1px solid var(--border-color);
}

/* —— Mobile: tighter layout, readable data density —— */
@media (max-width: 640px) {
  .employee-panel {
    margin-bottom: 0.65rem;
    padding: 0.6rem 0.65rem 0.7rem;
    border-radius: 12px;
  }
  .panel-head {
    margin-bottom: 0.45rem;
  }
  .panel-title-row {
    margin-bottom: 0.3rem;
    gap: 0.4rem 0.6rem;
  }
  .panel-title {
    font-size: 0.9375rem;
  }
  .panel-month-badge {
    font-size: 0.75rem;
    padding: 0.28rem 0.55rem;
  }
  .panel-hint {
    font-size: 0.75rem;
    line-height: 1.35;
  }
  .employee-toolbar {
    gap: 0.45rem;
    margin-bottom: 0.45rem;
  }
  .employee-search {
    min-width: 0;
    width: 100%;
    flex: 1 1 100%;
    padding: 0.42rem 0.55rem;
    font-size: 0.8125rem;
    border-radius: 8px;
  }
  .employee-table-actions {
    gap: 0.45rem;
    margin-top: 0.45rem;
    padding-top: 0.45rem;
  }
  .employee-table-actions .btn,
  .employee-table-actions .btn-secondary {
    padding: 0.45rem 0.65rem;
    font-size: 0.75rem;
    border-radius: 999px;
  }
  .employee-table-actions .btn.btn-primary {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 8px;
  }
  .employee-table-actions .btn.btn-toolbar-refresh.btn-secondary {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 8px;
  }
  .data-table--compact th,
  .data-table--compact td {
    padding: 0.35rem 0.4rem;
    font-size: 0.75rem;
  }
  .th-check,
  .td-check {
    width: 2rem;
  }
  .th-view,
  .td-view {
    width: 2.85rem;
  }
  .th-name,
  .cell-name {
    min-width: 14.5rem;
  }
  .icon-btn {
    width: 30px;
    height: 26px;
    border-radius: 8px;
  }
  .icon-16 {
    width: 14px;
    height: 14px;
  }
  .pager {
    gap: 0.45rem;
    margin-top: 0.45rem;
    padding-top: 0.45rem;
  }
  .pager-info {
    font-size: 0.72rem;
    text-align: center;
    width: 100%;
    order: -1;
  }
  .pager .btn-secondary {
    flex: 1;
    min-width: 0;
  }
  .table-card {
    border-radius: 12px;
  }
  .table-card .empty-hint {
    padding: 0.55rem 0.6rem;
    font-size: 0.72rem;
    line-height: 1.35;
  }
  .banner-error {
    margin: 0 0 0.6rem;
    padding: 0.5rem 0.65rem;
    font-size: 0.8125rem;
    border-radius: 8px;
  }
  .loading-state {
    padding: 0.65rem 0.6rem;
    font-size: 0.8125rem;
  }

  .modal-overlay {
    padding: 0.35rem;
    align-items: center;
  }
  .modal-panel {
    width: 100%;
    max-width: none;
    max-height: 96vh;
    margin: 0;
    padding: 0.55rem 0.6rem 0.65rem;
    padding-top: 2.5rem;
    border-radius: 14px;
    box-sizing: border-box;
  }
  .modal-close {
    right: 8px;
    top: 8px;
    width: 32px;
    height: 32px;
    font-size: 18px;
  }
  .modal-head {
    gap: 0.5rem;
    align-items: flex-start;
  }
  .modal-avatar {
    width: 44px;
    height: 44px;
  }
  .modal-title {
    font-size: 0.95rem;
    line-height: 1.25;
  }
  .modal-sub {
    gap: 0.3rem;
    margin-top: 0.2rem;
  }
  .pill {
    font-size: 0.6875rem;
    padding: 0.12rem 0.38rem;
  }
  .modal-controls {
    margin-top: 0.55rem;
    gap: 0.4rem;
  }
  .modal-controls .control {
    min-width: 0;
    flex: 1 1 auto;
  }
  .modal-controls .control-label {
    font-size: 0.72rem;
  }
  .modal-controls .control-input {
    padding: 0.4rem 0.5rem;
    font-size: 0.8125rem;
    border-radius: 8px;
  }
  .modal-muted {
    margin-top: 0.25rem;
    font-size: 0.75rem;
  }
  .history-table-card {
    margin-top: 0.45rem;
    border-radius: 10px;
  }
  .modal-timesheet-table th,
  .modal-timesheet-table td {
    padding: 0.3rem 0.4rem;
    font-size: 0.72rem;
  }
  .modal-timesheet-table td.td-activity {
    max-width: 9rem;
    min-width: 5.5rem;
    font-size: 0.6875rem;
  }
  .empty-hint {
    padding: 0.5rem 0.45rem;
    font-size: 0.72rem;
  }
  .modal-actions {
    padding: 0.5rem 0.55rem 0.55rem;
  }
  .modal-actions .btn.btn-primary {
    display: inline-flex;
    width: 100%;
    box-sizing: border-box;
    justify-content: center;
    align-items: center;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 8px;
  }
}

:root.light-mode .ts-filter-dropdown-portal.period-dropdown,
body.light-mode .ts-filter-dropdown-portal.period-dropdown {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

:root.light-mode .period-option.active,
body.light-mode .period-option.active {
  background: rgba(56, 189, 248, 0.2);
  color: #0284c7;
}
</style>

