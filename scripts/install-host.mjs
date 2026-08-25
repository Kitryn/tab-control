import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOST_NAME,
  filledHostManifest,
  hostManifestDestinations
} from "./native-host-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostPath = resolve(root, "dist", "native-host");
const chromiumExtensionId = extensionIdFromArgs(process.argv.slice(2));

try {
  await access(hostPath);
} catch {
  throw new Error("dist/native-host is missing. Run npm run build first.");
}

const destinations = hostManifestDestinations(homedir());
const firefoxTemplate = JSON.parse(
  await readFile(join(root, "native-host-manifests", "firefox.json"), "utf8")
);
const chromiumTemplate = JSON.parse(
  await readFile(join(root, "native-host-manifests", "chromium.json"), "utf8")
);

await install(
  destinations.firefox,
  filledHostManifest(firefoxTemplate, hostPath)
);
await install(
  destinations.chromium,
  filledHostManifest(chromiumTemplate, hostPath, chromiumExtensionId)
);

if (!chromiumExtensionId) {
  console.warn(
    "Chromium allowed_origins still has the placeholder ID. Pass --chromium-extension-id=<id> after loading the unpacked extension."
  );
}

console.log(`Installed ${HOST_NAME} -> ${hostPath}`);

async function install(directories, manifest) {
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  for (const directory of directories) {
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${HOST_NAME}.json`);
    await writeFile(file, body);
    console.log(file);
  }
}

function extensionIdFromArgs(arguments_) {
  for (const argument of arguments_) {
    if (argument.startsWith("--chromium-extension-id=")) {
      return argument.slice("--chromium-extension-id=".length);
    }
  }
  return undefined;
}
