import { createRouter, createWebHistory } from 'vue-router'
import DashboardLayout from '../components/DashboardLayout.vue'

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
    }
  ]
})

export default router
