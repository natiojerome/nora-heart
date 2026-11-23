import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Native host supervision. An absent JS child does not prove its systemd unit stopped. */
export interface HostUnits {
  active(id: string): Promise<boolean>;
  stop(id: string): Promise<void>;
}
const run = promisify(execFile);
export class SystemdUnits implements HostUnits {
  private async command(id: string, args: string[]) {
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new Error("Identifiant de commande invalide.");
    try {
      return (
        await run("/usr/bin/systemctl", [...args, `heart-yolo-${id}.service`], {
          timeout: 15000,
          env: { PATH: "/usr/bin:/bin" },
        })
      ).stdout.trim();
    } catch {
      throw new Error(
        "État de la commande hôte indisponible. Aucun arrêt présumé.",
      );
    }
  }
  async active(id: string) {
    const state = await this.command(id, [
      "show",
      "--property=ActiveState",
      "--value",
    ]);
    if (["inactive", "failed"].includes(state)) return false;
    if (
      [
        "active",
        "activating",
        "deactivating",
        "reloading",
        "refreshing",
      ].includes(state)
    )
      return true;
    throw new Error("État de la commande hôte inconnu. Aucun arrêt présumé.");
  }
  async stop(id: string) {
    await this.command(id, ["stop"]);
    if (await this.active(id))
      throw new Error("Arrêt de la commande hôte non confirmé.");
  }
}
