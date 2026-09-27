import { useEffect } from "react";

const BRAND = "PR Desk";

// "Blocked · Pull requests · PR Desk": the most specific part first, because a tab strip truncates from the end and the brand is the part every tab shares.
export function documentTitle(parts: string[]): string {
  return [...parts.filter(Boolean), BRAND].join(" · ");
}

// Every mounted claim on the title. The route table registers a fallback for each destination and a page may register its own, more specific one; React runs a child's effects before its parent's, so "last mounted wins" would let the route's fallback overwrite the page. A page claim therefore outranks every fallback, and among equals the most recent one wins.
const claims: { id: number; title: string; fallback: boolean }[] = [];
let nextId = 0;

const apply = () => {
  const page = claims.filter((claim) => !claim.fallback);
  const pool = page.length ? page : claims;
  const winner = pool[pool.length - 1];
  document.title = winner ? winner.title : BRAND;
};

export function useDocumentTitle(parts: string[], options: { fallback?: boolean } = {}): void {
  const title = documentTitle(parts);
  const fallback = options.fallback ?? false;
  useEffect(() => {
    const claim = { id: nextId++, title, fallback };
    claims.push(claim);
    apply();
    return () => {
      claims.splice(
        claims.findIndex((entry) => entry.id === claim.id),
        1,
      );
      apply();
    };
  }, [title, fallback]);
}
