<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import ThemeToggle from '../components/ThemeToggle.vue'
const { user, isLoggedIn, signOut } = useAuth()
const adminGate = ref(false)

/** Mobile: hold “TimeWorth” (brand text) 3s to reveal admin login / sign up (same as Ctrl+A on desktop). */
const ADMIN_GATE_LONG_PRESS_MS = 3000
let brandLongPressTimer: ReturnType<typeof setTimeout> | null = null

function clearBrandLongPress() {
  if (brandLongPressTimer) {
    clearTimeout(brandLongPressTimer)
    brandLongPressTimer = null
  }
}

function onBrandTouchStart() {
  if (isLoggedIn.value) return
  clearBrandLongPress()
  brandLongPressTimer = setTimeout(() => {
    brandLongPressTimer = null
    if (!isLoggedIn.value) adminGate.value = true
  }, ADMIN_GATE_LONG_PRESS_MS)
}

function onBrandTouchEnd() {
  clearBrandLongPress()
}

function onKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'a') {
    e.preventDefault()
    adminGate.value = true
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  clearBrandLongPress()
})
</script>
<template>
  <div class="landing">
    <header class="header">
      <div class="brand">
        <img src="/TimeWorthLogo.png" alt="" class="brand-logo" />
        <span
          class="brand-text admin-gate-touch-target"
          @touchstart.passive="onBrandTouchStart"
          @touchend="onBrandTouchEnd"
          @touchcancel="onBrandTouchEnd"
        >
          TimeWorth
        </span>
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
          <router-link to="/signup" class="btn primary large">Create your account now</router-link>
          <router-link to="/login" class="btn ghost large">Log in</router-link>
        </div>
        <div v-else class="welcome"><p>Welcome back. Signed in as <strong>{{ user?.email }}</strong>.</p></div>
      </div>
      <div class="hero-visual">
        <img src="/mascot1.png" alt="PC Worth mascot" class="hero-mascot" />
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

    <section id="how-it-works" class="how-process" aria-labelledby="how-it-works-heading">
      <div class="how-process-inner">
        <h2 id="how-it-works-heading" class="how-process-title">How does TimeWorth work?</h2>
        <p class="how-process-lead">
          Create your account, get approved, then clock in—on-site or from home.
        </p>
        <div class="how-process-grid" role="list">
          <article class="how-process-step" role="listitem">
            <div class="how-process-icon-ring" aria-hidden="true">
              <span class="material-symbols-outlined">person_add</span>
            </div>
            <h3 class="how-process-step-title">1. Create Account</h3>
            <p class="how-process-step-desc">
              Register, confirm your email, and wait for an admin to approve your account before you log in.
            </p>
          </article>
          <article class="how-process-step" role="listitem">
            <div class="how-process-icon-ring" aria-hidden="true">
              <span class="material-symbols-outlined">touch_app</span>
            </div>
            <h3 class="how-process-step-title">2. Choose Modality</h3>
            <p class="how-process-step-desc">
              Open the Timeclock page or tap <strong>Open Timeclock</strong> on the Dashboard, then choose <strong>Office</strong> or <strong>WFH</strong>.
            </p>
          </article>
          <article class="how-process-step" role="listitem">
            <div class="how-process-icon-ring" aria-hidden="true">
              <span class="material-symbols-outlined">familiar_face_and_zone</span>
            </div>
            <h3 class="how-process-step-title">3. Office</h3>
            <p class="how-process-step-desc">
              Stay inside the geofence to clock in and out. Scan your face at the office for both clock in and clock out.
            </p>
          </article>
          <article class="how-process-step" role="listitem">
            <div class="how-process-icon-ring" aria-hidden="true">
              <span class="material-symbols-outlined">home_work</span>
            </div>
            <h3 class="how-process-step-title">4. WFH</h3>
            <p class="how-process-step-desc">
              Upload a photo before clocking in. Submit an accomplishment report before you can clock out.
            </p>
          </article>
        </div>
      </div>
    </section>

    <section id="about-pc-worth" class="page-section thesis-credits" aria-labelledby="about-pc-worth-heading">
      <div class="page-inner about-inner">
        <h2 id="about-pc-worth-heading" class="section-title text-center">About PC Worth</h2>
        <div class="about-grid">
          <article class="about-card">
            <p>
              PC Worth is a Philippine-based technology retail company specializing in computer hardware, custom PC
              builds, and IT solutions. The company provides affordable and high-performance computer products for
              gamers, students, professionals, and businesses.
            </p>
            <p>
              Starting from a small computer shop, PC Worth has grown into a trusted provider of quality PC components,
              peripherals, and system builds, with a strong focus on customer satisfaction and technical support.
            </p>
          </article>
        </div>

        <article class="about-card branch-card">
          <h3>Branches</h3>
          <div class="branch-grid">
            <section class="branch-item">
              <div class="branch-head">
                <span class="material-symbols-outlined branch-icon" aria-hidden="true">storefront</span>
                <h4>Earnshaw Branch</h4>
              </div>
              <p>
                <span class="material-symbols-outlined branch-detail-icon" aria-hidden="true">location_on</span>
                <span>618 M. Earnshaw St. Sampaloc Manila</span>
              </p>
              <p>
                <span class="material-symbols-outlined branch-detail-icon" aria-hidden="true">call</span>
                <span>(02)8 656 0586</span>
              </p>
              <p>
                <span class="material-symbols-outlined branch-detail-icon" aria-hidden="true">mobile</span>
                <span>(+63) 967-701-8178 / (+63) 998 594 3037</span>
              </p>
            </section>
            <section class="branch-item">
              <div class="branch-head">
                <span class="material-symbols-outlined branch-icon" aria-hidden="true">apartment</span>
                <h4>Alabang Branch</h4>
              </div>
              <p>
                <span class="material-symbols-outlined branch-detail-icon" aria-hidden="true">location_on</span>
                <span>2nd Flr. Mega Accent Bldg. 479 Alabang-Zapote Road, Brgy. Almanza Uno, Las Pinas City</span>
              </p>
              <p>
                <span class="material-symbols-outlined branch-detail-icon" aria-hidden="true">call</span>
                <span>(02)8 292 9044</span>
              </p>
              <p>
                <span class="material-symbols-outlined branch-detail-icon" aria-hidden="true">mobile</span>
                <span>(+63) 931-062-1294</span>
              </p>
            </section>
            <section class="branch-item">
              <div class="branch-head">
                <span class="material-symbols-outlined branch-icon" aria-hidden="true">desktop_windows</span>
                <h4>PC Worth Experience (Quezon City)</h4>
              </div>
              <p>
                <span class="material-symbols-outlined branch-detail-icon" aria-hidden="true">location_on</span>
                <span>2nd Floor, LE-EL Building 5, 7 JP Rizal corner Malong St., Marilag, Quezon City</span>
              </p>
              <p>
                <span class="material-symbols-outlined branch-detail-icon" aria-hidden="true">call</span>
                <span>(02)7 002 0176</span>
              </p>
              <p>
                <span class="material-symbols-outlined branch-detail-icon" aria-hidden="true">mobile</span>
                <span>(+63) 947-357-1727</span>
              </p>
            </section>
          </div>
        </article>
      </div>
    </section>

    <footer class="footer">
      <p>© 2026 PC Worth. All Rights Reserved.</p>
      <p>Developed by TUP BET-CpEt Students. Batch 2026.</p>
    </footer>

    <div class="floating-theme-toggle">
      <ThemeToggle />
    </div>
  </div>
</template>





<style scoped>
.landing {
  --landing-bg: linear-gradient(180deg, var(--bg-primary) 0%, var(--bg-secondary) 45%, var(--bg-tertiary) 100%);
  --landing-text: var(--text-primary);
  --landing-border: var(--border-light);
  --landing-muted: var(--text-secondary);
  --landing-muted-2: var(--text-secondary);
  --landing-surface: var(--bg-primary);
  --landing-surface-soft: var(--bg-secondary);
  --landing-section-soft: var(--bg-secondary);
  --landing-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
  --landing-card-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
  --landing-heading: var(--text-primary);
  --landing-subheading: var(--text-primary);
  --landing-value: var(--text-primary);
  --landing-accent-border: color-mix(in srgb, var(--accent) 35%, transparent);
  --landing-fallback-bg: linear-gradient(145deg, color-mix(in srgb, var(--accent-light) 25%, transparent), var(--bg-primary));
  --landing-fallback-border: color-mix(in srgb, var(--accent-light) 30%, transparent);
  min-height: 100vh;
  width: 100%;
  background: var(--landing-bg);
  color: var(--landing-text);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem clamp(1.5rem, 5vw, 3rem);
  border-bottom: 1px solid var(--landing-border);
  max-width: 1600px;
  margin: 0 auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.brand-logo {
  display: block;
  height: clamp(2rem, 5vw, 2.75rem);
  width: auto;
  object-fit: contain;
  border-radius: 999px;
}

.brand-text {
  font-weight: 700;
  font-size: clamp(1.1rem, 3vw, 1.75rem);
}

.nav {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Long-press “TimeWorth” brand text (3s) to reveal admin links: reduce selection / callout noise */
.admin-gate-touch-target {
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}

.user-email {
  font-size: 0.8125rem;
  color: var(--landing-muted);
}

.link {
  color: var(--landing-muted);
  text-decoration: none;
  font-size: 0.9375rem;
}

.link:hover {
  color: #38bdf8;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.2s;
  border: none;
}

.btn.primary {
  background: #0ea5e9;
  color: #fff;
}

.btn.outline {
  background: transparent;
  color: var(--landing-muted-2);
  border: 1px solid var(--landing-border);
}

.btn.ghost {
  background: transparent;
  color: var(--landing-muted-2);
}

.btn.large {
  padding: 0.65rem 1.25rem;
  font-size: 1rem;
}

.btn:hover {
  opacity: 0.9;
}

.hero {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
  align-items: center;
  padding: clamp(2rem, 8vw, 5rem) clamp(1.5rem, 5vw, 3rem);
  max-width: 1280px;
  margin: 0 auto;
}

.thesis-card p {
  text-align: justify;
}

@media (min-width: 720px) {
  .hero {
    grid-template-columns: 1fr 1fr;
    gap: 3rem;
  }
}

@media (min-width: 1280px) {
  .hero {
    padding: 4rem 3rem 5rem;
  }
}

.hero-content h1 {
  margin: 0 0 1rem;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 700;
  line-height: 1.2;
}

.tagline {
  margin: 0 0 1.5rem;
  color: var(--landing-muted-2);
  font-size: clamp(0.9375rem, 2vw, 1.0625rem);
  line-height: 1.5;
  max-width: 420px;
}

.cta,
.welcome {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.welcome p {
  margin: 0;
  color: var(--landing-muted-2);
}

.welcome strong {
  color: var(--landing-heading);
}

.hero-visual {
  display: flex;
  justify-content: center;
}

.hero-mascot {
  display: block;
  width: min(100%, 620px);
  height: auto;
  object-fit: contain;
}

@media (max-width: 719px) {
  .hero-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .cta,
  .welcome {
    justify-content: center;
  }

  .hero-visual {
    order: -1;
  }

  .hero-mascot {
    width: min(100%, 420px);
  }

  .hero {
    gap: 4rem;
  }
}

.page-section {
  padding: clamp(3rem, 10vw, 5rem) clamp(1.5rem, 5vw, 3rem);
  border-top: 1px solid var(--landing-border);
}

.page-inner {
  max-width: 960px;
  margin: 0 auto;
}

.section-title {
  margin: 0 0 0.75rem;
  font-size: clamp(1.35rem, 3vw, 1.75rem);
  font-weight: 700;
}

.section-lead {
  margin: 0 0 2rem;
  color: var(--landing-muted);
  font-size: clamp(0.9375rem, 2vw, 1.0625rem);
  line-height: 1.6;
  max-width: 52ch;
}

.thesis-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}

@media (min-width: 768px) {
  .thesis-grid {
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
}

.thesis-card {
  padding: 1.5rem 1.35rem;
  border-radius: 12px;
  background: var(--landing-surface-soft);
  border: 1px solid var(--landing-border);
  transition: background 0.2s, border-color 0.2s;
  box-shadow: var(--landing-card-shadow);
}

.thesis-card:hover {
  background: var(--landing-surface);
  border-color: var(--landing-accent-border);
}

.thesis-card-icon {
  margin-bottom: 0.75rem;
  line-height: 1;
  display: flex;
  align-items: center;
}

.thesis-card-icon .material-symbols-outlined {
  font-size: 2.5rem;
  color: #38bdf8;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}

.thesis-card h3 {
  margin: 0 0 0.5rem;
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--landing-heading);
}

.thesis-card p {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--landing-muted);
  line-height: 1.6;
}

/* “Our Process” style: solid band, white type, circular icon rings */
.how-process {
  /* Blend with the rest of the landing page */
  --how-process-fg: var(--landing-text);
  background: transparent;
  color: var(--how-process-fg);
  padding: clamp(3rem, 10vw, 5rem) clamp(1.5rem, 5vw, 3rem);
  border-top: 1px solid var(--landing-border);
}

.how-process-inner {
  max-width: 1200px;
  margin: 0 auto;
  text-align: center;
}

.how-process-title {
  margin: 0 0 0.65rem;
  font-size: clamp(1.65rem, 4vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--how-process-fg);
}

.how-process-lead {
  margin: 0 auto 2.25rem;
  max-width: 42rem;
  font-size: clamp(0.95rem, 2vw, 1.0625rem);
  line-height: 1.55;
  color: var(--landing-muted);
  font-weight: 400;
}

.how-process-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem 1.5rem;
  align-items: start;
  text-align: center;
}

@media (min-width: 560px) {
  .how-process-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 960px) {
  .how-process-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1.25rem 1.75rem;
  }
}

.how-process-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 0.35rem;
  transform: translateZ(0);
  transition: transform 180ms ease, filter 180ms ease;
}

.how-process-step:hover {
  transform: scale(1.07);
}

.how-process-step:hover .how-process-icon-ring {
  border-color: color-mix(in srgb, var(--accent) 85%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .how-process-step {
    transition: none;
  }
  .how-process-step:hover {
    transform: none;
  }
}

.how-process-icon-ring {
  width: 5.5rem;
  height: 5.5rem;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.1rem;
  flex-shrink: 0;
  transition: border-color 180ms ease;
}

.how-process-icon-ring .material-symbols-outlined {
  font-size: 2.35rem;
  color: var(--accent);
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 48;
}

.how-process-step-title {
  margin: 0 0 0.55rem;
  font-size: clamp(1rem, 2.2vw, 1.125rem);
  font-weight: 700;
  color: var(--landing-heading);
  line-height: 1.25;
}

.how-process-step-desc {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.55;
  font-style: italic;
  color: var(--landing-muted);
  max-width: 22rem;
}

.how-process-step-desc strong {
  color: var(--landing-heading);
  font-weight: 600;
  font-style: italic;
}

.thesis-credits {
  background: var(--landing-surface-soft);
}

.about-inner {
  max-width: 980px;
}

.about-inner .section-title {
  margin-bottom: 1.5rem;
}

.about-grid {
  margin-bottom: 1.25rem;
}

.about-card {
  background: var(--landing-surface);
  border: 1px solid var(--landing-border);
  border-radius: 12px;
  padding: 1.25rem;
  box-shadow: var(--landing-card-shadow);
}

.about-card h3 {
  margin: 0 0 0.75rem;
  color: var(--landing-heading);
  font-size: 1.1rem;
  font-weight: 700;
}

.about-card p {
  margin: 0 0 0.75rem;
  color: var(--landing-muted);
  line-height: 1.6;
}

.about-card p:last-child {
  margin-bottom: 0;
}

.branch-card {
  margin-top: 0.25rem;
}

.branch-grid {
  display: grid;
  gap: 0.85rem;
}

@media (min-width: 900px) {
  .branch-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.branch-item {
  padding: 0.85rem 0.95rem;
}

.branch-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.5rem;
}

.branch-icon {
  font-size: 1.1rem;
  color: var(--accent-light);
  font-variation-settings: 'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24;
}

.branch-item h4 {
  margin: 0;
  color: var(--landing-subheading);
  font-size: 0.95rem;
}

.branch-item p {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  margin: 0 0 0.35rem;
  color: var(--landing-muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.branch-detail-icon {
  font-size: 1rem;
  line-height: 1.2;
  color: var(--accent-light);
  flex-shrink: 0;
  margin-top: 0.05rem;
  font-variation-settings: 'FILL' 0, 'wght' 450, 'GRAD' 0, 'opsz' 20;
}

.branch-item p:last-child {
  margin-bottom: 0;
}

.footer {
  text-align: center;
  padding: 2rem;
  font-size: 0.8125rem;
  color: var(--landing-muted);
  border-top: 1px solid var(--landing-border);
}

.floating-theme-toggle {
  position: fixed;
  right: clamp(0.9rem, 2vw, 1.25rem);
  bottom: clamp(0.9rem, 2vw, 1.25rem);
  z-index: 1200;
}

@media (min-width: 1024px) {
  .footer {
    padding: 2rem 3rem;
  }
}
</style>
