@echo off
:: Thai Font Studio - installer for Adobe Illustrator (Windows)
::   install-windows.bat          install / update (copies only the files the panel needs)
::   install-windows.bat debug    same, plus remote debugging (Chrome -> http://localhost:8088)
::   install-windows.bat link     for development: link the extensions folder to this folder
::                                (edits show up after the panel's reload button, no reinstall)
setlocal EnableExtensions
title Thai Font Studio - Install

set "NAME=IllusFont"
set "BUNDLE=com.thaifontstudio.illustrator"
set "MODE=%~1"
set "SRC=%~dp0%NAME%"
if not exist "%SRC%\CSXS\manifest.xml" set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"
if not defined APPDATA ( echo ERROR: APPDATA is not set. & goto :fail )
set "CEP=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%CEP%\%NAME%"

echo ============================================
echo  Thai Font Studio installer %MODE%
echo ============================================
echo  From: %SRC%
echo  To:   %DEST%
echo.

if not exist "%SRC%\CSXS\manifest.xml" (
  echo ERROR: extension files not found next to this script.
  echo        Keep install-windows.bat in the same folder as CSXS, src, libs ...
  goto :fail
)

:: --- 1) Illustrator must be closed (files in use cannot be replaced, and the panel is cached)
:checkrun
tasklist /FI "IMAGENAME eq Illustrator.exe" 2>nul | find /I "Illustrator.exe" >nul
if not errorlevel 1 (
  echo Illustrator is running. Please save your work and close Illustrator.
  choice /C RC /N /M "Press R to retry after closing, C to cancel: "
  if errorlevel 2 goto :cancel
  goto :checkrun
)

:: --- 2) warn about a second copy in the all-users folder (two copies = two panels / old version loads)
for %%P in ("%ProgramFiles(x86)%\Common Files\Adobe\CEP\extensions" "%ProgramFiles%\Common Files\Adobe\CEP\extensions") do (
  if exist "%%~P\%NAME%\CSXS\manifest.xml" (
    echo WARNING: another copy exists in %%~P\%NAME%
    echo          Remove it ^(needs admin^) so Illustrator does not load the old one.
    echo.
  )
)

:: --- 3) remove the previous install
::     A link (junction / symlink) is removed as a link only - the folder it points to is never touched.
if not exist "%CEP%" mkdir "%CEP%"
set "ISLINK="
for /f "delims=" %%L in ('dir /AL /B "%CEP%" 2^>nul') do if /I "%%L"=="%NAME%" set "ISLINK=1"
if defined ISLINK (
  echo Removing the previous development link ^(its target folder is kept^).
  rmdir "%DEST%"
) else if exist "%DEST%" (
  rmdir /S /Q "%DEST%" 2>nul
)
if exist "%DEST%" ( echo ERROR: cannot remove the old version at %DEST% & goto :fail )

if /I "%MODE%"=="link" goto :link

:: --- 4) clean copy of the runtime files only (no tests, node_modules, backups)
mkdir "%DEST%"
for %%D in (CSXS src libs icons) do (
  robocopy "%SRC%\%%D" "%DEST%\%%D" /E /NFL /NDL /NJH /NJS /NP >nul
  if errorlevel 8 ( echo ERROR: copying %%D failed & goto :fail )
)
for %%F in (index.html styles.css hostScript.jsx) do (
  copy /Y "%SRC%\%%F" "%DEST%\%%F" >nul
  if errorlevel 1 ( echo ERROR: copying %%F failed & goto :fail )
)
goto :verify

:link
mklink /J "%DEST%" "%SRC%" >nul
if errorlevel 1 ( echo ERROR: could not create the link. & goto :fail )
echo Linked %DEST% -^> %SRC%

:: --- 5) verify
:verify
set "MISSING="
for %%F in (CSXS\manifest.xml index.html styles.css hostScript.jsx libs\CSInterface.js libs\opentype.min.js src\app\core.js) do (
  if not exist "%DEST%\%%F" ( echo   missing: %%F & set "MISSING=1" )
)
if defined MISSING ( echo ERROR: the installed copy is incomplete. & goto :fail )

:: --- 6) allow unsigned extensions (CSXS 9 = Illustrator 2019 ... CSXS 12 = Illustrator 2025+)
if not defined TFS_SKIP_REG (
  for %%V in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)

:: --- 7) optional remote debugging
if /I not "%MODE%"=="debug" goto :report
> "%DEST%\.debug" (
  echo ^<?xml version="1.0" encoding="UTF-8"?^>
  echo ^<ExtensionList^>
  echo   ^<Extension Id="%BUNDLE%.panel"^>^<HostList^>^<Host Name="ILST" Port="8088"/^>^</HostList^>^</Extension^>
  echo ^</ExtensionList^>
)
echo Debug: open http://localhost:8088 in Chrome while the panel is open.

:: --- 8) report installed Illustrator versions
:report
set "FOUND="
for /D %%A in ("%ProgramFiles%\Adobe\Adobe Illustrator*") do ( set "FOUND=1" & echo Found: %%~nxA )
if not defined FOUND echo Note: Illustrator was not found in "%ProgramFiles%\Adobe". The panel needs Illustrator 2019 ^(v23^) or newer.

echo.
echo DONE. Start Illustrator, then open Window ^> Extensions ^> Thai Font Studio.
echo If the menu item is missing, see "Troubleshooting" in README.md.
goto :end

:cancel
echo Cancelled. Nothing was changed.
goto :end

:fail
echo.
echo Install did not finish.

:end
echo.
if not defined TFS_NO_PAUSE pause
endlocal
