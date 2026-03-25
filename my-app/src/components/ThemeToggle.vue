<script setup lang="ts">
import { useThemeStore } from '../stores/themeStore'

const themeStore = useThemeStore()
</script>

<template>
  <button
    class="theme-toggle"
    :title="themeStore.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="themeStore.toggleTheme"
  >
    <span v-if="themeStore.isDark" class="icon">☀️</span>
    <span v-else class="icon">🌙</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  background: none;
  border: 1px solid var(--border-light);
  cursor: pointer;
  font-size: 1.5rem;
  padding: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  border-radius: 50%;
  width: 44px;
  height: 44px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.theme-toggle:hover {
  background-color: var(--bg-hover);
  transform: scale(1.1);
  border-color: var(--accent);
}

.theme-toggle:active {
  transform: scale(0.95);
}

.icon {
  display: inline-block;
  transition: transform 0.3s ease;
}

.theme-toggle:active .icon {
  transform: rotate(20deg);
}
</style>
