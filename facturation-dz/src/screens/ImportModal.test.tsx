// @vitest-environment jsdom
/**
 * Parcours d'import (interface) : fichier → lecture (Rust simulée) → aperçu → enregistrement.
 * La lecture réelle du classeur est couverte par les tests cargo (src-tauri/src/import.rs).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("../store/desktop", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    isTauri: () => true,
    invokeDesktop: (...args: unknown[]) => invokeMock(...args),
  };
});

import { ImportModal } from "./ImportModal";
import { store } from "../store/store";

beforeEach(() => {
  invokeMock.mockReset();
  store.resetForTests();
});

function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe("assistant d'import", () => {
  it("affiche l'aperçu puis n'enregistre que les lignes valides", async () => {
    invokeMock.mockResolvedValue([
      ["Dénomination", "NIF", "Courriel"],
      ["SARL Nouvelle", "", ""],
      ["SARL Sans Email", "", "mauvais-courriel"],
    ]);
    const { container } = render(<ImportModal kind="customers" onClose={() => {}} />);
    const before = store.data.customers.length;

    const file = new File(["x"], "clients.csv", { type: "text/csv" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/1 à importer/)).toBeTruthy());
    expect(screen.getByText(/1 erreur/)).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("read_import_table", expect.objectContaining({ fileName: "clients.csv" }));
    // Rien n'est enregistré avant confirmation
    expect(store.data.customers.length).toBe(before);

    fireEvent.click(screen.getByText(/Importer 1 ligne/));
    await waitFor(() => expect(store.data.customers.length).toBe(before + 1));
    expect(store.data.customers.some((c) => c.denomination === "SARL Nouvelle")).toBe(true);
    expect(store.data.customers.some((c) => c.denomination === "SARL Sans Email")).toBe(false);
  });

  it("signale une colonne obligatoire absente sans rien enregistrer", async () => {
    invokeMock.mockResolvedValue([["Adresse"], ["Rue 1"]]);
    const { container } = render(<ImportModal kind="customers" onClose={() => {}} />);
    const before = store.data.customers.length;
    fireEvent.change(fileInput(container), { target: { files: [new File(["x"], "c.csv")] } });
    await waitFor(() => expect(screen.getByText(/Colonne\(s\) obligatoire/)).toBeTruthy());
    expect(screen.queryByText(/Importer \d+ ligne/)).toBeNull();
    expect(store.data.customers.length).toBe(before);
  });

  it("affiche l'erreur renvoyée par le backend", async () => {
    invokeMock.mockRejectedValue(new Error("Classeur Excel illisible ou protégé par mot de passe."));
    const { container } = render(<ImportModal kind="products" onClose={() => {}} />);
    fireEvent.change(fileInput(container), { target: { files: [new File(["x"], "p.xlsx")] } });
    await waitFor(() => expect(screen.getByText(/protégé par mot de passe/)).toBeTruthy());
  });

  it("importe des produits avec le code TVA résolu", async () => {
    invokeMock.mockResolvedValue([
      ["Référence", "Désignation", "Prix unitaire HT", "Code TVA"],
      ["IMP-001", "Ramette A4", "850", "TVA9"],
    ]);
    const { container } = render(<ImportModal kind="products" onClose={() => {}} />);
    const before = store.data.products.length;
    fireEvent.change(fileInput(container), { target: { files: [new File(["x"], "p.csv")] } });
    await waitFor(() => expect(screen.getByText(/Importer 1 ligne/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Importer 1 ligne/));
    await waitFor(() => expect(store.data.products.length).toBe(before + 1));
    const p = store.data.products.find((x) => x.reference === "IMP-001");
    expect(p?.puHtCents).toBe(85000);
    expect(p?.taxCodeDefaut).toBe("TVA9");
  });
});
