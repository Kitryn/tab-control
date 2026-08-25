import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src");

for (const file of await readdir(source)) {
  if (!file.endsWith(".js")) continue;
  await checkJavaScript(join(source, file));
}

await checkRust();

for (const browser of ["firefox", "chromium"]) {
  const manifest = JSON.parse(
    await readFile(join(root, "manifests", `${browser}.json`), "utf8")
  );
  if (manifest.manifest_version !== 3) {
    throw new Error(`${browser} manifest requires Manifest V3`);
  }
  if (!manifest.action?.default_popup) {
    throw new Error(`${browser} manifest requires a dashboard popup`);
  }
  if (manifest.background?.type !== "module") {
    throw new Error(`${browser} background must be type module`);
  }
}

console.log("Source and manifests are valid");

function checkRust() {
  return new Promise((resolveCheck, reject) => {
    const child = spawn(
      "cargo",
      ["check", "--manifest-path", join(root, "native", "Cargo.toml")],
      { stdio: "inherit", cwd: root }
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveCheck();
      else reject(new Error("Compile check failed for native crate"));
    });
  });
}

function checkJavaScript(file) {
  return new Promise((resolveCheck, reject) => {
    const child = spawn(process.execPath, ["--check", file], {
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveCheck();
      else reject(new Error(`Syntax check failed for ${file}`));
    });
  });
}
