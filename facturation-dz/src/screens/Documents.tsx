/**
 * Écran Documents (§45) : factures, avoirs, devis, proforma, BL.
 * Recherche et filtres (§27), actions (§45) : voir, modifier, dupliquer,
 * PDF, imprimer copie, annuler, créer avoir, encaisser, supprimer brouillon.
 */

import { useMemo, useState } from "react";
import { formatDateFr, todayISO } from "../core/format";
import type { Company, DocType, InvoiceDoc } from "../core/types";
import { DOC_TYPE_LABELS } from "../core/types";
import { formatCents, isOverdue, store } from "../store/store";
import type { Route } from "../ui/App";
import { Alert, Btn, Card, EmptyState, Modal, StatusBadge, useApp } from "../ui/components";
import { CancelModal, PaymentModal } from "../ui/docModals";
import { tryNativePdf } from "../ui/desktopActions";
import { ImportModal } from "./ImportModal";

/** PDF : natif (genpdf, desktop) sinon impression système (aperçu A4). */
async function pdfOrPrint(
  doc: InvoiceDoc,
  company: Company,
  fallbackPrint: () => void,
  onSuccess: (path: string) => void
): Promise<void> {
  const r = await tryNativePdf(doc, company);
  if (r.ok) onSuccess(r.path);
  else fallbackPrint();
}

type PeriodKey = "ALL" | "TODAY" | "WEEK" | "MONTH" | "PREV_MONTH" | "YEAR" | "CUSTOM";

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "ALL", label: "Tout" },
  { key: "TODAY", label: "Aujourd'hui" },
  { key: "WEEK", label: "Cette semaine" },
  { key: "MONTH", label: "Ce mois" },
  { key: "PREV_MONTH", label: "Mois précédent" },
  { key: "YEAR", label: "Cette année" },
  { key: "CUSTOM", label: "Période personnalisée" },
];

function inPeriod(dateISO: string, key: PeriodKey, from?: string, to?: string): boolean {
  if (key === "ALL") return true;
  if (key === "CUSTOM") return (!from || dateISO >= from) && (!to || dateISO <= to);
  const d = new Date(dateISO);
  const now = new Date();
  if (key === "TODAY") return dateISO.slice(0, 10) === todayISO();
  if (key === "YEAR") return d.getFullYear() === now.getFullYear();
  if (key === "MONTH") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (key === "PREV_MONTH") {
    const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === p.getFullYear() && d.getMonth() === p.getMonth();
  }
  if (key === "WEEK") {
    const start = new Date(now);
    const day = (start.getDay() + 6) % 7; // lundi = 0
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return d >= start && d < end;
  }
  return true;
}

export function DocumentsScreen({
  docType,
  go,
  print,
}: {
  docType: DocType;
  go: (r: Route) => void;
  print: (doc: InvoiceDoc, copy?: boolean) => void;
}) {
  const data = useApp();
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("ALL");
  const [importing, setImporting] = useState(false);
  const [payDoc, setPayDoc] = useState<InvoiceDoc | null>(null);
  const [cancelDoc, setCancelDoc] = useState<InvoiceDoc | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const docs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.docs
      .filter((d) => d.docType === docType)
      .filter((d) => inPeriod(d.date, period, from, to))
      .filter((d) => status === "ALL" || d.status === status)
      .filter((d) => {
        if (!q) return true;
        const customer = data.customers.find((c) => c.id === d.customerId);
        const hay = [
          d.number, d.buyerSnapshot.displayName, customer?.nif, customer?.nis,
          customer?.rc, d.date, formatDateFr(d.date), d.status, d.modePaiement,
          // Montants recherchables « à la française » (§27) : 119 000,00 etc.
          formatCents(d.totalHtCents, d.devise), formatCents(d.totalTvaCents, d.devise), formatCents(d.totalTtcCents, d.devise),
          formatCents(store.paidCents(d), d.devise), formatCents(store.remainingCents(d), d.devise),
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (b.date + (b.number ?? "")).localeCompare(a.date + (a.number ?? "")));
  }, [data, docType, search, period, from, to, status]);

  // Statuts pertinents selon la série (§20, §58).
  const statuses =
    docType === "DEV" || docType === "PRO" || docType === "BL"
      ? ["ALL", "BROUILLON", "ENVOYE", "ACCEPTE", "REFUSE", "EXPIRE", "ANNULEE"]
      : ["ALL", "BROUILLON", "VALIDEE", "ENVOYEE", "PARTIELLEMENT_PAYEE", "PAYEE", "ANNULEE"];

  function doAction(fn: () => void, okMsg: string) {
    try {
      fn();
      setMessage({ tone: "success", text: okMsg });
      setTimeout(() => setMessage(null), 4000);
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
      setTimeout(() => setMessage(null), 6000);
    }
  }

  return (
    <>
      {importing && <ImportModal kind="invoices" onClose={() => setImporting(false)} />}
      <div className="toolbar">
        <Btn variant="primary" onClick={() => go({ name: "editor", docType })}>
          + Nouveau {DOC_TYPE_LABELS[docType].toLowerCase()}
        </Btn>
        {docType === "FAC" && (
          <Btn need="document.validate" onClick={() => setImporting(true)} title="Factures déjà émises : le numéro du fichier est conservé tel quel">
            ⬆ Importer des factures historiques
          </Btn>
        )}
        <input
          className="grow"
          placeholder="Rechercher : numéro, client, NIF, NIS, RC, montant, statut, mode de paiement… (§27)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 480 }}
        />
        <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} style={{ width: "auto" }}>
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        {period === "CUSTOM" && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} />
          </>
        )}
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto" }}>
          {statuses.map((s) => (
            <option key={s} value={s}>{s === "ALL" ? "Tous les statuts" : s.replaceAll("_", " ")}</option>
          ))}
        </select>
      </div>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card>
        <div className="table-wrap card-body tight">
          <table className="data">
            <thead>
              <tr>
                <th>Numéro</th><th>Date</th><th>Client</th>
                <th className="num">Montant HT</th><th className="num">TVA</th>
                <th className="num">Montant TTC</th><th className="num">Payé</th>
                <th className="num">Reste</th><th>Statut</th><th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const paid = store.paidCents(d);
                const remaining = store.remainingCents(d);
                const editable = d.status === "BROUILLON";
                return (
                  <tr key={d.id}>
                    <td className="mono">{d.number ?? "(brouillon)"}</td>
                    <td className="nowrap">{formatDateFr(d.date)}</td>
                    <td>{d.buyerSnapshot.displayName}</td>
                    <td className="num">{formatCents(d.totalHtCents, d.devise)}</td>
                    <td className="num">{formatCents(d.totalTvaCents, d.devise)}</td>
                    <td className="num"><b>{formatCents(d.totalTtcCents, d.devise)}</b></td>
                    <td className="num">{formatCents(paid, d.devise)}</td>
                    <td className="num">{remaining > 0 ? formatCents(remaining, d.devise) : "—"}</td>
                    <td><StatusBadge status={d.status} overdue={isOverdue(d, paid)} /></td>
                    <td>
                      <div className="row-actions">
                        <Btn small onClick={() => go({ name: "editor", docType, docId: d.id })}>
                          {editable ? "Modifier" : "Voir"}
                        </Btn>
                        <Btn need="document.write" small variant="ghost" title="Dupliquer : nouveau brouillon, nouveau numéro (§46)"
                          onClick={() => doAction(() => { const c = store.duplicateDocument(d.id); go({ name: "editor", docType, docId: c.id }); }, "Brouillon dupliqué.")}>
                          Dupliquer
                        </Btn>
                        {d.docType === "DEV" && d.number && !["BROUILLON", "ANNULEE"].includes(d.status) && (
                          <Btn need="document.write" small variant="ghost" title="Créer une nouvelle version du devis : le devis d'origine reste intact (§20)"
                            onClick={() => doAction(() => {
                              const r = store.findOpenRevision(d.number!) ?? store.reviseDocument(d.id);
                              go({ name: "editor", docType, docId: r.id });
                            }, "Révision ouverte en brouillon.")}>
                            Réviser
                          </Btn>
                        )}
                        <Btn small variant="ghost" title="PDF natif (desktop) ou impression (§23, §26)"
                          onClick={() => pdfOrPrint(d, data.company, () => print(d), (path) => doAction(() => undefined, `PDF natif généré : ${path}`))}>
                          PDF
                        </Btn>
                        <Btn small variant="ghost" onClick={() => print(d)} title="Imprimer sur papier A4 (choix de l'imprimante)">Imprimer</Btn>
                        <Btn small variant="ghost" onClick={() => print(d, true)} title="Imprimer une copie (§26)">Copie</Btn>
                        {d.docType === "FAC" && d.status === "VALIDEE" && (
                          <>
                            <Btn need="payment.write" small variant="ghost" onClick={() => setPayDoc(d)}>Encaisser</Btn>
                            <Btn need="document.cancel" small variant="ghost" title="Créer un avoir sur cette facture (§22)"
                              onClick={() => doAction(() => { const a = store.createCreditNote(d.id); go({ name: "editor", docType: "AVOIR", docId: a.id }); }, "Avoir créé en brouillon.")}>
                              Avoir
                            </Btn>
                            <Btn need="document.cancel" small variant="ghost" onClick={() => setCancelDoc(d)}>Annuler</Btn>
                          </>
                        )}
                        {d.docType === "FAC" && ["PARTIELLEMENT_PAYEE", "ENVOYEE"].includes(d.status) && remaining > 0 && (
                          <Btn need="payment.write" small variant="ghost" onClick={() => setPayDoc(d)}>Encaisser</Btn>
                        )}
                        {editable && (
                          <Btn need="document.write" small variant="ghost" title="Supprimer le brouillon (§47)"
                            onClick={() => doAction(() => store.deleteDraft(d.id), "Brouillon supprimé (journalisé).")}>
                            Suppr.
                          </Btn>
                        )}
                        <Btn small variant="ghost" title={d.archived ? "Désarchiver" : "Archiver (§60) — le document reste consultable"}
                          onClick={() => store.toggleArchive(d.id)}>
                          {d.archived ? "↺" : "🗄"}
                        </Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {docs.length === 0 && (
                <tr><td colSpan={10}><EmptyState>Aucun document ne correspond à ces critères.</EmptyState></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {payDoc && <PaymentModal doc={payDoc} onClose={() => setPayDoc(null)} />}
      {cancelDoc && <CancelModal doc={cancelDoc} onClose={() => setCancelDoc(null)} />}
    </>
  );
}
