#!/bin/sh
# Download the OFAC list exports used by scripts/accuracy.mjs into the given directory.
set -eu
DIR="${1:?usage: scripts/fetch-ofac.sh <dir>}"
mkdir -p "$DIR"
for f in SDN.CSV ALT.CSV ADD.CSV CONS_PRIM.CSV CONS_ALT.CSV CONS_ADD.CSV; do
  curl -sSL -o "$DIR/$f" "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/$f"
done
echo "Saved to $DIR"
