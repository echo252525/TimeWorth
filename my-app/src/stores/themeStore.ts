import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  const isDark = ref(true)

  // Load theme from localStorage on init
  function initTheme() {
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme) {
      isDark.value = savedTheme === 'dark'
    }
    applyTheme()
  }

  // Apply theme to document
  function applyTheme() {
    const html = document.documentElement
    const body = document.body
    
    if (isDark.value) {
      html.style.colorScheme = 'dark'
      body.classList.add('dark-mode')
      body.classList.remove('light-mode')
    } else {
      html.style.colorScheme = 'light'
      body.classList.add('light-mode')
      body.classList.remove('dark-mode')
    }
    
    // Save to localStorage
    localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
  }

  // Toggle theme
  function toggleTheme() {
    isDark.value = !isDark.value
    applyTheme()
  }

  // Watch for changes
  watch(isDark, () => {
    applyTheme()
  })

  return {
    isDark,
    initTheme,
    toggleTheme,
    applyTheme
  }
})
