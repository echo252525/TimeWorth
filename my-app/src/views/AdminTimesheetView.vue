<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import supabase from '../lib/supabaseClient'
import { EyeIcon } from '@heroicons/vue/24/outline'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'
import { getSignedProfileUrl } from '../composables/useAuth'
import {
  storedToRealInstant,
  getLocalDateString,
  getBranch,
  isTravelFlagged,
  type AttendanceRow
} from '../composables/useAttendance'

const ATTENDANCE_SELECT =
  'attendance_id,user_id,clock_in,clock_out,facial_status,lunch_break_start,lunch_break_end,total_time,location_in,location_out,branch_location,created_at,updated_at,work_modality,facial_verifications_id,wfh_pic_url'

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

type HistoryDateFilter = 'today' | 'yesterday' | 'last7Days' | 'lastMonth' | 'custom'

const historyDateFilter = ref<HistoryDateFilter>('lastMonth')
const historyCustomStartDate = ref<string>('')
const historyCustomEndDate = ref<string>('')

function formatTotalTime(interval: string | null): string {
  if (!interval) return '—'
  const m = interval.match(/^(\d+):(\d+):(\d+)/)
  if (m) {
    const [, h, min] = m.map(Number)
    if (h) return `${h}h ${min}m`
    return `${min}m`
  }
  return interval
}

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

  if (historyDateFilter.value === 'last7Days') {
    const endDay = getLocalDateString(today)
    const s = new Date(today)
    s.setDate(s.getDate() - 6)
    const startDay = getLocalDateString(s)
    return { startDay, endDay, label: `${startDay} - ${endDay}` }
  }

  const y = today.getFullYear()
  const m = today.getMonth()
  const monthStart = new Date(y, m - 1, 1)
  const monthEnd = new Date(y, m, 0)
  const startDay = getLocalDateString(monthStart)
  const endDay = getLocalDateString(monthEnd)
  return { startDay, endDay, label: `${startDay} - ${endDay}` }
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

/** Same labels as the PDF “Activity” column (travel / location flags). */
function attendanceActivityLabel(r: AttendanceRow): string {
  const v = isTravelFlagged(r)
  return v === 'travel'
    ? 'Suspicious location activity'
    : v === 'possible_travel'
      ? 'Possible suspicious location activity'
      : '—'
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
      travel: string
      branch: string
    }>
  > = {}

  for (const r of rows) {
    const dateKey = r.clock_in ? getLocalDateString(new Date(storedToRealInstant(r.clock_in))) : '—'
    if (!map[dateKey]) map[dateKey] = []
    const branch = r.branch_location ? getBranch(r.branch_location) : null
    map[dateKey].push({
      date: dateKey,
      clockIn: formatTime12hApmFromStored(r.clock_in),
      clockOut: formatTime12hApmFromStored(r.clock_out),
      lunchIn: formatTime12hApmFromStored(r.lunch_break_start),
      lunchOut: formatTime12hApmFromStored(r.lunch_break_end),
      total: formatTotalTime(r.total_time),
      modality: r.work_modality ? String(r.work_modality).toLowerCase() : '—',
      travel: attendanceActivityLabel(r),
      branch: branch?.name ?? '—'
    })
  }

  const exportRows: Array<[string, string, string, string, string, string, string, string, string]> = []
  for (const [dateKey, groupRows] of Object.entries(map).sort(([a], [b]) =>
    a === '—' ? 1 : b === '—' ? -1 : new Date(b).getTime() - new Date(a).getTime()
  )) {
    for (const r of groupRows) {
      exportRows.push([dateKey, r.clockIn, r.clockOut, r.lunchIn, r.lunchOut, r.total, r.modality, r.branch, r.travel])
    }
  }

  return exportRows.map(
    ([date, clockIn, clockOut, lunchIn, lunchOut, total, modality, _branch, travel]) => [
      date,
      clockIn,
      clockOut,
      lunchIn,
      lunchOut,
      total,
      modality,
      travel
    ]
  )
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
    head: [
      ['Date', 'Clock in', 'Clock out', 'Lunch In', 'Lunch Out', 'Total Hours', 'Modality', 'Activity']
    ],
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
  historyDateFilter.value = 'last7Days'
  historyCustomStartDate.value = ''
  historyCustomEndDate.value = ''
  historyLoading.value = true
  try {
    activeProfileUrl.value = await getSignedProfileUrl(emp.picture)
  } finally {
    historyLoading.value = false
  }
  void loadActiveEmployeeHistory()
}

function closeEmployeeModal() {
  activeEmployee.value = null
  activeProfileUrl.value = null
  historyRows.value = []
  historyError.value = null
  downloadBusy.value = false
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

    const tableBody = buildAttendanceTableBodyFromRows(historyRows.value)
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

onMounted(async () => {
  await loadEmployees()
})
</script>

<template>
  <div class="page">
    <p v-if="error" class="banner-error">{{ error }}</p>

    <section class="employee-panel" aria-label="Employees">
      <div class="panel-head">
        <div class="panel-title-row">
          <h1 class="panel-title">Employees</h1>
          <time
            class="panel-month-badge"
            :datetime="currentMonthIso"
            title="Calendar month used for Download Timesheet"
          >
            {{ currentMonthDisplay }}
          </time>
        </div>
        <p class="panel-hint">
          Click <strong>Download Timesheet</strong> to download this month’s timesheet for the selected employees. For other date ranges, open an
          employee using <strong>View</strong> and use <strong>Download Timesheet</strong> there.
        </p>
      </div>
      <div class="employee-toolbar">
        <input
          v-model="employeeSearch"
          type="search"
          class="employee-search"
          placeholder="Search name, email, position…"
          autocomplete="off"
          aria-label="Search employees"
        />
      </div>
      <div v-if="loadingEmployees" class="loading-state">Loading employees…</div>
      <template v-else>
        <div class="employee-table-wrap">
          <table class="data-table data-table--compact">
            <thead>
              <tr>
                <th class="th-check" scope="col">
                  <input
                    type="checkbox"
                    :checked="allVisibleOnPageSelected"
                    :indeterminate.prop="someVisibleOnPageSelected && !allVisibleOnPageSelected"
                    aria-label="Select all on this page"
                    @change="toggleSelectPage(($event.target as HTMLInputElement).checked)"
                  />
                </th>
                <th class="th-name" scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Position</th>
                <th class="th-view" scope="col">View</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in pagedEmployees" :key="e.id" class="data-row">
                <td class="td-check">
                  <input
                    type="checkbox"
                    :checked="!!selectedEmployeeIds[e.id]"
                    :aria-label="`Select ${e.name}`"
                    @change="toggleEmployeeSelected(e.id, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td class="cell-name">{{ e.name }}</td>
                <td class="td-muted">{{ e.email }}</td>
                <td class="td-muted">{{ e.position_in_company || '—' }}</td>
                <td class="td-view">
                  <button type="button" class="icon-btn" :aria-label="`View ${e.name}`" @click.stop="openEmployeeModal(e)">
                    <EyeIcon class="icon-16" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!pagedEmployees.length && !loadingEmployees" class="empty-hint">No employees match your search.</div>
          <div v-if="filteredEmployees.length > EMPLOYEES_PER_PAGE" class="pager">
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="employeePage <= 1"
              @click="employeePage = Math.max(1, employeePage - 1)"
            >
              Previous
            </button>
            <span class="pager-info">
              Page {{ employeePage }} / {{ employeeTotalPages }} · {{ filteredEmployees.length }} total
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
        </div>
        <div class="employee-table-actions">
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
      </template>
    </section>

    <div class="table-card">
      <p class="empty-hint">
        Tick the row <strong>checkboxes</strong> for who to include, then click <strong>Download Timesheet</strong> below the table (current month; disabled until someone is selected).
        For <strong>other dates</strong>, click <strong>View</strong>, pick the period, then use <strong>Download Timesheet</strong> at the bottom of the window.
      </p>
    </div>

    <Teleport to="body">
      <div v-if="activeEmployee" class="modal-overlay" @click.self="closeEmployeeModal">
        <div class="modal-panel" role="dialog" aria-modal="true" aria-label="Employee timesheet">
          <button type="button" class="modal-close" aria-label="Close" @click="closeEmployeeModal">&times;</button>

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

          <p v-if="historyError" class="banner-error" style="margin-top:0.75rem">{{ historyError }}</p>

          <div class="modal-controls">
            <label class="control">
              <span class="control-label">Date</span>
              <select v-model="historyDateFilter" class="control-input">
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7Days">Last 7 Days</option>
                <option value="lastMonth">Last Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </label>
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
          <p v-if="historyDateFilter === 'custom' && !historyDateRangeValid" class="muted modal-muted">
            Select a valid start and end date.
          </p>

          <div class="history-table-card">
            <div v-if="historyLoading" class="loading-state">Loading…</div>
            <template v-else>
              <div v-if="historyRows.length" class="table-scroll">
                <table class="data-table modal-timesheet-table">
                  <thead>
                    <tr>
                      <th scope="col">Date Covered</th>
                      <th scope="col">Clock in</th>
                      <th scope="col">Clock out</th>
                      <th scope="col">Lunch In</th>
                      <th scope="col">Lunch Out</th>
                      <th scope="col">Total Hours</th>
                      <th scope="col">Modality</th>
                      <th scope="col">Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in historyRows" :key="r.attendance_id" class="data-row">
                      <td class="td-muted">{{ formatLocalDateFromStored(r.clock_in) }}</td>
                      <td class="td-muted">{{ formatTime12hApmFromStored(r.clock_in) }}</td>
                      <td class="td-muted">{{ formatTime12hApmFromStored(r.clock_out) }}</td>
                      <td class="td-muted">{{ formatTime12hApmFromStored(r.lunch_break_start) }}</td>
                      <td class="td-muted">{{ formatTime12hApmFromStored(r.lunch_break_end) }}</td>
                      <td class="td-muted">{{ formatTotalTime(r.total_time) }}</td>
                      <td class="td-muted">{{ r.work_modality ? String(r.work_modality).toLowerCase() : '—' }}</td>
                      <td class="td-muted td-activity">{{ attendanceActivityLabel(r) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <p v-if="!historyLoading && !historyRows.length" class="empty-hint">No attendance records for this period.</p>

            <div class="modal-actions">
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
</style>

