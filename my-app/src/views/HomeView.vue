<script setup lang="ts">
import { useAuth } from '../composables/useAuth'

const { user, isLoggedIn, signOut } = useAuth()
</script>

<template>
  <div class="home">
    <nav class="nav">
      <span class="brand">TimeWorth</span>
      <div v-if="isLoggedIn" class="user-actions">
        <span class="user-email">{{ user?.email }}</span>
        <button type="button" class="btn outline" @click="signOut">Sign out</button>
      </div>
      <div v-else class="user-actions">
        <router-link to="/login" class="link">Log in</router-link>
        <router-link to="/signup" class="btn primary">Sign up</router-link>
      </div>
    </nav>
    <main class="main">
      <h1 v-if="isLoggedIn">Welcome back</h1>
      <h1 v-else>Welcome to TimeWorth</h1>
      <p v-if="isLoggedIn">You're signed in as {{ user?.email }}.</p>
      <p v-else>Sign up or log in to get started.</p>
    </main>
  </div>
</template>

<style scoped>
.home {
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #e2e8f0;
}
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.brand {
  font-weight: 600;
  font-size: 1.25rem;
}
.user-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.user-email {
  font-size: 0.875rem;
  color: #94a3b8;
}
.link {
  color: #94a3b8;
  text-decoration: none;
  font-size: 0.9375rem;
}
.link:hover {
  color: #c7d2fe;
}
.btn {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.2s;
}
.btn.primary {
  background: #6366f1;
  color: #fff;
  border: none;
}
.btn.outline {
  background: transparent;
  color: #94a3b8;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.btn:hover {
  opacity: 0.9;
}
.main {
  padding: 3rem 1.5rem;
  max-width: 640px;
  margin: 0 auto;
}
.main h1 {
  margin: 0 0 0.5rem;
  font-size: 1.75rem;
}
.main p {
  margin: 0;
  color: #94a3b8;
}
</style>
