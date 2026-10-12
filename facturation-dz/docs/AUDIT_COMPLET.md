# Audit complet — FacturationDZ

Périmètre : moteur de calcul (TypeScript et Rust), authentification et contrôle d'accès,
persistance SQLite, conformité au cahier des charges, dépendances, configuration Tauri.
Méthode : revue de code ciblée, contrôles automatiques (`tsc`, tests, build, `npm audit`),
recherches systématiques (réseau, flottants, secrets, mentions légales), puis correction
et nouvelle exécution des tests.

## 1. Synthèse

| ID | Gravité | Sujet | Statut |
|----|---------|-------|--------|
| F-19 | 🔴 Critique | Calculs monétaires en flottants (ligne, remise, TVA) | ✅ Corrigé |
| F-20 | 🔴 Critique | Repli local d'authentification : contournement du backend | ✅ Corrigé |
| F-21 | 🟠 Élevé | Commandes sensibles sans contrôle de session (Rust) | ✅ Corrigé (partiel, voir §4) |
| F-22 | 🟠 Moyen | Mention légale « validation finale / non certifié DGI » absente | ✅ Corrigé |
| F-23 | 🟠 Élevé | Rôles (ADMIN, GESTIONNAIRE, COMPTABLE, VENDEUR, LECTEUR) non appliqués | ✅ Corrigé (Rust + interface, voir §2 F-23) |
| F-24 | 🟡 Moyen | Vulnérabilités dans les outils de développement (vitest, vite, esbuild) | ⏳ Accepté, dev uniquement |
| F-25 | 🟢 Faible | 91 `unwrap()` sur verrous Mutex hors tests | ⏳ Informatif |
| F-26 | 🟠 Élevé | PDF natif ignorant la monnaie du document (« DA » et « dinars » codés en dur) | ✅ Corrigé (voir §7) |

Résultat après corrections : **124 tests frontend (1 ignoré) + 36 tests Rust, tous verts ;
`tsc` propre ; `npm audit --omit=dev` : 0 vulnérabilité.**

## 2. Constats et corrections

### F-19 — Calculs monétaires en flottants (critique)

**Constat.** La ligne calculait `arrondi(quantité × prix)` et `arrondi(montant × taux / 100)`
directement en flottants JavaScript et `f64` Rust. Le cahier des charges interdit ce mode de
calcul (§14). Cas reproduit : `1,005 × 100 centimes` donnait `100` (la valeur exacte est
`100,5`, arrondie à `101`).

**Correction.**
- `src/core/money.ts` : `mulDivRound` (BigInt, arrondi half-up exact), `scaleDecimal`,
  `lineBrutCents`. `pctOf` et `vatForLine` passent par ces fonctions.
- `src-tauri/src/invoices.rs` : `mul_div_round` (i128) et `compute_line` équivalents.
- Vecteurs de test communs TypeScript/Rust (`1,005×100 → 101`, `1 000 × 1,15 % → 12`,
  `1 000 × 9,5 % → 95`, `0,333 × 300 000 → 99 900`) : les deux moteurs donnent le même résultat.

### F-20 — Repli local d'authentification (critique)

**Constat.** En mode bureau, `verifyPassword` appelait `auth_login` ; si le backend refusait
le mot de passe (`null`) ou renvoyait une erreur (« compte désactivé »), le code retombait sur
la vérification locale stockée dans le navigateur. Conséquence : un compte désactivé ou un
mot de passe changé côté base pouvait encore ouvrir l'application.

**Correction.** `src/store/store.ts` : en mode bureau, le backend est la seule source de
vérité ; aucun repli. `src/ui/App.tsx` : le motif de refus (ex. « compte désactivé ») est
affiché à l'écran. Tests : `src/store/auth.test.ts` (3 cas : refus, compte désactivé,
succès).

Vérification de non-régression : le hachage JavaScript (SHA-256 salé, sel en minuscules)
et la vérification Rust (`legacy_sha256`, sel en minuscules, recherche insensible à la casse)
sont cohérents. Les comptes créés depuis l'interface continuent de se connecter.

### F-21 — Contrôle de session absent côté Rust (élevé)

**Constat.** Le backend ouvre bien une session (`auth_login`, `current_user`), mais aucune
commande ne la vérifiait. N'importe quel appel pouvait restaurer une base, créer ou désactiver
un compte.

**Correction.** `src-tauri/src/commands.rs` : `require_session` appliqué à
`restore_backup`, `auth_create_user` et `auth_set_active`. Règle pure `acces_autorise`
(testée) : autorisé sans compte actif (premier lancement), sinon session ouverte requise.
Échec de lecture = refus (fail closed).

**Limite volontaire.** Les écritures de synchronisation (`sync_upsert`, `sync_delete`) ne sont
**pas** protégées. L'assistant de premier lancement écrit paramètres, numérotation et
entreprise juste après la création de l'administrateur, donc avant toute connexion. Les
protéger imposerait de refondre cet enchaînement, ce qui n'a pas pu être vérifié ici.
Voir §4.

### F-22 — Mention légale absente (moyen)

**Constat.** Le cahier des charges impose d'afficher que la validation finale relève de
l'entreprise et de son conseiller, et interdit toute revendication de certification DGI.
Aucune mention de ce type n'existait.

**Correction.** Pied de page permanent dans `src/ui/App.tsx` (style `.legal-note`) :
« Il n'est ni certifié ni agréé par la DGI. La validation finale des documents relève de
l'entreprise et de son conseiller fiscal. »

### F-23 — Rôles non appliqués (élevé)

**Constat.** Les cinq rôles existaient dans les données, mais aucun contrôle ne les appliquait :
un compte LECTEUR pouvait créer, valider, annuler des factures, encaisser, restaurer une sauvegarde.

**Correction.**
- Matrice unique `src/core/permissions.json` (11 actions × 5 rôles), lue par le Rust
  (`include_str!`, `src-tauri/src/permissions.rs`) et par l'interface (`src/core/permissions.ts`).
- Côté Rust, contrôle à l'entrée des commandes sensibles : `auth_create_user` et
  `auth_set_active` (`users.manage`), `restore_backup` (`backup.restore`), `sync_upsert` et
  `sync_delete` (action déduite de l'entité et du statut), `save_attachment` / `delete_attachment`
  (`document.write`), `validate_document` (`document.validate`), `cancel_document`
  (`document.cancel`), `add_payment` (`payment.write`), `export_zip` (`export.data`).
- Côté interface : `Btn` accepte une prop `need` (bouton désactivé avec explication) ; les écrans
  Documents, éditeur de documents, Paiements, Clients, Produits, Paramètres, Utilisateurs et
  Sauvegardes sont gatés ; les entrées de navigation sans droit sont masquées ; un brouillon
  sans droit d'écriture s'ouvre en lecture seule ; l'écran Paramètres et l'écran Utilisateurs
  affichent « Accès refusé » sans droit.
- Au démarrage (Tauri), si des comptes existent, l'application demande une connexion.
- L'assistant de premier lancement ouvre la session de l'administrateur dès sa création, avant
  d'écrire la configuration : le premier lancement reste possible sans casser les écritures protégées.
- Sauvegarde automatique à la fermeture (`backup_now`) : non soumise au contrôle, pour ne jamais
  bloquer la fermeture ni priver un rôle de sa protection de données.

**Vérifié.** `cargo test --lib` : 29 tests passés (dont matrice, séparation des tâches, premier
lancement, session désactivée, lecteur refusé). `vitest` : 116 tests (7 nouveaux sur la matrice
TS). `tsc --noEmit` : OK.

**Non vérifié / limites.** Le parcours complet (connexion, verrouillage, bouton désactivé à
l'écran) n'a pas été joué dans une fenêtre Windows réelle : à faire lors de la recette §65.
Le changement de statut d'un document (envoyé, accepté, refusé, expiré) est gaté par
`document.write` côté interface uniquement ; la synchronisation Rust le refuse si le rôle n'a
pas ce droit.

## 3. Vérifications sans anomalie

- **Réseau** : aucun appel HTTP/WebSocket dans le code ; aucune crate réseau dans
  `Cargo.toml` (ni reqwest, ureq, hyper, tungstenite) ; aucune télémétrie.
- **Plugins Tauri** : seul `tauri-plugin-dialog` (sélection de fichiers locaux).
- **Permissions Tauri** : capacités minimales (`core:default`, `dialog:default`, plein écran).
- **CSP** : `default-src 'self'`, pas de script distant.
- **Journaux** : aucun mot de passe ou secret journalisé.
- **SQL** : requêtes paramétrées (`params!`) ; le seul SQL construit par concaténation est
  `VACUUM INTO` avec un chemin échappé.
- **Taux de TVA** : aucun 19 % codé en dur dans la logique (seuls des libellés et des
  données de départ de la table des taux).

## 4. Risques résiduels et recommandations

1. **F-23 — Rôles (corrigé).** Matrice unique appliquée côté Rust et interface (§2). Reste à
   confirmer sur poste Windows lors de la recette §65.
2. **Écritures de synchronisation sans session (corrigé).** L'assistant ouvre désormais la session
   administrateur après création, puis les écritures protégées s'appliquent.
3. **Jeton de session.** La session est un état mémoire du processus, sans jeton transmis à
   l'interface. Le verrouillage automatique est purement côté interface.
4. **F-24 — Dépendances de développement.** `npm audit` signale des vulnérabilités dans
   vitest, vite, esbuild et tinypool. Elles concernent le serveur de développement et les
   tests, pas le programme livré. La mise à niveau est une version majeure (vitest 2→4,
   vite 5→6) : à faire dans un cycle dédié.
5. **Audit des crates Rust non exécuté.** `cargo audit` n'est pas installé dans
   l'environnement. À lancer en CI.
6. **F-25.** Les `unwrap()` sur des verrous Mutex ne posent problème qu'après un panic
   préalable dans une section critique. Risque faible.

## 5. Reproduction

```bash
npm test                      # 124 tests frontend (1 ignoré)
npx tsc --noEmit              # typage strict
cd src-tauri && cargo test --lib   # 36 tests Rust
npm audit --omit=dev          # 0 vulnérabilité en production
```

## 6. Livrable reconstruit

Installateur régénéré après l'import Excel (clients, produits, factures historiques), le correctif de monnaie (F-26), l'application des rôles (F-23) et les corrections précédentes
(`artifacts/`). Compilation croisée `x86_64-pc-windows-gnu`, NSIS 3.11, LTO désactivé, bibliothèque compilée en rlib seul (DLL retirée : limite d'exports Windows)
(mémoire de la machine de build) ; installateur non signé.

```
13daeab9…49930eef5  FacturationDZ-Setup.exe
89ad3bc0…d695147  FacturationDZ-Portable/FacturationDZ.exe
```

Empreintes complètes : `artifacts/SHA256SUMS.txt`.
Vérifié : `sha256sum -c SHA256SUMS.txt` (depuis `artifacts/`) → OK ; chaînes des corrections et des
rôles présentes dans le binaire portable (« Connexion requise… », « Action non autorisée… »).

**Non vérifié :** exécution de l'installeur et des rôles sur un poste Windows physique (recette §65),
signature de code (absente).

## 7. Audit pré-lancement

Demandé avant mise en service. Périmètre : migrations, sauvegarde/restauration, génération
PDF, montants en lettres, chaîne de livraison.

### F-26 — PDF natif ignorant la monnaie (élevé, corrigé)

Le moteur PDF natif (`src-tauri/src/pdf.rs`) écrivait toujours « DA » après chaque montant et
« dinars algériens » dans le montant en lettres, quelle que soit la monnaie du document
(EUR ou USD demandées). Correction :

- `PdfModel` reçoit un champ `devise` optionnel (défaut DZD) ; le frontend le transmet depuis le document.
- `da(cents, devise)` affiche le symbole : DZD → « DA », EUR → « € », USD → « $ ».
- `amount_in_words(cents, devise)` (`money_fr.rs`) : « euros » / « centimes », « dollars américains » / « cents ».
  Le montant en lettres enregistré à la validation (`invoices.rs`) suit la même règle.
- Test ajouté : `montant_en_lettres_selon_la_monnaie`.

### Contrôles effectués

| Contrôle | Résultat |
|----------|----------|
| `cargo test --lib` | 36 passés, 0 échec |
| Migrations v3 → v4 sur base existante (`migration_tests`) | Données conservées, TVA 19 % par défaut, sauvegarde `pre_migration_*` créée |
| Sauvegarde puis restauration (`backup::tests`) | Aller-retour vérifié |
| `tsc --noEmit` | OK |
| `vitest run` | 124 passés, 1 ignoré |
| `npm audit --omit=dev` | 0 vulnérabilité |
| Test navigateur : logo, impression A4 | 1 page A4, logo visible |

### Non réalisé

- `cargo audit` : non installé dans l'environnement ; à lancer en CI.
- Recette sur poste Windows physique (§65) : installeur, impression vers imprimante réelle,
  boîte de dialogue WebView2 : non exécutées dans ce sandbox.
- Signature de code : absente.

