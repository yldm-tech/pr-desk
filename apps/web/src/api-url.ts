// Production uses the web server's /api proxy; development can target the local API.
export const apiURL = (import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:8081" : "")).replace(/\/$/, "");
