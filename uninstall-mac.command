#!/bin/bash
# Thai Font Studio - uninstaller (macOS)
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/IllusFont"
pgrep -f "Adobe Illustrator.app/Contents/MacOS" >/dev/null 2>&1 && echo "Note: quit Illustrator first."
if [ -L "$DEST" ]; then rm "$DEST" && echo "Removed the development link $DEST (the linked folder was not touched)."
elif [ -d "$DEST" ]; then rm -rf "$DEST" && echo "Removed $DEST"
else echo "Not installed."; fi
echo
echo "PlayerDebugMode was left on because other unsigned extensions may need it."
echo "To turn it off: defaults delete com.adobe.CSXS.12 PlayerDebugMode   (repeat for 9-13)"
echo "Your font projects (.ai files) are not touched."
read -r -p "Press Return to close." _
