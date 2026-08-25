import { join } from "node:path";

export const HOST_NAME = "com.tab_control.bridge";
export const HOST_PATH_PLACEHOLDER = "HOST_PATH";

export function filledHostManifest(template, hostPath, chromiumExtensionId) {
  const manifest = {
    ...template,
    path: hostPath
  };

  if (chromiumExtensionId && Array.isArray(manifest.allowed_origins)) {
    manifest.allowed_origins = [`chrome-extension://${chromiumExtensionId}/`];
  }

  return manifest;
}

export function hostManifestDestinations(home, platform = process.platform) {
  if (platform === "darwin") {
    return {
      firefox: [join(home, "Library/Application Support/Mozilla/NativeMessagingHosts")],
      chromium: [
        join(home, "Library/Application Support/Chromium/NativeMessagingHosts"),
        join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts")
      ]
    };
  }

  if (platform === "linux") {
    return {
      firefox: [join(home, ".mozilla/native-messaging-hosts")],
      chromium: [
        join(home, ".config/chromium/NativeMessagingHosts"),
        join(home, ".config/google-chrome/NativeMessagingHosts")
      ]
    };
  }

  throw new Error(`Native host install is not supported on ${platform}`);
}
