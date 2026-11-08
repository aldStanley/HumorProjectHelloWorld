export type CaptionImage = {
  id: string
  url: string | null
}

export type CaptionRow = {
  id: string
  content: string | null
  created_datetime_utc: string
  caption_request_id: number | null
  llm_prompt_chain_id: number | null
  image: CaptionImage | CaptionImage[] | null
}
