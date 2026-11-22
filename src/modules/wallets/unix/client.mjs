import { Agent, request } from "node:http";

/** Standalone client: native Node only, persistent connection, no retry or key material. */
export class WalletClient {
  constructor(
    socket = "/run/nora-wallets/api.sock",
    { timeoutMs = 15000, maxSockets = Infinity } = {},
  ) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.agent = new Agent({ keepAlive: true, maxSockets });
    this.sequence = 0;
  }
  call(method, params = {}) {
    const id = ++this.sequence,
      body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socket,
          path: "/rpc",
          method: "POST",
          agent: this.agent,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("error", () => reject(Error("Wallet connection interrupted")));
          res.on("end", () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              if (
                data.id !== id ||
                data.jsonrpc !== "2.0" ||
                data.error ||
                res.statusCode !== 200
              )
                throw Error(data.error?.message || "Wallet protocol error");
              resolve(data.result);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on("error", () =>
        reject(Error("Local wallet service unavailable; no request retried")),
      );
      if (this.timeoutMs)
        req.setTimeout(this.timeoutMs, () =>
          req.destroy(Error("Wallet request timed out")),
        );
      req.end(body);
    });
  }
  list() {
    return this.call("wallets.list");
  }
  assets(walletId, networkId, refresh = false) {
    return this.call("wallets.assets", { walletId, networkId, refresh });
  }
  sign(request) {
    return this.call("wallets.sign", request);
  }
  signMessage(walletId, networkId, message) {
    return this.sign({
      walletId,
      networkId,
      kind: "message",
      payload: message,
    });
  }
  signTransaction(walletId, networkId, transaction) {
    return this.sign({
      walletId,
      networkId,
      kind: "transaction",
      payload: transaction,
    });
  }
  signTypedData(walletId, networkId, data) {
    return this.sign({ walletId, networkId, kind: "typedData", payload: data });
  }
  signBytes(walletId, networkId, hexBytes) {
    return this.sign({ walletId, networkId, kind: "bytes", payload: hexBytes });
  }
  create(request) {
    return this.call("wallets.create", request);
  }
  rename(walletId, label) {
    return this.call("wallets.rename", { walletId, label });
  }
  requestBackup() {
    return this.call("wallets.backup");
  }
  backupStatus() {
    return this.call("wallets.backup_status");
  }
  close() {
    this.agent.destroy();
  }
}
