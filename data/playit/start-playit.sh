#!/usr/bin/env bash
set -e
cd "$GITHUB_WORKSPACE"

echo "============================================================"
echo "PLAYIT TMUX SESSION"
echo "============================================================"
echo "HOME=$GITHUB_WORKSPACE/$PLAYIT_DIR/home"
echo "XDG_CONFIG_HOME=$GITHUB_WORKSPACE/$PLAYIT_DIR/config"
echo "Attach from SSH with: tmux attach -t playit"
echo "Detach with: Ctrl+B then D"
echo "============================================================"

if [ -n "${PLAYIT_SECRET_KEY:-}" ]; then
echo "PLAYIT_SECRET_KEY is set. Starting with secret key."
exec env \
HOME="$GITHUB_WORKSPACE/$PLAYIT_DIR/home" \
XDG_CONFIG_HOME="$GITHUB_WORKSPACE/$PLAYIT_DIR/config" \
SECRET_KEY="$PLAYIT_SECRET_KEY" \
./playit-linux-amd64
else
echo "PLAYIT_SECRET_KEY is not set. Starting first-run claim/setup mode."
exec env \
HOME="$GITHUB_WORKSPACE/$PLAYIT_DIR/home" \
XDG_CONFIG_HOME="$GITHUB_WORKSPACE/$PLAYIT_DIR/config" \
./playit-linux-amd64
fi
