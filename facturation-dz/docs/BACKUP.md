# Sauvegarde et restauration (§30, §31, §32, §33)

## Pourquoi c'est critique

La base `Data/facturation.db` est la donnée la plus importante de
l'application (§81). Toute la stratégie est construite autour d'une règle :
**il doit toujours exister une copie restaurable**.

## Sauvegarde automatique (§30)

Fréquences : quotidienne (défaut), hebdomadaire, à la fermeture, avant les
opérations critiques (migration §51, restauration §32).

- Fichiers : `Backups/facturation_2026-10-08_13-30-00_*.backup.sqlite`
- Rétention : **10 dernières par défaut**, paramétrable.
- Méthode : `VACUUM INTO` → copie cohérente même application ouverte (WAL).

## Sauvegarde manuelle (§31)

Bouton **SAUVEGARDER MES DONNÉES** → l'utilisateur choisit la destination :
clé USB, disque D:, disque externe, dossier réseau local. Format : base
SQLite + `metadata.json` (JSON ou archive ZIP selon le canal).

## Restauration (§32)

1. Sélection du fichier ; l'écran affiche date, taille, version de schéma,
   nombre de factures/clients/produits.
2. **Sauvegarde de sécurité automatique** de l'état courant AVANT l'opération.
3. Confirmation explicite, puis remplacement et redémarrage propre.

## Export complet (§33)

`EXPORTER TOUTES LES DONNÉES` : clients, produits, factures, lignes,
paiements, paramètres — SQLite backup, JSON, CSV (rapports), Excel (CSV),
impression PDF des listes.

## Vérification (§49)

Contrôle d'intégrité : orphelins, doublons de numéros, incohérences de
totaux, paiements incohérents, `PRAGMA integrity_check`.

## Ce qui est garanti (§81)

- Une mise à jour ne supprime jamais la base (§3, §51).
- Une désinstallation conserve les données par défaut (§52).
- Une restauration crée toujours une sauvegarde de sécurité d'abord (§32).
- Les factures validées ne peuvent pas être détruites par suppression (§34).
