import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { errorText, isTauri } from "./api";
import { useStore } from "./store";

let pending: Update | null = null;

/** Checks GitHub for a newer release. Returns true if one is available. */
export async function checkForUpdate(silent = true): Promise<boolean> {
  if (!isTauri) return false;
  const { setUpdate, toast } = useStore.getState();
  try {
    const update = await check();
    if (!update) {
      if (!silent) toast("You're on the latest version", "ok");
      return false;
    }
    pending = update;
    setUpdate({ version: update.version, notes: update.body ?? "", date: update.date ?? null, state: "available", progress: 0 });
    return true;
  } catch (e) {
    if (!silent) toast(`Couldn't check for updates: ${errorText(e)}`, "error");
    return false;
  }
}

export async function installUpdate() {
  const { update, setUpdate } = useStore.getState();
  if (!pending || !update) return;
  let total = 0;
  let got = 0;
  setUpdate({ ...update, state: "downloading", progress: 0 });
  try {
    await pending.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        const u = useStore.getState().update;
        if (u) setUpdate({ ...u, progress: total ? got / total : 0 });
      }
    });
    setUpdate({ ...update, state: "ready", progress: 1 });
    await relaunch();
  } catch (e) {
    setUpdate({ ...update, state: "error", progress: 0, error: errorText(e) });
  }
}
