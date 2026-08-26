import { join } from "node:path";

export const HOST_NAME = "com.tab_control.bridge";
export const HOST_PATH_PLACEHOLDER = "HOST_PATH";

export function filledHostManifest(template, hostPath) {
  return {
    ...template,
    path: hostPath
  };
}

export function hostManifestDestinations(home, platform = process.platform) {
  if (platform === "darwin") {
    return {
      firefox: [join(home, "Library/Application Support/Mozilla/NativeMessagingHosts")],
      chromium: [
        join(home, "Library/Application Support/Chromium/NativeMessagingHosts"),
        join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts"),
        join(home, "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
        join(home, "Library/Application Support/Microsoft Edge/NativeMessagingHosts"),
        join(home, "Library/Application Support/net.imput.helium/NativeMessagingHosts")
      ]
    };
  }

  if (platform === "linux") {
    return {
      firefox: [join(home, ".mozilla/native-messaging-hosts")],
      chromium: [
        join(home, ".config/chromium/NativeMessagingHosts"),
        join(home, ".config/google-chrome/NativeMessagingHosts"),
        join(home, ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
        join(home, ".config/microsoft-edge/NativeMessagingHosts"),
        join(home, ".config/net.imput.helium/NativeMessagingHosts")
      ]
    };
  }

  throw new Error(`Native host install is not supported on ${platform}`);
}
