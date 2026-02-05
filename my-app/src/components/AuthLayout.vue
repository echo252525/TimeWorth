<script setup lang="ts"></script>
<template>
  <div class="auth-page">
    <div class="auth-card"><slot /></div>
  </div>
</template>
<style scoped>
.auth-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; background: linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); }
.auth-card { width: 100%; max-width: 400px; padding: clamp(1.25rem, 4vw, 2rem); background: rgba(255,255,255,0.04); border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); }
</style>
<style>
.auth-card .auth-form { display: flex; flex-direction: column; gap: 0.875rem; }
.auth-card .auth-form .field { display: flex; flex-direction: column; gap: 0.25rem; }
.auth-card .auth-form label { font-size: 0.8125rem; color: #94a3b8; }
.auth-card .auth-form input { padding: 0.5rem 0.75rem; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; background: rgba(0,0,0,0.25); color: #f1f5f9; font-size: 0.9375rem; }
.auth-card .auth-form input::placeholder { color: #64748b; }
.auth-card .auth-form input:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,0.15); }
.auth-card .auth-form .error { margin: 0; font-size: 0.8125rem; color: #f87171; }
.auth-card .auth-form .btn { padding: 0.6rem 1rem; border: none; border-radius: 8px; font-size: 0.9375rem; font-weight: 500; cursor: pointer; transition: opacity 0.2s; }
.auth-card .auth-form .btn.primary { background: #0ea5e9; color: #fff; }
.auth-card .auth-form .btn:disabled { opacity: 0.7; cursor: not-allowed; }
.auth-card .auth-form .footer { margin-top: 1rem; font-size: 0.8125rem; color: #64748b; }
.auth-card .auth-form .footer a { color: #38bdf8; text-decoration: none; }
.auth-card .auth-form .footer a:hover { text-decoration: underline; }
.auth-card .auth-form h1 { margin: 0 0 1.25rem; font-size: 1.375rem; font-weight: 600; color: #f1f5f9; }
</style>
