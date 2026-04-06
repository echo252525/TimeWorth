import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type JsonRecord = Record<string, unknown>

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(status: number, body: JsonRecord) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: 'Missing required environment variables' })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { error: 'Missing bearer token' })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  })

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const {
    data: { user: caller },
    error: callerErr
  } = await userClient.auth.getUser()

  if (callerErr || !caller) {
    return json(401, { error: 'Unauthorized' })
  }

  const { data: callerAdmin, error: callerAdminErr } = await adminClient
    .from('admin')
    .select('id, role')
    .eq('id', caller.id)
    .maybeSingle()

  if (callerAdminErr) {
    return json(500, { error: callerAdminErr.message })
  }
  if (!callerAdmin || callerAdmin.role !== 'superadmin') {
    return json(403, { error: 'Only superadmin can delete other admin accounts' })
  }

  let payload: { targetUserId?: string } = {}
  try {
    const text = await req.text()
    if (text.trim()) payload = JSON.parse(text)
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const targetUserId = String(payload.targetUserId ?? '').trim()
  if (!targetUserId) {
    return json(400, { error: 'targetUserId is required' })
  }
  if (targetUserId === caller.id) {
    return json(400, { error: 'Cannot delete your own account from this endpoint' })
  }

  const { data: targetAdmin, error: targetErr } = await adminClient
    .from('admin')
    .select('id, role')
    .eq('id', targetUserId)
    .maybeSingle()

  if (targetErr) {
    return json(500, { error: targetErr.message })
  }
  if (!targetAdmin) {
    return json(404, { error: 'Target admin account not found' })
  }

  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(targetUserId)
  if (deleteErr) {
    return json(500, { error: deleteErr.message })
  }

  try {
    const bucket = 'admin_profile'
    const { data: files } = await adminClient.storage.from(bucket).list(targetUserId, {
      limit: 1000
    })
    const paths = (files ?? [])
      .filter((f) => typeof f.name === 'string' && f.name.length > 0)
      .map((f) => `${targetUserId}/${f.name}`)
    if (paths.length) {
      await adminClient.storage.from(bucket).remove(paths)
    }
  } catch {
    // optional cleanup
  }

  return json(200, { ok: true, deletedUserId: targetUserId })
})
