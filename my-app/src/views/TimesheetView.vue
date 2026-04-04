<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import supabase from '../lib/supabaseClient'
import { user } from '../composables/useAuth'
import { isTravelFlagged, getBranch, parseLocation, getLocalDateString, storedToRealInstant, type AttendanceRow, type WorkModality } from '../composables/useAttendance'
import { ClockIcon, PencilSquareIcon, CheckCircleIcon, XMarkIcon, PhotoIcon } from '@heroicons/vue/24/outline'

const ATTENDANCE_SELECT =
  'attendance_id,user_id,clock_in,clock_out,facial_status,lunch_break_start,lunch_break_end,total_time,location_in,location_out,branch_location,created_at,updated_at,work_modality,facial_verifications_id,wfh_pic_url'

const list = ref<AttendanceRow[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
const appliedModality = ref<WorkModality | ''>('')
const appliedBranch = ref<string>('')
const appliedShift = ref<'dayshift' | 'nightshift' | ''>('')

const employeeName = ref<string | null>(null)
const employeePosition = ref<string | null>(null)
const employeeEmail = ref<string | null>(null)
const employeeNo = ref<string | null>(null)

// Time filter (Undertime, Enough Time, Overtime)
type TimeFilter = 'all' | 'undertime' | 'enough' | 'overtime'
const timeFilter = ref<TimeFilter>('all')

// Date filter (Today, Yesterday, Last 7 Days, Last Month, Custom)
type DateFilter = 'today' | 'yesterday' | 'last7Days' | 'lastMonth' | 'custom'
const dateFilter = ref<DateFilter>('lastMonth')
const customStartDate = ref<string>('')
const customEndDate = ref<string>('')
const showCustomDateModal = ref(false)

// Modality filter
const modalityFilter = ref<'all' | 'office' | 'wfh'>('all')

// View toggles (Times, Breaks, Insights)
const showTimes = ref(true)
const showBreaks = ref(true)
const showInsights = ref(true)

// Expanded row state for multiple entries
const expandedRow = ref<string | null>(null)

// Edit request modal state
const showEditModal = ref(false)
const editTargetEntry = ref<AttendanceRow | null>(null)
const editTargetDateLabel = ref<string>('')
const editNewClockIn = ref<string>('')
const editNewClockOut = ref<string>('')
const editNewLunchStart = ref<string>('')
const editNewLunchEnd = ref<string>('')
const editReason = ref<string>('')

// City cache for reverse geocoded locations
const cityCache = ref<Record<string, string>>({})
const WFH_PICTURE_BUCKET = 'wfh_employee_picture'
const showWfhPhotoModal = ref(false)
const wfhPhotoModalUrl = ref<string | null>(null)
const wfhPhotoModalLoading = ref(false)
const wfhPhotoModalError = ref<string | null>(null)

/** Latest edit-request status per attendance_id for the current user */
const editRequestStatusMap = ref<Record<string, 'pending' | 'approved' | 'rejected'>>({})

async function openWfhPhotoModal(pathOrUrl: string | null) {
  console.log('[Timesheet] openWfhPhotoModal called', { pathOrUrl })
  if (!pathOrUrl) return
  wfhPhotoModalLoading.value = true
  wfhPhotoModalError.value = null
  wfhPhotoModalUrl.value = null
  showWfhPhotoModal.value = true
  try {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      wfhPhotoModalUrl.value = pathOrUrl
      console.log('[Timesheet] using direct photo URL', { url: pathOrUrl })
      return
    }
    const { data, error: signedErr } = await supabase
      .storage
      .from(WFH_PICTURE_BUCKET)
      .createSignedUrl(pathOrUrl, 60 * 60)
    if (signedErr) throw signedErr
    wfhPhotoModalUrl.value = data.signedUrl
    console.log('[Timesheet] signed URL created', {
      bucket: WFH_PICTURE_BUCKET,
      storagePath: pathOrUrl,
      hasSignedUrl: !!data.signedUrl
    })
  } catch (e) {
    wfhPhotoModalError.value = e instanceof Error ? e.message : 'Unable to load WFH photo.'
    console.error('[Timesheet] failed loading WFH photo', {
      pathOrUrl,
      error: wfhPhotoModalError.value
    })
  } finally {
    wfhPhotoModalLoading.value = false
  }
}

function closeWfhPhotoModal() {
  showWfhPhotoModal.value = false
  wfhPhotoModalUrl.value = null
  wfhPhotoModalError.value = null
}

function getDateRange() {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  
  if (dateFilter.value === 'custom' && customStartDate.value && customEndDate.value) {
    const customStart = new Date(customStartDate.value)
    customStart.setHours(0, 0, 0, 0)
    const customEnd = new Date(customEndDate.value)
    customEnd.setHours(23, 59, 59, 999)
    return { start: customStart.toISOString(), end: customEnd.toISOString() }
  } else if (dateFilter.value === 'today') {
    start.setHours(0, 0, 0, 0)
    return { start: start.toISOString(), end: end.toISOString() }
  } else if (dateFilter.value === 'yesterday') {
    start.setDate(start.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    const yesterdayEnd = new Date(start)
    yesterdayEnd.setHours(23, 59, 59, 999)
    return { start: start.toISOString(), end: yesterdayEnd.toISOString() }
  } else if (dateFilter.value === 'last7Days') {
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    return { start: start.toISOString(), end: end.toISOString() }
  } else if (dateFilter.value === 'lastMonth') {
    start.setMonth(start.getMonth() - 1)
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  // Fallback: last month
  start.setMonth(start.getMonth() - 1)
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  return { start: start.toISOString(), end: end.toISOString() }
}

function formatDateRange(): string {
  if (dateFilter.value === 'custom' && customStartDate.value && customEndDate.value) {
    const start = new Date(customStartDate.value)
    const end = new Date(customEndDate.value)
    const startMonth = start.toLocaleDateString('en-US', { month: 'long' })
    const endMonth = end.toLocaleDateString('en-US', { month: 'long' })
    const startDay = start.getDate()
    const endDay = end.getDate()
    
    if (startMonth === endMonth) {
      return `${startMonth} ${startDay} - ${endDay}`
    } else {
      return `${startMonth} ${startDay} - ${endMonth} ${endDay}`
    }
  }
  return ''
}

function openCustomDateModal() {
  showCustomDateModal.value = true
}

function closeCustomDateModal() {
  showCustomDateModal.value = false
}

function applyCustomDateRange() {
  if (customStartDate.value && customEndDate.value) {
    fetchData()
    closeCustomDateModal()
  }
}

async function fetchData() {
  if (!user.value?.id) return
  isLoading.value = true
  error.value = null
  const { start, end } = getDateRange()
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  // Same strategy as timeclock: widen DB bounds so locally-stored wall-time timestamps
  // (saved with trailing Z) are not excluded before client-side normalization.
  const padMs = 36 * 60 * 60 * 1000
  const startWide = new Date(startMs - padMs).toISOString()
  const endWide = new Date(endMs + padMs).toISOString()
  console.log('[Timesheet] fetchData start', {
    userId: user.value.id,
    start,
    startWide,
    end,
    endWide,
    modalityFilter: modalityFilter.value
  })
  const { data, error: err } = await supabase
    .from('attendance')
    .select(ATTENDANCE_SELECT)
    .eq('user_id', user.value.id)
    .gte('clock_in', startWide)
    .lte('clock_in', endWide)
    .order('clock_in', { ascending: false })
  isLoading.value = false
  if (err) {
    error.value = err.message
    console.error('[Timesheet] fetchData error', { message: err.message, details: err })
    return
  }
  const raw = (data ?? []) as AttendanceRow[]
  list.value = raw.filter((row) => {
    if (!row.clock_in) return false
    const realMs = storedToRealInstant(row.clock_in)
    return realMs >= startMs && realMs <= endMs
  })
  console.log('[Timesheet] fetchData result', {
    rawRows: raw.length,
    totalRows: list.value.length,
    wfhRows: list.value.filter((r) => r.work_modality === 'wfh').length,
    rowsWithWfhPic: list.value.filter((r) => !!r.wfh_pic_url).length,
    sample: list.value.slice(0, 5).map((r) => ({
      attendance_id: r.attendance_id,
      work_modality: r.work_modality,
      wfh_pic_url: r.wfh_pic_url
    }))
  })

  await loadEditRequestStatuses()
}

watch(dateFilter, (newVal) => {
  if (newVal === 'custom') {
    openCustomDateModal()
  } else {
    fetchData()
  }
}, { immediate: false })

watch([customStartDate, customEndDate], () => {
  if (dateFilter.value === 'custom' && customStartDate.value && customEndDate.value) {
    fetchData()
  }
}, { immediate: false })

watch([() => appliedModality.value, () => appliedBranch.value, () => appliedShift.value], () => { /* filters applied below via filteredRows */ })


async function loadEmployeeData() {
  if (!user.value?.id) return
  const { data } = await supabase
    .from('employee')
    .select('name, position_in_company, email, employee_no')
    .eq('id', user.value.id)
    .maybeSingle()
  if (data) {
    const row = data as {
      name: string | null
      position_in_company: string | null
      email: string | null
      employee_no: string | null
    }
    employeeName.value = row.name
    employeePosition.value = row.position_in_company
    employeeEmail.value = row.email
    employeeNo.value = row.employee_no
  }
}

async function loadEditRequestStatuses() {
  try {
    if (!user.value?.id) return
    const ids = Array.from(
      new Set(
        list.value
          .map(r => r.attendance_id)
          .filter((id): id is string => Boolean(id))
      )
    )
    if (!ids.length) {
      editRequestStatusMap.value = {}
      return
    }
    const { data, error: reqErr } = await supabase
      .from('attendance_edit_requests')
      .select('attendance_id, status, created_at')
      .eq('requested_by', user.value.id)
      .in('attendance_id', ids)
      .order('created_at', { ascending: false })
    if (reqErr) {
      console.error('Load edit request statuses error:', reqErr.message)
      return
    }
    const map: Record<string, 'pending' | 'approved' | 'rejected'> = {}
    const normalize = (s: string): 'pending' | 'approved' | 'rejected' | null => {
      if (s === 'pending' || s === 'approved' || s === 'rejected') return s
      if (s === 'declined') return 'rejected'
      return null
    }
    for (const row of (data ?? []) as { attendance_id: string | null; status: string }[]) {
      const aid = row.attendance_id
      if (!aid || map[aid] !== undefined) continue
      const st = normalize(row.status)
      if (st) map[aid] = st
    }
    editRequestStatusMap.value = map
  } catch (e) {
    console.error('Unexpected edit status load error:', e)
  }
}

onMounted(() => {
  // Initialize custom date range to last month if not set
  if (!customStartDate.value || !customEndDate.value) {
    const end = new Date()
    const start = new Date(end)
    start.setMonth(start.getMonth() - 1)
    start.setDate(1)
    customEndDate.value = end.toISOString().slice(0, 10)
    customStartDate.value = start.toISOString().slice(0, 10)
  }
  fetchData()
  loadEmployeeData()
})

/** 12-hour times for PDF/CSV export: `H:MM A.M.` / `P.M.` */
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

/** Min–max of YYYY-MM-DD dates actually present in the PDF/CSV export rows */
function formatExportTableDateCoveredRange(): string {
  const unique = new Set<string>()
  for (const row of exportRows.value) {
    const d = row[0]
    if (d && d !== '—') unique.add(d)
  }
  if (!unique.size) return '—'
  const sorted = Array.from(unique).sort()
  const a = sorted[0]!
  const b = sorted[sorted.length - 1]!
  return a === b ? a : `${a} - ${b}`
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

/** PDF / export: same compact total as AdminTimesheetView. */
function formatTotalTimeCompact(interval: string | null): string {
  if (!interval) return '—'
  const m = interval.match(/^(\d+):(\d+):(\d+)/)
  if (m) {
    const [, h, min] = m.map(Number)
    if (h) return `${h}h ${min}m`
    return `${min}m`
  }
  return interval
}

/** Same labels as AdminTimesheetView PDF “Activity” column. */
function attendanceActivityLabel(r: AttendanceRow): string {
  const v = isTravelFlagged(r)
  return v === 'travel'
    ? 'Suspicious location activity'
    : v === 'possible_travel'
      ? 'Possible suspicious location activity'
      : '—'
}

function safeFileSlug(s: string): string {
  return (
    s
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'timesheet'
  )
}

interface TimesheetPdfEmp {
  id: string
  name: string | null
  email: string | null
  position_in_company: string | null
  employee_no: string | null
}

/** Letterhead copy for exported PDFs (matches AdminTimesheetView). */
const PDF_LETTERHEAD = {
  brand: 'PCWorth',
  ownedByLabel: 'Owned and Operated by:',
  legalName: 'DRJ TECHNOLOGIES TRADING CORP.',
  address: '618 M Earnshaw Street, Sampaloc, Manila, Metro Manila 1008'
} as const

function buildPdfTableBodyFromRows(rows: AttendanceRow[]): string[][] {
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
      total: formatTotalTimeCompact(r.total_time),
      modality: r.work_modality ? String(r.work_modality).toLowerCase() : '—',
      travel: attendanceActivityLabel(r)
    })
  }

  const flat: Array<[string, string, string, string, string, string, string, string]> = []
  for (const [dateKey, groupRows] of Object.entries(map).sort(([a], [b]) =>
    a === '—' ? 1 : b === '—' ? -1 : new Date(b).getTime() - new Date(a).getTime()
  )) {
    for (const r of groupRows) {
      flat.push([
        dateKey,
        r.clockIn,
        r.clockOut,
        r.lunchIn,
        r.lunchOut,
        r.total,
        r.modality,
        r.travel
      ])
    }
  }

  return flat.map(([date, clockIn, clockOut, lunchIn, lunchOut, total, modality, travel]) => [
    date,
    clockIn,
    clockOut,
    lunchIn,
    lunchOut,
    total,
    modality,
    travel
  ])
}

function createTimesheetPdfDocument(
  emp: TimesheetPdfEmp,
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

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`
  if (cityCache.value[key]) return cityCache.value[key]
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'TimeWorthApp/1.0' } }
    )
    const data = await res.json()
    const addr = data?.display_name ?? null
    if (addr) {
      // Extract city from address
      const city = extractCityFromAddress(addr)
      if (city) {
        cityCache.value[key] = city
        return city
      }
    }
    return null
  } catch {
    return null
  }
}

function extractCityFromAddress(address: string): string | null {
  // Try to extract city from reverse geocoded address
  // Format is usually: "Street, City, Region, Country"
  const parts = address.split(',').map(s => s.trim())
  
  // Look for common city patterns (usually 2nd or 3rd from end)
  for (let i = parts.length - 2; i >= Math.max(0, parts.length - 4); i--) {
    const part = parts[i]
    if (part && (part.includes('City') || part.includes('Manila') || part.includes('Quezon') || part.includes('Las Piñas'))) {
      return part
    }
  }
  
  // Fallback: return second to last part (usually city)
  if (parts.length >= 2) {
    return parts[parts.length - 2] || null
  }
  return null
}

function extractCity(attendanceRow: AttendanceRow): string {
  // If office work, extract city from branch address
  if (attendanceRow.work_modality === 'office' && attendanceRow.branch_location) {
    const branch = getBranch(attendanceRow.branch_location)
    if (branch?.address) {
      // Extract city from address (usually last part before country)
      // Examples: "Sampaloc Manila", "Las Piñas City", "Quezon City"
      const parts = branch.address.split(',').map(s => s.trim()).filter(s => s.length > 0)
      // Look for common city patterns
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i]
        if (part && (part.includes('City') || part.includes('Manila') || part === 'Las Piñas' || part === 'Quezon City')) {
          return part
        }
      }
      // Fallback: return last part
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1]
        if (lastPart) return lastPart
      }
      return branch.name
    }
    return branch?.name || '—'
  }
  // For WFH, extract city from last clock out location
  if (attendanceRow.work_modality === 'wfh' && attendanceRow.location_out) {
    const coords = parseLocation(attendanceRow.location_out)
    if (coords) {
      const key = `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`
      // Check cache first
      if (cityCache.value[key]) {
        return cityCache.value[key]
      }
      // If not in cache, return WFH as fallback (will update when reverse geocode completes)
      return 'WFH'
    }
  }
  return 'WFH'
}

function formatTotalTime(interval: string | null): string {
  if (!interval) return '—'
  const timeMatch = interval.match(/^(\d+):(\d+):(\d+)/)
  if (timeMatch) {
    const [, h, m, s] = timeMatch.map(Number)
    const totalSeconds = (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
    
    if (totalSeconds === 0) return '0s'
    
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    
    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
    } else if (minutes > 0) {
      return `${minutes}m`
    } else if (seconds > 0) {
      return `${seconds}s`
    }
    return '0s'
  }
  return '—'
}

function lunchMinutes(row: AttendanceRow): number {
  if (!row.lunch_break_start) return 0
  const start = storedToRealInstant(row.lunch_break_start)
  const end = row.lunch_break_end ? storedToRealInstant(row.lunch_break_end) : Date.now()
  return Math.max(0, Math.floor((end - start) / 60000))
}

const filteredRows = computed(() => {
  let filtered = list.value
  // Apply modality filter
  if (modalityFilter.value === 'office') filtered = filtered.filter(r => r.work_modality === 'office')
  if (modalityFilter.value === 'wfh') filtered = filtered.filter(r => r.work_modality === 'wfh')
  // Legacy filters (if still needed)
  if (appliedModality.value) filtered = filtered.filter(r => r.work_modality === appliedModality.value)
  if (appliedBranch.value) filtered = filtered.filter(r => r.branch_location === appliedBranch.value)
  if (appliedShift.value) {
    filtered = filtered.filter(r => {
      if (!r.clock_in) return false
      const hour = new Date(r.clock_in).getHours()
      if (appliedShift.value === 'dayshift') return hour >= 6 && hour < 22
      if (appliedShift.value === 'nightshift') return hour >= 22 || hour < 6
      return true
    })
  }
  return filtered
})

interface DayRow {
  dateKey: string
  clockIn: string
  clockOut: string
  total: string
  totalMinutes: number
  totalSeconds: number
  plannedBreaks: string
  breakMinutes: number
  modality: string
  city: string
  citySummary: string
  hasMultipleEntries: boolean
  hasPendingEdit: boolean
  editRequestStatus: 'pending' | 'approved' | 'rejected' | null
  entryCount: number
  entries: AttendanceRow[]
  hasWfhPhoto: boolean
  firstWfhPhotoPath: string | null
}
// Get all unique dates from filtered rows (local date for correct grouping)
const allDates = computed(() => {
  const dateSet = new Set<string>()
  for (const r of filteredRows.value) {
    const key = r.clock_in ? getLocalDateString(new Date(storedToRealInstant(r.clock_in))) : ''
    if (key) dateSet.add(key)
  }
  return Array.from(dateSet).sort().reverse() // Most recent first
})

const weekDays = computed(() => allDates.value.map(dateKey => ({ dateKey })))

const tableRows = computed(() => {
  // Access cityCache to make this computed reactive to cache updates
  void cityCache.value
  const byDate: Record<string, AttendanceRow[]> = {}
  for (const r of filteredRows.value) {
    const key = r.clock_in ? getLocalDateString(new Date(storedToRealInstant(r.clock_in))) : ''
    if (!key) continue
    if (!byDate[key]) byDate[key] = []
    byDate[key].push(r)
  }
  return weekDays.value.map(({ dateKey }) => {
    const dayRows = byDate[dateKey] ?? []
    let clockIn = '—'
    let clockOut = '—'
    let totalSeconds = 0
    let totalMinutes = 0
    let breakMinutes = 0
    let modality = '—'
    const hasMultipleEntries = dayRows.length > 1
    const entryCount = dayRows.length
    const sorted = dayRows.length ? [...dayRows].sort((a, b) => storedToRealInstant(a.clock_in!) - storedToRealInstant(b.clock_in!)) : []
    let hasPendingEdit = false
    let editRequestStatus: 'pending' | 'approved' | 'rejected' | null = null
    const firstWfhWithPhoto = sorted.find(
      (entry) => entry.work_modality === 'wfh' && !!entry.wfh_pic_url
    ) ?? null

    if (dayRows.length && sorted.length > 0 && sorted[0]) {
      clockIn = formatTime12hApmFromStored(sorted[0].clock_in)
      const last = sorted[sorted.length - 1]
      if (last) {
        clockOut = formatTime12hApmFromStored(last.clock_out)
      }
      // Calculate total seconds (excluding breaks)
      for (const r of dayRows) {
        const t = r.total_time
        if (t) {
          const m = t.match(/^(\d+):(\d+):(\d+)/)
          if (m) {
            const hours = Number(m[1])
            const mins = Number(m[2])
            const secs = Number(m[3])
            totalSeconds += hours * 3600 + mins * 60 + secs
          }
        }
        breakMinutes += lunchMinutes(r)
      }
      // Subtract break minutes from total to get actual worked time
      const breakSeconds = breakMinutes * 60
      totalSeconds = Math.max(0, totalSeconds - breakSeconds)
      totalMinutes = Math.floor(totalSeconds / 60)
      
      // Get all unique modalities
      const modalities = new Set<string>()
      for (const r of dayRows) {
        if (r.work_modality === 'office') modalities.add('Office')
        else if (r.work_modality === 'wfh') modalities.add('WFH')
      }
      const modalityArray = Array.from(modalities)
      modality = modalityArray.length > 0 ? modalityArray.join(', ') : '—'

      const firstAttendanceId = sorted[0].attendance_id
      if (firstAttendanceId) {
        const st = editRequestStatusMap.value[firstAttendanceId]
        if (st) {
          editRequestStatus = st
          hasPendingEdit = st === 'pending'
        }
      }
    }
    // Extract city/cities for location display
    let city = '—'
    let citySummary = '—'
    if (dayRows.length > 0 && sorted.length > 0) {
      const cities = new Set<string>()
      // Collect all unique cities from all entries
      for (const entry of sorted) {
        const entryCity = extractCity(entry)
        if (entryCity && entryCity !== 'WFH' && entryCity !== '—') {
          cities.add(entryCity)
        } else if (entryCity === 'WFH') {
          cities.add('WFH')
        }
        // Trigger reverse geocoding for WFH if needed
        if (entry.work_modality === 'wfh' && entry.location_out) {
          const coords = parseLocation(entry.location_out)
          if (coords) {
            const key = `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`
            if (!cityCache.value[key]) {
              reverseGeocode(coords.lat, coords.lng).then(cityName => {
                if (cityName) {
                  cityCache.value[key] = cityName
                }
              })
            }
          }
        }
      }
      
      const cityArray = Array.from(cities)
      if (cityArray.length > 0) {
        if (hasMultipleEntries && cityArray.length > 1) {
          // Multiple locations: show count summary
          citySummary = `${cityArray.length} locations`
          city = cityArray.join(', ')
        } else {
          // Single location or all same
          const firstCity = cityArray[0]
          city = firstCity || '—'
          citySummary = firstCity || '—'
        }
      } else {
        city = '—'
        citySummary = '—'
      }
    }
    // Format total: show seconds if < 1 min, minutes if < 1 hour, otherwise hours and minutes
    let total = '—'
    if (totalSeconds > 0) {
      const totalH = Math.floor(totalSeconds / 3600)
      const totalM = Math.floor((totalSeconds % 3600) / 60)
      const totalS = totalSeconds % 60
      
      if (totalH > 0) {
        total = totalM > 0 ? `${totalH}h ${totalM}m` : `${totalH}h`
      } else if (totalM > 0) {
        total = `${totalM}m`
      } else if (totalS > 0) {
        total = `${totalS}s`
      } else {
        total = '0s'
      }
    } else {
      total = '0s'
    }
    // Format planned breaks: show seconds if < 1 min, minutes if < 1 hour, otherwise hours and minutes
    const breakSeconds = breakMinutes * 60
    let plannedBreaks = '—'
    if (breakSeconds > 0) {
      const breakH = Math.floor(breakSeconds / 3600)
      const breakM = Math.floor((breakSeconds % 3600) / 60)
      const breakS = breakSeconds % 60
      
      if (breakH > 0) {
        plannedBreaks = breakM > 0 ? `${breakH}h ${breakM}m` : `${breakH}h`
      } else if (breakM > 0) {
        plannedBreaks = `${breakM}m`
      } else if (breakS > 0) {
        plannedBreaks = `${breakS}s`
      } else {
        plannedBreaks = '0s'
      }
    } else {
      plannedBreaks = '0s'
    }
    return {
      dateKey,
      clockIn,
      clockOut,
      total,
      totalMinutes,
      totalSeconds,
      plannedBreaks,
      breakMinutes,
      modality,
      city,
      citySummary,
      hasMultipleEntries,
      hasPendingEdit,
      editRequestStatus,
      entryCount,
      entries: sorted,
      hasWfhPhoto: !!firstWfhWithPhoto?.wfh_pic_url,
      firstWfhPhotoPath: firstWfhWithPhoto?.wfh_pic_url ?? null
    } as DayRow
  }).filter(row => {
    // Apply time filter from dropdown
    if (timeFilter.value === 'all') return true
    const hours = row.totalSeconds / 3600
    if (timeFilter.value === 'undertime') return hours < 8
    if (timeFilter.value === 'enough') return hours >= 7.9 && hours <= 8.1
    if (timeFilter.value === 'overtime') return hours > 8.1
    return true
  })
})

watch(tableRows, (rows) => {
  console.log('[Timesheet] tableRows computed', {
    rowCount: rows.length,
    rowsWithWfhPhoto: rows.filter((r) => r.hasWfhPhoto).length,
    firstRows: rows.slice(0, 5).map((r) => ({
      dateKey: r.dateKey,
      modality: r.modality,
      hasWfhPhoto: r.hasWfhPhoto,
      firstWfhPhotoPath: r.firstWfhPhotoPath
    }))
  })
}, { immediate: true })

// Legacy dayGroups for PDF/Excel (grouped by day with multiple rows per day)
interface DisplayRow {
  date: string
  clockIn: string
  clockOut: string
  lunchIn: string
  lunchOut: string
  total: string
  modality: string
  travel: string
  branch: string
  raw: AttendanceRow
}
const dayGroups = computed(() => {
  const map: Record<string, DisplayRow[]> = {}
  for (const r of filteredRows.value) {
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
      modality: r.work_modality ? r.work_modality.toLowerCase() : '—',
      travel: attendanceActivityLabel(r),
      branch: branch?.name ?? '—',
      raw: r
    })
  }
  return Object.entries(map)
    .sort(([a], [b]) => (a === '—' ? 1 : b === '—' ? -1 : new Date(b).getTime() - new Date(a).getTime()))
    .map(([dateKey, rows]) => {
      let totalSeconds = 0
      for (const r of rows) {
        const t = r.raw.total_time
        if (t) {
          const m = t.match(/^(\d+):(\d+):(\d+)/)
          if (m) totalSeconds += Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        }
      }
      const totalH = Math.floor(totalSeconds / 3600)
      const totalM = Math.floor((totalSeconds % 3600) / 60)
      const dailyTotal = totalH || totalM ? `${totalH}h ${totalM}m` : '0h'
      return {
        date: dateKey,
        rows,
        dailyTotal
      }
    })
})

const exportRows = computed(() => {
  const flat: Array<[string, string, string, string, string, string, string, string, string]> = []
  for (const group of dayGroups.value) {
    for (const row of group.rows) {
      flat.push([
        group.date,
        row.clockIn,
        row.clockOut,
        row.lunchIn,
        row.lunchOut,
        row.total,
        row.modality,
        row.branch,
        row.travel
      ])
    }
  }
  return flat
})

async function downloadPDF() {
  if (!user.value?.id) return

  let pcDataUrl: string
  let twDataUrl: string
  try {
    ;[pcDataUrl, twDataUrl] = await Promise.all([
      loadRoundedLogoDataUrl(publicAssetUrl('PCWorthLogo.jpg')),
      loadRoundedLogoDataUrl(publicAssetUrl('TimeWorthLogo.png'))
    ])
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not load PDF logos'
    error.value = msg
    console.error('PDF logo load:', e)
    return
  }

  const tableBody = buildPdfTableBodyFromRows(filteredRows.value)
  const emp: TimesheetPdfEmp = {
    id: user.value.id,
    name: employeeName.value,
    email: employeeEmail.value ?? user.value.email ?? null,
    position_in_company: employeePosition.value,
    employee_no: employeeNo.value
  }
  const doc = createTimesheetPdfDocument(
    emp,
    tableBody,
    formatExportTableDateCoveredRange(),
    pcDataUrl,
    twDataUrl
  )
  const today = new Date().toISOString().slice(0, 10)
  const nameSlug = safeFileSlug(employeeName.value || user.value.email || 'timesheet')
  doc.save(`timesheet-${nameSlug}-${today}.pdf`)
}

function toggleRowExpansion(dateKey: string) {
  if (expandedRow.value === dateKey) {
    expandedRow.value = null
  } else {
    expandedRow.value = dateKey
  }
}

function toLocalDateTimeInput(isoOrNull: string | null): string {
  if (!isoOrNull) return ''
  const ms = storedToRealInstant(isoOrNull)
  const d = new Date(ms)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${mins}`
}

function openEditModalForDay(row: DayRow) {
  if (!row.entries.length) return
  const target = row.entries[0]
  if (!target) return
  editTargetEntry.value = target
  editTargetDateLabel.value = row.dateKey
  editNewClockIn.value = toLocalDateTimeInput(target.clock_in)
  editNewClockOut.value = toLocalDateTimeInput(target.clock_out)
  editNewLunchStart.value = toLocalDateTimeInput(target.lunch_break_start)
  editNewLunchEnd.value = toLocalDateTimeInput(target.lunch_break_end)
  editReason.value = ''
  showEditModal.value = true
}

function closeEditModal() {
  showEditModal.value = false
  editTargetEntry.value = null
}

function editButtonTitle(row: DayRow): string {
  if (row.hasPendingEdit) return 'Edit request pending'
  if (row.editRequestStatus === 'approved') return 'Request approved — you can submit another edit'
  if (row.editRequestStatus === 'rejected') return 'Request declined — you can submit a new edit'
  return 'Request edit for ' + row.dateKey
}

async function confirmEditRequest() {
  try {
    if (!user.value?.id) return
    const uid = user.value.id
    if (!editTargetEntry.value) return
    const target = editTargetEntry.value
    if (!target.attendance_id) return

    const toIsoOrNull = (val: string): string | null =>
      val ? new Date(val).toISOString() : null

    const nowIso = new Date().toISOString()
    const payload = {
      attendance_id: target.attendance_id,
      requested_by: uid,
      old_clock_in: target.clock_in,
      old_clock_out: target.clock_out,
      old_lunch_break_start: target.lunch_break_start,
      old_lunch_break_end: target.lunch_break_end,
      old_location_in: target.location_in,
      old_location_out: target.location_out,
      old_work_modality: target.work_modality,
      new_clock_in: toIsoOrNull(editNewClockIn.value),
      new_clock_out: toIsoOrNull(editNewClockOut.value),
      new_lunch_break_start: toIsoOrNull(editNewLunchStart.value),
      new_lunch_break_end: toIsoOrNull(editNewLunchEnd.value),
      new_location_in: null,
      new_location_out: null,
      new_work_modality: null,
      status: 'pending' as const,
      reason: editReason.value || null,
      admin_comment: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: nowIso
    }

    const { data: existingList, error: existingErr } = await supabase
      .from('attendance_edit_requests')
      .select('id')
      .eq('attendance_id', target.attendance_id)
      .eq('requested_by', uid)
      .order('created_at', { ascending: false })
      .limit(1)

    if (existingErr) {
      console.error('Edit request lookup error:', existingErr.message)
      error.value = existingErr.message
      return
    }

    const existingId = existingList?.[0]?.id

    async function applyUpdateById(id: string) {
      return supabase
        .from('attendance_edit_requests')
        .update(payload)
        .eq('id', id)
    }

    /** When a prior request was approved/declined, the same row is reused: pending + new proposed times. */
    async function applyUpdateByAttendanceKeys() {
      return supabase
        .from('attendance_edit_requests')
        .update(payload)
        .eq('attendance_id', target.attendance_id)
        .eq('requested_by', uid)
    }

    if (existingId) {
      const { error: updateError } = await applyUpdateById(existingId)
      if (updateError) {
        console.error('Edit request update error:', updateError.message)
        error.value = updateError.message
        return
      }
    } else {
      const { error: insertError } = await supabase
        .from('attendance_edit_requests')
        .insert(payload)
      if (insertError) {
        const isDup =
          insertError.code === '23505' ||
          /duplicate|unique/i.test(insertError.message ?? '')
        if (isDup) {
          const { error: updateError } = await applyUpdateByAttendanceKeys()
          if (updateError) {
            console.error('Edit request update-after-duplicate error:', updateError.message)
            error.value = updateError.message
            return
          }
        } else {
          console.error('Edit request error:', insertError.message)
          error.value = insertError.message
          return
        }
      }
    }

    editRequestStatusMap.value = {
      ...editRequestStatusMap.value,
      [target.attendance_id]: 'pending'
    }

    closeEditModal()
  } catch (e) {
    console.error('Unexpected edit request error:', e)
  }
}
</script>

<template>
  <div class="page">
    <section class="controls" aria-label="Timesheet filters">
      <div class="controls-row">
        <label class="control">
          <span class="control-label">Date</span>
          <select v-model="dateFilter" class="control-input" aria-label="Date filter">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7Days">Last 7 Days</option>
            <option value="lastMonth">Last Month</option>
            <option value="custom">Custom Range</option>
          </select>
        </label>
        <span v-if="dateFilter === 'custom' && formatDateRange()" class="custom-range-display">
          {{ formatDateRange() }}
        </span>
        <label class="control">
          <span class="control-label">Time</span>
          <select v-model="timeFilter" class="control-input" aria-label="Time filter">
            <option value="all">All</option>
            <option value="undertime">Undertime</option>
            <option value="enough">In Time</option>
            <option value="overtime">Overtime</option>
          </select>
        </label>
        <label class="control">
          <span class="control-label">Modality</span>
          <select v-model="modalityFilter" class="control-input" aria-label="Modality filter">
            <option value="all">All</option>
            <option value="office">Office</option>
            <option value="wfh">WFH</option>
          </select>
        </label>
      </div>
      <div class="controls-row controls-row-toggles">
        <label class="filter-check">
          <input v-model="showTimes" type="checkbox" class="filter-check-input" />
          <span class="filter-check-box"></span>
          <span class="filter-check-label">Show time columns</span>
        </label>
        <label class="filter-check">
          <input v-model="showBreaks" type="checkbox" class="filter-check-input" />
          <span class="filter-check-box"></span>
          <span class="filter-check-label">Show breaks</span>
        </label>
      </div>
    </section>

    <p v-if="error" class="banner-error">{{ error }}</p>
    <div v-if="isLoading" class="loading-state">Loading…</div>

    <div v-else class="card-wrap">
      <div class="table-card">
        <div class="table-scroll">
        <table class="data-table ts-table">
          <thead>
            <tr>
              <th>Date</th>
              <th v-if="showTimes">Clock In</th>
              <th v-if="showTimes">Clock Out</th>
              <th v-if="showTimes">Total Hours</th>
              <th v-if="showBreaks">Planned Breaks</th>
              <th>Location</th>
              <th v-if="showInsights">Modality</th>
              <th>Edit</th>
            </tr>
          </thead>
          <tbody>
            <!-- eslint-disable-next-line vue/no-v-for-template-key -->
            <template v-for="row in tableRows" :key="row.dateKey">
              <tr 
                class="ts-row" 
                :class="{ 'ts-row-multiple': row.hasMultipleEntries, 'ts-row-clickable': row.hasMultipleEntries }"
                @click="row.hasMultipleEntries && toggleRowExpansion(row.dateKey)"
              >
                <td class="ts-date">
                  <div class="ts-date-content">
                    {{ row.dateKey }}
                    <span v-if="row.hasMultipleEntries" class="expand-icon" :class="{ 'expanded': expandedRow === row.dateKey }">▼</span>
                  </div>
                </td>
                <td v-if="showTimes" class="ts-cell">{{ row.clockIn }}</td>
                <td v-if="showTimes" class="ts-cell">{{ row.clockOut }}</td>
                <td v-if="showTimes" class="ts-cell ts-total">{{ row.total }}</td>
                <td v-if="showBreaks" class="ts-cell">{{ row.plannedBreaks }}</td>
                <td class="ts-cell">
                  <span v-if="row.hasMultipleEntries && row.citySummary.includes('locations')" class="location-summary">{{ row.citySummary }}</span>
                  <span v-else>{{ row.city }}</span>
                  <button
                    v-if="row.hasWfhPhoto"
                    type="button"
                    class="wfh-photo-btn"
                    title="View WFH photo"
                    aria-label="View WFH photo"
                    @click.stop="openWfhPhotoModal(row.firstWfhPhotoPath)"
                  >
                    <PhotoIcon class="wfh-photo-icon" />
                  </button>
                </td>
                <td v-if="showInsights" class="ts-cell">
                  <span>{{ row.modality }}</span>
                </td>
                <td class="ts-cell ts-edit-cell">
                  <div class="ts-edit-cell-inner">
                    <CheckCircleIcon
                      v-if="row.editRequestStatus === 'approved'"
                      class="edit-status-icon edit-status-approved"
                      aria-hidden="true"
                    />
                    <XMarkIcon
                      v-else-if="row.editRequestStatus === 'rejected'"
                      class="edit-status-icon edit-status-declined"
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      class="edit-btn"
                      :title="editButtonTitle(row)"
                      :disabled="row.hasPendingEdit"
                      @click.stop="openEditModalForDay(row)"
                    >
                      <PencilSquareIcon v-if="!row.hasPendingEdit" class="edit-icon" />
                      <ClockIcon v-else class="edit-icon pending-icon" />
                    </button>
                  </div>
                </td>
              </tr>
              <Transition name="expand">
                <tr 
                  v-if="row.hasMultipleEntries && expandedRow === row.dateKey"
                  :key="`expanded-${row.dateKey}`"
                  class="ts-row-expanded"
                >
                  <td :colspan="(showTimes ? 3 : 0) + (showBreaks ? 1 : 0) + (showInsights ? 1 : 0) + 2" class="ts-expanded-content">
                    <div class="ts-expanded-header">All Clock Entries ({{ row.entryCount }})</div>
                    <div class="ts-expanded-entries">
                      <div v-for="(entry, idx) in row.entries" :key="idx" class="ts-entry-item">
                        <div class="ts-entry-details">
                          <div class="ts-entry-row">
                            <span class="ts-entry-label">Clock In:</span>
                            <span class="ts-entry-value">{{ formatTime12hApmFromStored(entry.clock_in) }}</span>
                            <span class="ts-entry-label">Clock Out:</span>
                            <span class="ts-entry-value">{{ formatTime12hApmFromStored(entry.clock_out) }}</span>
                          </div>
                          <div class="ts-entry-row">
                            <span class="ts-entry-label">Duration:</span>
                            <span class="ts-entry-value">{{ formatTotalTime(entry.total_time) }}</span>
                            <span class="ts-entry-label">Location:</span>
                            <span class="ts-entry-value">{{ extractCity(entry) }}</span>
                          </div>
                          <div class="ts-entry-row">
                            <span class="ts-entry-label">Modality:</span>
                            <span class="ts-entry-value">{{ entry.work_modality === 'office' ? 'Office' : entry.work_modality === 'wfh' ? 'WFH' : '—' }}</span>
                            <span class="ts-entry-label">Break:</span>
                            <span class="ts-entry-value">{{ lunchMinutes(entry) > 0 ? `${Math.floor(lunchMinutes(entry) / 60)}h ${lunchMinutes(entry) % 60}m` : '—' }}</span>
                          </div>
                          <div v-if="entry.work_modality === 'wfh'" class="ts-entry-row">
                            <span class="ts-entry-label">WFH Photo:</span>
                            <button
                              v-if="entry.wfh_pic_url"
                              type="button"
                              class="wfh-photo-btn wfh-photo-btn-inline"
                              @click.stop="openWfhPhotoModal(entry.wfh_pic_url)"
                            >
                              <PhotoIcon class="wfh-photo-icon" />
                              <span>View photo</span>
                            </button>
                            <span v-else class="ts-entry-value">—</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </Transition>
            </template>
          </tbody>
        </table>
        </div>
      </div>
      <p v-if="!tableRows.length" class="empty-hint">No attendance records found.</p>
    </div>

    <div class="table-toolbar">
      <button type="button" class="btn btn-primary" :disabled="!dayGroups.length" @click="downloadPDF">
        Download Timesheet
      </button>
    </div>

    <!-- Custom Date Range Modal -->
    <div v-if="showCustomDateModal" class="modal-overlay" @click.self="closeCustomDateModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">Select Date Range</h3>
          <button type="button" class="modal-close" @click="closeCustomDateModal" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="date-picker-group">
            <label class="date-picker-label">
              <span>From:</span>
              <input v-model="customStartDate" type="date" class="date-picker-input" />
            </label>
            <label class="date-picker-label">
              <span>To:</span>
              <input v-model="customEndDate" type="date" class="date-picker-input" />
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="closeCustomDateModal">Cancel</button>
          <button type="button" class="btn btn-primary" @click="applyCustomDateRange" :disabled="!customStartDate || !customEndDate">Apply</button>
        </div>
      </div>
    </div>

    <!-- Edit Attendance Request Modal -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="closeEditModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">Request Attendance Edit</h3>
          <button type="button" class="modal-close" @click="closeEditModal" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="edit-summary">
            <p class="edit-summary-date">{{ editTargetDateLabel }}</p>
          </div>
          <div class="date-picker-group">
            <label class="date-picker-label">
              <span>New Clock In</span>
              <input v-model="editNewClockIn" type="datetime-local" class="date-picker-input" />
            </label>
            <label class="date-picker-label">
              <span>New Clock Out</span>
              <input v-model="editNewClockOut" type="datetime-local" class="date-picker-input" />
            </label>
            <label class="date-picker-label">
              <span>New Lunch Break Start</span>
              <input v-model="editNewLunchStart" type="datetime-local" class="date-picker-input" />
            </label>
            <label class="date-picker-label">
              <span>New Lunch Break End</span>
              <input v-model="editNewLunchEnd" type="datetime-local" class="date-picker-input" />
            </label>
            <label class="date-picker-label">
              <span>Reason for change</span>
              <textarea
                v-model="editReason"
                rows="3"
                class="date-picker-textarea"
                placeholder="Explain why this attendance needs to be edited"
              />
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="closeEditModal">Cancel</button>
          <button
            type="button"
            class="btn btn-primary"
            @click="confirmEditRequest"
            :disabled="!editNewClockIn && !editNewClockOut && !editNewLunchStart && !editNewLunchEnd && !editReason"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>

    <div v-if="showWfhPhotoModal" class="modal-overlay" @click.self="closeWfhPhotoModal">
      <div class="modal-content wfh-photo-modal-content">
        <div class="modal-header">
          <h3 class="modal-title">WFH Photo</h3>
          <button type="button" class="modal-close" @click="closeWfhPhotoModal" aria-label="Close">×</button>
        </div>
        <div class="modal-body wfh-photo-modal-body">
          <p v-if="wfhPhotoModalLoading" class="muted">Loading photo…</p>
          <p v-else-if="wfhPhotoModalError" class="error">{{ wfhPhotoModalError }}</p>
          <img v-else-if="wfhPhotoModalUrl" :src="wfhPhotoModalUrl" alt="WFH uploaded proof" class="wfh-photo-modal-image" />
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.page {
  width: 100%;
  max-width: 100%;
}

/* Match AdminTimesheetView filter panel */
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
.controls-row-toggles {
  margin-top: 0.65rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--border-color);
  align-items: center;
}
.control {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 140px;
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
.control-input:focus {
  outline: none;
  border-color: var(--accent, #0d9488);
}

.banner-error {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  background: rgba(248, 113, 113, 0.12);
  color: var(--error, #f87171);
  border: 1px solid rgba(248, 113, 113, 0.18);
}
.loading-state {
  padding: 1.25rem 1rem;
  color: var(--text-secondary);
  font-size: 0.9375rem;
}

.table-card {
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
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
.data-table .ts-row:last-child td {
  border-bottom: none;
}

.empty-hint {
  margin: 0;
  padding: 0.75rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

.table-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.filter-check {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--text-primary, #334155);
  user-select: none;
}
.filter-check-input { position: absolute; opacity: 0; width: 0; height: 0; }
.filter-check-box {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 2px solid var(--border-color, #cbd5e1);
  background: var(--bg-primary, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s, background 0.2s;
}
.filter-check-input:checked + .filter-check-box {
  background: var(--accent, #0d9488);
  border-color: var(--accent, #0d9488);
}
.filter-check-input:checked + .filter-check-box::after {
  content: '';
  width: 5px;
  height: 9px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-bottom: 2px;
}
.filter-check-label {
  font-weight: 500;
}

.card-wrap {
  margin-bottom: 0.5rem;
}

.ts-table.ts-table {
  font-size: 0.875rem;
}

/* Mobile: allow horizontal scroll for wide tables */
@media (max-width: 767px) {
  .controls-row .control {
    min-width: 0;
    flex: 1 1 100%;
  }
  .custom-range-display {
    width: 100%;
    box-sizing: border-box;
  }
  .card-wrap {
    margin-bottom: 0.5rem;
  }
  .data-table.ts-table {
    width: max-content;
    min-width: 100%;
  }
  .data-table.ts-table th,
  .data-table.ts-table td {
    padding: 0.625rem 0.75rem;
  }
  .table-toolbar .btn {
    width: 100%;
    justify-content: center;
  }
}

.ts-table td {
  color: var(--text-primary);
}
.ts-row:last-child td {
  border-bottom: none;
}
.ts-date { font-weight: 500; }
.ts-date-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.expand-icon {
  font-size: 0.75rem;
  color: var(--text-secondary, #64748b);
  transition: transform 0.3s ease;
  display: inline-block;
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

.ts-cell { white-space: nowrap; }
.ts-total { font-weight: 500; }
.ts-row-multiple {
  background: rgba(59, 130, 246, 0.05);
  border-left: 3px solid rgba(59, 130, 246, 0.5);
}
.ts-row-clickable {
  cursor: pointer;
}
.ts-row-clickable:hover {
  background: rgba(59, 130, 246, 0.08);
}
.ts-row-expanded {
  background: rgba(59, 130, 246, 0.03);
}

.expand-enter-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.expand-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.expand-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.expand-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  transform: translateY(0);
}

.ts-expanded-content {
  padding: 1rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
.ts-expanded-header {
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
}
.ts-expanded-entries {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.ts-entry-item {
  padding: 0.75rem;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.ts-entry-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.ts-entry-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.875rem;
}
.ts-entry-label {
  font-weight: 500;
  color: var(--text-secondary, #475569);
  min-width: 80px;
}
.ts-entry-value {
  color: var(--text-primary, #1e293b);
  font-weight: 500;
}

.location-summary {
  font-size: 0.8125rem;
  color: var(--accent, #0d9488);
  font-weight: 500;
}

.ts-edit-cell {
  text-align: center;
}

.ts-edit-cell-inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.edit-status-icon {
  width: 1.125rem;
  height: 1.125rem;
  flex-shrink: 0;
}

.edit-status-approved {
  color: #16a34a;
}

.edit-status-declined {
  color: #dc2626;
}

.edit-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease, transform 0.2s ease, color 0.2s ease;
  color: var(--text-secondary, #64748b);
}

.edit-btn:hover {
  background: rgba(99, 102, 241, 0.12);
  color: var(--accent, #0d9488);
  transform: translateY(-1px);
}

.edit-icon {
  width: 1.1rem;
  height: 1.1rem;
}

.edit-btn:disabled {
  cursor: default;
  opacity: 0.6;
  transform: none;
}

.edit-btn:disabled:hover {
  background: transparent;
  color: var(--text-secondary, #64748b);
}

.pending-icon {
  color: #eab308; /* amber/yellow for pending */
}
.ts-row-total {
  background: var(--bg-secondary, #f1f5f9);
  font-weight: 600;
}
.ts-row-total .ts-date { color: var(--text-primary, #1e293b); }
.ts-row-total .ts-cell { border-bottom: none; color: var(--text-primary, #1e293b); }

.badge {
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-weight: 500;
}
.badge.insight {
  background: rgba(251, 191, 36, 0.15);
  color: #b45309;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--accent, #0d9488);
  color: #fff;
}
.btn-secondary {
  background: var(--bg-secondary, #e2e8f0);
  color: var(--text-primary, #334155);
}
.btn-secondary:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-primary:hover:not(:disabled) {
  opacity: 0.92;
}

.custom-range-display {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-weight: 600;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 10px;
  border: 1px solid var(--border-light);
  align-self: flex-end;
}

.wfh-photo-btn {
  margin-left: 0.45rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-secondary, #f8fafc);
  color: var(--text-secondary, #475569);
  border-radius: 8px;
  padding: 0.24rem 0.48rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.wfh-photo-btn:hover {
  border-color: var(--accent, #0d9488);
  color: var(--accent, #0d9488);
}

.wfh-photo-btn-inline {
  margin-left: 0;
}

.wfh-photo-icon {
  width: 0.95rem;
  height: 0.95rem;
}

.wfh-photo-modal-content {
  max-width: 720px;
}

.wfh-photo-modal-body {
  display: flex;
  justify-content: center;
}

.wfh-photo-modal-image {
  width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 10px;
  border: 1px solid var(--border-color, #e2e8f0);
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

.modal-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 16px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow: auto;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.modal-close {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s;
}

.modal-close:hover {
  opacity: 0.9;
}

.modal-body {
  padding: 1.5rem;
}

.date-picker-group {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.date-picker-label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.date-picker-label span {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary, #334155);
}

.date-picker-input {
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
}

.date-picker-input:focus {
  outline: none;
  border-color: var(--accent, #0d9488);
}

.date-picker-textarea {
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  border: 1px solid var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.875rem;
  resize: vertical;
}

.date-picker-textarea:focus {
  outline: none;
  border-color: var(--accent, #0d9488);
}

.edit-summary {
  margin-bottom: 0.75rem;
}

.edit-summary-date {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-secondary, #64748b);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1.25rem 1.5rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
</style>
