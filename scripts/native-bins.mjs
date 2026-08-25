import { spawn } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const target = process.env.CARGO_TARGET_DIR ?? join(root, "native", "target");

export const nativeHost = join(target, "debug", "native-host");
export const tabctl = join(target, "debug", "tabctl");

let built = false;

export async function buildNativeBins() {
  if (built) return;
  await new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      ["build", "--manifest-path", join(root, "native", "Cargo.toml")],
      { stdio: "inherit", cwd: root }
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        built = true;
        resolve();
      } else {
        reject(new Error("cargo build failed"));
      }
    });
  });
}
