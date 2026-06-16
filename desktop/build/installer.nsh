; Custom NSIS uninstall hook for Mindre På Spil (electron-builder).
;
; Runs the still-installed app with --report-uninstall BEFORE any files are
; removed, so the backend is told protection is being uninstalled and can
; alert the user's accountability partner. ExecWait blocks until the headless
; report run exits; the Sleep is a small safety margin for the network call.
!macro customUnInstall
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --report-uninstall'
  Sleep 1500
!macroend
