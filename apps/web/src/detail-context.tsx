import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { FollowUp } from "./followup-view";

// What a detail surface is opened on. `pr.id` is the PullRequest primary key — the same one a follow-up's `pr.id` carries and the activity endpoint loads by — and never the PR number, which only identifies a pull request within its repository.
export type DetailTarget = { pr: { id: number; repo: string; number: number; title: string; url?: string; comments?: number }; followUp?: FollowUp };

type DetailState = { target: DetailTarget | null; opener: HTMLElement | null };
type DetailContext = { target: DetailTarget | null; opener: HTMLElement | null; open: (t: DetailTarget, opener?: HTMLElement | null) => void; close: () => void };

const Context = createContext<DetailContext | null>(null);

// One open detail for the whole application, so a PR row and an Inbox row open the same surface and the shell mounts it once.
export function DetailProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DetailState>({ target: null, opener: null });
  const open = useCallback((target: DetailTarget, opener: HTMLElement | null = null) => setState({ target, opener }), []);
  const close = useCallback(() => setState({ target: null, opener: null }), []);
  const { pathname } = useLocation();
  // The sheet is state with no history entry of its own, so a platform back gesture — which on touch is the habitual "dismiss this" — changed the route underneath and left a full-screen sheet mounted over a different page.
  useEffect(() => close(), [pathname, close]);
  const value = useMemo(() => ({ target: state.target, opener: state.opener, open, close }), [state, open, close]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDetail(): DetailContext {
  const value = useContext(Context);
  if (!value) throw new Error("useDetail must be used inside DetailProvider");
  return value;
}
