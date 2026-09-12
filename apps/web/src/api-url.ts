// Production uses the Go server's same-origin API; development targets the local API, which listens on 8080 unless PORT says otherwise.
export function resolveAPIURL(env: { VITE_API_URL?: string; DEV?: boolean }): string {
  return (env.VITE_API_URL ?? (env.DEV ? "http://localhost:8080" : "")).replace(/\/$/, "");
}
export const apiURL = resolveAPIURL(import.meta.env);
