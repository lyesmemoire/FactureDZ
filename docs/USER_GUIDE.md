# Guide utilisateur — FacturationDZ

## Premier démarrage (§54)

L'assistant configure : entreprise (RC, NIF, NIS, AI distincts) → logo /
cachet / signature → facture par défaut → numérotation → TVA → sauvegardes →
compte administrateur → terminé. Un jeu de démonstration optionnel (§77) peut
être chargé : il est marqué « démo » et reste séparé de vos données.

## Créer une facture (§11)

1. **Factures → + Nouvelle facture** : choisir le client.
2. Saisir l'en-tête : date, échéance, mode/conditions de paiement, références.
3. Ajouter des lignes : depuis le catalogue (la désignation, l'unité, le PU et
   la TVA se pré-remplissent) ou en **ligne libre** (§9). Lignes de frais
   (transport, emballage…) disponibles (§18).
4. Remises : par ligne (%) ou globale (% ou montant), répartie
   proportionnellement (§17).
5. **L'aperçu A4 à droite se met à jour en temps réel** (§25).
6. **Valider** : les contrôles §48 s'exécutent ; un numéro unique est
   attribué (ex. `FAC-2026-000001`) ; le document est alors **figé** (§20).

> Le montant en lettres s'affiche automatiquement et n'est jamais modifiable (§16).

## Après validation

- **Encaisser** un paiement (espèces, chèque, virement, carte, CCP) : le
  statut passe automatiquement à PAYÉE / PARTIELLEMENT PAYÉE (§19).
- **Annuler** : motif obligatoire, marquage « FACTURE ANNULÉE » sur le PDF,
  numéro conservé à jamais (§21).
- **Créer un avoir** : référence la facture d'origine, nouveau numéro (§22).
- **Dupliquer** : nouveau brouillon, nouveau numéro, jamais une copie du
  numéro existant (§46).

## Devis / Proforma / BL (§57-59)

Séries séparées (`DEV-`, `PRO-`, `BL-`), statuts dédiés, conversion en
facture = nouveau document avec nouveau numéro.

## Rechercher (§27)

Par numéro, client, NIF, NIS, RC, montant, statut, mode de paiement +
filtres temporels (aujourd'hui, semaine, mois, mois précédent, année, période
personnalisée).

## Rapports et exports (§29, §33)

CA, TVA, factures, impayés, paiements, ventes par produit/client, mensuel,
annuel — export CSV/Excel et impression, calculés depuis la base locale.
Export complet JSON disponible depuis Sauvegardes.

## Sauvegarder (§30, §31)

- Automatique : quotidienne/hebdomadaire/à la fermeture, rétention paramétrable.
- Manuelle : **SAUVEGARDER MES DONNÉES** → choisissez l'emplacement (clé USB,
  D:, disque externe, réseau local).
- Restauration (§32) : sauvegarde de sécurité automatique avant l'opération.
- **VÉRIFIER L'INTÉGRITÉ DES DONNÉES** (§49) dans l'écran Sauvegardes/Diagnostic.

## Paramètres (§6, §8, §10, §55)

- Mon entreprise : tous les champs fiscaux distincts + logo/cachet/signature.
- Numérotation : gabarits par série — les numéros déjà attribués ne changent jamais.
- Taxes : ajout/modification de taux avec date d'effet, motif et historique ;
  les anciennes factures conservent le taux de l'époque (§10).
- Règles de validation : OFF / Avertissement / Bloquant par identifiant (§8).

## Importer des clients ou des produits depuis Excel

1. Ouvrez **Clients** ou **Produits / services**, puis cliquez sur **⬆ Importer Excel / CSV**.
2. Téléchargez le **modèle à remplir (CSV)** pour connaître les colonnes attendues. Le modèle s'ouvre directement dans Excel.
3. Remplissez votre fichier (.xlsx, .xls, .ods ou .csv ; première ligne = en-têtes) et choisissez-le.
4. Vérifiez l'aperçu : chaque ligne est marquée **À importer**, **Doublon** ou **Erreur**, avec le motif.
5. Cliquez sur **Importer N lignes**. Seules les lignes « À importer » sont enregistrées.

Les doublons (NIF ou référence déjà présents) et les lignes en erreur sont ignorés : corrigez votre fichier et réimportez-le si besoin.

## Importer des factures historiques

Pour reprendre des factures déjà émises (avant l'utilisation de l'application) :

1. Ouvrez **Factures** puis cliquez sur **⬆ Importer des factures historiques**.
2. Téléchargez le modèle : une facture par numéro, une ligne par article.
3. Colonnes obligatoires : **Numéro**, **Date**, **Client** (ou **NIF client**), **Désignation**, **Quantité**, **Prix unitaire HT**.
4. Le **numéro est conservé tel quel** : aucune renumérotation. La prochaine facture créée dans l'application prendra le numéro suivant la séquence.
5. Le client doit déjà exister : importez d'abord vos clients.
6. Vérifiez l'aperçu puis cliquez sur **Importer**. Les factures sont enregistrées avec le statut « validée ».

Les numéros déjà présents dans l'application sont ignorés (doublons). Les paiements et les avoirs ne sont pas importés à cette étape.
