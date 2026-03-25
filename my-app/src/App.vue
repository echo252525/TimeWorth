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
  --error: #f87171;
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
</style>
