<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import supabase from '../lib/supabaseClient'
import { user } from '../composables/useAuth'
import { isTravelFlagged, type AttendanceRow } from '../composables/useAttendance'

const list = ref<AttendanceRow[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  if (!user.value?.id) return
  const { data, error: err } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', user.value.id)
    .order('clock_in', { ascending: false })
    .limit(50)
  isLoading.value = false
  if (err) { error.value = err.message; return }
  list.value = (data ?? []) as AttendanceRow[]
})

function formatTotalTime(interval: string | null): string {
  if (!interval) return '—'
  const timeMatch = interval.match(/^(\d+):(\d+):(\d+)/)
  if (timeMatch) {
    const [, h, m, s] = timeMatch.map(Number)
    const parts = []
    if (h) parts.push(`${h}h`)
    if (m) parts.push(`${m}m`)
    if (s || !parts.length) parts.push(`${s}s`)
    return parts.join(' ')
  }
  const match = interval.match(/(\d+)\s*hours?|(\d+)\s*minutes?|(\d+)\s*seconds?/gi)
  if (!match) return interval
  let h = 0, m = 0, s = 0
  match.forEach(p => {
    const n = parseInt(p, 10)
    if (p.toLowerCase().includes('hour')) h = n
    else if (p.toLowerCase().includes('minute')) m = n
    else if (p.toLowerCase().includes('second')) s = n
  })
  const parts = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s || !parts.length) parts.push(`${s}s`)
  return parts.join(' ')
}

const rows = computed(() => list.value.map(r => ({
  date: r.clock_in ? new Date(r.clock_in).toLocaleDateString() : '—',
  clockIn: r.clock_in ? new Date(r.clock_in).toLocaleTimeString() : '—',
  clockOut: r.clock_out ? new Date(r.clock_out).toLocaleTimeString() : '—',
  total: formatTotalTime(r.total_time),
  modality: r.work_modality ?? '—',
  travel: isTravelFlagged(r)
})))
</script>
<template>
  <div class="page">
    <h1>Timesheet</h1>
    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="isLoading" class="muted">Loading…</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Date</th><th>Clock in</th><th>Clock out</th><th>Total</th><th>Modality</th><th>Travel</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="i">
            <td>{{ row.date }}</td><td>{{ row.clockIn }}</td><td>{{ row.clockOut }}</td><td>{{ row.total }}</td><td>{{ row.modality }}</td>
            <td><span v-if="row.travel === 'travel'" class="badge travel">Travel</span><span v-else-if="row.travel === 'possible_travel'" class="badge possible">Possible travel</span><span v-else class="muted">—</span></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!list.length" class="muted">No attendance records yet.</p>
    </div>
  </div>
</template>
<style scoped>
.page { max-width: 900px; }
.page h1 { margin: 0 0 1rem; font-size: 1.5rem; }
.error { color: #f87171; font-size: 0.875rem; margin: 0 0 0.5rem; }
.muted { color: #64748b; font-size: 0.875rem; }
.table-wrap { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.table th, .table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.08); }
.table th { color: #94a3b8; font-weight: 500; }
.badge { font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 4px; }
.badge.travel { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
.badge.possible { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }
</style>
