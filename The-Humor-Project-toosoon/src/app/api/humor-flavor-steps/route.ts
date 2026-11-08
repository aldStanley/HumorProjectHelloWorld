import { NextResponse } from 'next/server'

import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const flavorIdParam = searchParams.get('flavorId')
  const flavorId = flavorIdParam ? Number.parseInt(flavorIdParam, 10) : Number.NaN

  if (!Number.isFinite(flavorId)) {
    return NextResponse.json(
      { error: 'Invalid flavor id.' },
      { status: 400 }
    )
  }

  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('humor_flavor_steps')
    .select(
      'id, order_by, llm_temperature, llm_system_prompt, llm_user_prompt, step_type:humor_flavor_step_types ( slug, description )'
    )
    .eq('humor_flavor_id', flavorId)
    .order('order_by', { ascending: true })

  if (error) {
    return NextResponse.json(
      { error: 'Unable to load humor flavor steps.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ steps: data ?? [] })
}
