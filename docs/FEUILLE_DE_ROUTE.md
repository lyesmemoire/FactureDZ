# Feuille de route — FacturationDZ

Périmètre retenu : **application de bureau hors ligne** (Windows, SQLite local).
Pas de cloud, pas de multi-postes, pas d'application mobile à ce stade.

## 1. Comptabilité et reporting

État constaté dans le code (`src/screens/Reports.tsx`, `src/screens/Dashboard.tsx`) :

| Élément | État | Détail |
|---------|------|--------|
| Chiffre d'affaires (mensuel, annuel) | ✅ Existant | Rapports CA, mensuel par année, annuel |
| TVA collectée par taux | ✅ Existant | Rapport TVA par taux |
| Impayés, paiements | ✅ Existant | Rapports IMPAYES et PAIEMENTS |
| Ventes par produit, par client | ✅ Existant | Rapports VENTES_PRODUIT et VENTES_CLIENT |
| Export CSV (séparateur « ; », ouvrable dans Excel) | ✅ Existant | Un rapport à la fois |
| Factures en retard | 🟡 Partiel | Compteur sur le tableau de bord, pas de détail |
| Créances âgées (0-30, 31-60, 61-90, +90 jours) | ❌ Manquant | À créer |
| TVA déclarative (collectée − déductible) | ❌ Manquant | Dépend des achats (TVA déductible), voir §5 |
| Export Excel natif (.xlsx) | ❌ Manquant | Actuellement CSV uniquement |
| Export PDF en lot | ❌ Manquant | Un document à la fois |
| Plan comptable et écritures | ❌ Manquant | Prérequis de l'export comptable |
| Export vers logiciel comptable | ❌ Manquant | Format cible à définir (voir questions) |

Travaux proposés :
1. Créances âgées par client et par tranche (calcul sur la date d'échéance).
2. Export .xlsx natif pour tous les rapports.
3. Export PDF en lot (factures d'une période, ou d'un client).
4. TVA déclarative (après §5 si les achats sont retenus).
5. Plan comptable paramétrable et journal des écritures.
6. Export comptable selon le format du logiciel retenu par l'entreprise.

## 2. Import depuis Excel ou d'autres logiciels

État : aucun import. Seul l'export existe.

Travaux proposés :
1. Import de clients et de produits depuis Excel/CSV, avec aperçu et détection des doublons.
2. Import de factures historiques (numéro et montants conservés, sans renumérotation).
3. Import depuis les formats d'export courants des logiciels concurrents (à définir selon les logiciels visés).

## 3. Relances d'impayés

État : seul un compteur « Factures en retard » sur le tableau de bord.

Travaux proposés :
1. Liste des impayés avec niveau de retard et dernière relance.
2. Modèles de relance (courrier, e-mail, SMS) paramétrables.
3. Historique des relances par document, tracé dans le journal d'audit.
4. Génération en lot des courriers de relance (PDF).
5. Envoi par e-mail : nécessite un paramétrage SMTP local ; reste hors ligne au sens strict, à confirmer.

## 4. Autres points de la liste précédente (à planifier ensuite)

- Factures récurrentes.
- Duplication et conversion devis → facture.
- Taux de change et conversion multi-devises.
- Mention de fiabilité : recette Windows §65, signature de code, mise à jour.

## 5. Questions ouvertes

- Gestion des achats (factures fournisseurs) : nécessaire pour la TVA déclarative. À confirmer.
- Logiciel comptable cible pour l'export (format attendu).
- Canal de relance préféré (courrier, e-mail, SMS).

## 6. Décisions validées (suite à la discussion)

- **Import Excel** : clients, produits, factures de vente historiques, achats.
- **Factures d'achat** : cycle complet avec bons de commande fournisseur, réception, puis facture d'achat. La TVA déductible alimente la TVA déclarative.
- **Export comptable PC Compta** : reporté. Il faut un fichier d'exemple exporté depuis PC Compta ou la version exacte du logiciel. Sans cela, le format ne peut pas être garanti. Piste non confirmée : format ASCII « XIMPORT.TXT » (137 caractères par enregistrement, séparateur décimal virgule), documenté pour Ciel Compta.

## 7. Phases proposées

**Phase 1 — Import Excel (clients, produits, factures de vente historiques)**
- Lecture .xlsx et .csv, modèle téléchargeable, aperçu avant import, rapport d'erreurs ligne par ligne.
- Détection des doublons (NIF pour les clients, référence pour les produits).
- Factures historiques : numéro conservé, aucune renumérotation, statut figé à la reprise.
- Point technique : choisir la bibliothèque de lecture Excel. `xlsx` (SheetJS) 0.18.5 a des avis de sécurité connus ; une lecture côté Rust (crate `calamine`) est à étudier.

**Phase 2 — Achats : fournisseurs, bons de commande, réception, factures d'achat**
- Fiche fournisseur, bon de commande, bon de réception, facture d'achat rapprochée.
- Numérotation propre aux achats, pièces jointes, TVA déductible par taux.
- Règlements fournisseurs et échéancier.

**Phase 3 — TVA déclarative et tableaux de bord**
- TVA collectée − TVA déductible par période.
- Créances âgées, dépenses par fournisseur.

**Phase 4 — Export comptable PC Compta**
- Dépend de la réception du fichier d'exemple ou de la version du logiciel.

**Phase 5 — Relances d'impayés** (planning à définir après les phases précédentes).

## 8. Avancement — phase 1 (import Excel)

| Élément | État |
|---------|------|
| Lecture .xlsx, .xls, .ods (calamine 0.30, côté Rust) et .csv (« ; » ou « , », guillemets, BOM) | ✅ Fait — 8 tests Rust, dont un vrai classeur |
| Mapping des colonnes par libellé (accents, casse et ponctuation ignorés) | ✅ Fait |
| Clients : type, dénomination ou nom, NIF/RC/NIS (règles de la fiche client §8), courriel, délai | ✅ Fait |
| Produits : référence, désignation, prix (format français « 1 250,50 »), code ou taux de TVA | ✅ Fait |
| Doublons : NIF ou nom pour les clients, référence pour les produits (base et fichier) | ✅ Fait |
| Aperçu ligne par ligne, rien d'écrit avant confirmation, modèles CSV téléchargeables | ✅ Fait |
| Tests : logique d'import (18 tests), parcours d'interface (4 tests) | ✅ Fait — 146 tests frontend au total |
| **Factures de vente historiques** : numéro du fichier conservé tel quel, regroupement par numéro, client par NIF ou nom, contrôle du total TTC facultatif, doublons refusés, compteur avancé pour ne pas reprendre un numéro | ✅ Fait — 11 tests de logique, 5 tests de store |
| Règle de numérotation des factures importées (décision utilisateur : numéro accepté tel quel) | ✅ Appliquée |
| Paiements des factures importées (montants encaissés) | ⏳ Non importés — à ajouter si besoin |
| Avoirs et annulations historiques | ⏳ Non importés (factures uniquement) |
| Mise en page facture : vendeur non répété (en-tête seul), acheteur en haut à droite libellé « Client », espacements resserrés pour les articles | ✅ Fait (à valider à l'impression) |
| Devis : conditions de vente facultatives (bouton « Ajouter les conditions de vente », affichées seulement si renseignées), migration 0005 | ✅ Fait (écran, A4, PDF natif) |
| Test sur un vrai fichier Excel client dans l'installeur Windows | ⏳ À faire (recette) |

Limites connues :
- Import de 5 000 lignes maximum et 10 Mo par fichier.
- Chaque ligne importée crée une entrée dans le journal d'audit (pas de transaction groupée).
- Seule la première feuille du classeur est lue.
- Factures importées : statut « validée », TVA recalculée à partir des taux (le total TTC du fichier est contrôlé si la colonne est fournie).
- Les factures importées sont datées dans le passé uniquement (date future refusée).

## 9. Achats — phase 2 (bons de commande)

État : bons de commande et fournisseurs livrés (migration 0006). Facture d'achat : étape suivante.

| Élément | État |
|---|---|
| Fiches fournisseurs (liste dédiée, NIF/RC/NIS, wilaya, délai de paiement), distinctes des clients | ✅ Fait |
| Bon de commande : brouillon modifiable, lignes avec remise et TVA, totaux calculés comme les factures | ✅ Fait |
| Numérotation BC-AAAA-000001 attribuée à l'envoi, compteur monotone | ✅ Fait |
| Contenu figé après envoi ; fournisseur figé en instantané | ✅ Fait |
| Réception par ligne (partielle ou totale), statut RECU_PARTIEL / RECU | ✅ Fait |
| Annulation avec motif, uniquement avant toute réception | ✅ Fait |
| Suppression : brouillon seulement ; fournisseur refusé s'il a un BC | ✅ Fait |
| Impression A4 du bon de commande (navigateur) | ✅ Fait — PDF natif à faire |
| Droit `purchase.write` (ADMIN, GESTIONNAIRE, COMPTABLE) | ✅ Fait |
| Tests : logique BC, store, écran, persistance Rust (46 tests Rust au total) | ✅ Fait |
| Facture d'achat liée à un BC (statut FACTURE, paiements fournisseurs) | ⏳ Étape suivante |
| Réception en sur-livraison (quantité supérieure à la commande) | ⏳ Refusée pour l'instant |
