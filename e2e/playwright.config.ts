import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvPython =
  process.platform === "win32"
    ? path.join(root, "backend", ".venv", "Scripts", "python.exe")
    : path.join(root, "backend", ".venv", "bin", "python");

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:8080" },
  webServer: [
    {
      command: `"${venvPython}" -m http.server 8080 --bind 127.0.0.1 --directory "${path.join(root, "synthetic-site")}"`,
      url: "http://127.0.0.1:8080/index.html",
      reuseExistingServer: true,
      stderr: "ignore",
    },
    {
      // Backend runs with the MOCK provider so e2e never calls a paid API.
      command: `"${venvPython}" -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: path.join(root, "backend"),
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: false,
      env: { AI_PROVIDER: "MOCK", EVALIX_ENABLE_MOCK: "true", MOCK_ACCURACY: "1.0" },
    },
  ],
});
