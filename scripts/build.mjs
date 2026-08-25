import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src");
const manifestSource = join(root, "manifests");
const outputRoot = join(root, "dist");
const nativeRoot = join(root, "native");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await run("cargo", ["build", "--release", "--manifest-path", join(nativeRoot, "Cargo.toml")]);

const release = join(nativeRoot, "target", "release");
await cp(join(release, "native-host"), join(outputRoot, "native-host"));
await cp(join(release, "tabctl"), join(outputRoot, "tabctl"));

for (const browser of ["firefox", "chromium"]) {
  const output = join(outputRoot, browser);
  await mkdir(output, { recursive: true });
  await cp(source, output, { recursive: true });
  await cp(join(manifestSource, `${browser}.json`), join(output, "manifest.json"));
}

await writeFile(
  join(outputRoot, ".gitignore"),
  "*\n!.gitignore\n",
  "utf8"
);

console.log("Built dist/native-host, dist/tabctl, dist/firefox, and dist/chromium");

function run(command, arguments_) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, { stdio: "inherit", cwd: root });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
