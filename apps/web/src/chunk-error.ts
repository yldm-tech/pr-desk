// A content-hashed chunk from a previous build 404s after the server is upgraded, and each browser words that import failure differently.
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(message);
}
