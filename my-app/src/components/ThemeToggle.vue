<script setup lang="ts">
import { useThemeStore } from '../stores/themeStore'

const themeStore = useThemeStore()

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
</script>

<template>
  <button
    type="button"
    class="theme-slide"
    :class="{ 'is-dark': themeStore.isDark, 'theme-slide--compact': compact }"
    role="switch"
    :aria-checked="themeStore.isDark"
    :title="themeStore.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="themeStore.toggleTheme"
  >
    <span class="theme-slide-bg" aria-hidden="true">
      <span class="theme-slide-slot">
        <span class="material-symbols-outlined theme-slide-bg-icon">light_mode</span>
      </span>
      <span class="theme-slide-slot">
        <span class="material-symbols-outlined theme-slide-bg-icon">dark_mode</span>
      </span>
    </span>
    <span class="theme-slide-thumb" aria-hidden="true">
      <span class="material-symbols-outlined theme-slide-thumb-icon">
        {{ themeStore.isDark ? 'dark_mode' : 'light_mode' }}
      </span>
    </span>
  </button>
</template>

<style scoped>
.theme-slide {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 4.75rem;
  height: 2.125rem;
  padding: 3px;
  border: 1px solid var(--border-light);
  border-radius: 9999px;
  background: var(--bg-tertiary);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    width 0.25s ease,
    height 0.25s ease,
    padding 0.25s ease;
}

.theme-slide--compact {
  width: 100%;
  max-width: 3.5rem;
  height: 1.25rem;
  padding: 2px;
}

.theme-slide--compact .theme-slide-bg-icon,
.theme-slide--compact .theme-slide-thumb-icon {
  font-size: 0.6875rem;
  transition: font-size 0.25s ease;
}

.theme-slide--compact .theme-slide-thumb {
  top: 2px;
  left: 2px;
  bottom: 2px;
  width: calc((100% - 4px) / 2);
}

.theme-slide:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.theme-slide:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.theme-slide-bg {
  display: flex;
  align-items: center;
  height: 100%;
  pointer-events: none;
}

.theme-slide-slot {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-slide-bg-icon {
  font-size: 1.125rem;
  line-height: 1;
  color: var(--text-tertiary);
  opacity: 0.45;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}

.theme-slide-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  bottom: 3px;
  width: calc((100% - 6px) / 2);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--bg-secondary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  z-index: 1;
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.theme-slide.is-dark .theme-slide-thumb {
  transform: translateX(100%);
}

.theme-slide-thumb-icon {
  font-size: 1.125rem;
  line-height: 1;
  color: var(--text-primary);
  font-variation-settings: 'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24;
}
</style>
