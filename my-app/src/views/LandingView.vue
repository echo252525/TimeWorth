<script setup lang="ts">
import { useAuth } from '../composables/useAuth'

const { isLoggedIn, signOut } = useAuth()
</script>

<template>
  <div class="landing">
    <header class="header">
      <router-link to="/" class="brand">TimeWorth</router-link>
      <nav class="nav">
        <template v-if="isLoggedIn">
          <router-link to="/dashboard" class="link">Dashboard</router-link>
          <button type="button" class="btn outline" @click="signOut">Sign out</button>
        </template>
        <template v-else>
          <router-link to="/login" class="link">Log in</router-link>
          <router-link to="/signup" class="btn primary">Sign up</router-link>
        </template>
      </nav>
    </header>

    <main class="main">
      <section class="hero">
        <h1>Track time. Stay on top.</h1>
        <p class="tagline">Time in, time out. One place for your team’s attendance and working hours.</p>
        <div v-if="!isLoggedIn" class="cta">
          <router-link to="/signup" class="btn primary large">Get started</router-link>
          <router-link to="/login" class="btn ghost large">Log in</router-link>
        </div>
        <div v-else class="cta">
          <router-link to="/dashboard" class="btn primary large">Go to Dashboard</router-link>
        </div>
      </section>

      <section class="features">
        <div class="feature">
          <span class="icon">⏱</span>
          <h3>Time in / Time out</h3>
          <p>Clock in and out in one tap. Simple and fast.</p>
        </div>
        <div class="feature">
          <span class="icon">📊</span>
          <h3>Working hours</h3>
          <p>See your hours at a glance. No spreadsheets.</p>
        </div>
        <div class="feature">
          <span class="icon">📱</span>
          <h3>Works on mobile</h3>
          <p>Use it on any device. Responsive and reliable.</p>
        </div>
      </section>
    </main>

    <footer class="footer">
      <span>TimeWorth — Attendance & time tracking</span>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background: linear-gradient(160deg, #0f0f14 0%, #1a1a2e 40%, #16213e 100%);
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
  color: #f1f5f9;
  text-decoration: none;
  letter-spacing: -0.02em;
}
.nav {
  display: flex;
  align-items: center;
  gap: clamp(0.5rem, 2vw, 1rem);
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
  border-radius: 10px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.2s;
  border: none;
}
.btn.primary {
  background: #6366f1;
  color: #fff;
}
.btn.outline {
  background: transparent;
  color: #94a3b8;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.btn.ghost {
  background: transparent;
  color: #94a3b8;
}
.btn.ghost:hover,
.btn.outline:hover {
  color: #e2e8f0;
}
.btn.large {
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
}
.main {
  padding: clamp(2rem, 8vw, 4rem) clamp(1rem, 4vw, 1.5rem);
  max-width: 900px;
  margin: 0 auto;
}
.hero {
  text-align: center;
  padding: clamp(2rem, 6vw, 4rem) 0;
}
.hero h1 {
  margin: 0 0 0.75rem;
  font-size: clamp(1.75rem, 5vw, 2.5rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
}
.tagline {
  margin: 0 0 1.75rem;
  font-size: clamp(1rem, 2.5vw, 1.15rem);
  color: #94a3b8;
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}
.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
}
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: clamp(1.25rem, 4vw, 1.75rem);
  margin-top: clamp(2rem, 6vw, 3rem);
}
.feature {
  padding: 1.25rem;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.feature .icon {
  font-size: 1.75rem;
  display: block;
  margin-bottom: 0.5rem;
}
.feature h3 {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  font-weight: 600;
}
.feature p {
  margin: 0;
  font-size: 0.875rem;
  color: #94a3b8;
}
.footer {
  padding: 1.5rem clamp(1rem, 4vw, 1.5rem);
  text-align: center;
  font-size: 0.8125rem;
  color: #64748b;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
</style>
