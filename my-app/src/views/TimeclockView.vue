<script setup lang="ts">
import { onMounted } from 'vue'
import { useAttendance } from '../composables/useAttendance'

const { todayRecord, isClockedIn, isOnLunch, usedLunchBreak, elapsedDisplay, lunchElapsedDisplay, isLoading, error, fetchToday, clockIn, clockOut, startLunchBreak, endLunchBreak } = useAttendance()

onMounted(() => fetchToday())

function fmt(t: string | null) { return t ? new Date(t).toLocaleTimeString() : '—' }
</script>
<template>
  <div class="page">
    <h1>Timeclock</h1>
    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="isLoading && !todayRecord" class="muted">Loading…</div>
    <template v-else>
      <div v-if="!todayRecord?.clock_in" class="card">
        <p class="muted">You have not clocked in today.</p>
        <button type="button" class="btn primary" :disabled="isLoading" @click="() => clockIn()">Clock in</button>
      </div>
      <div v-else class="card">
        <div v-if="todayRecord.clock_out" class="done">
          <p>Clocked out. Total: <strong>{{ todayRecord.total_hours ?? 0 }}h</strong></p>
          <p class="muted">In: {{ fmt(todayRecord.clock_in) }} · Out: {{ fmt(todayRecord.clock_out) }}</p>
          <p v-if="todayRecord.lunch_break_start" class="muted lunch">Lunch: {{ fmt(todayRecord.lunch_break_start) }} – {{ fmt(todayRecord.lunch_break_end) }}</p>
        </div>
        <template v-else>
          <div v-if="isOnLunch" class="timer-wrap">
            <p class="timer-label">Lunch break</p>
            <div class="timer lunch-timer">{{ lunchElapsedDisplay }}</div>
            <p class="muted sub">Work time: {{ elapsedDisplay }}</p>
          </div>
          <div v-else class="timer-wrap">
            <div class="timer">{{ elapsedDisplay }}</div>
            <p class="muted">Clocked in at {{ fmt(todayRecord.clock_in) }}</p>
          </div>
          <div v-if="todayRecord.lunch_break_start" class="lunch-info">
            <span class="muted">Lunch {{ isOnLunch ? 'started' : 'ended' }} at {{ isOnLunch ? fmt(todayRecord.lunch_break_start) : fmt(todayRecord.lunch_break_end) }}</span>
          </div>
          <div class="actions">
            <template v-if="!usedLunchBreak">
              <button v-if="!isOnLunch" type="button" class="btn secondary" :disabled="isLoading" @click="startLunchBreak">Start lunch break</button>
              <button v-else type="button" class="btn secondary" :disabled="isLoading" @click="endLunchBreak">End lunch break</button>
            </template>
            <button type="button" class="btn primary" :disabled="isLoading" @click="() => clockOut()">Clock out</button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
<style scoped>
.page { max-width: 480px; }
.page h1 { margin: 0 0 1rem; font-size: 1.5rem; }
.error { color: #f87171; font-size: 0.875rem; margin: 0 0 0.5rem; }
.muted { color: #64748b; font-size: 0.875rem; margin: 0.5rem 0; }
.lunch-info { margin: 0.25rem 0; }
.card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1.5rem; }
.timer-wrap { margin-bottom: 0.25rem; }
.timer-label { margin: 0 0 0.25rem; font-size: 0.875rem; color: #94a3b8; }
.timer { font-size: 2rem; font-weight: 700; color: #38bdf8; font-variant-numeric: tabular-nums; }
.timer.lunch-timer { color: #fbbf24; }
.timer-wrap .sub { margin-top: 0.5rem; font-size: 0.8125rem; }
.actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
.btn { padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.9375rem; font-weight: 500; cursor: pointer; border: none; transition: opacity 0.2s; }
.btn.primary { background: #0ea5e9; color: #fff; }
.btn.secondary { background: rgba(255,255,255,0.1); color: #e2e8f0; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.done .muted { font-size: 0.8125rem; }
.done .lunch { margin-top: 0.25rem; }
</style>
