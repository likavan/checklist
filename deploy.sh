#!/bin/bash
set -e

SERVER="${CHECKLIST_SERVER:-root@204.168.230.16}"

echo "📦 Deploying Checklist Auditor to $SERVER…"

ssh "$SERVER" bash -s <<'EOF'
set -e
cd /root/checklist
git pull
npm ci --omit=dev=false
npm run build
systemctl restart checklist
echo "✅ Deploy done. Service status:"
systemctl is-active checklist
EOF
