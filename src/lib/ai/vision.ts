import { AiError, type AiConfig, type AiUsage } from './types'
import { aiRequestTimeoutMs, MAX_OUTPUT_TOKENS } from './defaults'
import {
  normalizeUsage,
  providerHttpError,
  toNetworkError,
} from './providers/shared'
import {
  allowedPrivateHosts,
  normalizeOpenAiCompatibleBaseUrl,
} from './providers/openai-compatible'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { getT } from '@/lib/i18n/translate'

const t = getT('LibErrors')

// ============================================================
// One-shot vision call: "here are some images + an instruction, answer".
//
// Used by product photo matching (src/lib/products/match.ts). Kept
// separate from the text adapters in ./providers so the existing,
// well-tested text path is untouched.
//
// Image support per provider:
//   - openai / openai_compatible: `image_url` content parts with a
//     base64 data URL (OpenAI, Gemini's OpenAI-compatible endpoint,
//     and most vision-capable compatible servers accept this).
//   - anthropic: base64 `image` content blocks.
// A text-only model (e.g. some DeepSeek models) answers with an HTTP
// error here; the caller treats any failure as "no match".
// ============================================================

export const VISION_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export type VisionPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; base64: string }

export interface VisionArgs {
  config: AiConfig
  /** System instruction for this call. */
  instruction: string
  /** User content: text and images, in order. */
  parts: VisionPart[]
}

export interface VisionResult {
  text: string
  usage: AiUsage | null
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

function openAiContent(parts: VisionPart[]) {
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : {
          type: 'image_url',
          image_url: { url: `data:${p.mimeType};base64,${p.base64}` },
        },
  )
}

function anthropicContent(parts: VisionPart[]) {
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : {
          type: 'image',
          source: { type: 'base64', media_type: p.mimeType, data: p.base64 },
        },
  )
}

interface OpenAiLikeResponse {
  choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

function openAiText(data: OpenAiLikeResponse | null): string {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && typeof c.text === 'string')
      .map((c) => c.text)
      .join('')
  }
  return ''
}

/**
 * Run one vision request. Throws `AiError` on any provider/network
 * failure or an empty answer (same contract as `generateReply`).
 */
export async function callVision(args: VisionArgs): Promise<VisionResult> {
  const { config, instruction, parts } = args
  for (const p of parts) {
    if (p.type === 'image' && !VISION_MIME_TYPES.has(p.mimeType)) {
      throw new AiError(`Unsupported image type: ${p.mimeType}`, {
        code: 'unsupported_image',
        status: 400,
      })
    }
  }
  const signal = AbortSignal.timeout(aiRequestTimeoutMs())

  if (config.provider === 'anthropic') {
    let res: Response
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          system: instruction,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: 'user', content: anthropicContent(parts) }],
        }),
        signal,
      })
    } catch (err) {
      throw toNetworkError(err)
    }
    if (!res.ok) throw await providerHttpError('Anthropic', res)
    const data = (await res.json().catch(() => null)) as AnthropicResponse | null
    const text = (data?.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim()
    if (!text) {
      throw new AiError(t('ai.emptyResponse', { provider: 'Anthropic' }), {
        code: 'empty_response',
      })
    }
    return {
      text,
      usage: normalizeUsage({
        prompt: data?.usage?.input_tokens,
        completion: data?.usage?.output_tokens,
      }),
    }
  }

  let endpoint: string
  let providerName: string
  if (config.provider === 'openai') {
    endpoint = OPENAI_URL
    providerName = 'OpenAI'
  } else if (config.provider === 'openai_compatible') {
    endpoint = normalizeOpenAiCompatibleBaseUrl(config.baseUrl ?? '')
    providerName = 'OpenAI-compatible provider'
    let deliverable = false
    try {
      deliverable = await isDeliverableUrl(endpoint, {
        allowPrivateHosts: allowedPrivateHosts(),
      })
    } catch {
      deliverable = false
    }
    if (!deliverable) {
      throw new AiError(
        t('ai.compatBlockedUrl', { envVar: 'AI_PROVIDER_ALLOWED_PRIVATE_HOSTS' }),
        { code: 'blocked_url', status: 400 },
      )
    }
  } else {
    throw new AiError(`Unsupported AI provider: ${String(config.provider)}`, {
      code: 'unsupported_provider',
      status: 400,
    })
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: instruction },
      { role: 'user', content: openAiContent(parts) },
    ],
  }
  // OpenAI's newer models only accept max_completion_tokens; compatible
  // servers (Gemini, DeepSeek, Groq…) expect max_tokens — same split as
  // the text adapters.
  if (config.provider === 'openai') body.max_completion_tokens = MAX_OUTPUT_TOKENS
  else body.max_tokens = MAX_OUTPUT_TOKENS

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError(providerName, res)
  const data = (await res.json().catch(() => null)) as OpenAiLikeResponse | null
  const text = openAiText(data).trim()
  if (!text) {
    throw new AiError(t('ai.emptyResponse', { provider: providerName }), {
      code: 'empty_response',
    })
  }
  return {
    text,
    usage: normalizeUsage({
      prompt: data?.usage?.prompt_tokens,
      completion: data?.usage?.completion_tokens,
      total: data?.usage?.total_tokens,
    }),
  }
}

/**
 * Pull the first JSON object out of a model answer. Models wrap JSON in
 * ```json fences or add a sentence before it; this tolerates both.
 * Returns null when nothing parses.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidates = [fenced?.[1], text].filter((c): c is string => !!c)
  for (const c of candidates) {
    const start = c.indexOf('{')
    const end = c.lastIndexOf('}')
    if (start === -1 || end <= start) continue
    try {
      const parsed = JSON.parse(c.slice(start, end + 1))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // try the next candidate
    }
  }
  return null
}

/** Sum two usage records (null-tolerant) for logging a multi-call match. */
export function addUsage(a: AiUsage | null, b: AiUsage | null): AiUsage | null {
  if (!a) return b
  if (!b) return a
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}
