import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'Landing', component: () => import('../views/LandingView.vue') },
    { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue') },
    { path: '/signup', name: 'Signup', component: () => import('../views/SignupView.vue') },
    { path: '/dashboard', name: 'Dashboard', component: () => import('../views/HomeView.vue') },
  ],
})

export default router
