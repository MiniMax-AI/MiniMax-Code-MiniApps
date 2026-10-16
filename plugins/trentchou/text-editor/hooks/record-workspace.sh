#!/bin/sh
# Records the workspace of the conversation that just started or received a message, so the
# text editor can put that project first the next time it opens. Side effect only: no stdout.
cat > /dev/null
[ -n "$PLUGIN_DATA" ] && [ -n "$MINIMAX_PROJECT_DIR" ] || exit 0
mkdir -p "$PLUGIN_DATA" || exit 0
tmp="$PLUGIN_DATA/active-workspace.$$"
printf '%s' "$MINIMAX_PROJECT_DIR" > "$tmp" && mv -f "$tmp" "$PLUGIN_DATA/active-workspace"
exit 0
