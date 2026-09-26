import { spawnSync } from "node:child_process";
import process from "node:process";

const packages = [
  "vinext@1.0.0-beta.12",
  "@vinext/cloudflare@1.0.0-beta.10",
  "vite@8.3.0",
  "@vitejs/plugin-react@6.1.1",
  "@vitejs/plugin-rsc@0.5.35",
  "react-server-dom-webpack@19.2.8",
  "@cloudflare/vite-plugin@1.54.11",
  "wrangler@4.139.0",
];

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Preparing pinned vinext/Cloudflare build toolchain...");
run(process.platform === "win32" ? "npm.cmd" : "npm", [
  "install",
  "--no-save",
  "--no-package-lock",
  "--no-audit",
  "--no-fund",
  ...packages,
]);

console.log("Running vinext production build...");
run(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "--no-install",
    "vinext",
    "build",
  ],
  {
    ...process.env,
    VINEXT_CLOUDFLARE: "1",
  },
);
