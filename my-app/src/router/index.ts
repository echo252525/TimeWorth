import { createRouter, createWebHistory } from 'vue-router'
import DashboardLayout from '../components/DashboardLayout.vue'
import AdminLayout from '../components/AdminLayout.vue'
import supabase from '../lib/supabaseClient'

async function getAuthenticatedHomeRedirect() {
  const {
    data: { session }
  } = await supabase.auth.getSession()

  const uid = session?.user?.id
  if (!uid) return null

  const { data: adminRow } = await supabase
    .from('admin')
    .select('id')
    .eq('id', uid)
    .maybeSingle()

  if (adminRow) return { name: 'AdminHome' as const }

  const { data: employeeRow } = await supabase
    .from('employee')
    .select('id')
    .eq('id', uid)
    .maybeSingle()

  if (employeeRow) return { name: 'Dashboard' as const }

  return { name: 'Dashboard' as const }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('../views/HomeView.vue'),
      beforeEnter: async () => {
        const redirect = await getAuthenticatedHomeRedirect()
        return redirect ?? true
      }
    },
    { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue') },
    { path: '/signup', name: 'Signup', component: () => import('../views/SignupView.vue') },
    { path: '/forgot-password', name: 'ForgotPassword', component: () => import('../views/ForgotPasswordView.vue') },
    { path: '/reset-password', name: 'ResetPassword', component: () => import('../views/ResetPasswordView.vue') },
    {
      path: '/dashboard',
      component: DashboardLayout,
      children: [
        { path: '', name: 'Dashboard', component: () => import('../views/DashboardView.vue') },
        { path: 'timeclock', name: 'Timeclock', component: () => import('../views/TimeclockView.vue') },
        { path: 'timesheet', name: 'Timesheet', component: () => import('../views/TimesheetView.vue') },
        { path: 'settings', name: 'Settings', component: () => import('../views/SettingsView.vue') }
      ]
    },
    { path: '/admin/login', name: 'AdminLogin', component: () => import('../views/AdminLoginView.vue') },
    { path: '/admin/signup', name: 'AdminSignup', component: () => import('../views/AdminSignupView.vue') },
    {
      path: '/admin',
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

export default router
