#!/bin/bash
# Thai Font Studio - installer for Adobe Illustrator (macOS)
#   ./install-mac.command          install / update
#   ./install-mac.command debug    same, plus remote debugging (Chrome -> http://localhost:8088)
#   ./install-mac.command link     for development: link the extensions folder to this folder
cd "$(dirname "$0")" || exit 1
MODE="$1"

NAME="IllusFont"
BUNDLE="com.thaifontstudio.illustrator"
SRC="$PWD/$NAME"
[ -f "$SRC/CSXS/manifest.xml" ] || SRC="$PWD"
CEP="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$CEP/$NAME"

fail() { echo; echo "ERROR: $1"; echo "Install did not finish."; read -r -p "Press Return to close." _; exit 1; }

echo "============================================"
echo " Thai Font Studio installer"
echo "============================================"
echo " From: $SRC"
echo " To:   $DEST"
echo

[ -f "$SRC/CSXS/manifest.xml" ] || fail "extension files not found next to this script."

# 1) Illustrator must be closed
while pgrep -f "Adobe Illustrator.app/Contents/MacOS" >/dev/null 2>&1; do
  echo "Illustrator is running. Please save your work and quit Illustrator."
  read -r -p "Press Return to retry, or type c to cancel: " ans
  [ "$ans" = "c" ] && { echo "Cancelled. Nothing was changed."; exit 0; }
done

# 2) warn about an all-users copy
if [ -f "/Library/Application Support/Adobe/CEP/extensions/$NAME/CSXS/manifest.xml" ]; then
  echo "WARNING: another copy exists in /Library/Application Support/Adobe/CEP/extensions/$NAME"
  echo "         Remove it so Illustrator does not load the old one."
  echo
fi

# 3) remove the previous install (a symlink is removed as a link only - its target is never touched)
mkdir -p "$CEP" || fail "cannot create $CEP"
if [ -L "$DEST" ]; then
  echo "Removing the previous development link (its target folder is kept)."
  rm "$DEST" || fail "cannot remove the link at $DEST"
elif [ -e "$DEST" ]; then
  rm -rf "$DEST" || fail "cannot remove the old version at $DEST"
fi

if [ "$MODE" = "link" ]; then
  ln -s "$SRC" "$DEST" || fail "could not create the link"
  echo "Linked $DEST -> $SRC"
else
  # 4) clean copy of the runtime files only
  mkdir -p "$DEST" || fail "cannot create $DEST"
  for d in CSXS src libs icons; do
    cp -R "$SRC/$d" "$DEST/" || fail "copying $d failed"
  done
  for f in index.html styles.css hostScript.jsx; do
    cp "$SRC/$f" "$DEST/" || fail "copying $f failed"
  done
fi

# 5) verify
missing=""
for f in CSXS/manifest.xml index.html styles.css hostScript.jsx libs/CSInterface.js libs/opentype.min.js src/app/core.js; do
  [ -f "$DEST/$f" ] || missing="$missing $f"
done
[ -z "$missing" ] || fail "missing after copy:$missing"

# downloaded zips are quarantined - Illustrator silently refuses quarantined panels
xattr -dr com.apple.quarantine "$DEST/" 2>/dev/null

# 6) allow unsigned extensions (CSXS 9 = Illustrator 2019 ... CSXS 12 = Illustrator 2025+)
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

# 7) optional remote debugging
if [ "$MODE" = "debug" ]; then
  cat > "$DEST/.debug" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<ExtensionList>
  <Extension Id="$BUNDLE.panel"><HostList><Host Name="ILST" Port="8088"/></HostList></Extension>
</ExtensionList>
EOF
  echo "Debug: open http://localhost:8088 in Chrome while the panel is open."
fi

# 8) report installed Illustrator versions
found=0
for a in /Applications/Adobe\ Illustrator*/; do
  [ -d "$a" ] && { echo "Found: $(basename "$a")"; found=1; }
done
[ $found = 1 ] || echo "Note: Illustrator was not found in /Applications. The panel needs Illustrator 2019 (v23) or newer."

echo
echo "DONE. Start Illustrator, then open Window > Extensions > Thai Font Studio."
echo "If the menu item is missing, see \"Troubleshooting\" in README.md."
read -r -p "Press Return to close." _
