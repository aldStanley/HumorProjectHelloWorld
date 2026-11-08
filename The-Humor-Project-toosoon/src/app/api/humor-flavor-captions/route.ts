import { NextResponse } from 'next/server'

import { PAGE_SIZE } from '@/app/humor-flavor/[humorFlavorId]/captions/constants'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const flavorIdParam = searchParams.get('flavorId')
  const pageParam = searchParams.get('page')
  const flavorId = flavorIdParam ? Number.parseInt(flavorIdParam, 10) : Number.NaN
  const pageValue = Number.parseInt(pageParam ?? '1', 10)
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1

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

  const offset = (page - 1) * PAGE_SIZE
  const { data, error, count } = await supabase
    .from('captions')
    .select(
      'id, content, created_datetime_utc, caption_request_id, llm_prompt_chain_id, image:images ( id, url )',
      {
        count: 'exact',
      }
    )
    .eq('humor_flavor_id', flavorId)
    .order('created_datetime_utc', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    return NextResponse.json(
      { error: 'Unable to load captions.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    captions: data ?? [],
    count: typeof count === 'number' ? count : null,
    page,
  })
}
