// Port of nonchalant's src/utils/get-student-brain-output.ts so that
// ${studentBrainOutput} resolves identically here and in the production
// pipeline: same OAuth exchange, same endpoint, same verbatim JSON body.
const DEFAULT_TOP_K = 20

type OAuthTokenResponse = {
  access_token?: string
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

// The Student Brain API protects its endpoints with short-lived OAuth access
// tokens, so exchange the client credentials for one before every retrieval.
async function getStudentBrainAccessToken(apiUrl: string): Promise<string> {
  const response = await fetch(`${apiUrl}/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: requiredEnv('STUDENT_BRAIN_CLIENT_ID'),
      client_secret: requiredEnv('STUDENT_BRAIN_CLIENT_SECRET'),
    }),
  })

  if (!response.ok) {
    throw new Error(`Student Brain token request failed with status ${response.status}`)
  }

  const tokenResponse = (await response.json()) as OAuthTokenResponse
  const accessToken = tokenResponse.access_token

  if (!accessToken) {
    throw new Error('Student Brain token response did not include an access_token')
  }

  return accessToken
}

// Returns the raw prompt-time-retrieval response body, verbatim, so the prompt
// receives the exact JSON the Student Brain API produced with no reshaping.
export async function getStudentBrainOutputText(topK: number = DEFAULT_TOP_K): Promise<string> {
  const apiUrl = requiredEnv('STUDENT_BRAIN_API_URL').replace(/\/+$/, '')
  const accessToken = await getStudentBrainAccessToken(apiUrl)

  const response = await fetch(`${apiUrl}/v1/prompt-time-retrieval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'metrics',
      topK: topK,
    }),
  })

  if (!response.ok) {
    throw new Error(`Student Brain prompt-time retrieval failed with status ${response.status}`)
  }

  return await response.text()
}

// ---------------------------------------------------------------------------
// Raw Sidechat posts — GET /v1/sidechat-posts, the same live data behind
// brain.almostcrackd.ai/sidechat-posts. toosoon's own sidechat_posts table is
// an older mirror that stopped refreshing in June 2026; this is the fresh feed.
// ---------------------------------------------------------------------------

export type BrainSidechatPost = {
  id: string
  content: string
  likeCount: number
  postedAt: string
}

type RawSidechatPost = {
  id?: string | number
  content?: string | null
  upvote_count?: number | null
  created_at?: string | null
}

type SidechatPostsPage = {
  result?: { posts?: RawSidechatPost[]; total?: number }
  posts?: RawSidechatPost[]
  total?: number
}

// The API caps a page at 999 rows; a 30- or 90-day window can run past that,
// so keep paging by offset until the reported total is covered.
const SIDECHAT_PAGE_LIMIT = 999
const SIDECHAT_MAX_PAGES = 20

const toPost = (p: RawSidechatPost): BrainSidechatPost => ({
  id: String(p.id ?? ''),
  content: (p.content ?? '').trim(),
  likeCount: p.upvote_count ?? 0,
  postedAt: p.created_at ?? '',
})

async function fetchSidechatPage(
  apiUrl: string,
  accessToken: string,
  params: URLSearchParams
): Promise<{ posts: RawSidechatPost[]; total: number }> {
  const response = await fetch(`${apiUrl}/v1/sidechat-posts?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Student Brain sidechat-posts request failed with status ${response.status}`)
  }
  const body = (await response.json()) as SidechatPostsPage
  const result = body.result ?? body
  const posts = Array.isArray(result.posts) ? result.posts : []
  return { posts, total: typeof result.total === 'number' ? result.total : posts.length }
}

// Every non-empty post created on or after `windowStart`, most-upvoted first.
// `start_date` is a calendar day on the API side, so the window is rounded
// down to the start of that UTC day.
export async function getStudentBrainSidechatPosts(
  windowStart: Date
): Promise<{ posts: BrainSidechatPost[]; total: number }> {
  const apiUrl = requiredEnv('STUDENT_BRAIN_API_URL').replace(/\/+$/, '')
  const accessToken = await getStudentBrainAccessToken(apiUrl)

  const collected: RawSidechatPost[] = []
  let total = 0
  for (let page = 0; page < SIDECHAT_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      start_date: windowStart.toISOString().slice(0, 10),
      order_by: 'upvote_count',
      order: 'desc',
      limit: String(SIDECHAT_PAGE_LIMIT),
      offset: String(page * SIDECHAT_PAGE_LIMIT),
    })
    const { posts, total: reported } = await fetchSidechatPage(apiUrl, accessToken, params)
    total = reported
    collected.push(...posts)
    if (posts.length < SIDECHAT_PAGE_LIMIT || collected.length >= total) break
  }

  const seen = new Set<string>()
  const posts = collected
    .map(toPost)
    .filter((p) => p.id && p.content.length > 0 && !seen.has(p.id) && seen.add(p.id))
  return { posts, total }
}

// When a window comes back empty, this tells the caller how fresh the feed is.
export async function getStudentBrainNewestSidechatPostAt(): Promise<string | null> {
  const apiUrl = requiredEnv('STUDENT_BRAIN_API_URL').replace(/\/+$/, '')
  const accessToken = await getStudentBrainAccessToken(apiUrl)
  const { posts } = await fetchSidechatPage(
    apiUrl,
    accessToken,
    new URLSearchParams({ order_by: 'created_at', order: 'desc', limit: '1' })
  )
  return posts[0]?.created_at ?? null
}

// ---------------------------------------------------------------------------
// The six additional retrieval variables (from staging, PR #32). Same auth
// flow as getStudentBrainOutputText above, just passing extra params
// (sortBy / memoryType) through to the same "metrics" operation.
// ---------------------------------------------------------------------------

function getStudentBrainApiUrl(): string {
  return requiredEnv('STUDENT_BRAIN_API_URL').replace(/\/+$/, '')
}

export type StudentBrainSortBy = 'velocity' | 'volume' | 'recentlyAdded'
export type StudentBrainMemoryType = 'active' | 'persistent' | 'dormant'

async function fetchStudentBrainMetrics(
  extraParams: Record<string, unknown>,
  topK: number
): Promise<string> {
  const apiUrl = getStudentBrainApiUrl()
  const accessToken = await getStudentBrainAccessToken(apiUrl)

  const response = await fetch(`${apiUrl}/v1/prompt-time-retrieval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'metrics',
      topK: topK,
      ...extraParams,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Student Brain prompt-time retrieval failed with status ${response.status} (params: ${JSON.stringify(extraParams)})`
    )
  }

  return await response.text()
}

// ${topByVelocity}
export async function getTopByVelocityText(topK: number = DEFAULT_TOP_K): Promise<string> {
  return fetchStudentBrainMetrics({ sortBy: 'velocity' }, topK)
}

// ${topByVolume}
export async function getTopByVolumeText(topK: number = DEFAULT_TOP_K): Promise<string> {
  return fetchStudentBrainMetrics({ sortBy: 'volume' }, topK)
}

// ${recentlyAdded}
export async function getRecentlyAddedText(topK: number = DEFAULT_TOP_K): Promise<string> {
  return fetchStudentBrainMetrics({ sortBy: 'recentlyAdded' }, topK)
}

// ${activeMemories}
export async function getActiveMemoriesText(topK: number = DEFAULT_TOP_K): Promise<string> {
  return fetchStudentBrainMetrics({ memoryType: 'active' }, topK)
}

// ${persistentMemories}
export async function getPersistentMemoriesText(topK: number = DEFAULT_TOP_K): Promise<string> {
  return fetchStudentBrainMetrics({ memoryType: 'persistent' }, topK)
}

// ${dormantMemories}
export async function getDormantMemoriesText(topK: number = DEFAULT_TOP_K): Promise<string> {
  return fetchStudentBrainMetrics({ memoryType: 'dormant' }, topK)
}
