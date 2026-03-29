<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuth } from './composables/useAuth'
import { useThemeStore } from './stores/themeStore'

const { init } = useAuth()
const themeStore = useThemeStore()

onMounted(() => {
  themeStore.initTheme()
  init()
})
</script>

<template>
  <div class="app-container">
    <router-view />
  </div>
</template>

<style>
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100vh; }

/* CSS Variables for Theming */
:root {
  --bg-primary: #0b0f1a;
  --bg-secondary: #0f172a;
  --bg-tertiary: #1e293b;
  --bg-hover: rgba(255, 255, 255, 0.06);
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;
  --border-color: rgba(255, 255, 255, 0.06);
  --border-light: rgba(255, 255, 255, 0.12);
  --accent: #38bdf8;
  --accent-light: #0ea5e9;
  --accent-light-for-hover: #099adc;
  --error: #FF0000;
  --overlay: rgba(0, 0, 0, 0.5);
}

/* Light Mode */
:root.light-mode, body.light-mode {
  --bg-primary: #f8fafc;
  --bg-secondary: #f1f5f9;
  --bg-tertiary: #e2e8f0;
  --bg-hover: rgba(15, 23, 42, 0.06);
  --text-primary: #1e293b;
  --text-secondary: #475569;
  --text-tertiary: #64748b;
  --border-color: rgba(15, 23, 42, 0.06);
  --border-light: rgba(15, 23, 42, 0.12);
  --accent: #38bdf8;
  --accent-light: #0ea5e9;
  --error: #f87171;
  --overlay: rgba(0, 0, 0, 0.3);
}

/* Dark Mode (Default) */
body.dark-mode {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

/* Light Mode */
body.light-mode {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

#app { min-height: 100vh; }

.app-container {
  position: relative;
  min-height: 100vh;
}

/* Light mode: KPI icon contrast (Dashboard + Admin; compound selectors beat scoped SFC rules) */
body.light-mode .kpi-icon.kpi-icon-green,
body.light-mode .admin-kpi-icon.admin-kpi-icon-green {
  background: rgba(34, 197, 94, 0.2);
  color: #16a34a;
}
body.light-mode .admin-kpi-icon.admin-kpi-icon-green {
  border-color: rgba(34, 197, 94, 0.35);
}
body.light-mode .kpi-icon.kpi-icon-blue,
body.light-mode .admin-kpi-icon.admin-kpi-icon-blue {
  background: rgba(59, 130, 246, 0.2);
  color: #2563eb;
}
body.light-mode .admin-kpi-icon.admin-kpi-icon-blue {
  border-color: rgba(59, 130, 246, 0.35);
}
body.light-mode .kpi-icon.kpi-icon-orange,
body.light-mode .admin-kpi-icon.admin-kpi-icon-orange {
  background: rgba(249, 115, 22, 0.2);
  color: #ea580c;
}
body.light-mode .admin-kpi-icon.admin-kpi-icon-orange {
  border-color: rgba(249, 115, 22, 0.35);
}
body.light-mode .kpi-icon.kpi-icon-purple,
body.light-mode .admin-kpi-icon.admin-kpi-icon-purple {
  background: rgba(168, 85, 247, 0.2);
  color: #9333ea;
}
body.light-mode .admin-kpi-icon.admin-kpi-icon-purple {
  border-color: rgba(168, 85, 247, 0.35);
}

/* Native date/select should follow light chrome in light theme */
body.light-mode .date-input-group input[type="date"],
body.light-mode .hero-map-date,
body.light-mode .filter-select {
  color-scheme: light;
}
</style>
