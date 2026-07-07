#!/usr/bin/env bash
set -e
cd "/home/runner/work/vps/vps"
CMD=(
"data/server/runtime/TShock.Server"
-world "data/server/worlds/friends1.wld"
-autocreate "3"
-difficulty "2"
-port "7777"
-maxplayers "8"
-configpath "data/server/tshock"
-logpath "data/server/logs"
)
if [ -n "" ]; then
CMD+=( -pass "" )
fi
if [ -n "for the worthy" ]; then
CMD+=( -seed "for the worthy" )
fi
exec "${CMD[@]}"
