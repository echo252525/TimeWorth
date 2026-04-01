<script setup lang="ts">
import { onMounted, ref, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useAdminAuth, getSignedAdminProfileUrl } from '../composables/useAdminAuth'
import {
  HomeIcon,
  UsersIcon,
  PencilSquareIcon,
  RectangleStackIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon
} from '@heroicons/vue/24/outline'
import ThemeToggle from './ThemeToggle.vue'

const router = useRouter()
const route = useRoute()
const { user } = useAuth()
const { adminProfile, isAdmin, signOut, fetchAdminProfile } = useAdminAuth()

/** Signed URL for header avatar (private bucket). */
const headerAvatarUrl = ref<string | null>(null)

async function refreshHeaderAvatar() {
  const pic = adminProfile.value?.picture
  if (!pic) {
    headerAvatarUrl.value = null
    return
  }
  if (pic.startsWith('http')) {
    headerAvatarUrl.value = pic
    return
  }
  headerAvatarUrl.value = await getSignedAdminProfileUrl(pic)
}

watch(() => adminProfile.value?.picture, () => { void refreshHeaderAvatar() }, { immediate: true })

function onProfileUpdated() {
  void fetchAdminProfile().then(() => refreshHeaderAvatar())
}

const collapsed = ref(false)
const mobileOpen = ref(false)
const isMobile = ref(false)
const MOBILE_BP = 768
function checkMobile() {
  isMobile.value = window.innerWidth < MOBILE_BP
  if (!isMobile.value) mobileOpen.value = false
}
onMounted(async () => {
  const profile = await fetchAdminProfile()
  if (!profile) {
    router.replace('/admin/login')
    return
  }
  if (profile.role === 'pending') {
    await signOut()
    router.replace({ path: '/admin/login', query: { pending: '1' } })
    return
  }
  if (profile.role !== 'admin' && profile.role !== 'superadmin') {
    await signOut()
    router.replace('/admin/login')
    return
  }
  checkMobile()
  window.addEventListener('resize', checkMobile)
  window.addEventListener('profile-updated', onProfileUpdated)
})
onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  window.removeEventListener('profile-updated', onProfileUpdated)
})

async function logout() {
  await signOut()
  router.replace('/')
}
function go(to: string) {
  router.push(to)
  mobileOpen.value = false
}

const nav = [
  { path: '/admin', label: 'Home', icon: HomeIcon },
  { path: '/admin/employees', label: 'Employees', icon: UsersIcon },
  { path: '/admin/edit-requests', label: 'Edit request', icon: PencilSquareIcon },
  { path: '/admin/system-configuration', label: 'System configuration', icon: RectangleStackIcon },
  { path: '/admin/settings', label: 'Settings', icon: Cog6ToothIcon }
]
function isActive(path: string) {
  return path === '/admin' ? route.path === '/admin' : route.path.startsWith(path)
}
</script>
<template>
  <div v-if="isAdmin" class="layout" :class="{ 'sidebar-collapsed': collapsed && !isMobile }">
    <button type="button" class="burger" :class="{ open: isMobile && mobileOpen }" :aria-label="isMobile && mobileOpen ? 'Close menu' : 'Open menu'" @click="mobileOpen = !mobileOpen">
      <span class="material-symbols-outlined toggle-icon">{{ isMobile && mobileOpen ? 'close' : 'menu' }}</span>
    </button>
    <Transition name="overlay"><div v-if="mobileOpen" class="sidebar-backdrop" @click="mobileOpen = false" aria-hidden="true" /></Transition>
    <aside class="sidebar" :class="{ collapsed: collapsed && !isMobile, mobile: isMobile, 'mobile-open': mobileOpen }">
      <div class="sidebar-top" :class="{ 'collapsed-top': collapsed && !isMobile }">
        <div v-if="!collapsed || isMobile" class="account-head">
          <img v-if="headerAvatarUrl" :src="headerAvatarUrl" class="account-avatar" alt="" @error="headerAvatarUrl = null" />
          <span v-else class="account-avatar placeholder">{{ (adminProfile?.name || adminProfile?.email || '?').slice(0, 1).toUpperCase() }}</span>
          <div class="account-meta">
            <span class="account-name">{{ adminProfile?.name || 'Admin' }}</span>
            <span class="account-email">{{ adminProfile?.email }}</span>
          </div>
        </div>
        <button type="button" class="collapse-btn" :aria-label="collapsed ? 'Expand' : 'Collapse'" @click="collapsed = !collapsed">
          <span class="material-symbols-outlined collapse-icon">{{ collapsed ? 'menu' : 'close' }}</span>
        </button>
      </div>
      <nav class="nav">
        <button v-for="item in nav" :key="item.path" type="button" class="nav-link" :class="{ active: isActive(item.path) }" @click="go(item.path)">
          <component :is="item.icon" class="nav-icon" />
          <Transition name="nav-label"><span v-if="!collapsed || isMobile" class="nav-text">{{ item.label }}</span></Transition>
        </button>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-footer-actions">
          <ThemeToggle :compact="collapsed && !isMobile" />
          <button type="button" class="btn-logout" :class="{ 'btn-logout-collapsed': collapsed && !isMobile }" @click="logout" :title="collapsed && !isMobile ? 'Logout' : ''">
            <ArrowRightOnRectangleIcon class="logout-icon" />
            <Transition name="nav-label">
              <span v-if="!collapsed || isMobile" class="logout-text">Logout</span>
            </Transition>
          </button>
        </div>
      </div>
    </aside>
    <main class="main">
      <header class="main-header">
        <div class="header-title-section">
          <img src="/TimeWorthLogo.png" alt="TimeWorth" class="header-logo" />
          <div class="header-title-copy">
            <h1 class="app-title">TimeWorth</h1>
            <p class="app-tagline">An attendance app for PC Worth employees</p>
          </div>
        </div>
      </header>
      <div class="main-content"><router-view /></div>
    </main>
  </div>
</template>


<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
  width: 100%;
  background: var(--bg-primary);
  color: var(--text-primary);
  position: relative;
}

.burger {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 100;
  width: 100%;
  height: 52px;
  align-items: center;
  justify-content: flex-start;
  cursor: pointer;
  padding: 0 1rem;
  border: none;
  background: var(--bg-secondary);
  color: inherit;
}

.toggle-icon {
  font-size: 28px;
  line-height: 1;
  color: var(--text-secondary);
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}

.sidebar-backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: 40;
}

.sidebar {
  --sidebar-brand-mark-size: 28px;
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  width: 240px;
  flex-shrink: 0;
  padding: 1rem 0;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease, transform 0.3s ease;
  background: var(--bg-secondary);
  z-index: 50;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
}

@media (min-width: 1024px) {
  .sidebar {
    width: 260px;
  }
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem 1.5rem;
}

.sidebar-top.collapsed-top {
  justify-content: center;
  padding-left: 0.35rem;
  padding-right: 0.35rem;
}

.account-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  flex: 1;
}

.account-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.account-avatar.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(56, 189, 248, 0.3);
  color: var(--accent);
  font-weight: 600;
  font-size: 0.875rem;
}

.account-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.account-name {
  font-size: 0.82rem;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-email {
  font-size: 0.72rem;
  color: var(--text-tertiary);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapse-btn {
  position: static;
  width: var(--sidebar-brand-mark-size);
  height: var(--sidebar-brand-mark-size);
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 0;
  margin-top: 0.2rem;
  transition: color 0.2s;
  box-shadow: none;
  outline: none;
}

.collapse-btn:hover {
  color: var(--text-primary);
}

.collapse-icon {
  font-size: var(--sidebar-brand-mark-size);
  line-height: 1;
  flex-shrink: 0;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}

.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0.5rem;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.9375rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s, color 0.2s;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}

.nav-link:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-link.active {
  background: rgba(56, 189, 248, 0.15);
  color: var(--accent);
}

.nav-icon {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
}

.nav-text {
  white-space: nowrap;
  overflow: hidden;
}

.sidebar-footer {
  padding: 0.75rem;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  box-sizing: border-box;
  max-width: 100%;
}

.sidebar.collapsed .sidebar-footer {
  padding-left: 0.35rem;
  padding-right: 0.35rem;
}

.sidebar-footer-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.sidebar.collapsed .sidebar-footer-actions {
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
}

.sidebar.collapsed .sidebar-footer-actions :deep(.theme-slide) {
  max-width: 100%;
  flex-shrink: 1;
  min-width: 0;
}

.btn-logout {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  font-size: 0.8125rem;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
  transition: color 0.2s, border-color 0.2s;
  box-sizing: border-box;
}

.sidebar.collapsed .btn-logout {
  width: 100%;
  flex: none;
}

.btn-logout:hover {
  color: var(--error);
  border-color: rgba(248, 113, 113, 0.4);
}

.btn-logout-collapsed {
  padding: 0.4rem;
  justify-content: center;
}

.logout-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

.logout-text {
  white-space: nowrap;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  margin-left: 240px;
  transition: margin-left 0.3s ease;
}

@media (min-width: 1024px) {
  .main {
    margin-left: 260px;
  }
}

.layout.sidebar-collapsed .main {
  margin-left: 64px;
}

.main-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.header-title-section {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-logo {
  width: auto;
  height: 36px;
  object-fit: contain;
  flex-shrink: 0;
}

.header-title-copy {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.app-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.app-tagline {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.main-content {
  flex: 1;
  padding: 1.5rem;
  overflow: auto;
  min-height: 0;
}

@media (min-width: 1024px) {
  .main-content {
    padding: 2rem 2.5rem;
    width: 100%;
    box-sizing: border-box;
  }
}

@media (max-width: 767px) {
  .burger {
    display: flex;
  }

  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 260px;
    transform: translateX(-100%);
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.3);
    padding-top: 52px;
  }

  .sidebar.mobile-open {
    transform: translateX(0);
  }

  .sidebar.collapsed {
    width: 260px;
  }

  .collapse-btn {
    display: none;
  }

  .main {
    margin-left: 0;
    padding-top: 52px;
  }

  .main-header {
    padding-top: 0.5rem;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .header-title-section {
    width: 100%;
  }

  .header-logo {
    height: 30px;
  }

  .app-title {
    font-size: 1.125rem;
  }

  .app-tagline {
    font-size: 0.75rem;
  }
}

.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.25s ease;
}

.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}

.nav-label-enter-active,
.nav-label-leave-active {
  transition: opacity 0.2s ease;
}

.nav-label-enter-from,
.nav-label-leave-to {
  opacity: 0;
}

/* Keep Leaflet UI below the admin sidebar/backdrop. */
:deep(.leaflet-pane),
:deep(.leaflet-map-pane),
:deep(.leaflet-tile-pane),
:deep(.leaflet-overlay-pane),
:deep(.leaflet-shadow-pane),
:deep(.leaflet-marker-pane),
:deep(.leaflet-tooltip-pane),
:deep(.leaflet-popup-pane) {
  z-index: 1;
}
:deep(.leaflet-top),
:deep(.leaflet-bottom),
:deep(.leaflet-control) {
  z-index: 10;
}
</style>
