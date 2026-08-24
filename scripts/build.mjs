import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src");
const manifestSource = join(root, "manifests");
const outputRoot = join(root, "dist");

await rm(outputRoot, { recursive: true, force: true });

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

console.log("Built dist/firefox and dist/chromium");
