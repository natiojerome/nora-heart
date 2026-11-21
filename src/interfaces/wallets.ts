import { runWalletCommand } from "../app/wallets.ts";
try {
  console.log(
    JSON.stringify(
      await runWalletCommand(process.argv[2] ?? "help", process.argv.slice(3)),
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Wallet command failed. Check command, configuration, source key/address match, file permissions and supported networks. No secret values logged. See docs/WALLETS.md.",
  );
  process.exitCode = 1;
}
