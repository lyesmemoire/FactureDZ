/**
 * FacturationDZ — Types métier partagés.
 *
 * RÈGLE ABSOLUE (§14) : aucun nombre flottant pour les montants.
 * Tous les montants sont exprimés en CENTIMES (entiers). 1 DA = 100 centimes.
 */

export type Cents = number;

/* ------------------------------------------------------------------ */
/* Documents commerciaux                                               */
/* ------------------------------------------------------------------ */

export type DocType = "FAC" | "DEV" | "PRO" | "BL" | "AVOIR";

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  FAC: "Facture",
  DEV: "Devis",
  PRO: "Facture proforma",
  BL: "Bon de livraison",
  AVOIR: "Avoir (note de crédit)",
};

export type DocStatus =
  | "BROUILLON"
  | "VALIDEE"
  | "ENVOYEE"
  | "PARTIELLEMENT_PAYEE"
  | "PAYEE"
  | "ANNULEE"
  // statuts spécifiques devis / proforma / BL
  | "ENVOYE"
  | "ACCEPTE"
  | "REFUSE"
  | "EXPIRE";

export const STATUS_LABELS: Record<DocStatus, string> = {
  BROUILLON: "Brouillon",
  VALIDEE: "Validée",
  ENVOYEE: "Envoyée",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  PAYEE: "Payée",
  ANNULEE: "Annulée",
  ENVOYE: "Envoyé",
  ACCEPTE: "Accepté",
  REFUSE: "Refusé",
  EXPIRE: "Expiré",
};

/* ------------------------------------------------------------------ */
/* Tiers et entreprise                                                 */
/* ------------------------------------------------------------------ */

export type CustomerType = "ENTREPRISE" | "PARTICULIER";

export interface CustomerContact {
  id: string;
  nom: string;
  fonction?: string;
  telephone?: string;
  email?: string;
}

export interface Customer {
  id: string;
  type: CustomerType;
  // Entreprise
  denomination?: string;
  nomCommercial?: string;
  formeJuridique?: string;
  activite?: string;
  rc?: string;
  nif?: string;
  nis?: string;
  articleImposition?: string;
  tinInternational?: string;
  creditLimitCents?: Cents;
  // Particulier
  nom?: string;
  prenom?: string;
  // Commun
  adresse?: string;
  wilaya?: string;
  commune?: string;
  telephone?: string;
  fax?: string;
  email?: string;
  contactPrincipal?: string;
  conditionsPaiementJours?: number;
  observations?: string;
  contacts: CustomerContact[];
  actif: boolean;
  demo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  raisonSociale: string;
  nomCommercial?: string;
  formeJuridique?: string;
  activite?: string;
  adresse?: string;
  wilaya?: string;
  commune?: string;
  telephone?: string;
  fax?: string;
  email?: string;
  siteWeb?: string;
  // Identifiants fiscaux DISTINCTS (§6) — jamais de champ générique.
  rc?: string;
  nif?: string;
  nis?: string;
  articleImposition?: string;
  /** Le TIN est uniquement le libellé international du NIF (§6). */
  tinLibelle?: string;
  capitalSocial?: string;
  // Banque
  banque?: string;
  agence?: string;
  rib?: string;
  ripCcp?: string;
  // Images (data-URL, stockées localement)
  logoDataUrl?: string;
  cachetDataUrl?: string;
  signatureDataUrl?: string;
  afficherCachet: boolean;
  afficherSignature: boolean;
  afficherCoordonneesBancaires: boolean;
  // Défauts
  devise: string; // "DZD" par défaut (§42) : DZD, EUR ou USD
  taxCodeDefaut?: string; // code du taux de TVA proposé par défaut sur les nouvelles lignes
  conditionsPaiementDefautJours: number;
  modePaiementDefaut: string;
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

/** Liste des 58 wilayas (utilisée pour les adresses — §6, §7). */
export const WILAYAS = [
  "Adrar", "Chlef", "Laghouat", "Oum El Bouaghi", "Batna", "Béjaïa", "Biskra",
  "Béchar", "Blida", "Bouira", "Tamanrasset", "Tébessa", "Tlemcen", "Tiaret",
  "Tizi Ouzou", "Alger", "Djelfa", "Jijel", "Sétif", "Saïda", "Skikda",
  "Sidi Bel Abbès", "Annaba", "Guelma", "Constantine", "Médéa", "Mostaganem",
  "M'Sila", "Mascara", "Ouargla", "Oran", "El Bayadh", "Illizi",
  "Bordj Bou Arreridj", "Boumerdès", "El Tarf", "Tindouf", "Tissemsilt",
  "El Oued", "Khenchela", "Souk Ahras", "Tipaza", "Mila", "Aïn Defla",
  "Naâma", "Aïn Témouchent", "Ghardaïa", "Relizane", "Timimoun",
  "Bordj Badji Mokhtar", "Ouled Djellal", "Béni Abbès", "In Salah", "In Guezzam",
  "Touggourt", "Djanet", "El M'Ghair", "El Meniaa",
];

export const UNITES = [
  "unité",
  "pièce",
  "kg",
  "tonne",
  "litre",
  "mètre",
  "m²",
  "m³",
  "heure",
  "jour",
  "forfait",
] as const;

export interface Product {
  id: string;
  reference: string;
  designation: string;
  description?: string;
  unite: string;
  puHtCents: Cents;
  taxCodeDefaut: string; // code du taux de TVA par défaut
  categorie?: string;
  actif: boolean;
  demo?: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Moteur fiscal (§10, §73)                                            */
/* ------------------------------------------------------------------ */

export interface TaxRate {
  id: string;
  code: string; // ex : TVA19, TVA9, EXO, TIC…
  libelle: string; // ex : "TVA 19 %"
  ratePct: number; // 19, 9, 0… (jamais codé en dur ailleurs)
  dateDebut: string; // ISO
  dateFin?: string; // ISO, éventuelle
  actif: boolean;
  /** §10 : TVA (défaut) ou AUTRE taxe/droit/contribution appliquée sur le HT
   *  de la ligne et agrégée séparément dans les totaux du document. */
  kind?: "TVA" | "AUTRE";
  description?: string;
  referenceReglementaire?: string;
  commentaire?: string;
}

export interface TaxChangeRecord {
  id: string;
  taxCode: string;
  oldValue: Partial<TaxRate>;
  newValue: Partial<TaxRate>;
  dateEffet: string;
  motif?: string;
  utilisateur: string;
  ts: string;
}

/* ------------------------------------------------------------------ */
/* Lignes de document                                                  */
/* ------------------------------------------------------------------ */

export type LineNature = "VENTE" | "FRAIS" | "REMISE";

export interface DocLine {
  id: string;
  nature: LineNature;
  productRef?: string;
  designation: string;
  description?: string;
  qty: number;
  unite: string;
  puHtCents: Cents;
  /** Remise en pourcentage (0-100). */
  remisePct?: number;
  /** Code du taux appliqué (référence tax_rates au moment de la création). */
  taxCode: string;
  /** SNAPSHOT du taux au moment de la saisie (§10) — une modification
   *  ultérieure du référentiel ne modifie jamais un document existant. */
  taxRatePctSnapshot: number;
  taxLibelleSnapshot: string;
  /** Snapshot de la NATURE de la taxe (§10) : TVA ou autre taxe. */
  taxKindSnapshot?: "TVA" | "AUTRE";
  motifExoneration?: string;
}

export interface ComputedLine extends DocLine {
  brutCents: Cents; // qty × PU
  remiseCents: Cents;
  htCents: Cents; // brut − remise
  tvaCents: Cents;
  ttcCents: Cents;
}

export interface GlobalDiscount {
  kind: "PCT" | "AMT";
  value: number; // % ou centimes
}

export interface VatDetail {
  ratePct: number;
  libelle: string;
  baseCents: Cents;
  amountCents: Cents;
}

/* ------------------------------------------------------------------ */
/* Documents (factures, devis, proforma, BL, avoirs)                   */
/* ------------------------------------------------------------------ */

export interface PartySnapshot {
  /** Snapshot complet vendeur/acheteur figé à la validation (§38). */
  displayName: string;
  type: CustomerType | "ENTREPRISE_VENDEUR";
  formeJuridique?: string;
  activite?: string;
  adresse?: string;
  wilaya?: string;
  commune?: string;
  telephone?: string;
  fax?: string;
  email?: string;
  rc?: string;
  nif?: string;
  nis?: string;
  articleImposition?: string;
  capitalSocial?: string;
}

export interface InvoiceDoc {
  id: string;
  docType: DocType;
  /** Numéro séquentiel attribué à la validation. Null tant que brouillon. */
  number: string | null;
  status: DocStatus;
  date: string; // ISO (AAAA-MM-JJ)
  dateEcheance?: string;
  customerId: string;
  sellerSnapshot: PartySnapshot;
  buyerSnapshot: PartySnapshot;
  lines: DocLine[];
  globalDiscount?: GlobalDiscount;
  totalHtCents: Cents;
  totalTvaCents: Cents;
  /** §10 : autres taxes/droits/contributions (hors TVA), agrégées. */
  totalOtherTaxesCents?: Cents;
  totalTtcCents: Cents;
  vatDetail: VatDetail[];
  /** Détail des autres taxes (§10), même structure que vatDetail. */
  otherTaxDetail?: VatDetail[];
  amountInWords: string; // générée automatiquement, jamais modifiable (§16)
  /** Pièces jointes (§61). */
  attachments?: DocAttachment[];
  modePaiement?: string;
  conditionsPaiement?: string;
  refCommande?: string;
  refDevis?: string;
  refBonLivraison?: string;
  observations?: string;
  /** Conditions de vente du devis (texte libre, facultatif). */
  conditionsVente?: string;
  /** Pour un avoir : référence de la facture d'origine (§22). */
  originDocNumber?: string;
  originDocId?: string;
  cancellation?: { at: string; by: string; motif: string };
  /** Champs optionnels import/export (§41). */
  incoterm?: string;
  paysOrigine?: string;
  deviseChange?: string;
  tauxChange?: string;
  refDouaniere?: string;
  devise: string;
  archived: boolean;
  demo?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Pièce jointe d'un document (§61). Le fichier lui-même vit dans
 *  Documents/ (desktop) ; la base ne stocke que la référence. */
export interface DocAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType?: string;
  /** data-URL — mode démo/navigateur uniquement (jamais en desktop). */
  dataUrl?: string;
  /** Chemin relatif au dossier Documents/ — mode desktop uniquement. */
  desktopPath?: string;
  addedBy: string;
  addedAt: string;
}

/* ------------------------------------------------------------------ */
/* Paiements (§19)                                                     */
/* ------------------------------------------------------------------ */

export const MODES_PAIEMENT = [
  "Espèces",
  "Chèque",
  "Virement bancaire",
  "Carte bancaire",
  "CCP",
  "Autre",
] as const;

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  mode: string;
  date: string;
  amountCents: Cents;
  reference?: string;
  banque?: string;
  numeroCheque?: string;
  commentaire?: string;
  ts: string;
}

/* ------------------------------------------------------------------ */
/* Audit / sauvegardes / séquences                                     */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  id: string;
  ts: string;
  utilisateur: string;
  action: string;
  objectType: string;
  objectId?: string;
  details?: string;
  oldValue?: string;
  newValue?: string;
}

export interface BackupRecord {
  id: string;
  ts: string;
  kind: "AUTO" | "MANUELLE" | "SECURITE_AVANT_RESTAURATION" | "AVANT_MIGRATION";
  label: string;
  sizeBytes: number;
  counts: { factures: number; clients: number; produits: number };
  schemaVersion: number;
}

export interface SequenceConfig {
  docType: DocType;
  template: string; // ex : "FAC-{YEAR}-{COUNTER}" ou "{YEAR}/FAC/{COUNTER}"
  padding: number; // nombre de chiffres du compteur
}

/* ------------------------------------------------------------------ */
/* Utilisateurs et rôles (§35)                                         */
/* ------------------------------------------------------------------ */

export type UserRole = "ADMIN" | "GESTIONNAIRE" | "COMPTABLE" | "VENDEUR" | "LECTEUR";

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrateur",
  GESTIONNAIRE: "Gestionnaire",
  COMPTABLE: "Comptable",
  VENDEUR: "Vendeur",
  LECTEUR: "Lecteur",
};

/** Matrice de permissions de référence (§35) — appliquée par le backend. */
export const ROLE_PERMISSIONS: Record<UserRole, string> = {
  ADMIN: "Tous les droits : paramètres, utilisateurs, sauvegardes, restauration, validation, annulation.",
  GESTIONNAIRE: "Factures, avoirs, clients, produits, paiements, rapports, sauvegardes.",
  COMPTABLE: "Factures, paiements, rapports, exports.",
  VENDEUR: "Clients, catalogue, création de brouillons uniquement.",
  LECTEUR: "Consultation seule (aucune écriture).",
};

export interface UserAccount {
  id: string;
  username: string;
  role: UserRole;
  /** Jamais de mot de passe en clair (§36) — hash côté desktop : Argon2. */
  passwordHash: string;
  createdAt: string;
}

export interface ValidationRulesConfig {
  /** Pour chaque identifiant : OFF | WARN | BLOCK (§8). */
  nif: "OFF" | "WARN" | "BLOCK";
  nis: "OFF" | "WARN" | "BLOCK";
  rc: "OFF" | "WARN" | "BLOCK";
  articleImposition: "OFF" | "WARN" | "BLOCK";
  nifPattern: string;
  nisPattern: string;
  rcPattern: string;
  aiPattern: string;
}

/* ------------------------------------------------------------------ */
/* Achats : fournisseurs et bons de commande (BC)                      */
/* ------------------------------------------------------------------ */

/** Fournisseur : fiche séparée des clients. */
export interface Supplier {
  id: string;
  denomination: string;
  nomCommercial?: string;
  adresse?: string;
  wilaya?: string;
  commune?: string;
  telephone?: string;
  email?: string;
  contactPrincipal?: string;
  rc?: string;
  nif?: string;
  nis?: string;
  articleImposition?: string;
  conditionsPaiementJours?: number;
  observations?: string;
  actif: boolean;
  demo?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Cycle de vie d'un bon de commande :
 * BROUILLON → ENVOYE → RECU_PARTIEL → RECU, ou ANNULE (tant que rien n'est reçu).
 * Le contenu n'est modifiable qu'en brouillon ; après envoi, seule la réception évolue.
 */
export type PoStatus = "BROUILLON" | "ENVOYE" | "RECU_PARTIEL" | "RECU" | "ANNULE";

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  BROUILLON: "Brouillon",
  ENVOYE: "Envoyé",
  RECU_PARTIEL: "Reçu partiellement",
  RECU: "Reçu",
  ANNULE: "Annulé",
};

export interface PurchaseOrderLine {
  id: string;
  productRef?: string;
  designation: string;
  unite: string;
  qty: number;
  /** Quantité reçue à ce jour (jamais supérieure à qty). */
  qtyRecue: number;
  puHtCents: Cents;
  remisePct?: number;
  taxCode: string;
  taxRatePctSnapshot: number;
}

export interface PurchaseOrder {
  id: string;
  /** Numéro attribué à l'envoi (BC-AAAA-000001) ; null en brouillon. */
  number: string | null;
  status: PoStatus;
  supplierId: string;
  /** Figé à l'envoi pour que le BC reste lisible même si la fiche fournisseur change. */
  supplierSnapshot: PartySnapshot;
  date: string;
  dateLivraison?: string;
  devise: string;
  modePaiement?: string;
  conditionsPaiement?: string;
  lieuLivraison?: string;
  observations?: string;
  lines: PurchaseOrderLine[];
  totalHtCents: Cents;
  totalTvaCents: Cents;
  totalTtcCents: Cents;
  vatDetail: VatDetail[];
  amountInWords: string;
  sentAt?: string;
  cancelledAt?: string;
  cancelMotif?: string;
  createdByUsername?: string;
  createdAt: string;
  updatedAt: string;
}
