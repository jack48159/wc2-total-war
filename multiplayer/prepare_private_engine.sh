#!/bin/sh
set -eu

base=/opt/wc2-multiplayer
engine="$base/multiplayer/engine"
source_game="$base/public/src/game"
source_data="$base/project/app/src/main/assets/remake/data"
source_assets="$base/project/app/src/main/assets"

test -f "$source_game/game.js"
test -f "$source_data/areas.json"
test -f "$base/public/data/commanders.json"
test -f "$source_assets/armydef.xml"
test -f "$source_assets/commanderdef.xml"
test "$(realpath "$base")" = /opt/wc2-multiplayer

mkdir -p "$engine/src" "$engine/data" "$engine/assets"
cp -a "$source_game" "$engine/src/"
if test -d "$base/public/scenarios"; then cp -a "$base/public/scenarios" "$engine/"; fi
cp -a "$source_data/." "$engine/data/"
cp -an "$base/public/data/." "$engine/data/"
cp -a "$source_assets/armydef.xml" "$source_assets/commanderdef.xml" "$engine/assets/"

test -f "$engine/src/game/game.js"
test -f "$engine/data/stages/battle_axis1.json"
test -f "$engine/data/commanders.json"
test -f "$engine/data/hoi4_commanders.json"
test -f "$engine/data/national_traits.json"
test -f "$engine/data/ai_doctrines.json"
test -f "$engine/assets/armydef.xml"
test -f "$engine/assets/commanderdef.xml"
