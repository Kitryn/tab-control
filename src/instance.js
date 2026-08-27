const INSTANCE_ID_KEY = "instanceId";
const PROFILE_NAME_KEY = "profileName";
const PROFILE_NAME_MAX_LENGTH = 64;

export async function loadInstance(api) {
  const stored = await readInstanceId(api);
  const instanceId = stored ?? crypto.randomUUID();
  if (stored !== instanceId) {
    await api.storage.local.set({ [INSTANCE_ID_KEY]: instanceId });
  }
  return {
    instanceId,
    browser: await browserName(api),
    name: await readProfileName(api)
  };
}

export async function saveProfileName(api, value) {
  if (typeof value !== "string") {
    throw new TypeError("Profile name must be text");
  }
  const name = value.trim() || null;
  if (name && name.length > PROFILE_NAME_MAX_LENGTH) {
    throw new RangeError(`Profile name must not exceed ${PROFILE_NAME_MAX_LENGTH} characters`);
  }
  await api.storage.local.set({ [PROFILE_NAME_KEY]: name });
  return name;
}

async function readInstanceId(api) {
  const result = await api.storage.local.get(INSTANCE_ID_KEY);
  const value = result[INSTANCE_ID_KEY];
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  ) {
    return undefined;
  }
  return value;
}

async function readProfileName(api) {
  const result = await api.storage.local.get(PROFILE_NAME_KEY);
  const value = result[PROFILE_NAME_KEY];
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name.length <= PROFILE_NAME_MAX_LENGTH ? name : null;
}

async function browserName(api) {
  if (typeof api.runtime.getBrowserInfo === "function") {
    const info = await api.runtime.getBrowserInfo();
    if (info?.name) {
      return info.name;
    }
  }

  const brands = navigator.userAgentData?.brands;
  if (Array.isArray(brands)) {
    const names = new Set(brands.map((entry) => entry?.brand).filter(Boolean));
    if (names.has("Brave")) return "Brave";
    if (names.has("Microsoft Edge")) return "Edge";
    if (names.has("Opera")) return "Opera";
    if (names.has("Vivaldi")) return "Vivaldi";
    if (names.has("Google Chrome")) return "Chrome";
    if (names.has("Chromium")) return "Chromium";
  }

  const userAgent = navigator.userAgent;
  if (userAgent.includes("Firefox/")) return "Firefox";
  if (userAgent.includes("Edg/")) return "Edge";
  if (userAgent.includes("OPR/") || userAgent.includes("Opera/")) return "Opera";
  if (userAgent.includes("Brave/")) return "Brave";
  if (userAgent.includes("Chrome/")) return "Chrome";
  return "Chromium";
}
