import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(appRoot, "node_modules/monaco-editor/min/vs");
const destination = resolve(appRoot, "public/vs");

if (!existsSync(source)) {
  throw new Error("Monaco assets are missing. Run pnpm install first.");
}

mkdirSync(resolve(appRoot, "public"), { recursive: true });
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log("Copied Monaco editor runtime and workers into public/vs");
