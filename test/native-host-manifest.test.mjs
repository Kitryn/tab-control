import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  HOST_PATH_PLACEHOLDER,
  filledHostManifest,
  hostManifestDestinations
} from "../scripts/native-host-manifest.mjs";

const root = process.cwd();

test("host manifest templates do not pin a machine path", async () => {
  for (const browser of ["firefox", "chromium"]) {
    const manifest = JSON.parse(
      await readFile(join(root, "native-host-manifests", `${browser}.json`), "utf8")
    );
    assert.equal(manifest.path, HOST_PATH_PLACEHOLDER);
  }
});

test("install fills the absolute host path", async () => {
  const template = JSON.parse(
    await readFile(join(root, "native-host-manifests", "firefox.json"), "utf8")
  );
  const filled = filledHostManifest(template, "/opt/tab-control/native-host");
  assert.equal(filled.path, "/opt/tab-control/native-host");
  assert.deepEqual(filled.allowed_extensions, template.allowed_extensions);
});

test("install can set the Chromium extension id", async () => {
  const template = JSON.parse(
    await readFile(join(root, "native-host-manifests", "chromium.json"), "utf8")
  );
  const filled = filledHostManifest(template, "/opt/tab-control/native-host", "abcdefgh");
  assert.deepEqual(filled.allowed_origins, ["chrome-extension://abcdefgh/"]);
});

test("linux user destinations match the browser docs", () => {
  const destinations = hostManifestDestinations("/home/dev", "linux");
  assert.deepEqual(destinations.firefox, [
    "/home/dev/.mozilla/native-messaging-hosts"
  ]);
  assert.deepEqual(destinations.chromium, [
    "/home/dev/.config/chromium/NativeMessagingHosts",
    "/home/dev/.config/google-chrome/NativeMessagingHosts"
  ]);
});
