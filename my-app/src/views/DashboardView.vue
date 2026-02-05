<script setup lang="ts">
import { useAuth } from '../composables/useAuth'
const { user } = useAuth()
</script>
<template>
  <div class="page">
    <h1>Dashboard</h1>
    <p>Welcome back, {{ user?.email }}.</p>
    <p class="muted">Use the sidebar to open Timeclock, Timesheet, or Settings.</p>
  </div>
</template>
<style scoped>
.page { max-width: 640px; }
.page h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
.page p { margin: 0 0 0.25rem; color: #e2e8f0; }
.muted { color: #64748b; font-size: 0.9375rem; margin-top: 0.5rem; }
</style>
