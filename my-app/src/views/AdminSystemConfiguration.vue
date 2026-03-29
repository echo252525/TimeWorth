<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { PencilSquareIcon, TrashIcon, PlusCircleIcon } from '@heroicons/vue/24/outline'
import supabase from '../lib/supabaseClient'

export interface PositionRow {
  position_id: string
  title: string
  created_at: string
  updated_at: string
}

const rows = ref<PositionRow[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const savingId = ref<string | 'new' | null>(null)
const editingId = ref<string | null>(null)
const editTitle = ref('')
const newTitle = ref('')
const showNewRow = ref(false)

async function load() {
  loading.value = true
  error.value = null
  const { data, error: qErr } = await supabase.from('position').select('*').order('title', { ascending: true })
  loading.value = false
  if (qErr) {
    error.value = qErr.message
    return
  }
  rows.value = (data ?? []) as PositionRow[]
}

onMounted(load)

function startEdit(r: PositionRow) {
  editingId.value = r.position_id
  editTitle.value = r.title
}

function cancelEdit() {
  editingId.value = null
  editTitle.value = ''
}

async function saveEdit(r: PositionRow) {
  const t = editTitle.value.trim()
  if (!t) {
    error.value = 'Title is required'
    return
  }
  error.value = null
  savingId.value = r.position_id
  const { error: err } = await supabase.from('position').update({ title: t, updated_at: new Date().toISOString() }).eq('position_id', r.position_id)
  savingId.value = null
  if (err) {
    error.value = err.message
    return
  }
  editingId.value = null
  await load()
}

async function removeRow(r: PositionRow) {
  if (!confirm(`Remove position "${r.title}"?`)) return
  error.value = null
  savingId.value = r.position_id
  const { error: err } = await supabase.from('position').delete().eq('position_id', r.position_id)
  savingId.value = null
  if (err) {
    error.value = err.message
    return
  }
  await load()
}

function openNew() {
  showNewRow.value = true
  newTitle.value = ''
  error.value = null
}

function cancelNew() {
  showNewRow.value = false
  newTitle.value = ''
}

async function saveNew() {
  const t = newTitle.value.trim()
  if (!t) {
    error.value = 'Title is required'
    return
  }
  error.value = null
  savingId.value = 'new'
  const { error: err } = await supabase.from('position').insert({ title: t })
  savingId.value = null
  if (err) {
    error.value = err.message
    return
  }
  showNewRow.value = false
  newTitle.value = ''
  await load()
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return iso
  }
}
</script>

<template>
  <div class="page">
    <h1>System configuration</h1>
    <p class="muted">Manage job positions available for employee signup and records.</p>

    <p v-if="error" class="banner-error">{{ error }}</p>

    <div class="toolbar">
      <button type="button" class="btn-add" :disabled="loading || showNewRow" @click="openNew">
        <PlusCircleIcon class="btn-add-icon" aria-hidden="true" />
        Add position
      </button>
    </div>

    <div v-if="loading" class="loading-state">Loading…</div>

    <div v-else class="table-card">
      <div v-if="showNewRow" class="new-row">
        <input v-model="newTitle" type="text" class="input" placeholder="New position title" aria-label="New position title" @keyup.enter="saveNew" />
        <button type="button" class="btn-primary" :disabled="savingId === 'new'" @click="saveNew">{{ savingId === 'new' ? 'Saving…' : 'Save' }}</button>
        <button type="button" class="btn-ghost" :disabled="savingId === 'new'" @click="cancelNew">Cancel</button>
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Created</th>
              <th scope="col" class="th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.position_id" class="data-row">
              <td>
                <template v-if="editingId === r.position_id">
                  <input v-model="editTitle" type="text" class="input input-inline" :aria-label="`Edit title for ${r.title}`" @keyup.enter="saveEdit(r)" />
                </template>
                <template v-else>
                  {{ r.title }}
                </template>
              </td>
              <td class="td-muted">{{ formatDate(r.created_at) }}</td>
              <td class="td-actions">
                <template v-if="editingId === r.position_id">
                  <button type="button" class="btn-icon btn-save" :disabled="savingId === r.position_id" title="Save" @click="saveEdit(r)">
                    Save
                  </button>
                  <button type="button" class="btn-icon btn-cancel" :disabled="savingId === r.position_id" title="Cancel" @click="cancelEdit">Cancel</button>
                </template>
                <template v-else>
                  <button type="button" class="btn-icon" title="Edit title" :disabled="savingId !== null" @click="startEdit(r)">
                    <PencilSquareIcon class="icon" aria-hidden="true" />
                    <span class="sr-only">Edit</span>
                  </button>
                  <button type="button" class="btn-icon btn-danger" title="Remove" :disabled="savingId !== null" @click="removeRow(r)">
                    <TrashIcon class="icon" aria-hidden="true" />
                    <span class="sr-only">Remove</span>
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!rows.length && !showNewRow" class="empty-hint">No positions yet. Click “Add position” to create one.</p>
    </div>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 960px;
}
.page h1 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}
.muted {
  color: var(--text-secondary);
  font-size: 0.9375rem;
  margin: 0 0 1rem;
}
.banner-error {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.12);
  color: var(--error, #f87171);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
.toolbar {
  margin-bottom: 1rem;
}
.btn-add {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-add:hover:not(:disabled) {
  background: var(--bg-hover);
}
.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-add-icon {
  width: 1.25rem;
  height: 1.25rem;
}
.loading-state {
  color: var(--text-tertiary);
  padding: 1rem 0;
}
.table-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1rem;
}
.new-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}
.input {
  flex: 1;
  min-width: 200px;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.9375rem;
}
.input-inline {
  min-width: 0;
  width: 100%;
  max-width: 320px;
}
.input:focus {
  outline: none;
  border-color: var(--accent);
}
.table-scroll {
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.data-table th,
.data-table td {
  padding: 0.65rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}
.data-table th {
  color: var(--text-tertiary);
  font-weight: 600;
}
.th-actions {
  width: 7rem;
  text-align: right;
}
.td-muted {
  color: var(--text-secondary);
}
.td-actions {
  text-align: right;
  white-space: nowrap;
}
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem;
  margin-left: 0.25rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  vertical-align: middle;
}
.btn-icon:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.12);
}
.btn-icon .icon {
  width: 1.25rem;
  height: 1.25rem;
}
.btn-danger {
  color: var(--error, #f87171);
}
.btn-danger:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.12);
}
.btn-save,
.btn-cancel {
  font-size: 0.8125rem;
  padding: 0.35rem 0.6rem;
  margin-left: 0.35rem;
}
.btn-primary {
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  border: none;
  background: var(--accent);
  color: #fff;
  font-weight: 500;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-ghost {
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.empty-hint {
  margin: 1rem 0 0;
  color: var(--text-tertiary);
  font-size: 0.875rem;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
