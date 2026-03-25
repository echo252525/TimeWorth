import { createRouter, createWebHistory } from 'vue-router'
import DashboardLayout from '../components/DashboardLayout.vue'
import AdminLayout from '../components/AdminLayout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'Home', component: () => import('../views/HomeView.vue') },
    { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue') },
    { path: '/signup', name: 'Signup', component: () => import('../views/SignupView.vue') },
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
        { path: 'settings', name: 'AdminSettings', component: () => import('../views/AdminSettingsView.vue') }
      ]
    }
  ]
})

export default router
