<script setup lang="ts">
import { onMounted, ref, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import supabase from '../lib/supabaseClient'

const router = useRouter()
const route = useRoute()
const { user, isLoggedIn, signOut, getSignedProfileUrl } = useAuth()

const collapsed = ref(false)
const mobileOpen = ref(false)
const isMobile = ref(false)
const employeeName = ref<string | null>(null)
const profileUrl = ref<string | null>(null)

async function loadProfile() {
  if (!user.value?.id) return
  employeeName.value = null
  profileUrl.value = null
  const { data } = await supabase.from('employee').select('name, picture').eq('id', user.value.id).maybeSingle()
  if (!data) return
  employeeName.value = data.name
  const pathOrUrl = data.picture
  if (!pathOrUrl) return
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    profileUrl.value = pathOrUrl
  } else {
    profileUrl.value = await getSignedProfileUrl(pathOrUrl)
  }
}
watch(user, loadProfile, { immediate: true })

const MOBILE_BP = 768
function checkMobile() {
  isMobile.value = window.innerWidth < MOBILE_BP
  if (!isMobile.value) mobileOpen.value = false
}
onMounted(() => {
  if (!isLoggedIn.value) router.replace('/login')
  checkMobile()
  window.addEventListener('resize', checkMobile)
})
onUnmounted(() => window.removeEventListener('resize', checkMobile))

async function logout() {
  await signOut()
  router.push('/')
}

function go(to: string) {
  router.push(to)
  mobileOpen.value = false
}

const nav = [
  { path: '/dashboard', label: 'Dashboard', icon: '◉' },
  { path: '/dashboard/timeclock', label: 'Timeclock', icon: '⏱' },
  { path: '/dashboard/timesheet', label: 'Timesheet', icon: '📋' },
  { path: '/dashboard/settings', label: 'Settings', icon: '⚙' }
]

function isActive(path: string) {
  return path === '/dashboard' ? route.path === '/dashboard' : route.path === path
}
</script>
<template>
  <div v-if="isLoggedIn" class="layout">
    <div class="burger" :class="{ open: mobileOpen }" @click="mobileOpen = !mobileOpen" aria-label="Menu">
      <span></span><span></span><span></span>
    </div>
    <Transition name="overlay">
      <div v-if="mobileOpen" class="sidebar-backdrop" @click="mobileOpen = false" aria-hidden="true" />
    </Transition>
    <aside class="sidebar" :class="{ collapsed: collapsed && !isMobile, mobile: isMobile, 'mobile-open': mobileOpen }">
      <div class="logo-placeholder" title="Logo">
        <span v-if="!collapsed || isMobile">Logo</span>
      </div>
      <button type="button" class="collapse-btn" :aria-label="collapsed ? 'Expand' : 'Collapse'" @click="collapsed = !collapsed">
        {{ collapsed ? '›' : '‹' }}
      </button>
      <nav class="nav">
        <button
          v-for="item in nav"
          :key="item.path"
          type="button"
          class="nav-link"
          :class="{ active: isActive(item.path) }"
          @click="go(item.path)"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <Transition name="nav-label">
            <span v-if="!collapsed || isMobile" class="nav-text">{{ item.label }}</span>
          </Transition>
        </button>
      </nav>
      <div class="sidebar-footer">
        <Transition name="nav-label">
          <span v-if="!collapsed || isMobile" class="user-email">{{ user?.email }}</span>
        </Transition>
        <button type="button" class="btn-logout" @click="logout">Logout</button>
      </div>
    </aside>
    <main class="main">
      <header class="main-header">
        <button type="button" class="profile-trigger" @click="go('/dashboard/settings')">
          <img v-if="profileUrl" :src="profileUrl" class="profile-avatar" alt="" />
          <span v-else class="profile-avatar placeholder">{{ (employeeName || user?.email || '?').slice(0, 1).toUpperCase() }}</span>
          <span class="profile-name">{{ employeeName || user?.email }}</span>
        </button>
      </header>
      <div class="main-content"><router-view /></div>
    </main>
  </div>
</template>
<style scoped>
.layout { display: flex; min-height: 100vh; background: #0f172a; color: #f1f5f9; position: relative; }
.burger { display: none; position: fixed; top: 1rem; left: 1rem; z-index: 100; width: 28px; height: 22px; flex-direction: column; justify-content: space-between; cursor: pointer; padding: 4px; }
.burger span { display: block; height: 3px; background: #94a3b8; border-radius: 2px; transition: transform 0.25s, opacity 0.25s; }
.burger.open span:nth-child(1) { transform: translateY(9.5px) rotate(45deg); }
.burger.open span:nth-child(2) { opacity: 0; }
.burger.open span:nth-child(3) { transform: translateY(-9.5px) rotate(-45deg); }
.sidebar-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 40; }
.sidebar {
  position: relative;
  width: 240px; flex-shrink: 0; padding: 1rem 0; border-right: 1px solid rgba(255,255,255,0.08);
  display: flex; flex-direction: column; transition: width 0.3s ease, transform 0.3s ease;
  background: #0f172a; z-index: 50;
}
.sidebar.collapsed { width: 64px; }
.sidebar.collapsed .logo-placeholder span { display: none; }
.sidebar.collapsed .collapse-btn { left: 50%; right: auto; transform: translateX(-50%); }
.logo-placeholder {
  height: 48px; margin: 0 0.75rem 1rem; border-radius: 10px; background: rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: center; font-size: 0.875rem; color: #64748b;
  flex-shrink: 0; position: relative;
}
.collapse-btn {
  position: absolute; top: 1.5rem; right: -12px; width: 24px; height: 24px; border-radius: 50%;
  background: #1e293b; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; cursor: pointer;
  font-size: 1rem; line-height: 1; display: flex; align-items: center; justify-content: center;
  transition: background 0.2s, color 0.2s; z-index: 10;
}
.collapse-btn:hover { background: #334155; color: #e2e8f0; }
.nav { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 0 0.5rem; overflow: hidden; }
.nav-link {
  display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem; border: none; border-radius: 8px;
  background: transparent; color: #94a3b8; font-size: 0.9375rem; cursor: pointer; text-align: left;
  transition: background 0.2s, color 0.2s; width: 100%;
}
.nav-link:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; }
.nav-link.active { background: rgba(56,189,248,0.15); color: #38bdf8; }
.nav-icon { font-size: 1.1rem; flex-shrink: 0; width: 1.5rem; text-align: center; }
.nav-text { white-space: nowrap; overflow: hidden; }
.sidebar-footer { padding: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06); }
.user-email { font-size: 0.7rem; color: #64748b; display: block; margin-bottom: 0.5rem; overflow: hidden; text-overflow: ellipsis; }
.btn-logout { padding: 0.4rem 0.75rem; font-size: 0.8125rem; background: transparent; color: #94a3b8; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; cursor: pointer; width: 100%; transition: color 0.2s, border-color 0.2s; }
.btn-logout:hover { color: #f87171; border-color: rgba(248,113,113,0.4); }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.main-header { flex-shrink: 0; display: flex; justify-content: flex-end; align-items: center; padding: 0.75rem 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
.profile-trigger { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem; border: none; border-radius: 8px; background: transparent; color: #e2e8f0; cursor: pointer; font-size: 0.9375rem; transition: background 0.2s; }
.profile-trigger:hover { background: rgba(255,255,255,0.06); }
.profile-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
.profile-avatar.placeholder { display: flex; align-items: center; justify-content: center; background: rgba(56,189,248,0.3); color: #38bdf8; font-weight: 600; font-size: 0.875rem; }
.profile-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.main-content { flex: 1; padding: 1.5rem; overflow: auto; }
@media (max-width: 767px) { .profile-name { max-width: 100px; } }
@media (max-width: 767px) {
  .burger { display: flex; }
  .sidebar { position: fixed; left: 0; top: 0; bottom: 0; width: 260px; transform: translateX(-100%); box-shadow: 4px 0 24px rgba(0,0,0,0.3); }
  .sidebar.mobile-open { transform: translateX(0); }
  .sidebar.collapsed { width: 260px; }
  .collapse-btn { display: none; }
  .main { margin-left: 0; padding-top: 3rem; }
  .main-header { padding-top: 0.5rem; }
}
.overlay-enter-active, .overlay-leave-active { transition: opacity 0.25s ease; }
.overlay-enter-from, .overlay-leave-to { opacity: 0; }
.nav-label-enter-active, .nav-label-leave-active { transition: opacity 0.2s ease; }
.nav-label-enter-from, .nav-label-leave-to { opacity: 0; }
</style>
