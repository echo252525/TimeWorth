<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuth } from './composables/useAuth'

const { init } = useAuth()

onMounted(() => {
  init()
})
</script>

<template>
  <router-view />
</template>

<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: #0f0f14;
  color: #e2e8f0;
}
</style>
