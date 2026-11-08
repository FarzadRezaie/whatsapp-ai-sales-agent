# Go live — checklist

Everything needed to move from `localhost + ngrok` to a real server that
shops can use 24/7.

## 1. Database (Supabase SQL editor)

Run these files **in order**, each one once. `060_products.sql` is already
applied.

| File | What it does |
|---|---|
| `supabase/migrations/061_product_images_paths.sql` | Fixes product-photo storage permissions |
| `supabase/migrations/062_ai_handoff_message.sql` | Custom "a colleague will reply" message |
| `supabase/migrations/063_monthly_message_usage.sql` | Monthly message counter + monthly limit |
| `supabase/migrations/064_redeem_invitation_new_tables.sql` | Team invites stay correct with the new tables |

All four are safe to re-run.

## 2. Server

Any VPS with **Node 22.12+** and 1 GB RAM works (e.g. Hostinger KVM 1).

```bash
git clone <your repo> app && cd app
cp .env.local.example .env.local   # then fill it in (section 3)
npm ci
npm run build
npx pm2 start npm --name shop-assistant -- start
npx pm2 save && npx pm2 startup
```

Put nginx (or Caddy) in front on port 443 with a free Let's Encrypt
certificate, proxying to `localhost:3000`. Meta only accepts HTTPS webhooks.

After every change to `.env.local` or the code: `npm run build && npx pm2 restart shop-assistant`.

## 3. Environment (`.env.local`)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | From Supabase → Project settings → API |
| `ENCRYPTION_KEY` | 64 hex chars. **Never change it after go-live** — saved tokens and AI keys become unreadable |
| `META_APP_SECRET` | Meta app → App settings → Basic |
| `NEXT_PUBLIC_SITE_URL` | Your real domain, e.g. `https://app.yourbrand.af` (invite links use it) |
| `NEXT_PUBLIC_APP_LOCALE` | `fa` (Dari by default; users can switch to English) |
| `NEXT_PUBLIC_BRAND_NAME` / `NEXT_PUBLIC_BRAND_NAME_FA` | Your product name in English / Dari |

Rotate any secret that was ever pasted into a chat, screenshot or repo
before go-live (Supabase service-role key, Meta app secret, ngrok token).
Rotate `ENCRYPTION_KEY` only **before** real shops save their tokens.

## 4. Meta / WhatsApp

1. **Permanent token** — Business settings → System users → add an admin
   system user → assign the app and the WhatsApp account → *Generate token*
   with `whatsapp_business_messaging` + `whatsapp_business_management`,
   expiry *Never*. The token from *API Setup* dies in 24 hours.
2. **Webhook** — WhatsApp → Configuration → Callback URL
   `https://<your domain>/api/whatsapp/webhook`, same verify token as in
   Settings → WhatsApp. Subscribe the `messages` field.
3. **Publish the app** (App mode: Live). Needs a privacy-policy URL.
4. **Real number** — add the shop's number, verify it, set the 2-step PIN
   and enter it in Settings → WhatsApp so the number is registered.
5. **Payment method** on the WhatsApp account. Service replies inside the
   24-hour window: 1,000 free per number per month; templates are paid.

## 5. Per shop (onboarding, ~20 minutes)

1. Settings → WhatsApp: connect the shop's number.
2. AI Assistant → Settings: API key, business info, auto-reply **on**,
   max replies per chat `10`, handoff agent, **monthly limit** = their plan
   (Basic 1,500 AFN → e.g. 1,000 messages).
3. Products: every product with a clear photo, price, sizes, stock.
4. AI Assistant → Test: send a product photo and a price question.
5. Send a real WhatsApp message from another phone.

## 6. 15-minute smoke test (do it after every deploy)

- [ ] Log in, switch Dari ⇄ English, light ⇄ dark from the account menu.
- [ ] Add a product with a photo; edit it; toggle stock; delete it.
- [ ] Test tab: text question → answer with the right price.
- [ ] Test tab: product photo → "Recognised: …" + price.
- [ ] Test tab: unrelated photo → handoff message.
- [ ] WhatsApp: ask a price → reply within seconds.
- [ ] WhatsApp: send a product photo → reply with that product's photo + price.
- [ ] WhatsApp: send a voice note → holding message, chat shows "AI paused".
- [ ] Inbox: "Take over" / "Resume AI" works.
- [ ] Home: "Messages this month" counter went up.

## Optional

- Automations/flows timers (advanced mode only) need a cron hitting
  `/api/automations/cron` and `/api/flows/cron` every minute with
  `AUTOMATION_CRON_SECRET` set (see `.env.local.example`) — skip if you
  don't use them.
