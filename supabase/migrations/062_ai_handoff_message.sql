-- ============================================================
-- 062_ai_handoff_message.sql — customer-facing handoff message
--
-- When the auto-reply bot hands a chat to a human (the model asks for
-- it, a photo matches no product, the per-chat reply cap is reached,
-- or the AI provider fails), the customer now receives a short
-- holding message instead of silence.
--
-- `handoff_message` lets each shop write its own text. NULL / empty →
-- the built-in default in the customer's script (Dari for Arabic
-- script, English otherwise — see src/lib/ai/holding-message.ts).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_message text;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_handoff_message_length;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_handoff_message_length
  CHECK (handoff_message IS NULL OR char_length(handoff_message) <= 500);
