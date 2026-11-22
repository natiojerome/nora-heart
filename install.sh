#!/usr/bin/env bash
# Public bootstrap. Usage: curl -fsSL .../install.sh | sudo bash -s -- --path /srv/heart
set -euo pipefail
if [[ "$EUID" != 0 ]]; then echo 'Relancer avec sudo bash.' >&2; exit 1; fi
destination=/opt/nora-heart
args=("$@")
for ((i=0;i<$#;i++)); do
  if [[ "${args[i]}" == --path ]]; then destination="${args[i+1]:?Chemin requis}"; fi
  if [[ "${args[i]}" == --path=* ]]; then destination="${args[i]#--path=}"; fi
  if [[ "${args[i]}" == --help ]]; then echo 'Options : --path /chemin/heart [--address IP | --domain assistant.example.com | --private] [--account-server https://mcps.natio.re] [--port 4215] [--password-file /fichier/prive]'; exit 0; fi
done
command -v apt-get >/dev/null || { echo 'Installateur : Debian/Ubuntu avec systemd requis.' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo 'Un serveur avec systemd actif est requis.' >&2; exit 1; }
if ! command -v git >/dev/null || ! command -v python3 >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git python3 ca-certificates curl
fi
destination="$(realpath -m -- "$destination")"
if [[ -e "$destination/.heart/install.json" || -f "$destination/.git/heart-bootstrap" ]]; then
  exec python3 "$destination/scripts/install.py" "${args[@]}"
fi
if [[ -e "$destination" ]] && [[ -n "$(ls -A -- "$destination")" ]]; then
  echo 'Dossier non vide : aucun fichier remplacé. Choisir un nouveau chemin.' >&2; exit 1
fi
git clone --depth 1 https://github.com/natiojerome/nora-heart.git "$destination"
touch "$destination/.git/heart-bootstrap"
exec python3 "$destination/scripts/install.py" "${args[@]}"
