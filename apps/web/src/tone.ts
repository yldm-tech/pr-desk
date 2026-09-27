import { BellOff, Check, CircleCheck, CircleDashed, CircleDot, Clock, GitMerge, GitPullRequestClosed, MessageSquare, OctagonAlert, type LucideIcon } from "lucide-react";

// The five status tones. Colour is never the only signal: every tone also has its own glyph shape, and every chip carries text.
// blocked: only GitHub can clear it (conflict, failing checks). action: work you can start now. waiting: the clock is running on someone else. ready: done or shippable. neutral: draft, closed, unknown.
export type Tone = "blocked" | "action" | "waiting" | "ready" | "neutral";
export const tones: readonly Tone[] = ["blocked", "action", "waiting", "ready", "neutral"];

// The state of one row, which picks its glyph. Several kinds share a tone (draft, merged and closed are all neutral) but never a shape.
export type GlyphKind = "blocked" | "action" | "waiting" | "ready" | "draft" | "muted" | "merged" | "closed" | "open";

export const glyphIcon: Record<GlyphKind, LucideIcon> = { blocked: OctagonAlert, action: CircleDot, waiting: Clock, ready: CircleCheck, draft: CircleDashed, muted: BellOff, merged: GitMerge, closed: GitPullRequestClosed, open: CircleDot };

// The small icon a reason chip leads with.
export const reasonIcon: Record<Tone, LucideIcon> = { blocked: OctagonAlert, action: MessageSquare, waiting: Clock, ready: Check, neutral: CircleDashed };

// Class strings per tone, spelled out in full so Tailwind's scanner sees every one of them.
export const toneText: Record<Tone, string> = { blocked: "text-tone-blocked", action: "text-tone-action", waiting: "text-tone-waiting", ready: "text-tone-ready", neutral: "text-tone-neutral" };
export const toneBorder: Record<Tone, string> = { blocked: "border-tone-blocked-line", action: "border-tone-action-line", waiting: "border-tone-waiting-line", ready: "border-tone-ready-line", neutral: "border-tone-neutral-line" };
