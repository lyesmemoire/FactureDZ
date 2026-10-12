; ============================================================
; FacturationDZ — Hooks NSIS personnalisés de l'installateur
; ============================================================
; §52 du cahier des charges : la désinstallation ne doit JAMAIS
; supprimer automatiquement les données de l'utilisateur.
; Les données vivent dans %ProgramData%\FacturationDZ
; (Data, Backups, Documents, Exports, Logs).
;
; §79 : aucune revendication de certification officielle (DGI).
;
; Encodage : UTF-8 — Tauri invoque makensis avec -INPUTCHARSET UTF8.
; NB : $COMMONAPPDATA n'existe pas comme constante NSIS ; on résout
;      %ProgramData% via ExpandEnvStrings (valide dans le désinstalleur).
; ============================================================


; ------------------------------------------------------------
; NSIS_HOOK_POSTINSTALL — après copie des fichiers et raccourcis
; ------------------------------------------------------------
!macro NSIS_HOOK_POSTINSTALL
  IfSilent facturationdz_postinstall_done

  Push $0
  ExpandEnvStrings $0 "%ProgramData%"
  StrCpy $0 "$0\FacturationDZ"

  MessageBox MB_OK|MB_ICONINFORMATION "FacturationDZ est installé.$\r$\n$\r$\n• Fonctionnement 100 % hors ligne : aucune donnée ne quitte cet ordinateur.$\r$\n• Vos données seront enregistrées dans :$\r$\n   $0$\r$\n$\r$\nRappel : ce logiciel est conçu pour intégrer la réglementation algérienne applicable. La validation finale des documents reste sous la responsabilité de l'entreprise et de son conseil fiscal."

  Pop $0
  facturationdz_postinstall_done:
!macroend


; ------------------------------------------------------------
; NSIS_HOOK_PREUNINSTALL — avant toute suppression
; Conservation par défaut ; suppression uniquement après double
; confirmation explicite ; jamais en mode silencieux.
; ------------------------------------------------------------
!macro NSIS_HOOK_PREUNINSTALL
  Push $0
  ExpandEnvStrings $0 "%ProgramData%"
  StrCpy $0 "$0\FacturationDZ"

  ; Mise à jour / déploiement silencieux (/S) : conserver, toujours.
  IfSilent facturationdz_keep_data

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Vos données FacturationDZ (factures, avoirs, paiements, sauvegardes, documents PDF, exports, journaux) se trouvent dans :$\r$\n$0$\r$\n$\r$\nOui  : conserver mes données (recommandé)$\r$\nNon : me proposer de tout supprimer" IDYES facturationdz_keep_data IDNO facturationdz_confirm_delete

  facturationdz_confirm_delete:
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "CONFIRMATION — Suppression DÉFINITIVE et IRRÉVERSIBLE de toutes les données FacturationDZ ?$\r$\n$\r$\nDossier : $0$\r$\n$\r$\nCette action détruit votre base de données et vos sauvegardes. Elle est impossible à annuler.$\r$\n$\r$\nConfirmer la suppression totale ?" IDYES facturationdz_delete_data IDNO facturationdz_keep_data

  facturationdz_delete_data:
  ; Suppression uniquement sur demande explicite et confirmée.
  ; Best-effort : sans droits suffisants, la suppression échoue silencieusement.
  RMDir /r /REBOOTOK "$0"

  facturationdz_keep_data:
  Pop $0
!macroend
