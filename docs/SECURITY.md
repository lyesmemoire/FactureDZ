# Sécurité (§36)

## Authentification locale

- Comptes locaux uniquement (§35) — aucun service cloud, aucune connexion.
- Mots de passe : **Argon2id** (backend desktop) / SHA-256 salé (démo
  navigateur). Jamais stockés en clair. Jamais journalisés (§67).
- Sessions locales avec expiration (`sessions`), verrouillage automatique
  après inactivité : 5/10/15/30 min ou jamais (§37).

## Permissions par rôle (§35)

| Rôle | Droits |
|---|---|
| ADMIN | Tout (paramètres, utilisateurs, restauration…) |
| GESTIONNAIRE | Documents, clients, produits, paiements, rapports, sauvegardes |
| COMPTABLE | Factures, paiements, rapports, exports |
| VENDEUR | Clients, catalogue, brouillons uniquement |
| LECTEUR | Consultation seule |

## Protection des données

- SQL injecté impossible : requêtes préparées partout (rusqlite /
  adaptateur local typé).
- CSP restrictive dans la WebView (`script-src 'self'`, pas de scripts
  distants) — protection XSS (§36).
- Permissions Tauri minimales (capabilities) : pas d'accès shell, pas de
  requêtes réseau.
- Aucune télémétrie, aucune collecte (§62) : les données commerciales
  (clients, NIF, montants, coordonnées bancaires) ne quittent jamais le PC.

## Protection des factures

- Factures validées : non supprimables et non modifiables **au niveau de la
  base** (triggers SQLite) (§20, §34, §47).
- Annulation tracée : motif, auteur, horodatage (§21).
- Chaque action sensible est historisée dans `audit_logs` (§34).

## Journalisation (§67)

Deux journaux distincts :
1. **Journal d'audit** (métier, append-only, consultable à l'écran).
2. **Journal technique** `Logs/facturationdz.log` (INFO/WARNING/ERROR/CRITICAL).

## Erreurs utilisateur (§68)

Les erreurs SQLite sont reformulées en messages métier clairs
(`error.rs::user_message`), jamais d'erreur brute affichée.

## RÈGLE ABSOLUE (§81)

Aucune mise à jour, erreur, désinstallation ou restauration ne peut détruire
les données sans une sauvegarde préalable vérifiée (§32, §51, §52).
