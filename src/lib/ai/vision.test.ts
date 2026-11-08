import { afterEach, describe, expect, it, vi } from 'vitest'
import { addUsage, callVision, extractJsonObject } from './vision'
import type { AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    baseUrl: null,
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

const IMAGE = { type: 'image' as const, mimeType: 'image/jpeg', base64: 'QUJD' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractJsonObject', () => {
  it('reads plain, fenced and chatty JSON answers', () => {
    expect(extractJsonObject('{"match": 2}')).toEqual({ match: 2 })
    expect(extractJsonObject('```json\n{"match": 1, "confidence": "high"}\n```')).toEqual({
      match: 1,
      confidence: 'high',
    })
    expect(extractJsonObject('Sure! {"category": "Shirts"} hope this helps')).toEqual({
      category: 'Shirts',
    })
  })
  it('returns null for non-JSON', () => {
    expect(extractJsonObject('no idea')).toBeNull()
    expect(extractJsonObject('[1,2]')).toBeNull()
  })
})

describe('addUsage', () => {
  it('sums and tolerates nulls', () => {
    const a = { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
    expect(addUsage(null, a)).toBe(a)
    expect(addUsage(a, null)).toBe(a)
    expect(addUsage(a, a)).toEqual({ promptTokens: 2, completionTokens: 4, totalTokens: 6 })
  })
})

describe('callVision', () => {
  it('sends OpenAI image_url data URLs and returns the text + usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"match": 1}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await callVision({
      config: config(),
      instruction: 'sys',
      parts: [{ type: 'text', text: 'hi' }, IMAGE],
    })
    expect(r.text).toBe('{"match": 1}')
    expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    const body = JSON.parse(init.body)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,QUJD' },
    })
    expect(body.max_completion_tokens).toBeGreaterThan(0)
  })

  it('sends Anthropic base64 image blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"match": 0}' }],
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await callVision({
      config: config({ provider: 'anthropic', model: 'claude-test' }),
      instruction: 'sys',
      parts: [IMAGE],
    })
    expect(r.text).toBe('{"match": 0}')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toBe('sys')
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
    })
  })

  it('maps HTTP 429 to a rate_limited AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":{"message":"slow down"}}', { status: 429 })),
    )
    await expect(
      callVision({ config: config(), instruction: 'x', parts: [IMAGE] }),
    ).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('rejects unsupported image types before calling the provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      callVision({
        config: config(),
        instruction: 'x',
        parts: [{ type: 'image', mimeType: 'image/heic', base64: 'AA' }],
      }),
    ).rejects.toMatchObject({ code: 'unsupported_image' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on an empty answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '  ' } }] }), { status: 200 }),
      ),
    )
    await expect(
      callVision({ config: config(), instruction: 'x', parts: [IMAGE] }),
    ).rejects.toMatchObject({ code: 'empty_response' })
  })
})
