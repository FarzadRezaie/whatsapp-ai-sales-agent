import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type?: string | null
  content_text: string | null
}

/** Marker the model sees for a photo turn (customer photo or the
 *  product photo the bot sent). The caption, if any, follows it. */
export const PHOTO_MARKER = '[Photo]'

function rowText(m: DbMessage): string {
  const text = (m.content_text ?? '').trim()
  if (m.content_type === 'image') {
    return text ? `${PHOTO_MARKER} ${text}` : PHOTO_MARKER
  }
  return text
}

/**
 * Fetch the last N text messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Photos appear as "[Photo] caption"; other non-text messages (video,
 * audio, templates, interactive) are excluded — they carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text')
    .eq('conversation_id', conversationId)
    // Photos are included (as "[Photo] caption") so the model knows a
    // customer sent a picture and which product photo the bot answered
    // with; other media carry nothing the model can use.
    .in('content_type', ['text', 'image'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .map((m) => ({ m, text: rowText(m) }))
    .filter(({ text }) => text.length > 0)
    .map(({ m, text }) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: text,
    }))
}
