<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
const { user, isLoggedIn, signOut } = useAuth()
const adminGate = ref(false)
const schoolLogoError = ref(false)
const citDeptLogoError = ref(false)
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'a') { e.preventDefault(); adminGate.value = true }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>
<template>
  <div class="landing">
    <header class="header">
      <div class="brand">
        <img src="/TimeWorthLogo.png" alt="" class="brand-logo" />
        <span class="brand-text">TimeWorth</span>
      </div>
      <nav class="nav">
        <template v-if="adminGate">
          <router-link to="/admin/login" class="link">Admin login</router-link>
          <router-link to="/admin/signup" class="btn outline">Admin sign up</router-link>
        </template>
        <template v-else-if="isLoggedIn">
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
        <h1>Smart Attendance with<br />GPS & Facial Recognition</h1>
        <p class="tagline">A secure attendance system for PCWorth that verifies both your location and identity in real time.</p>
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

    <section id="thesis-features" class="page-section thesis-features" aria-labelledby="thesis-features-heading">
      <div class="page-inner">
        <h2 id="thesis-features-heading" class="section-title text-center mb-4">Dual Verification Technology</h2>
        <div class="thesis-grid">
          <article class="thesis-card">
            <div class="thesis-card-icon" aria-hidden="true">
              <span class="material-symbols-outlined">location_on</span>
            </div>
            <h3>GPS &amp; Geofencing</h3>
            <p>The system tracks employee GPS location and only allows clock-in when they are within the designated geofence. That way, attendance reflects real on-site presence, not remote check-ins.</p>
          </article>
          <article class="thesis-card">
            <div class="thesis-card-icon" aria-hidden="true">
              <span class="material-symbols-outlined">familiar_face_and_zone</span>
            </div>
            <h3>Facial Recognition</h3>
            <p>At the office entrance, employees scan their face for identity verification. Facial recognition confirms the person clocking in matches the registered account, reducing buddy punching and impersonation.</p>
          </article>
        </div>
      </div>
    </section>

    <section id="how-it-works" class="page-section how-it-works" aria-labelledby="how-it-works-heading">
      <div class="page-inner">
        <h2 id="how-it-works-heading" class="section-title how-title">How does it work</h2>
        <p class="how-lead">
          TimeWorth checks your location and your identity before you can clock in. Follow these three steps when you arrive at the office.
        </p>
        <div class="how-steps">
          <article class="how-step">
            <div class="how-step-icon" aria-hidden="true">
              <span class="material-symbols-outlined">smartphone</span>
            </div>
            <p class="how-step-label">Step 1</p>
            <p class="how-step-text">Open TimeWorth on your phone and make sure GPS is on so the app can confirm you are inside the designated geofence.</p>
          </article>
          <div class="how-arrow" aria-hidden="true">
            <span class="material-symbols-outlined">arrow_forward</span>
          </div>
          <article class="how-step">
            <div class="how-step-icon" aria-hidden="true">
              <span class="material-symbols-outlined">face</span>
            </div>
            <p class="how-step-label">Step 2</p>
            <p class="how-step-text">At the entrance, scan your face so facial recognition can verify that you are the registered employee.</p>
          </article>
          <div class="how-arrow" aria-hidden="true">
            <span class="material-symbols-outlined">arrow_forward</span>
          </div>
          <article class="how-step">
            <div class="how-step-icon" aria-hidden="true">
              <span class="material-symbols-outlined">task_alt</span>
            </div>
            <p class="how-step-label">Step 3</p>
            <p class="how-step-text">When both checks pass, complete clock-in. Your attendance is recorded securely for the day.</p>
          </article>
        </div>
      </div>
    </section>

    <section id="thesis-credits" class="page-section thesis-credits" aria-labelledby="thesis-credits-heading">
      <div class="page-inner credits-inner">
        <h2 id="thesis-credits-heading" class="section-title text-center mb-5">Our Team</h2>
        <div class="credits-layout">
          <div class="brands-column">
            <div class="school-brand">
              <div class="brand-logo-frame">
                <img
                  v-if="!schoolLogoError"
                  src="/school-logo.png"
                  alt="School logo"
                  class="school-logo"
                  @error="schoolLogoError = true"
                />
                <div v-else class="school-logo-fallback" aria-hidden="true">S</div>
              </div>
              <p class="school-name">TECHNOLOGICAL UNIVERSITY OF THE PHILIPPINES - MANILA</p>
            </div>
            <div class="dept-brand">
              <div class="brand-logo-frame">
                <img
                  v-if="!citDeptLogoError"
                  src="/citDept.png"
                  alt="CIT Department logo"
                  class="dept-logo"
                  @error="citDeptLogoError = true"
                />
                <div v-else class="dept-logo-fallback" aria-hidden="true">CIT</div>
              </div>
              <p class="dept-name">COLLEGE OF INDUSTRIAL TECHNOLOGY DEPARTMENT</p>
            </div>
          </div>
          <dl class="credits-meta">
            <div class="meta-row">
              <dt>Thesis title</dt>
              <dd>Development of Employee Deployment Monitoring System with Verifier</dd>
            </div>
            <div class="meta-row">
              <dt>Program</dt>
              <dd>Bachelor of Engineering Technology Major in Computer Engineering Technology</dd>
            </div>
            <div class="meta-row">
              <dt>Batch</dt>
              <dd>2025–2026</dd>
            </div>
            <div class="meta-row">
              <dt>Students</dt>
              <dd>
                <ul class="name-list">
                  <li>Jericho D. Montuya</li>
                  <li>Mhylze Micaela B. Miranda</li>
                  <li>Cy Bernadine S. Verbo</li>
                  <li>Rb Ionic C. Silverio</li>
                  <li>Allana A. Maclang</li>
                  <li>Geralyn D. Laput</li>
                </ul>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    <footer class="footer">TimeWorth — Location-based Attendance with Facial Recognition</footer>
  </div>
</template>
<style scoped>
.landing { min-height: 100vh; width: 100%; background: linear-gradient(180deg, #0b0f1a 0%, #0f172a 30%, #1e293b 60%, #0f172a 100%); color: #f1f5f9; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 1rem clamp(1.5rem, 5vw, 3rem); border-bottom: 1px solid rgba(255,255,255,0.06); max-width: 1600px; margin: 0 auto; }
.brand { display: flex; align-items: center; gap: 0.5rem; }
.brand-logo { display: block; height: clamp(2rem, 5vw, 2.5rem); width: auto; object-fit: contain; border-radius: 0.5rem; }
.brand-text { font-weight: 700; font-size: clamp(1.1rem, 3vw, 1.35rem); }
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
.hero { display: grid; grid-template-columns: 1fr; gap: 2rem; align-items: center; padding: clamp(2rem, 8vw, 5rem) clamp(1.5rem, 5vw, 3rem); max-width: 1280px; margin: 0 auto; }

.thesis-card p { text-align: justify; }

@media (min-width: 720px) { .hero { grid-template-columns: 1fr 1fr; gap: 3rem; } }
@media (min-width: 1280px) { .hero { padding: 4rem 3rem 5rem; } }
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

.page-section { padding: clamp(3rem, 10vw, 5rem) clamp(1.5rem, 5vw, 3rem); border-top: 1px solid rgba(255,255,255,0.06); }
.page-inner { max-width: 960px; margin: 0 auto; }
.section-title { margin: 0 0 0.75rem; font-size: clamp(1.35rem, 3vw, 1.75rem); font-weight: 700; }
.section-lead { margin: 0 0 2rem; color: #94a3b8; font-size: clamp(0.9375rem, 2vw, 1.0625rem); line-height: 1.6; max-width: 52ch; }
.thesis-grid { display: grid; grid-template-columns: 1fr; gap: 1.25rem; }
@media (min-width: 768px) { .thesis-grid { grid-template-columns: 1fr 1fr; gap: 1.5rem; } }
.thesis-card { padding: 1.5rem 1.35rem; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); transition: background 0.2s, border-color 0.2s; }
.thesis-card:hover { background: rgba(255,255,255,0.05); border-color: rgba(56, 189, 248, 0.2); }
.thesis-card-icon { margin-bottom: 0.75rem; line-height: 1; display: flex; align-items: center; }
.thesis-card-icon .material-symbols-outlined { font-size: 2.5rem; color: #38bdf8; font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
.thesis-card h3 { margin: 0 0 0.5rem; font-size: 1.0625rem; font-weight: 600; color: #e2e8f0; }
.thesis-card p { margin: 0; font-size: 0.9375rem; color: #94a3b8; line-height: 1.6; }

.how-it-works { background: rgba(255,255,255,0.02); }
.how-title { text-align: center; width: 100%; }
.how-lead { margin: 0 auto 2.5rem; text-align: center; color: #94a3b8; font-size: clamp(0.9375rem, 2vw, 1.0625rem); line-height: 1.65; max-width: min(36rem, 90%); }
.how-steps { display: flex; flex-direction: column; align-items: center; gap: 1.25rem; }
.how-step { display: flex; flex-direction: column; align-items: center; text-align: center; max-width: 22rem; width: 100%; }
.how-step-icon { margin-bottom: 0.5rem; line-height: 0; display: flex; align-items: center; justify-content: center; }
.how-step-icon .material-symbols-outlined { font-size: 3rem; color: #e2e8f0; font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 48; }
.how-step-label { margin: 0 0 0.5rem; font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #f1f5f9; }
.how-step-text { margin: 0; font-size: 0.875rem; color: #94a3b8; line-height: 1.55; }
.how-arrow { display: flex; align-items: center; justify-content: center; color: #64748b; flex-shrink: 0; }
.how-arrow .material-symbols-outlined { font-size: 1.75rem; }
@media (max-width: 899px) {
  .how-arrow .material-symbols-outlined { transform: rotate(90deg); }
}
@media (min-width: 900px) {
  .how-steps { flex-direction: row; flex-wrap: nowrap; justify-content: center; align-items: flex-start; gap: 0.75rem 1rem; }
  .how-step { flex: 1 1 0; min-width: 0; max-width: none; }
  .how-arrow { align-self: center; padding: 0 0.25rem; }
}

.thesis-credits { background: rgba(0,0,0,0.15); }
.credits-inner { max-width: 720px; }
.credits-layout { display: grid; gap: 2rem; align-items: start; }
@media (min-width: 640px) { .credits-layout { grid-template-columns: minmax(160px, 220px) 1fr; gap: 2.5rem; } }
.brands-column { display: flex; flex-direction: column; gap: 1.75rem; align-items: center; }
@media (min-width: 640px) { .brands-column { align-items: flex-start; } }
.school-brand, .dept-brand { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; text-align: center; width: 100%; }
.brand-logo-frame { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 120px; flex-shrink: 0; }
.school-logo, .dept-logo { display: block; width: 120px; max-width: 100%; height: auto; max-height: 120px; object-fit: contain; margin: 0; border-radius: 8px; }
.school-logo-fallback, .dept-logo-fallback { width: 120px; height: 120px; margin: 0; border-radius: 12px; background: linear-gradient(145deg, rgba(14,165,233,0.25), rgba(255,255,255,0.06)); border: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; font-size: 1.25rem; font-weight: 700; color: #38bdf8; text-align: center; padding: 0.35rem; line-height: 1.15; flex-shrink: 0; }
.school-logo-fallback { font-size: 2.5rem; padding: 0; }
.dept-logo-fallback { font-size: 1.65rem; letter-spacing: 0.03em; }
.school-name, .dept-name { margin: 0; font-size: 0.9375rem; font-weight: 600; color: #e2e8f0; line-height: 1.4; }
.dept-name { color: #94a3b8; font-weight: 500; font-size: 0.875rem; }
.credits-meta { margin: 0; }
.meta-row { margin-bottom: 1.25rem; }
.meta-row:last-child { margin-bottom: 0; }
.meta-row dt { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; margin-bottom: 0.35rem; }
.meta-row dd { margin: 0; font-size: 0.9375rem; color: #cbd5e1; line-height: 1.5; }
.name-list { margin: 0; padding-left: 1.25rem; }
.name-list li { margin-bottom: 0.25rem; }
.name-list li:last-child { margin-bottom: 0; }

.footer { text-align: center; padding: 2rem; font-size: 0.8125rem; color: #64748b; border-top: 1px solid rgba(255,255,255,0.06); }
@media (min-width: 1024px) { .footer { padding: 2rem 3rem; } }
</style>
