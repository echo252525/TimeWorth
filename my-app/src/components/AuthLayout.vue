<script setup lang="ts"></script>
<template>
  <div class="auth-page">
    <div class="auth-card"><slot /></div>
  </div>
</template>

<!-- LOGIN STYLES (some are shared css for both login and signup) -->
<style scoped>
.auth-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; background: linear-gradient(160deg, var(--bg-secondary) 0%, var(--bg-tertiary) 50%, var(--bg-secondary) 100%); }
.auth-card { width: 100%; max-width: 400px; padding: clamp(1.25rem, 4vw, 2rem); background: var(--bg-primary); border-radius: 16px; border: 1px solid var(--border-light); }
</style>

<!-- SIGNUP STYLES (some are shared css for both login and signup) -->
<style>
.auth-card .auth-form { display: flex; flex-direction: column; gap: 0.875rem; }
.auth-card .auth-form .field { display: flex; flex-direction: column; gap: 0.25rem; }

.auth-card .auth-form label { font-size: 0.8125rem; color: var(--text-secondary); }
.auth-card .auth-form input { padding: 0.5rem 0.75rem; border: 1px solid var(--border-light); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); font-size: 0.9375rem; }
.auth-card .auth-form input::placeholder { color: var(--text-tertiary); }
.auth-card .auth-form input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15); }

.auth-card .auth-form .error { margin: 0; font-size: 0.8125rem; color: var(--error); }
.auth-card .auth-form .btn.primary { padding: 0.6rem 1rem; border: none; border-radius: 8px; font-size: 0.9375rem; font-weight: 500; cursor: pointer; transition: opacity 0.2s; background: var(--accent-light); color: #fff; }
.auth-card .auth-form .btn.primary:disabled { opacity: 0.7; cursor: not-allowed; }

.auth-card .footer { margin-top: 1rem; font-size: 0.9rem; color: var(--text-tertiary); text-align: center; }
.auth-card .footer a { color: var(--accent); text-decoration: none; }
.auth-card .footer a:hover { text-decoration: underline; }
.auth-card .auth-form h1 { margin: 0 0 1.25rem; font-size: 1.375rem; font-weight: 600; color: var(--text-primary); }

.auth-card .auth-actions-row {
  display: flex;
  align-items: stretch;
  gap: 0.75rem;
}

.auth-card .auth-actions-row .btn {
  flex: 1 1 0;
  min-width: 0;
}

.auth-card .auth-footer-row {
  margin-top: 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.auth-card .auth-footer-row .footer {
  margin-top: 0;
  text-align: right;
}

.auth-title {
  text-align: center;
  margin-top: 0rem;
  margin-bottom: 1rem;
}

.input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
}

.input-with-icon input {
  width: 100%;
  padding-right: 2.5rem;
}

.icon-btn {
  position: absolute;
  right: 0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.1rem;
  height: 2.1rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.icon-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15);
}

.icon {
  display: block;
}

.auth-success-banner {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1rem 1.125rem;
  border-radius: 12px;
  border: 1px solid rgba(56, 189, 248, 0.35);
  background: rgba(56, 189, 248, 0.08);
  color: var(--text-primary);
  text-align: center;
}

.auth-success-banner__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.auth-success-banner__text {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--text-secondary);
}

.auth-success-banner__cta {
  align-self: center;
  margin-top: 0.25rem;
  text-decoration: none;
  text-align: center;
  display: inline-block;
  padding: 0.6rem 1rem;
  border: none;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-weight: 500;
  background: var(--accent-light);
  color: #fff;
}
</style>
