<script setup lang="ts">
import { useAuth } from '../composables/useAuth'

const { user, signOut } = useAuth()
</script>

<template>
  <div class="dashboard">
    <header class="header">
      <span class="brand">TimeWorth</span>
      <div class="nav">
        <span class="email">{{ user?.email }}</span>
        <router-link to="/" class="link">Home</router-link>
        <button type="button" class="btn outline" @click="signOut">Sign out</button>
      </div>
    </header>
    <main class="main">
      <h1>Welcome back</h1>
      <p>You’re signed in. Time in/out and attendance features can go here.</p>
    </main>
  </div>
</template>

<style scoped>
.dashboard {
  min-height: 100vh;
  background: linear-gradient(160deg, #0f0f14 0%, #1a1a2e 100%);
  color: #e2e8f0;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: clamp(0.75rem, 2vw, 1rem) clamp(1rem, 4vw, 1.5rem);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.brand {
  font-weight: 700;
  font-size: clamp(1.1rem, 2.5vw, 1.35rem);
}
.nav {
  display: flex;
  align-items: center;
  gap: clamp(0.5rem, 2vw, 1rem);
}
.email {
  font-size: 0.875rem;
  color: #94a3b8;
}
.link {
  color: #818cf8;
  text-decoration: none;
  font-size: 0.9375rem;
}
.btn {
  padding: 0.5rem 1rem;
  border-radius: 10px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: #94a3b8;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.main {
  padding: clamp(2rem, 6vw, 3rem) clamp(1rem, 4vw, 1.5rem);
  max-width: 640px;
  margin: 0 auto;
}
.main h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.5rem, 4vw, 1.75rem);
}
.main p {
  margin: 0;
  color: #94a3b8;
}
</style>
