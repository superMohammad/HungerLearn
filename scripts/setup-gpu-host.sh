#!/usr/bin/env bash
# One-time setup of the team GPU host: serve Ollama to teammates over Tailscale only.
# Needs sudo, an installed Tailscale (`tailscale up` done) and an active ufw firewall.
#
# Usage: sudo scripts/setup-gpu-host.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo" >&2
  exit 1
fi
command -v tailscale >/dev/null || { echo "Install Tailscale first: https://tailscale.com/download/linux" >&2; exit 1; }
ip link show tailscale0 >/dev/null 2>&1 || { echo "tailscale0 not found. Run: sudo tailscale up" >&2; exit 1; }
ufw status | grep -q "Status: active" || {
  echo "ufw is not active. Ollama would be open to the whole LAN. Run: sudo ufw enable" >&2
  exit 1
}

echo "== Ollama: listen on all interfaces, one model in VRAM, one request at a time"
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/hungerlearn.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"
EOF
systemctl daemon-reload
systemctl restart ollama

echo "== Firewall: Ollama (11434) and staging app (3000) only over tailscale0"
ufw allow in on tailscale0 to any port 11434 proto tcp
ufw allow in on tailscale0 to any port 3000 proto tcp
ufw deny 11434/tcp
ufw deny 3000/tcp

cat <<EOF

Done. Teammates use GPU_HOST=$(tailscale ip -4 | head -1)
Staging app for teammates: cd web && pnpm dev -H 0.0.0.0   -> http://<that IP>:3000
EOF
