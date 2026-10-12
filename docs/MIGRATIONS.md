# Migrations de base de données (§5, §51)

## Principes

1. **Versionnées** : `db/migrations/000N_nom.sql`, appliquées dans l'ordre,
   tracées dans `schema_migrations`.
2. **Jamais destructives** : on ajoute, on renomme via vues, on ne supprime
   pas de données utilisateur.
3. **Backup avant migration** : `Backups/pre_migration_*.sqlite` créé
   automatiquement par le moteur (§51).
4. **Vérification après migration** : intégrité (§49) exécutée au démarrage.
5. **Règle absolue §81** : une migration ne supprime jamais la base ni les
   factures.

## Mécanisme

Au démarrage (`db.rs::Db::open`) :
```
open → pragma WAL/FK → lecture MAX(version) de schema_migrations
     → pour chaque migration non appliquée :
           backup VACUUM INTO (si base existante)
           BEGIN; exécution du script; INSERT schema_migrations; COMMIT
```

## Ajouter une migration (guide développeur)

1. Créer `db/migrations/0002_mon_changement.sql` :
   - DDL uniquement (CREATE/ALTER ADD COLUMN/INDEX) ;
   - INSERT OR IGNORE pour les données de référence ;
   - jamais de DROP de données utilisateur.
2. L'enregistrer dans `MIGRATIONS` (`src-tauri/src/db.rs`).
3. Incrémenter `SCHEMA_VERSION` côté frontend (`src/store/store.ts`) si le
   schéma exposé change.
4. Ajouter les tests de non-régression correspondants (§66).

## Compatibilité des sauvegardes

Les sauvegardes sont horodatées avec leur `schema_version`. À la
restauration d'une sauvegarde plus ancienne, les migrations manquantes sont
ré-appliquées automatiquement au démarrage suivant.
