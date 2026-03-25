<script setup lang="ts"></script>
<template>
  <div class="auth-page">
    <div class="auth-card"><slot /></div>
  </div>
</template>
<style scoped>
.auth-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; background: linear-gradient(160deg, var(--bg-secondary) 0%, var(--bg-tertiary) 50%, var(--bg-secondary) 100%); }
.auth-card { width: 100%; max-width: 400px; padding: clamp(1.25rem, 4vw, 2rem); background: var(--bg-primary); border-radius: 16px; border: 1px solid var(--border-light); }
</style>
<style>
.auth-card .auth-form { display: flex; flex-direction: column; gap: 0.875rem; }
.auth-card .auth-form .field { display: flex; flex-direction: column; gap: 0.25rem; }
.auth-card .auth-form label { font-size: 0.8125rem; color: var(--text-secondary); }
.auth-card .auth-form input { padding: 0.5rem 0.75rem; border: 1px solid var(--border-light); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); font-size: 0.9375rem; }
.auth-card .auth-form input::placeholder { color: var(--text-tertiary); }
.auth-card .auth-form input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15); }
.auth-card .auth-form .error { margin: 0; font-size: 0.8125rem; color: var(--error); }
.auth-card .auth-form .btn { padding: 0.6rem 1rem; border: none; border-radius: 8px; font-size: 0.9375rem; font-weight: 500; cursor: pointer; transition: opacity 0.2s; }
.auth-card .auth-form .btn.primary { background: var(--accent-light); color: #fff; }
.auth-card .auth-form .btn:disabled { opacity: 0.7; cursor: not-allowed; }
.auth-card .auth-form .footer { margin-top: 1rem; font-size: 0.8125rem; color: var(--text-tertiary); }
.auth-card .auth-form .footer a { color: var(--accent); text-decoration: none; }
.auth-card .auth-form .footer a:hover { text-decoration: underline; }
.auth-card .auth-form h1 { margin: 0 0 1.25rem; font-size: 1.375rem; font-weight: 600; color: var(--text-primary); }
</style>
