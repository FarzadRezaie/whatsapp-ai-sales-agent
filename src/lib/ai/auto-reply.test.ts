import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendMedia: vi.fn(),
  loadAccountMetaCredentials: vi.fn(),
  loadActiveProducts: vi.fn(),
  matchProductPhoto: vi.fn(),
  loadInboundPhoto: vi.fn(),
  loadMonthlyUsage: vi.fn(),
  sendTypingIndicator: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    updates: [] as { payload: Record<string, unknown>; isNull: string[] }[],
    rpcCalls: [] as { name: string; args: unknown }[],
    latestInbound: [] as { message_id: string }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendMedia: h.engineSendMedia,
  loadAccountMetaCredentials: h.loadAccountMetaCredentials,
}))
vi.mock('@/lib/products/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/products/catalog')>(
    '@/lib/products/catalog',
  )
  return { ...actual, loadActiveProducts: h.loadActiveProducts }
})
vi.mock('@/lib/products/match', () => ({ matchProductPhoto: h.matchProductPhoto }))
vi.mock('@/lib/products/inbound-photo', () => ({ loadInboundPhoto: h.loadInboundPhoto }))
vi.mock('./monthly-usage', async () => {
  const actual = await vi.importActual<typeof import('./monthly-usage')>('./monthly-usage')
  return { ...actual, loadMonthlyUsage: h.loadMonthlyUsage }
})
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTypingIndicator: h.sendTypingIndicator,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      if (table === 'messages') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.latestInbound, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = { ...h.state.updatePayload, ...payload }
          const record = { payload, isNull: [] as string[] }
          h.state.updates.push(record)
          const result = Promise.resolve({ error: null })
          const filter = Object.assign(result, {
            is: (column: string) => {
              record.isNull.push(column)
              return result
            },
          })
          return { eq: () => filter }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  inboundMessageId: 'wamid.inbound-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
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

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.updates = []
  h.state.rpcCalls = []
  h.state.latestInbound = [{ message_id: 'wamid.inbound-1' }]
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.engineSendMedia.mockResolvedValue({ whatsapp_message_id: 'm2' })
  h.loadActiveProducts.mockResolvedValue([])
  h.matchProductPhoto.mockReset()
  h.loadInboundPhoto.mockResolvedValue({ mimeType: 'image/jpeg', base64: 'AAAA' })
  h.loadMonthlyUsage.mockResolvedValue({ month: '2026-11-01', botMessages: 0, agentMessages: 0, total: 0 })
  h.loadAccountMetaCredentials.mockResolvedValue({
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
  })
  h.sendTypingIndicator.mockResolvedValue(undefined)
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the slot claim is refused after a human takeover', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('leaves the reply to the newer run when another inbound arrived', async () => {
    h.state.latestInbound = [{ message_id: 'wamid.inbound-2' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('replies when the triggering inbound is still the latest', async () => {
    h.state.latestInbound = [{ message_id: 'wamid.inbound-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('hands off with a holding message when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('reply limit')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toContain('team')
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — typing indicator (#527)', () => {
  it('shows "typing…" on the inbound wamid before calling the LLM', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadAccountMetaCredentials).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
    )
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
    expect(h.sendTypingIndicator).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      messageId: 'wamid.inbound-1',
    })
    // Ordering: the indicator goes out while the customer waits on the
    // model, not after the reply is already generated.
    const typingOrder = h.sendTypingIndicator.mock.invocationCallOrder[0]
    const llmOrder = h.generateReply.mock.invocationCallOrder[0]
    expect(typingOrder).toBeLessThan(llmOrder)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('still sends the reply when the indicator request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.sendTypingIndicator.mockRejectedValue(new Error('Meta API error: 400'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('typing indicator failed'),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it('still sends the reply when the WhatsApp credentials cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.loadAccountMetaCredentials.mockRejectedValue(
      new Error('WhatsApp not configured for this account'),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('skips the indicator when no inbound wamid is supplied', async () => {
    const { inboundMessageId: _omit, ...legacyArgs } = ARGS
    void _omit
    await dispatchInboundToAiReply(legacyArgs)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.loadAccountMetaCredentials).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('does not fire when a gate short-circuits before the LLM', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.loadAccountMetaCredentials).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and sends only the holding message on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    // Never silent: exactly one message — the holding message.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0]).toMatchObject({
      conversationId: 'conv-1',
      aiGenerated: true,
    })
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  it('assigns the handoff agent only while the thread is still unassigned', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    const pause = h.state.updates.find((u) => 'ai_autoreply_disabled' in u.payload)
    const assign = h.state.updates.find((u) => 'assigned_agent_id' in u.payload)
    expect(pause?.payload).not.toHaveProperty('assigned_agent_id')
    expect(pause?.isNull).toEqual([])
    expect(assign?.payload).toEqual({ assigned_agent_id: 'agent-7' })
    expect(assign?.isNull).toEqual(['assigned_agent_id'])
  })
})

describe('dispatchInboundToAiReply — holding message (never silent)', () => {
  it('uses the Dari default when the customer writes in Arabic script', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'سلام، قیمتش چند است؟' }])
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText.mock.calls[0][0].text).toMatch(/[\u0600-\u06FF]/)
  })

  it("uses the shop's own handoff message when set", async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffMessage: 'One moment please!' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText.mock.calls[0][0].text).toBe('One moment please!')
  })

  it('hands off with a holding message when the AI provider fails', async () => {
    h.generateReply.mockRejectedValue(new Error('rate limit reached'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('AI provider error')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('does not send anything when a gate fails before committing', async () => {
    h.loadAiConfig.mockRejectedValue(new Error('db down'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
  })

  it('never throws even when the holding message itself fails', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    h.engineSendText.mockRejectedValue(new Error('meta down'))
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
  })
})

describe('dispatchInboundToAiReply — product catalog + photos', () => {
  const shirt = {
    id: 'p1',
    account_id: 'acct-1',
    category: 'Shirts',
    name: 'White shirt',
    description: null,
    price: 1200,
    currency: 'AFN',
    sizes: ['M', 'L'],
    colors: ['White'],
    in_stock: true,
    stock_note: null,
    image_path: 'account-acct-1/shirt.jpg',
    image_url: 'https://cdn.example/shirt.jpg',
    is_active: true,
    created_at: '',
    updated_at: '',
  }
  const PHOTO_ARGS = { ...ARGS, inboundImage: { mediaId: 'media-1', caption: 'price?' } }

  it('puts the catalog in the system prompt for text questions', async () => {
    h.loadActiveProducts.mockResolvedValue([shirt])
    await dispatchInboundToAiReply(ARGS)
    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).toContain('Product catalog')
    expect(prompt).toContain('White shirt')
    expect(prompt).toContain('1,200 AFN')
  })

  it("answers a matched photo with ONE message: the product's photo + caption", async () => {
    h.loadActiveProducts.mockResolvedValue([shirt])
    h.matchProductPhoto.mockResolvedValue({
      status: 'matched',
      product: shirt,
      confidence: 'high',
      description: 'white shirt',
      visibleText: null,
      usage: null,
    })
    h.generateReply.mockResolvedValue({ text: 'White shirt — 1,200 AFN, sizes M and L.', handoff: false })
    await dispatchInboundToAiReply(PHOTO_ARGS)
    expect(h.loadInboundPhoto).toHaveBeenCalledWith({ mediaId: 'media-1', accessToken: 'tok' })
    expect(h.matchProductPhoto.mock.calls[0][0].caption).toBe('price?')
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toContain('Customer photo')
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.engineSendMedia).toHaveBeenCalledTimes(1)
    expect(h.engineSendMedia.mock.calls[0][0]).toMatchObject({
      kind: 'image',
      link: 'https://cdn.example/shirt.jpg',
      caption: 'White shirt — 1,200 AFN, sizes M and L.',
      aiGenerated: true,
    })
    expect(h.state.rpcCalls[0]?.name).toBe('claim_ai_reply_slot')
  })

  it('hands an unmatched photo to a human with a holding message (no guess)', async () => {
    h.loadActiveProducts.mockResolvedValue([shirt])
    h.matchProductPhoto.mockResolvedValue({
      status: 'no_match',
      product: null,
      confidence: 'low',
      description: 'red shoes',
      visibleText: null,
      usage: null,
    })
    await dispatchInboundToAiReply(PHOTO_ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('matches no product')
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('red shoes')
  })

  it('hands off a photo when there is no catalog yet', async () => {
    await dispatchInboundToAiReply(PHOTO_ARGS)
    expect(h.matchProductPhoto).not.toHaveBeenCalled()
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('no products')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('hands off when the photo cannot be downloaded', async () => {
    h.loadActiveProducts.mockResolvedValue([shirt])
    h.loadInboundPhoto.mockResolvedValue(null)
    await dispatchInboundToAiReply(PHOTO_ARGS)
    expect(h.matchProductPhoto).not.toHaveBeenCalled()
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('could not be downloaded')
  })

  it('caps a long reply to the 1024-character WhatsApp caption limit', async () => {
    h.loadActiveProducts.mockResolvedValue([shirt])
    h.matchProductPhoto.mockResolvedValue({
      status: 'matched', product: shirt, confidence: 'high', description: null, visibleText: null, usage: null,
    })
    h.generateReply.mockResolvedValue({ text: 'x'.repeat(3000), handoff: false })
    await dispatchInboundToAiReply(PHOTO_ARGS)
    expect((h.engineSendMedia.mock.calls[0][0].caption as string).length).toBe(1024)
  })
})

describe('dispatchInboundToAiReply — voice notes / video / documents', () => {
  it('hands a voice note to a human with a holding message, without calling the model', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply({ ...ARGS, inboundUnsupported: 'audio' })
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('voice message')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('still respects the gates (e.g. a human is assigned)', async () => {
    h.state.conv = { assigned_agent_id: 'agent-1', ai_autoreply_disabled: false, ai_reply_count: 0 }
    await dispatchInboundToAiReply({ ...ARGS, inboundUnsupported: 'document' })
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — monthly message cap', () => {
  it('replies normally while under the cap', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ monthlyReplyCap: 1000 }))
    h.loadMonthlyUsage.mockResolvedValue({ month: '2026-11-01', botMessages: 600, agentMessages: 399, total: 999 })
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toBe('Hello!')
  })

  it('hands off (holding message, no model call) once the month is used up', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ monthlyReplyCap: 1000 }))
    h.loadMonthlyUsage.mockResolvedValue({ month: '2026-11-01', botMessages: 700, agentMessages: 300, total: 1000 })
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('monthly message limit')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('does not check usage when no cap is set', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadMonthlyUsage).not.toHaveBeenCalled()
  })

  it('keeps replying when usage cannot be read (fail open)', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ monthlyReplyCap: 10 }))
    h.loadMonthlyUsage.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
  })
})
