# Conformité réglementaire algérienne (§39, §72, §73, §74)

## Texte de référence

**Décret exécutif n° 05-468 du 10 décembre 2005** fixant les conditions et
modalités d'établissement de la facture, du bon de transfert, du bon de
livraison et de la facture récapitulative.

## Mentions prises en charge

### Vendeur (§39)
Nom/dénomination, forme juridique, activité, adresse, téléphone, fax, email,
capital social, RC, NIS, **NIF et Article d'imposition** (ajout logiciel),
mode de paiement, date de règlement, date d'établissement.

### Facture
Numéro d'ordre séquentiel (§12), désignation, quantité, prix unitaire HT,
remises, total HT, nature et taux des taxes (moteur configurable §10),
**total TTC en chiffres et en lettres** (§16).

### Acheteur
Nom/dénomination, forme juridique, activité, adresse, téléphone, fax, email,
RC, NIS — et pour un consommateur : nom, prénom, adresse (§7).

### Zones de validation (§24, §40)
Cachet de l'entreprise et signature, positionnés selon les paramètres.

## Centralisation des règles (§73)

Toutes les valeurs fiscales et mentions pilotables vivent dans :
- `tax_rates`, `tax_rules`, `tax_rate_history` ;
- `legal_configuration` (+ historique) ;
- `document_templates`.

Une évolution légale (taux, mention, format) s'intègre par **configuration**,
sans réécriture applicative.

## Modification réglementaire par l'administrateur (§74)

L'application étant hors ligne, aucune loi n'est récupérée automatiquement.
Un administrateur peut modifier taux et règles depuis l'écran Taxes ; chaque
changement enregistre : ancienne valeur, nouvelle valeur, date d'effet,
motif, utilisateur.

## Limitation juridique (§72)

> Application conçue pour intégrer les exigences réglementaires algériennes
> applicables à la facturation. La validation finale par l'entreprise et son
> conseiller fiscal/comptable reste nécessaire.

L'application n'affiche **jamais** « agréé par la DGI » ni « 100 % garanti
conforme par l'État algérien ».

## Données historiques (§38)

Chaque document validé fige les identités complètes vendeur/acheteur
(adresses, RC, NIF, NIS, AI, lignes, prix, taux) : les anciennes factures
restent conformes à leur date d'émission, quelles que soient les
modifications ultérieures des fiches.
