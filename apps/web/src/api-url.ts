// Production uses the Go server's same-origin API; development can target the local API.
export const apiURL = (import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:8081" : "")).replace(/\/$/, "");
