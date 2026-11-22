"""JSON-RPC 2.0 Unix client, Python standard library only. No automatic retries."""
import http.client
import json
import socket
import threading


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path, timeout):
        super().__init__("localhost", timeout=timeout)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


class WalletClient:
    def __init__(self, socket_path="/run/nora-wallets/api.sock", timeout=15):
        self.connection = UnixConnection(socket_path, timeout)
        self.sequence = 0
        self.lock = threading.Lock()

    def call(self, method, **params):
        with self.lock:
            self.sequence += 1
            body = json.dumps(dict(jsonrpc="2.0", id=self.sequence,
                                   method=method, params=params))
            try:
                self.connection.request("POST", "/rpc", body,
                                        {"Content-Type": "application/json"})
                response = self.connection.getresponse()
                result = json.loads(response.read())
            except Exception:
                self.connection.close()
                raise RuntimeError("Wallet connection failed; request not retried") from None
            if response.status != 200 or result.get("id") != self.sequence or result.get("error"):
                raise RuntimeError(result.get("error", {}).get("message", "Wallet protocol error"))
            return result["result"]

    def list(self):
        return self.call("wallets.list")

    def create(self, wallet_id, label, family, network_ids, networks=None):
        params = dict(id=wallet_id, label=label, family=family, networkIds=network_ids)
        if networks is not None:
            params['networks'] = networks
        return self.call('wallets.create', **params)

    def rename(self, wallet_id, label):
        return self.call('wallets.rename', walletId=wallet_id, label=label)

    def backup(self):
        return self.call('wallets.backup')

    def backup_status(self):
        return self.call('wallets.backup_status')

    def assets(self, wallet_id, network_id, refresh=False):
        return self.call("wallets.assets", walletId=wallet_id,
                         networkId=network_id, refresh=refresh)

    def sign(self, wallet_id, network_id, kind, payload):
        return self.call("wallets.sign", walletId=wallet_id,
                         networkId=network_id, kind=kind, payload=payload)

    def sign_message(self, wallet_id, network_id, message):
        return self.sign(wallet_id, network_id, "message", message)

    def sign_transaction(self, wallet_id, network_id, transaction):
        return self.sign(wallet_id, network_id, "transaction", transaction)

    def sign_typed_data(self, wallet_id, network_id, data):
        return self.sign(wallet_id, network_id, "typedData", data)

    def sign_bytes(self, wallet_id, network_id, hex_bytes):
        return self.sign(wallet_id, network_id, "bytes", hex_bytes)

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
