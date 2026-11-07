@echo off
:: Thai Font Studio - uninstaller (Windows)
setlocal EnableExtensions
title Thai Font Studio - Uninstall
set "NAME=IllusFont"
set "CEP=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%CEP%\%NAME%"

tasklist /FI "IMAGENAME eq Illustrator.exe" 2>nul | find /I "Illustrator.exe" >nul
if not errorlevel 1 echo Note: close Illustrator first, otherwise some files may stay in use.

set "ISLINK="
for /f "delims=" %%L in ('dir /AL /B "%CEP%" 2^>nul') do if /I "%%L"=="%NAME%" set "ISLINK=1"
if defined ISLINK (
  rmdir "%DEST%"
  echo Removed the development link %DEST% ^(the linked folder was not touched^).
) else if exist "%DEST%" (
  rmdir /S /Q "%DEST%"
  if exist "%DEST%" ( echo ERROR: could not remove %DEST% ) else ( echo Removed %DEST% )
) else (
  echo Not installed.
)
echo.
echo PlayerDebugMode was left on because other unsigned extensions may need it.
echo To turn it off: reg delete "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /f  ^(repeat for 9-13^)
echo Your font projects (.ai files) are not touched.
echo.
if not defined TFS_NO_PAUSE pause
endlocal
