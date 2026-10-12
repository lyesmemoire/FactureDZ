// @vitest-environment jsdom
/**
 * Tests d'interface (§66, O-04) : assistant de premier démarrage,
 * navigation, écrans critiques et garde-fous (§47, §61, O-16).
 *
 * Le store est un singleton persistant (localStorage jsdom) : chaque test
 * le réinitialise via resetForTests().
 */

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { CustomersScreen } from "../screens/Customers";
import { store } from "../store/store";
import { computeDocument } from "../core/invoiceCalculator";
import { uid } from "../core/ids";
import type { Customer, InvoiceDoc } from "../core/types";

function completeWizard(seedDemo = false) {
  store.completeFirstRun(
    {
      ...store.data.company,
      raisonSociale: "SARL Test Fac",
      adresse: "1 rue des Tests",
      wilaya: "Alger",
      nif: "002116123456789",
      rc: "16/00-1234567B21",
    },
    seedDemo,
    "admin"
  );
}

/** Crée un client minimal directement dans le store. */
function seedCustomer(name: string): Customer {
  return store.saveCustomer(
    {
      id: uid("cus"),
      type: "ENTREPRISE",
      denomination: name,
      adresse: "1 rue des Tests",
      wilaya: "Alger",
      contacts: [],
      actif: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    true
  );
}

/** Crée un document validé avec une ligne TVA. */
function seedValidatedInvoice(): InvoiceDoc {
  const customer = seedCustomer("SARL Facturée");
  const draft = store.createDraft({ docType: "FAC", customerId: customer.id });
  draft.lines = [
    {
      id: uid("ln"),
      nature: "VENTE",
      designation: "Prestation d'essai",
      qty: 1,
      unite: "forfait",
      puHtCents: 100000,
      taxCode: "TVA19",
      taxRatePctSnapshot: 19,
      taxLibelleSnapshot: "TVA 19 %",
      taxKindSnapshot: "TVA",
    },
  ];
  const comp = computeDocument(draft.lines);
  draft.totalHtCents = comp.totalHtCents;
  draft.totalTvaCents = comp.totalTvaCents;
  draft.totalOtherTaxesCents = comp.totalOtherTaxesCents;
  draft.totalTtcCents = comp.totalTtcCents;
  draft.vatDetail = comp.vatDetail;
  draft.otherTaxDetail = comp.otherTaxDetail;
  draft.amountInWords = comp.amountInWords;
  store.updateDraft(draft);
  return store.validateDocument(draft.id);
}

beforeEach(() => {
  store.resetForTests();
});

describe("Assistant de premier démarrage (§54)", () => {
  it("s'affiche tant que l'application n'est pas configurée", () => {
    render(<App />);
    expect(screen.getByText(/Bienvenue dans FacturationDZ/i)).toBeTruthy();
    expect(screen.getByText(/Étape 1 \/ 9/)).toBeTruthy();
  });

  it("gère l'ensemble des 9 étapes et initialise l'application", async () => {
    render(<App />);

    // Étape 1 → 2
    fireEvent.click(screen.getByText(/Suivant/));
    // Étape 2 : entreprise (raison sociale obligatoire)
    const raison = (await screen.findByLabelText(/Raison sociale/i)) as HTMLInputElement;
    fireEvent.change(raison, { target: { value: "SARL Atlas Distribution" } });

    // Étapes 3 → 8
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByText(/Suivant/));

    // Étape 8 : compte administrateur
    const pwds = document.querySelectorAll('input[type="password"]');
    expect(pwds.length).toBe(2);
    fireEvent.change(pwds[0], { target: { value: "secret123" } });
    fireEvent.change(pwds[1], { target: { value: "secret123" } });
    fireEvent.click(screen.getByText(/Suivant/));

    // Étape 9 : fin
    expect(screen.getByText(/Configuration terminée/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Commencer à utiliser FacturationDZ/));

    await waitFor(() => {
      expect(store.data.initialized).toBe(true);
    });
    expect(store.data.company.raisonSociale).toBe("SARL Atlas Distribution");
    expect(store.data.users).toHaveLength(1);
    expect(store.data.users[0].role).toBe("ADMIN");
    // Le mot de passe n'est jamais stocké en clair (§36).
    expect(store.data.users[0].passwordHash).not.toContain("secret123");
  });

  it("refuse un mot de passe administrateur trop court", async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Suivant/));
    const raison = (await screen.findByLabelText(/Raison sociale/i)) as HTMLInputElement;
    fireEvent.change(raison, { target: { value: "SARL X" } });
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByText(/Suivant/));
    const pwds = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwds[0], { target: { value: "123" } });
    fireEvent.change(pwds[1], { target: { value: "123" } });
    fireEvent.click(screen.getByText(/Suivant/));
    fireEvent.click(screen.getByText(/Commencer à utiliser FacturationDZ/));
    await waitFor(() => {
      expect(screen.getByText(/au moins 6 caractères/)).toBeTruthy();
    });
    expect(store.data.initialized).toBe(false);
  });
});

describe("Coquille applicative", () => {
  it("affiche la navigation et le tableau de bord après configuration", async () => {
    completeWizard(true); // avec données de démonstration (§77)
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Tableau de bord" })).toBeTruthy();
    expect(screen.getByText("Factures")).toBeTruthy();
    expect(screen.getAllByText("Clients").length).toBeGreaterThan(0);
    // Le bandeau de démonstration est visible.
    expect(screen.getByText(/Données de démonstration présentes/)).toBeTruthy();
  });

  it("affiche le bandeau de conformité et le libellé hors ligne", () => {
    completeWizard(false);
    render(<App />);
    expect(screen.getByText(/Hors ligne — SARL Test Fac/)).toBeTruthy();
  });
});

describe("Écran Clients (§7)", () => {
  it("crée un client via la modale et le retrouve par la recherche", async () => {
    completeWizard(false);
    render(<CustomersScreen />);

    fireEvent.click(screen.getByText("+ Nouveau client"));
    const denomination = (await screen.findByLabelText(/Dénomination \/ raison sociale/i)) as HTMLInputElement;
    fireEvent.change(denomination, { target: { value: "SARL Béton Express" } });
    fireEvent.click(screen.getByText("Enregistrer"));

    await waitFor(() => {
      expect(screen.getByText("SARL Béton Express")).toBeTruthy();
    });

    // Recherche : un terme absent vide le tableau.
    const search = screen.getByPlaceholderText(/Rechercher : nom, NIF/);
    fireEvent.change(search, { target: { value: "introuvable-xyz" } });
    await waitFor(() => {
      expect(screen.getByText(/Aucun client trouvé/)).toBeTruthy();
    });
  });

  it("empêche la suppression d'un client rattaché à un document (§47)", async () => {
    completeWizard(false);
    const doc = seedValidatedInvoice();
    const customer = store.data.customers.find((c) => c.id === doc.customerId)!;
    expect(() => store.deleteCustomer(customer.id)).toThrow(/documents lui sont rattachés/);
  });
});

describe("Documents (§27, F-08)", () => {
  it("affiche le document validé et permet la recherche par montant", async () => {
    completeWizard(false);
    const doc = seedValidatedInvoice();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Factures/ }));

    await waitFor(() => {
      expect(screen.getAllByText(doc.number!).length).toBeGreaterThan(0);
    });

    // Recherche par montant TTC (F-08) — 1 190,00 DA sur l'écran.
    const search = screen.getByPlaceholderText(/Rechercher : numéro, client/);
    fireEvent.change(search, { target: { value: "1 190,00" } });
    await waitFor(() => {
      expect(screen.getAllByText(doc.number!).length).toBeGreaterThan(0);
    });

    // Un montant inexistant ne remonte plus rien.
    fireEvent.change(search, { target: { value: "9 999 999,99" } });
    await waitFor(() => {
      expect(screen.getByText(/Aucun document/)).toBeTruthy();
    });
  });
});

describe("Autres taxes (§10)", () => {
  it("affiche la ligne « Autres taxes » dans l'éditeur", async () => {
    completeWizard(false);
    store.addTaxRate({
      id: uid("tax"),
      code: "TIC",
      libelle: "Taxe intérieure de consommation",
      ratePct: 3,
      dateDebut: "2020-01-01",
      actif: true,
      kind: "AUTRE",
    });
    const customer = seedCustomer("SARL Autres Taxes");
    const draft = store.createDraft({ docType: "FAC", customerId: customer.id });
    draft.lines = [
      {
        id: uid("ln"),
        nature: "VENTE",
        designation: "Produit soumis à TIC",
        qty: 2,
        unite: "unité",
        puHtCents: 50000,
        taxCode: "TIC",
        taxRatePctSnapshot: 3,
        taxLibelleSnapshot: "Taxe intérieure de consommation",
        taxKindSnapshot: "AUTRE",
      },
    ];
    store.updateDraft(draft);
    const comp = computeDocument(draft.lines);
    expect(comp.totalOtherTaxesCents).toBe(3000);
    expect(comp.totalTvaCents).toBe(0);

    render(<App />);
    // L'éditeur s'ouvre depuis la liste des documents.
    fireEvent.click(screen.getByRole("button", { name: /Factures/ }));
    await waitFor(() => expect(screen.getByText(/Brouillon/)).toBeTruthy());
    fireEvent.click(screen.getByText(/^(Modifier|Voir)$/));

    await waitFor(() => {
      expect(screen.getAllByText("Taxe intérieure de consommation").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/TOTAL TTC/).length).toBeGreaterThan(0);
    });
    // La panne « Autres taxes » apparaît dans le récapitulatif.
    const panel = document.querySelector(".totals-panel")!;
    expect(within(panel as HTMLElement).getByText(/Taxe intérieure de consommation/)).toBeTruthy();
  });
});

describe("Pièces jointes (§61)", () => {
  it("le panneau de pièces jointes est présent dans l'éditeur", async () => {
    completeWizard(false);
    const customer = seedCustomer("SARL PJ");
    const draft = store.createDraft({ docType: "FAC", customerId: customer.id });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Factures/ }));
    await waitFor(() => expect(screen.getByText(/^(Modifier|Voir)$/)).toBeTruthy());
    fireEvent.click(screen.getByText(/^(Modifier|Voir)$/));
    await waitFor(() => {
      expect(screen.getByText(/Pièces jointes \(§61\)/)).toBeTruthy();
      expect(screen.getByText(/Ajouter une pièce jointe/)).toBeTruthy();
    });
    expect(draft.id).toBeTruthy();
  });

  it("refuse une pièce jointe trop volumineuse en mode démonstration", async () => {
    completeWizard(false);
    const customer = seedCustomer("SARL PJ 2");
    const draft = store.createDraft({ docType: "FAC", customerId: customer.id });
    await expect(
      store.addAttachment(draft.id, {
        name: "gros.pdf",
        sizeBytes: 3 * 1024 * 1024,
        mimeType: "application/pdf",
        dataUrl: "data:application/pdf;base64,AAA",
      })
    ).rejects.toThrow(/2 Mo/);
  });
});

describe("Garde-fou écran de verrouillage (O-16)", () => {
  it("propose de relancer l'assistant si aucun compte n'existe", async () => {
    completeWizard(false);
    store.data.users = [];
    render(<App />);
    fireEvent.click(screen.getByTitle("Verrouiller l'application (§37)"));
    await waitFor(() => {
      expect(screen.getByText(/Aucun compte utilisateur/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Relancer l'assistant de configuration/));
    await waitFor(() => {
      expect(store.data.initialized).toBe(false);
    });
  });
});
