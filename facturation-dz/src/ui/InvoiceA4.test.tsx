// @vitest-environment jsdom
/**
 * Mise en page A4 : le vendeur n'apparaît qu'une fois (en-tête), pour libérer de la place aux articles.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InvoiceA4 } from "./InvoiceA4";
import { store } from "../store/store";
import type { InvoiceDoc } from "../core/types";

describe("InvoiceA4 — pas de doublon vendeur", () => {
  it("affiche les coordonnées du vendeur une seule fois", () => {
    const company = { ...store.data.company, raisonSociale: "GICI Test SARL", nif: "001416100792202" };
    const doc = {
      id: "d1",
      docType: "DEV",
      number: "DEV-2026-000001",
      status: "ENVOYE",
      date: "2026-10-11",
      customerId: "c1",
      sellerSnapshot: { displayName: "GICI Test SARL", type: "ENTREPRISE_VENDEUR", nif: "001416100792202", rc: "16/00 1007922814" },
      buyerSnapshot: { displayName: "SARL Acheteur", type: "ENTREPRISE" },
      lines: [],
      totalHtCents: 0,
      totalTvaCents: 0,
      totalTtcCents: 0,
      vatDetail: [],
      amountInWords: "",
      modePaiement: "Chèque",
      conditionsPaiement: "30 jours",
      devise: "DZD",
      archived: false,
      createdAt: "2026-10-11T00:00:00Z",
      updatedAt: "2026-10-11T00:00:00Z",
    } as unknown as InvoiceDoc;

    const { container } = render(<InvoiceA4 doc={doc} company={company} />);
    const text = container.textContent ?? "";
    // Deux occurrences attendues : en-tête (identité du vendeur) et pied de page légal.
    // Le bloc « Vendeur » intermédiaire, qui doublait l'en-tête, est supprimé.
    expect(text.split("GICI Test SARL").length - 1).toBe(2);
    expect(text.split("001416100792202").length - 1).toBe(2);
    expect(text).not.toContain("Vendeur");
    expect(text).toContain("SARL Acheteur");
    // Les conditions restent présentes (en bas de page)
    expect(text).toContain("30 jours");
  });

  it("affiche les conditions de vente seulement si elles sont renseignées", () => {
    const company = { ...store.data.company, raisonSociale: "GICI Test SARL" };
    const base = {
      id: "d2", docType: "DEV", number: "DEV-2026-000002", status: "ENVOYE", date: "2026-10-11",
      customerId: "c1", sellerSnapshot: { displayName: "GICI Test SARL", type: "ENTREPRISE_VENDEUR" },
      buyerSnapshot: { displayName: "SARL Acheteur", type: "ENTREPRISE" }, lines: [],
      totalHtCents: 0, totalTvaCents: 0, totalTtcCents: 0, vatDetail: [], amountInWords: "",
      devise: "DZD", archived: false, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z",
    };
    const without = render(<InvoiceA4 doc={base as unknown as InvoiceDoc} company={company} />);
    expect(without.container.textContent).not.toContain("Conditions de vente");
    without.unmount();
    const withCond = render(
      <InvoiceA4 doc={{ ...base, conditionsVente: "Validité 30 jours" } as unknown as InvoiceDoc} company={company} />,
    );
    expect(withCond.container.textContent).toContain("Conditions de vente");
    expect(withCond.container.textContent).toContain("Validité 30 jours");
  });
});
