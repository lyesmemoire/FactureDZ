/**
 * Assistant d'import Excel / CSV (clients ou produits) — phase 1.
 * 1) choix du fichier  2) aperçu ligne par ligne  3) enregistrement des seules lignes « ok ».
 * La lecture du classeur est faite côté Rust (commande read_import_table).
 */

import { useState } from "react";
import { invokeDesktop } from "../store/desktop";
import { isTauri } from "../store/desktop";
import { store } from "../store/store";
import {
  buildCustomerImport,
  buildProductImport,
  importTemplate,
  type ImportPreview,
  type RowStatus,
} from "../core/importTable";
import {
  buildHistoricalInvoiceImport,
  historicalTemplate,
  type HistoricalInvoice,
} from "../core/historicalImport";
import { todayISO } from "../core/format";
import type { Customer, Product } from "../core/types";
import { Alert, Badge, Btn, Modal } from "../ui/components";

type Kind = "customers" | "products" | "invoices";
type Built =
  | { kind: "customers"; preview: ImportPreview<Customer> }
  | { kind: "products"; preview: ImportPreview<Product> }
  | { kind: "invoices"; preview: ImportPreview<HistoricalInvoice> };

const KIND_LABEL: Record<Kind, { title: string; column: string; file: string; template: () => string }> = {
  customers: { title: "Importer des clients", column: "Client", file: "modele_clients.csv", template: () => importTemplate("customers") },
  products: { title: "Importer des produits", column: "Produit", file: "modele_produits.csv", template: () => importTemplate("products") },
  invoices: { title: "Importer des factures historiques", column: "Facture", file: "modele_factures_historiques.csv", template: historicalTemplate },
};

const STATUS_LABEL: Record<RowStatus, { text: string; tone: "green" | "gray" | "red" }> = {
  ok: { text: "À importer", tone: "green" },
  doublon: { text: "Doublon (ignoré)", tone: "gray" },
  erreur: { text: "Erreur (ignorée)", tone: "red" },
};

/** Base64 par morceaux (évite la limite d'arguments de String.fromCharCode). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Lit un fichier en octets (FileReader : compatible avec tous les environnements). */
function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsArrayBuffer(file);
  });
}

function downloadTemplate(kind: Kind) {
  const blob = new Blob([KIND_LABEL[kind].template()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = KIND_LABEL[kind].file;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ImportModal({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const [fileName, setFileName] = useState("");
  const [built, setBuilt] = useState<Built | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const title = KIND_LABEL[kind].title;

  async function onFile(file: File) {
    setError("");
    setDone(null);
    setBuilt(null);
    setFileName(file.name);
    if (!isTauri()) {
      setError("L'import de fichiers est disponible dans l'application de bureau.");
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await readFileBytes(file));
      const table = await invokeDesktop<string[][]>("read_import_table", {
        fileName: file.name,
        dataB64: bytesToBase64(bytes),
      });
      if (!table) throw new Error("Lecture du fichier impossible.");
      if (kind === "invoices") {
        const preview = buildHistoricalInvoiceImport(table, {
          customers: store.data.customers,
          taxRates: store.data.taxRates,
          companyTaxCode: store.data.company.taxCodeDefaut ?? "",
          devise: store.data.company.devise,
          existingNumbers: store.data.docs.map((d) => d.number),
          today: todayISO(),
        });
        setBuilt({ kind, preview });
      } else if (kind === "customers") {
        const preview = buildCustomerImport(table, store.data.customers, {
          rules: store.data.settings.validation,
          conditionsPaiementDefautJours: store.data.company.conditionsPaiementDefautJours,
        });
        setBuilt({ kind, preview });
      } else {
        const preview = buildProductImport(table, store.data.products, {
          taxRates: store.data.taxRates,
          defaultTaxCode: store.data.taxRates.find((t) => t.actif)?.code ?? "TVA19",
        });
        setBuilt({ kind, preview });
      }
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function commit() {
    if (!built) return;
    let n = 0;
    try {
      if (built.kind === "customers") {
        for (const r of built.preview.rows) {
          if (r.status === "ok" && r.value) {
            store.saveCustomer(r.value, true);
            n++;
          }
        }
      } else if (built.kind === "products") {
        for (const r of built.preview.rows) {
          if (r.status === "ok" && r.value) {
            store.saveProduct(r.value, true);
            n++;
          }
        }
      } else {
        for (const r of built.preview.rows) {
          if (r.status === "ok" && r.value) {
            store.importHistoricalInvoice(r.value);
            n++;
          }
        }
      }
      setDone(n);
      setBuilt(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const preview = built?.preview;
  const missing = preview?.missingColumns ?? [];
  const okCount = preview?.counts.ok ?? 0;

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={860}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Fermer</Btn>
          {okCount > 0 && (
            <Btn need={kind === "invoices" ? "document.validate" : "catalog.write"} variant="primary" onClick={commit}>
              Importer {okCount} ligne{okCount > 1 ? "s" : ""}
            </Btn>
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="file"
            accept=".xlsx,.xls,.ods,.csv"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <Btn small variant="ghost" onClick={() => downloadTemplate(kind)}>⬇ Modèle à remplir (CSV)</Btn>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#555" }}>
          Formats acceptés : .xlsx, .xls, .ods, .csv (10 Mo, 5 000 lignes maximum). La première ligne doit contenir
          les en-têtes. Les doublons (NIF ou référence déjà présents) et les lignes en erreur ne sont pas importés.
          Aucune donnée n'est modifiée tant que vous ne cliquez pas sur « Importer ».
        </p>

        {busy && <Alert tone="info">Lecture du fichier…</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {done !== null && <Alert tone="success">{done} élément(s) importé(s) depuis « {fileName} ».</Alert>}

        {missing.length > 0 && (
          <Alert tone="error">
            Colonne(s) obligatoire(s) introuvable(s) : {missing.join(", ")}. Utilisez le modèle fourni.
          </Alert>
        )}

        {preview && missing.length === 0 && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge tone="green">{preview.counts.ok} à importer</Badge>
              <Badge tone="gray">{preview.counts.doublon} doublon(s)</Badge>
              <Badge tone="red">{preview.counts.erreur} erreur(s)</Badge>
              <span style={{ fontSize: 13, color: "#555" }}>
                Fichier : {fileName}
              </span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Ligne</th>
                    <th>Résultat</th>
                    <th>{KIND_LABEL[kind].column}</th>
                    <th>Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 500).map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td>
                      <td><Badge tone={STATUS_LABEL[r.status].tone}>{STATUS_LABEL[r.status].text}</Badge></td>
                      <td>{describe(built!, r.value)}</td>
                      <td style={{ fontSize: 12 }}>{r.messages.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 500 && (
              <p style={{ fontSize: 12, color: "#555" }}>Seules les 500 premières lignes sont affichées ; toutes les lignes « ok » sont importées.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function describe(built: Built, value: Customer | Product | HistoricalInvoice | undefined): string {
  if (!value) return "";
  if (built.kind === "invoices") {
    const inv = value as HistoricalInvoice;
    return `${inv.number} · ${inv.customerLabel} · ${inv.date}`;
  }
  if (built.kind === "customers") {
    const c = value as Customer;
    return c.type === "ENTREPRISE" ? c.denomination ?? "" : `${c.prenom ?? ""} ${c.nom ?? ""}`.trim();
  }
  const p = value as Product;
  return `${p.reference} — ${p.designation}`;
}
