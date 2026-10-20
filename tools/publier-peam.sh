#!/bin/sh
# Prépare la version PEAM : exe sans mise à jour automatique (PEAM s'en charge), licence PEAM obligatoire,
# et le .zip à envoyer sur PEAM (TerraMedievale.exe + peam.json à la racine).
# Usage : tools/publier-peam.sh 3.2.0 [identifiant-peam]
set -e
VER="$1"; ID="${2:-terra-medievale}"
[ -n "$VER" ] || { echo "usage: $0 VERSION [ID]"; exit 1; }
cd "$(dirname "$0")/.."
mkdir -p dist/peam
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w -X main.Version=$VER -X main.Distrib=peam" -o dist/peam/TerraMedievale.exe .
cat > dist/peam/peam.json <<JSON
{
  "id": "$ID",
  "name": "Terra Médiévale",
  "version": "$VER",
  "executable": "TerraMedievale.exe",
  "platforms": ["windows"],
  "minPeamVersion": "0.12.0",
  "saves": "%APPDATA%/TerraMedievale",
  "sdk": {
    "apiVersion": "3",
    "license": true,
    "features": ["license", "presence", "stats", "achievements", "overlay", "invites"]
  }
}
JSON
rm -f "dist/terra-medievale-$VER-peam.zip"
(cd dist/peam && zip -q -9 "../terra-medievale-$VER-peam.zip" TerraMedievale.exe peam.json)
echo "Prêt : dist/terra-medievale-$VER-peam.zip"
