/**
 * Test de contrat IPC (§70) — garde-fou contre la classe de bug F-18.
 *
 * Tauri v2 convertit les paramètres Rust `snake_case` en `camelCase` côté
 * JavaScript : un `invoke("cmd", { local_id })` échoue si Rust attend
 * `local_id` (il attend `localId`). Cette erreur n'apparaît qu'à l'exécution,
 * dans les journaux techniques — jamais dans les tests unitaires.
 *
 * Ce test compare statiquement :
 *   1. les signatures `#[tauri::command] pub fn …` de `src-tauri/src/commands.rs` ;
 *   2. les clés réellement envoyées par chaque `invokeDesktop("cmd", { … })` du frontend.
 * Toute clé inconnue du backend fait échouer la suite.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");

/* ---------------- 1. Paramètres attendus côté Rust ---------------- */

function rustCommandParams(): Map<string, string[]> {
  const src = readFileSync(join(ROOT, "src-tauri", "src", "commands.rs"), "utf8");
  const out = new Map<string, string[]>();
  // Découpe sur chaque attribut #[tauri::command] puis lit la signature suivante.
  const re = /#\[tauri::command\]\s*pub fn\s+(\w+)\s*\(([\s\S]*?)\)\s*->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const raw = m[2];
    const params: string[] = [];
    // `state: State<AppState>` est injecté, jamais envoyé par le frontend.
    for (const part of raw.split(",")) {
      const p = part.trim();
      if (!p.includes(":")) continue;
      const [pn] = p.split(":");
      const param = pn.trim();
      if (param === "state") continue;
      // snake_case Rust → camelCase attendu côté JS.
      params.push(param.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()));
    }
    out.set(name, params);
  }
  return out;
}

/* ---------------- 2. Clés envoyées par le frontend ---------------- */

function frontendInvokes(): { cmd: string; file: string; keys: string[] }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) files.push(full);
    }
  };
  walk(join(ROOT, "src"));

  const found: { cmd: string; file: string; keys: string[] }[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const re = /invokeDesktop(?:<[^>]*>)?\(\s*"([a-z_]+)",?\s*(\{)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const cmd = m[1];
      if (!m[2]) {
        found.push({ cmd, file, keys: [] });
        continue;
      }
      // Équilibre les accolades pour extraire l'objet d'arguments complet.
      let depth = 0;
      let i = m.index + m[0].length - 1;
      let obj = "";
      for (; i < src.length; i++) {
        const ch = src[i];
        obj += ch;
        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      // Clés de premier niveau. On découpe l'objet en segments séparés par des
      // virgules de profondeur 0, puis on ne retient — pour chaque segment —
      // que la partie AVANT le premier « : » (donc jamais la valeur :
      // `{ source: path }` → clé « source », pas « path »).
      const segments: string[] = [];
      let depth2 = 0;
      let buf = "";
      for (const ch of obj.slice(1, -1)) {
        if (ch === "{" || ch === "(" || ch === "[") depth2++;
        if (ch === "}" || ch === ")" || ch === "]") depth2--;
        if (ch === "," && depth2 === 0) {
          segments.push(buf);
          buf = "";
        } else {
          buf += ch;
        }
      }
      segments.push(buf);

      const keys: string[] = [];
      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("...")) continue; // spread : non vérifiable statiquement
        const beforeColon = trimmed.split(":")[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(beforeColon)) keys.push(beforeColon);
      }
      found.push({ cmd, file, keys });
    }
  }
  return found;
}

/* ---------------- 3. Vérification ---------------- */

describe("contrat IPC frontend ↔ backend (§70, garde-fou F-18)", () => {
  const rust = rustCommandParams();
  const calls = frontendInvokes();

  it("toutes les commandes invoquées existent côté Rust", () => {
    const unknown = calls.filter((c) => !rust.has(c.cmd)).map((c) => `${c.cmd} (${c.file})`);
    expect(unknown).toEqual([]);
  });

  it("les clés envoyées correspondent aux paramètres camelCase de Tauri v2", () => {
    const problems: string[] = [];
    for (const call of calls) {
      const expected = rust.get(call.cmd);
      if (!expected) continue; // traité par le test précédent
      for (const key of call.keys) {
        // Les arguments injectés (state) ne sont jamais envoyés ; les types
        // structurés (input, model) restent des paramètres nommés légitimes.
        if (!expected.includes(key)) {
          problems.push(
            `${call.cmd} : clé « ${key} » inconnue (attendu : ${expected.join(", ") || "aucune"}) — ${call.file}`
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("le nombre d'appels analysés est plausible (le test ne peut pas être vide)", () => {
    expect(calls.length).toBeGreaterThanOrEqual(8);
    expect(rust.size).toBeGreaterThanOrEqual(15);
  });
});
