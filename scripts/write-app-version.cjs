const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

function readGitSha() {
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const version = {
  version:
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    readGitSha() ||
    String(Date.now()),
  builtAt: new Date().toISOString(),
};

const target = path.join(__dirname, "..", "public", "app-version.json");
fs.writeFileSync(target, `${JSON.stringify(version)}\n`, "utf8");
console.log(`Wrote ${path.relative(process.cwd(), target)} (${version.version})`);
