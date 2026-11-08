-- ============================================================
-- 063_monthly_message_usage.sql — monthly message counter + AI cap
--
-- WhatsApp gives every business number 1,000 free service replies a
-- month; after that Meta bills each reply. Shops are sold plans with a
-- monthly message allowance, so the bot must know how many messages
-- the account has sent this month and stop at the plan's cap.
--
--   1. account_message_usage — one row per account per month (UTC),
--      counting outbound non-template messages, split into bot and
--      agent. Maintained by an AFTER INSERT trigger on `messages`, so
--      every send path (inbox, bot, flows, automations, API) is counted
--      without touching application code.
--   2. ai_configs.monthly_reply_cap — the account's monthly allowance.
--      NULL = no cap. When bot + agent messages this month reach it,
--      the auto-reply bot hands new chats to a human instead of
--      answering.
--
-- Template messages are excluded: Meta bills them separately and they
-- don't use the free service-message allowance.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS monthly_reply_cap integer;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_monthly_reply_cap_range;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_monthly_reply_cap_range
  CHECK (monthly_reply_cap IS NULL OR monthly_reply_cap BETWEEN 1 AND 1000000);

CREATE TABLE IF NOT EXISTS account_message_usage (
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- First day of the month, UTC.
  month          date NOT NULL,
  bot_messages   integer NOT NULL DEFAULT 0,
  agent_messages integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, month)
);

ALTER TABLE account_message_usage ENABLE ROW LEVEL SECURITY;

-- Any member may read their account's counters; nobody writes them
-- directly (the trigger below runs as the table owner).
DROP POLICY IF EXISTS account_message_usage_select ON account_message_usage;
CREATE POLICY account_message_usage_select ON account_message_usage FOR SELECT
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.count_outbound_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF NEW.sender_type NOT IN ('bot', 'agent') OR NEW.content_type = 'template' THEN
    RETURN NEW;
  END IF;

  SELECT account_id INTO v_account_id
  FROM conversations
  WHERE id = NEW.conversation_id;

  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO account_message_usage (account_id, month, bot_messages, agent_messages)
  VALUES (
    v_account_id,
    date_trunc('month', now() AT TIME ZONE 'UTC')::date,
    CASE WHEN NEW.sender_type = 'bot' THEN 1 ELSE 0 END,
    CASE WHEN NEW.sender_type = 'agent' THEN 1 ELSE 0 END
  )
  ON CONFLICT (account_id, month) DO UPDATE
  SET bot_messages   = account_message_usage.bot_messages + EXCLUDED.bot_messages,
      agent_messages = account_message_usage.agent_messages + EXCLUDED.agent_messages,
      updated_at     = now();

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.count_outbound_message() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.count_outbound_message() FROM PUBLIC;

DROP TRIGGER IF EXISTS messages_count_outbound ON messages;
CREATE TRIGGER messages_count_outbound
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.count_outbound_message();
