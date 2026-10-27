#!/bin/sh
# Rebuilds everything in /data and /assets from the original archives.
# Needs: unzip/bsdtar (built into macOS), ruby (built into macOS), node.
set -e
cd "$(dirname "$0")/.."

if [ ! -d "_raw/map/Essentials FRLG" ]; then
  echo "Unpacking Map.zip, pkmSprites.zip and spritesRed.gz into _raw/ ..."
  mkdir -p _raw/map _raw/pkmSprites _raw/spritesRed
  (cd _raw/map && bsdtar -xf ../../Map.zip)
  python3 -I tools/unzip_names.py pkmSprites.zip _raw/pkmSprites
  gunzip -c spritesRed.gz > _raw/spritesRed/generation-1.tar
  (cd _raw/spritesRed && tar -xf generation-1.tar && rm generation-1.tar)
fi

ruby tools/rxdata2json.rb "_raw/map/Essentials FRLG/Data" _raw/json
ruby tools/anims2json.rb "_raw/map/Essentials FRLG/Data" data/animations.json
node tools/convert.js
node tools/bundle.js
echo "Done. Play with:  node tools/serve.js   (or open index.html)"
