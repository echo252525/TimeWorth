import { createRouter, createWebHistory } from 'vue-router'
import DashboardLayout from '../components/DashboardLayout.vue'
import AdminLayout from '../components/AdminLayout.vue'
import supabase from '../lib/supabaseClient'

type AuthKind = 'guest' | 'employee' | 'admin'

async function getAuthKind(): Promise<AuthKind> {
  const {
    data: { session }
  } = await supabase.auth.getSession()

  const uid = session?.user?.id
  if (!uid) return 'guest'

  const { data: adminRow } = await supabase
    .from('admin')
    .select('id, role')
    .eq('id', uid)
    .maybeSingle()

  if (adminRow && (adminRow.role === 'admin' || adminRow.role === 'superadmin')) return 'admin'

  const { data: employeeRow } = await supabase
    .from('employee')
    .select('id')
    .eq('id', uid)
    .maybeSingle()

  if (employeeRow) return 'employee'

  return 'guest'
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('../views/HomeView.vue')
    },
    { path: '/login', name: 'Login', meta: { guestOnly: true }, component: () => import('../views/LoginView.vue') },
    { path: '/signup', name: 'Signup', meta: { guestOnly: true }, component: () => import('../views/SignupView.vue') },
    { path: '/forgot-password', name: 'ForgotPassword', meta: { guestOnly: true }, component: () => import('../views/ForgotPasswordView.vue') },
    { path: '/reset-password', name: 'ResetPassword', component: () => import('../views/ResetPasswordView.vue') },
    {
      path: '/dashboard',
      meta: { requiresAuth: 'employee' },
      component: DashboardLayout,
      children: [
        { path: '', name: 'Dashboard', component: () => import('../views/DashboardView.vue') },
        { path: 'timeclock', name: 'Timeclock', component: () => import('../views/TimeclockView.vue') },
        { path: 'timesheet', name: 'Timesheet', component: () => import('../views/TimesheetView.vue') },
        { path: 'settings', name: 'Settings', component: () => import('../views/SettingsView.vue') }
      ]
    },
    { path: '/admin/login', name: 'AdminLogin', meta: { guestOnly: true }, component: () => import('../views/AdminLoginView.vue') },
    { path: '/admin/signup', name: 'AdminSignup', meta: { guestOnly: true }, component: () => import('../views/AdminSignupView.vue') },
    {
      path: '/admin',
      meta: { requiresAuth: 'admin' },
      component: AdminLayout,
      children: [
        { path: '', name: 'AdminHome', component: () => import('../views/AdminHomeView.vue') },
        { path: 'employees', name: 'AdminEmployees', component: () => import('../views/AdminEmployeesView.vue') },
        { path: 'edit-requests', name: 'AdminEditRequests', component: () => import('../views/AdminEditRequestsView.vue') },
        { path: 'system-configuration', name: 'AdminSystemConfiguration', component: () => import('../views/AdminSystemConfiguration.vue') },
        { path: 'settings', name: 'AdminSettings', component: () => import('../views/AdminSettingsView.vue') }
      ]
    }
  ]
})

router.beforeEach(async (to) => {
  const authKind = await getAuthKind()

  const requiresEmployee = to.matched.some((r) => r.meta.requiresAuth === 'employee')
  const requiresAdmin = to.matched.some((r) => r.meta.requiresAuth === 'admin')
  const guestOnly = to.matched.some((r) => r.meta.guestOnly === true)

  if (to.path === '/') {
    if (authKind === 'admin') return { name: 'AdminHome', replace: true }
    if (authKind === 'employee') return { name: 'Dashboard', replace: true }
    return true
  }

  if (requiresEmployee && authKind !== 'employee') {
    return { name: 'Login', replace: true }
  }

  if (requiresAdmin && authKind !== 'admin') {
    return { name: 'AdminLogin', replace: true }
  }

  if (guestOnly && authKind === 'employee') {
    return { name: 'Dashboard', replace: true }
  }

  if (guestOnly && authKind === 'admin') {
    return { name: 'AdminHome', replace: true }
  }

  return true
})

export default router
