<script setup lang="ts">
import { useAuth } from '../composables/useAuth'
const { user, isLoggedIn, signOut } = useAuth()
</script>
<template>
  <div class="landing">
    <header class="header">
      <span class="brand">⏱ TimeWorth</span>
      <nav class="nav">
        <template v-if="isLoggedIn">
          <span class="user-email">{{ user?.email }}</span>
          <button type="button" class="btn outline" @click="signOut">Sign out</button>
        </template>
        <template v-else>
          <router-link to="/login" class="link">Log in</router-link>
          <router-link to="/signup" class="btn primary">Get started</router-link>
        </template>
      </nav>
    </header>
    <main class="hero">
      <div class="hero-content">
        <h1>Track time.<br />Stay accountable.</h1>
        <p class="tagline">Time in, time out. A simple attendance system for working hours.</p>
        <div v-if="!isLoggedIn" class="cta">
          <router-link to="/signup" class="btn primary large">Start tracking</router-link>
          <router-link to="/login" class="btn ghost large">Log in</router-link>
        </div>
        <div v-else class="welcome"><p>Welcome back. Signed in as <strong>{{ user?.email }}</strong>.</p></div>
      </div>
      <div class="hero-visual">
        <div class="card-mock">
          <div class="mock-row"><span class="dot"></span> Time in — 9:00 AM</div>
          <div class="mock-row"><span class="dot"></span> Time out — 6:00 PM</div>
          <div class="mock-row total">8h 0m today</div>
        </div>
      </div>
    </main>
    <section class="features">
      <div class="feature"><span class="feat-icon">📋</span><h3>Attendance</h3><p>Clock in and out.</p></div>
      <div class="feature"><span class="feat-icon">⏰</span><h3>Working hours</h3><p>Daily and weekly totals.</p></div>
      <div class="feature"><span class="feat-icon">🔒</span><h3>Secure</h3><p>Data private and backed up.</p></div>
    </section>
    <footer class="footer">TimeWorth — Attendance & time tracking</footer>
  </div>
</template>
<style scoped>
.landing { min-height: 100vh; background: linear-gradient(180deg, #0f172a 0%, #1e293b 35%, #0f172a 100%); color: #f1f5f9; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 1rem clamp(1rem, 4vw, 2rem); border-bottom: 1px solid rgba(255,255,255,0.06); }
.brand { font-weight: 700; font-size: clamp(1.1rem, 3vw, 1.35rem); }
.nav { display: flex; align-items: center; gap: 0.75rem; }
.user-email { font-size: 0.8125rem; color: #94a3b8; }
.link { color: #94a3b8; text-decoration: none; font-size: 0.9375rem; }
.link:hover { color: #38bdf8; }
.btn { padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.9375rem; font-weight: 500; cursor: pointer; text-decoration: none; transition: opacity 0.2s; border: none; }
.btn.primary { background: #0ea5e9; color: #fff; }
.btn.outline { background: transparent; color: #94a3b8; border: 1px solid rgba(255,255,255,0.2); }
.btn.ghost { background: transparent; color: #94a3b8; }
.btn.large { padding: 0.65rem 1.25rem; font-size: 1rem; }
.btn:hover { opacity: 0.9; }
.hero { display: grid; grid-template-columns: 1fr; gap: 2rem; align-items: center; padding: clamp(2rem, 8vw, 4rem) clamp(1rem, 4vw, 2rem); max-width: 1100px; margin: 0 auto; }
@media (min-width: 720px) { .hero { grid-template-columns: 1fr 1fr; } }
.hero-content h1 { margin: 0 0 1rem; font-size: clamp(1.75rem, 4vw, 2.5rem); font-weight: 700; line-height: 1.2; }
.tagline { margin: 0 0 1.5rem; color: #94a3b8; font-size: clamp(0.9375rem, 2vw, 1.0625rem); line-height: 1.5; max-width: 420px; }
.cta, .welcome { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.welcome p { margin: 0; color: #94a3b8; }
.welcome strong { color: #e2e8f0; }
.hero-visual { display: flex; justify-content: center; }
.card-mock { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1.25rem 1.5rem; min-width: 260px; }
.mock-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9375rem; padding: 0.35rem 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
.mock-row.total { margin-top: 0.5rem; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.1); font-weight: 600; color: #38bdf8; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1.5rem; padding: 3rem clamp(1rem, 4vw, 2rem); max-width: 1100px; margin: 0 auto; }
.feature { text-align: center; padding: 1rem; }
.feat-icon { font-size: 1.75rem; display: block; margin-bottom: 0.5rem; }
.feature h3 { margin: 0 0 0.25rem; font-size: 1rem; font-weight: 600; }
.feature p { margin: 0; font-size: 0.8125rem; color: #94a3b8; }
.footer { text-align: center; padding: 1.5rem; font-size: 0.8125rem; color: #64748b; border-top: 1px solid rgba(255,255,255,0.06); }
</style>
