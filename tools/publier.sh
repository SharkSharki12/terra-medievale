#!/bin/sh
# Compile une nouvelle version et prépare les fichiers de mise à jour (latest.json + exe) à publier
# comme « release » GitHub sur SharkSharki12/terra-medievale.
# Usage : tools/publier.sh 3.1.0 "Notes de version"
set -e
VER="$1"; NOTES="${2:-Nouvelle version}"
[ -n "$VER" ] || { echo "usage: $0 VERSION [NOTES]"; exit 1; }
REPO="SharkSharki12/terra-medievale"
URL="https://github.com/$REPO/releases/latest/download/latest.json"
cd "$(dirname "$0")/.."
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w -X main.Version=$VER -X main.UpdateURL=$URL" -o dist/TerraMedievale.exe .
SUM=$(sha256sum dist/TerraMedievale.exe | cut -d' ' -f1)
cat > dist/latest.json <<JSON
{"version":"$VER","url":"https://github.com/$REPO/releases/download/v$VER/TerraMedievale.exe","sha256":"$SUM","notes":"$NOTES"}
JSON
echo "Prêt : dist/TerraMedievale.exe + dist/latest.json (à publier dans la release v$VER)"
