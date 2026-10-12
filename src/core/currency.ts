/**
 * FacturationDZ — Monnaies prises en charge (§42).
 *
 * Trois monnaies : dinar algérien (défaut, légal pour la facturation locale), euro, dollar US.
 * Le code ISO est enregistré avec chaque document (snapshot) : un changement de monnaie
 * dans les paramètres ne modifie jamais un document déjà émis.
 */

export const DEVISES = ["DZD", "EUR", "USD"] as const;
export type Devise = (typeof DEVISES)[number];

export const DEVISE_DEFAUT: Devise = "DZD";

interface InfoDevise {
  label: string;
  symbole: string;
  /** Nom de l'unité en lettres : [singulier, pluriel]. */
  unite: [string, string];
  /** Nom du sous-multiple (centime / cent) : [singulier, pluriel]. */
  sousUnite: [string, string];
}

const INFO: Record<Devise, InfoDevise> = {
  DZD: {
    label: "DZD — Dinar algérien",
    symbole: "DA",
    unite: ["dinar algérien", "dinars algériens"],
    sousUnite: ["centime", "centimes"],
  },
  EUR: {
    label: "EUR — Euro",
    symbole: "€",
    unite: ["euro", "euros"],
    sousUnite: ["centime", "centimes"],
  },
  USD: {
    label: "USD — Dollar US",
    symbole: "$",
    unite: ["dollar américain", "dollars américains"],
    sousUnite: ["cent", "cents"],
  },
};

/** Vrai si le code est une monnaie prise en charge. */
export function isDevise(code: unknown): code is Devise {
  return typeof code === "string" && (DEVISES as readonly string[]).includes(code);
}

/** Symbole affiché après les montants. Monnaie inconnue ou absente → DZD. */
export function currencySymbol(code?: string | null): string {
  return isDevise(code) ? INFO[code].symbole : INFO[DEVISE_DEFAUT].symbole;
}

/** Libellé du menu déroulant. */
export function currencyLabel(code: Devise): string {
  return INFO[code].label;
}

/** Noms de l'unité et du sous-multiple, pour le montant en lettres. */
export function currencyNames(code?: string | null): { unite: [string, string]; sousUnite: [string, string] } {
  const info = isDevise(code) ? INFO[code] : INFO[DEVISE_DEFAUT];
  return { unite: info.unite, sousUnite: info.sousUnite };
}
