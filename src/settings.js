import { loadInstance, saveProfileName } from "./instance.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const form = document.querySelector("#settings-form");
const input = document.querySelector("#profile-name");
const instanceId = document.querySelector("#instance-id");
const status = document.querySelector("#status");
const saveButton = form.querySelector("button");

const instance = await loadInstance(extensionApi);
input.value = instance.name ?? "";
instanceId.textContent = instance.instanceId;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  status.textContent = "Saving…";
  try {
    const name = await saveProfileName(extensionApi, input.value);
    input.value = name ?? "";
    status.textContent = "Saved";
  } catch (error) {
    status.textContent = error?.message ?? "Could not save the profile name";
  } finally {
    saveButton.disabled = false;
  }
});
