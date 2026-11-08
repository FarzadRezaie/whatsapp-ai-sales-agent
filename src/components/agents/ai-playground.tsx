'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  Bot,
  ImagePlus,
  Loader2,
  RotateCcw,
  Send,
  UserCircle2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { fileToBase64, shrinkProductPhoto } from '@/lib/products/resize-image';

/** Same marker the live bot uses for a photo turn (src/lib/ai/context.ts). */
const PHOTO_MARKER = '[Photo]';

interface Turn {
  role: 'user' | 'assistant';
  /** What is sent to the API as this turn's text. */
  content: string;
  /** user-only: local preview of a test photo. */
  photoUrl?: string;
  /** user-only: the caption typed with the photo (display text). */
  caption?: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
  /** assistant-only: the catalog product a photo was matched to. */
  product?: { name: string; price: string; image_url: string | null };
  /** assistant-only: a photo was not matched (goes to a human). */
  photoUnmatched?: boolean;
}

interface PendingPhoto {
  previewUrl: string;
  mimeType: string;
  base64: string;
}

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const t = useTranslations('Agents.playground');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [photo, setPhoto] = useState<PendingPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPreparing(true);
    try {
      const small = await shrinkProductPhoto(file);
      const base64 = await fileToBase64(small);
      setPhoto({ previewUrl: URL.createObjectURL(small), mimeType: small.type, base64 });
    } catch {
      toast.error(t('photoError'));
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !photo) || sending) return;

    const sentPhoto = photo;
    const userTurn: Turn = sentPhoto
      ? {
          role: 'user',
          content: text ? `${PHOTO_MARKER} ${text}` : PHOTO_MARKER,
          photoUrl: sentPhoto.previewUrl,
          caption: text,
        }
      : { role: 'user', content: text };
    const next: Turn[] = [...turns, userTurn];
    setTurns(next);
    setInput('');
    setPhoto(null);
    setSending(true);
    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send only role+content — the server ignores anything else.
        body: JSON.stringify({
          messages: next.map((x) => ({ role: x.role, content: x.content })),
          image: sentPhoto
            ? { mimeType: sentPhoto.mimeType, base64: sentPhoto.base64 }
            : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(t('notConfigured'));
        } else {
          toast.error(data.error ?? t('noReply'));
        }
        // Roll the unsent user turn back so the transcript stays clean.
        setTurns(turns);
        setInput(text);
        setPhoto(sentPhoto);
        return;
      }
      const reply = typeof data.reply === 'string' && data.reply.trim() ? data.reply : '';
      const matched = data.photo?.status === 'matched' ? data.photo.product : undefined;
      setTurns([
        ...next,
        {
          role: 'assistant',
          // Mirror the live bot: a photo reply is stored as "[Photo] caption".
          content: matched && reply ? `${PHOTO_MARKER} ${reply}` : reply,
          handoff: Boolean(data.handoff),
          product: matched,
          photoUnmatched: Boolean(sentPhoto) && !matched,
        },
      ]);
    } catch {
      toast.error(t('unreachable'));
      setTurns(turns);
      setInput(text);
      setPhoto(sentPhoto);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const displayText = (turn: Turn) => {
    if (turn.role === 'user' && turn.photoUrl) return turn.caption ?? '';
    if (turn.role === 'assistant' && turn.product && turn.content.startsWith(PHOTO_MARKER)) {
      return turn.content.slice(PHOTO_MARKER.length).trim();
    }
    return turn.content;
  };

  return (
    <div className="flex h-[60vh] min-h-[420px] flex-col rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">{t('title')}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t('subtitle')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTurns([])}
          disabled={turns.length === 0 || sending}
          className="text-muted-foreground"
        >
          <RotateCcw className="me-1.5 h-3.5 w-3.5" /> {t('reset')}
        </Button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Bot className="mb-2 h-8 w-8 text-muted-foreground/60" />
            <p>{t('emptyTitle')}</p>
            <p className="mt-1 text-xs">{t('emptyDesc')}</p>
            <p className="mt-1 text-xs">{t('photoHint')}</p>
            {onGoToSetup && (
              <Button
                variant="link"
                size="sm"
                onClick={onGoToSetup}
                className="mt-1 h-auto p-0 text-xs"
              >
                {t('goToSetup')} <ArrowRight className="ms-1 h-3 w-3 rtl:rotate-180" />
              </Button>
            )}
          </div>
        )}

        {turns.map((turn, i) => {
          const text = displayText(turn);
          return (
            <div
              key={i}
              className={cn('flex gap-2', turn.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              {turn.role === 'assistant' && <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" />}
              <div
                className={cn(
                  'max-w-[80%] overflow-hidden rounded-2xl text-sm',
                  turn.role === 'user'
                    ? 'rounded-ee-sm bg-primary text-primary-foreground'
                    : 'rounded-es-sm bg-muted text-foreground',
                )}
              >
                {turn.photoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={turn.photoUrl} alt="" className="max-h-56 w-full object-cover" />
                )}
                {turn.product?.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={turn.product.image_url} alt={turn.product.name} className="max-h-56 w-full object-cover" />
                )}
                <div className={cn('px-3.5 py-2', !text && !turn.handoff && !turn.product && 'hidden')}>
                  {turn.product && (
                    <p className="mb-1 text-xs font-medium text-primary">
                      {t('matched', { name: turn.product.name, price: turn.product.price })}
                    </p>
                  )}
                  {text && <p className="whitespace-pre-wrap">{text}</p>}
                  {turn.role === 'assistant' && turn.handoff && (
                    <p
                      className={cn(
                        'flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400',
                        text && 'mt-1.5 border-t border-border/50 pt-1.5',
                      )}
                    >
                      <UserCircle2 className="h-3.5 w-3.5" />
                      {turn.photoUnmatched ? t('photoNoMatch') : t('handoff')}
                    </p>
                  )}
                </div>
              </div>
              {turn.role === 'user' && (
                <UserCircle2 className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
              )}
            </div>
          );
        })}

        {sending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="h-5 w-5 text-primary" />
            <Loader2 className="h-4 w-4 animate-spin" /> {t('thinking')}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        {photo && (
          <div className="mb-2 flex items-center gap-2">
            <div className="relative h-14 w-14 overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                aria-label={t('photoRemove')}
                className="absolute end-0.5 top-0.5 rounded-full bg-background/90 p-0.5 text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <span className="text-xs text-muted-foreground">{t('photoAttached')}</span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={sending || preparing}
            aria-label={t('photoAttach')}
            title={t('photoAttach')}
            className="h-9 w-9 shrink-0 p-0 text-muted-foreground"
          >
            {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => void pickPhoto(e.target.files?.[0])}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={photo ? t('captionPlaceholder') : t('placeholder')}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
          />
          <Button
            size="sm"
            onClick={send}
            disabled={(!input.trim() && !photo) || sending}
            className="h-9 w-9 shrink-0 p-0"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:rotate-180" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
