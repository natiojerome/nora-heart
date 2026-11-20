#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Exécuter le déploiement avec les droits administrateur.' >&2
  exit 1
fi
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${HARNESS_NODE_BIN:-$project_root/.tools/node-v$(cat "$project_root/.node-version")-linux-x64/bin/node}"
"$node_bin" -e 'if (process.versions.node.split(".")[0] !== "24") process.exit(1)'

if ! id personal-harness >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/personal-harness --shell /usr/sbin/nologin personal-harness
fi
install -d -m 0700 -o personal-harness -g personal-harness /var/lib/personal-harness
install -d -m 0700 -o personal-harness -g personal-harness /var/lib/personal-harness/lab /var/lib/personal-harness/chatgpt
install -d -m 0700 /etc/personal-harness

# Reuse the signing key on redeploy. Do not echo, reuse or import another Nora's secrets.
if [[ ! -f /etc/personal-harness/web.env ]]; then
  python3 - <<'PY'
from pathlib import Path
import os,secrets
p=Path('/etc/personal-harness/web.env')
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:
 f.write('HARNESS_WEB_SESSION_SECRET='+secrets.token_hex(32)+'\n')
 f.write('HARNESS_WEB_ORIGIN=https://heart.natio.re\n')
 f.write('HARNESS_WEB_STATE_DIR=/var/lib/personal-harness/lab\n')
 f.write('HARNESS_CHATGPT_AUTH_DIR=/var/lib/personal-harness/chatgpt\n')
 f.write('HARNESS_WEB_INVITE_FILE=/var/lib/personal-harness/invite.json\n')
 f.write('HARNESS_WEB_HOST=172.18.0.1\nPORT=4215\n')
PY
fi

cat > /etc/systemd/system/personal-harness-web.service <<EOF
[Unit]
Description=Personal harness test web interface
After=network-online.target
Wants=network-online.target

[Service]
User=personal-harness
Group=personal-harness
WorkingDirectory=$project_root
EnvironmentFile=/etc/personal-harness/web.env
Environment=NODE_ENV=production
ExecStart=$node_bin $project_root/node_modules/tsx/dist/cli.mjs $project_root/src/interfaces/web.ts
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/personal-harness
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=1G
CPUQuota=100%
TasksMax=192

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable personal-harness-web.service
systemctl restart personal-harness-web.service
echo 'Service web installé. Le proxy et le DNS se configurent séparément après vérification.'
