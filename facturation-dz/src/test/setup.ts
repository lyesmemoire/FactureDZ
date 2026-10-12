/**
 * Environnement de test UI (§66) : polyfills jsdom nécessaires.
 * - jsdom n'implémente pas SubtleCrypto → on expose celui de Node
 *   (utilisé par hashPassword de la démo).
 */

import { webcrypto } from "node:crypto";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// jsdom : pas de matchMedia (certains composants le sondent).
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom : URL.createObjectURL absent — utilisé par les téléchargements de sauvegarde.
if (typeof URL !== "undefined" && !URL.createObjectURL) {
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
}
