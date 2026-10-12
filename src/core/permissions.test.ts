import { describe, expect, it } from "vitest";
import matrice from "./permissions.json";
import { ROLES, roleAllows, type Action } from "./permissions";

describe("matrice des droits (§35)", () => {
  it("l'administrateur possède tous les droits", () => {
    for (const action of Object.keys(matrice.actions) as Action[]) {
      expect(roleAllows("ADMIN", action)).toBe(true);
    }
  });

  it("le lecteur ne peut rien modifier ni exporter", () => {
    for (const action of Object.keys(matrice.actions) as Action[]) {
      if (action === "audit.write") continue;
      expect(roleAllows("LECTEUR", action)).toBe(false);
    }
  });

  it("séparation des tâches : le comptable ne rédige pas, le vendeur n'encaisse pas", () => {
    expect(roleAllows("COMPTABLE", "document.write")).toBe(false);
    expect(roleAllows("COMPTABLE", "payment.write")).toBe(true);
    expect(roleAllows("VENDEUR", "payment.write")).toBe(false);
    expect(roleAllows("VENDEUR", "document.write")).toBe(true);
  });

  it("seul l'administrateur gère la configuration, les utilisateurs et la restauration", () => {
    for (const action of ["config.manage", "users.manage", "backup.restore"] as Action[]) {
      expect(roleAllows("GESTIONNAIRE", action)).toBe(false);
      expect(roleAllows("COMPTABLE", action)).toBe(false);
      expect(roleAllows("VENDEUR", action)).toBe(false);
    }
  });

  it("rôle absent ou inconnu : refus", () => {
    expect(roleAllows(undefined, "document.write")).toBe(false);
    expect(roleAllows(null, "document.write")).toBe(false);
    expect(roleAllows("INCONNU", "document.write")).toBe(false);
  });

  it("action inconnue : refus", () => {
    expect(roleAllows("ADMIN", "n.importe.quoi" as Action)).toBe(false);
  });

  it("la liste des rôles correspond à la matrice", () => {
    expect([...ROLES]).toEqual(matrice.roles);
  });
});
