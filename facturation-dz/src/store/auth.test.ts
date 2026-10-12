/**
 * Authentification desktop (§36) — non-régression de la faille « repli local ».
 * En mode bureau, le backend Rust est la seule source de vérité : un refus ou
 * une erreur (compte désactivé) ne doit JAMAIS ouvrir l'accès via la copie
 * locale du navigateur.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("./desktop", () => ({
  isTauri: () => true,
  invokeDesktop: (...args: unknown[]) => invokeMock(...args),
}));

import { createMemoryStorage, createStore, hashPassword } from "./store";

describe("authentification bureau : le backend fait foi (§36)", () => {
  beforeEach(() => invokeMock.mockReset());

  it("mot de passe refusé par le backend → refus, même si la copie locale correspond", async () => {
    const s = createStore(createMemoryStorage());
    const hash = await hashPassword("motdepasse", "admin");
    s.data.users = [
      { id: "usr_1", username: "admin", role: "ADMIN", passwordHash: hash, createdAt: "2026-01-01T00:00:00Z" },
    ];
    invokeMock.mockResolvedValueOnce(null); // backend : mauvais mot de passe
    expect(await s.verifyPassword("admin", "motdepasse")).toBe(false);
  });

  it("compte désactivé → l'erreur du backend est remontée, sans repli local", async () => {
    const s = createStore(createMemoryStorage());
    const hash = await hashPassword("motdepasse", "admin");
    s.data.users = [
      { id: "usr_1", username: "admin", role: "ADMIN", passwordHash: hash, createdAt: "2026-01-01T00:00:00Z" },
    ];
    invokeMock.mockRejectedValueOnce(new Error("Ce compte est désactivé. Contactez un administrateur."));
    await expect(s.verifyPassword("admin", "motdepasse")).rejects.toThrow(/désactivé/);
  });

  it("succès backend → accès accordé", async () => {
    const s = createStore(createMemoryStorage());
    invokeMock.mockResolvedValueOnce({ username: "admin", role: "ADMIN" });
    expect(await s.verifyPassword("admin", "motdepasse")).toBe(true);
  });
});
