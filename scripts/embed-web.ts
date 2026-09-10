import { access, cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../apps/web/dist");
const destination = resolve(import.meta.dir, "../apps/api/webdist");
await access(resolve(source, "index.html"));
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
