/**
 * Achats (phase 2) : bons de commande fournisseurs et fiches fournisseurs.
 * Cycle : brouillon → envoyé (numéro BC-AAAA-…) → reçu partiellement / reçu, ou annulé avant réception.
 */

import { useEffect, useState } from "react";
import { uid } from "../core/ids";
import { nowISO, formatDateFr, todayISO } from "../core/format";
import { fromNumber } from "../core/money";
import { isTaxApplicable, pickDefaultTax } from "../core/taxEngine";
import {
  canCancelPurchaseOrder,
  canDeletePurchaseOrder,
  canEditPurchaseOrder,
  canReceivePurchaseOrder,
  computePurchaseTotals,
  resteARecevoir,
} from "../core/purchaseOrders";
import { UNITES, WILAYAS, PO_STATUS_LABELS, type PoStatus, type PurchaseOrder, type PurchaseOrderLine, type Supplier } from "../core/types";
import { formatCents, store } from "../store/store";
import { Alert, Badge, Btn, Card, EmptyState, Field, Modal, useApp } from "../ui/components";
import { PurchaseOrderSheet } from "../ui/PurchaseOrderSheet";

type Tab = "bons" | "fournisseurs";

const STATUS_TONE: Record<PoStatus, string> = {
  BROUILLON: "gray",
  ENVOYE: "blue",
  RECU_PARTIEL: "blue",
  RECU: "green",
  ANNULE: "gray",
};

function emptySupplier(): Supplier {
  return { id: uid("sup"), denomination: "", actif: true, createdAt: nowISO(), updatedAt: nowISO() };
}

function emptyPo(supplierId: string): PurchaseOrder {
  return {
    id: uid("po"),
    number: null,
    status: "BROUILLON",
    supplierId,
    supplierSnapshot: { displayName: "", type: "ENTREPRISE" },
    date: todayISO(),
    devise: "DZD",
    lines: [],
    totalHtCents: 0,
    totalTvaCents: 0,
    totalTtcCents: 0,
    vatDetail: [],
    amountInWords: "",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
}

export function PurchasesScreen() {
  const data = useApp();
  const [tab, setTab] = useState<Tab>("bons");
  const [editing, setEditing] = useState<{ po: PurchaseOrder; isNew: boolean } | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [cancelling, setCancelling] = useState<PurchaseOrder | null>(null);
  const [printing, setPrinting] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState("");
  const canWrite = store.can("purchase.write");

  // Impression : la feuille est rendue, puis la boîte d'impression s'ouvre.
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 150);
    return () => clearTimeout(t);
  }, [printing]);

  if (editing) {
    return (
      <PoEditor
        initial={editing.po}
        isNew={editing.isNew}
        onDone={() => setEditing(null)}
      />
    );
  }

  const suppliersById = new Map(data.suppliers.map((f) => [f.id, f]));
  const orders = [...data.purchaseOrders].sort((a, b) =>
    (b.number ?? "~").localeCompare(a.number ?? "~") || b.createdAt.localeCompare(a.createdAt)
  );

  const newPo = () => {
    const first = data.suppliers.find((f) => f.actif);
    if (!first) {
      setError("Créez d'abord un fournisseur (onglet Fournisseurs).");
      setTab("fournisseurs");
      return;
    }
    setError("");
    setEditing({ po: emptyPo(first.id), isNew: true });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <Btn variant={tab === "bons" ? "primary" : "default"} onClick={() => setTab("bons")}>
          Bons de commande
        </Btn>
        <Btn variant={tab === "fournisseurs" ? "primary" : "default"} onClick={() => setTab("fournisseurs")}>
          Fournisseurs ({data.suppliers.length})
        </Btn>
      </div>

      {error && <Alert tone="warning">{error}</Alert>}

      {tab === "bons" && (
        <Card
          title="Bons de commande"
          actions={canWrite ? <Btn variant="primary" onClick={newPo}>+ Nouveau bon de commande</Btn> : undefined}
        >
          {orders.length === 0 ? (
            <EmptyState>Aucun bon de commande. Un bon de commande part vers un fournisseur ; il est numéroté à l'envoi.</EmptyState>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Date</th>
                  <th>Fournisseur</th>
                  <th style={{ textAlign: "right" }}>Total TTC</th>
                  <th>Réception</th>
                  <th>Statut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => {
                  const f = suppliersById.get(po.supplierId);
                  const recu = po.lines.reduce((s, l) => s + l.qtyRecue, 0);
                  const cmd = po.lines.reduce((s, l) => s + l.qty, 0);
                  return (
                    <tr key={po.id}>
                      <td>{po.number ?? <i>(brouillon)</i>}</td>
                      <td>{formatDateFr(po.date)}</td>
                      <td>{f?.denomination ?? po.supplierSnapshot.displayName}</td>
                      <td style={{ textAlign: "right" }}>{formatCents(po.totalTtcCents, po.devise)}</td>
                      <td>{po.status === "BROUILLON" ? "—" : `${recu} / ${cmd}`}</td>
                      <td><Badge tone={STATUS_TONE[po.status]}>{PO_STATUS_LABELS[po.status]}</Badge></td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        {canWrite && canEditPurchaseOrder(po) && (
                          <Btn small onClick={() => setEditing({ po: structuredClone(po), isNew: false })}>Modifier</Btn>
                        )}
                        {canWrite && canEditPurchaseOrder(po) && (
                          <Btn small variant="success" onClick={() => {
                            const errs = store.sendPurchaseOrder(po.id);
                            setError(errs.join(" "));
                          }}>Envoyer</Btn>
                        )}
                        {canWrite && canReceivePurchaseOrder(po) && (
                          <Btn small onClick={() => setReceiving(po)}>Réception</Btn>
                        )}
                        <Btn small variant="ghost" onClick={() => setPrinting(po)}>Imprimer</Btn>
                        {canWrite && canCancelPurchaseOrder(po) && (
                          <Btn small variant="ghost" onClick={() => setCancelling(po)}>Annuler</Btn>
                        )}
                        {canWrite && canDeletePurchaseOrder(po) && (
                          <Btn small variant="danger" onClick={() => {
                            if (!window.confirm("Supprimer ce brouillon ?")) return;
                            store.deletePurchaseOrder(po.id);
                          }}>Supprimer</Btn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "fournisseurs" && <SuppliersTab canWrite={canWrite} />}

      {receiving && <ReceptionModal po={receiving} onClose={() => setReceiving(null)} />}
      {cancelling && <CancelModal po={cancelling} onClose={() => setCancelling(null)} />}

      {printing && (
        <div className="print-sheet">
          <PurchaseOrderSheet po={printing} company={data.company} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Éditeur de bon de commande (brouillon)                              */
/* ------------------------------------------------------------------ */

function PoEditor({ initial, isNew, onDone }: { initial: PurchaseOrder; isNew: boolean; onDone: () => void }) {
  const data = useApp();
  const [po, setPo] = useState<PurchaseOrder>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const activeTaxes = data.taxRates.filter((t) => isTaxApplicable(t, po.date));
  const defaultTax = pickDefaultTax(data.taxRates, data.company.taxCodeDefaut, po.date);
  const totals = computePurchaseTotals(po.lines, po.devise);

  const patch = (p: Partial<PurchaseOrder>) => setPo((cur) => ({ ...cur, ...p }));
  const patchLine = (id: string, p: Partial<PurchaseOrderLine>) =>
    setPo((cur) => ({ ...cur, lines: cur.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) }));

  const addLine = () => {
    const tax = defaultTax ?? activeTaxes[0];
    const line: PurchaseOrderLine = {
      id: uid("pol"),
      designation: "",
      unite: "unité",
      qty: 1,
      qtyRecue: 0,
      puHtCents: 0,
      remisePct: 0,
      taxCode: tax?.code ?? "",
      taxRatePctSnapshot: tax?.ratePct ?? 0,
    };
    patch({ lines: [...po.lines, line] });
  };

  const removeLine = (id: string) => patch({ lines: po.lines.filter((l) => l.id !== id) });

  const pickProduct = (lineId: string, productId: string) => {
    const p = data.products.find((x) => x.id === productId);
    if (!p) return;
    const tax = data.taxRates.find((t) => t.code === p.taxCodeDefaut);
    patchLine(lineId, {
      productRef: p.reference || undefined,
      designation: p.designation,
      unite: p.unite,
      puHtCents: p.puHtCents,
      taxCode: tax?.code ?? p.taxCodeDefaut,
      taxRatePctSnapshot: tax?.ratePct ?? 0,
    });
  };

  const save = (send: boolean) => {
    const cleaned: PurchaseOrder = { ...po, lines: po.lines };
    if (!cleaned.supplierId) {
      setErrors(["Choisissez un fournisseur."]);
      return;
    }
    try {
      store.savePurchaseOrder(cleaned, isNew);
    } catch (e) {
      setErrors([(e as Error).message]);
      return;
    }
    if (send) {
      const errs = store.sendPurchaseOrder(cleaned.id, po.date);
      if (errs.length) {
        setErrors(errs);
        return;
      }
    }
    onDone();
  };

  const supplier = data.suppliers.find((f) => f.id === po.supplierId);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{isNew ? "Nouveau bon de commande" : `Brouillon BC`}</h2>
        <Btn variant="ghost" onClick={onDone}>← Retour</Btn>
      </div>

      {errors.length > 0 && <Alert tone="warning">{errors.map((e, i) => <div key={i}>{e}</div>)}</Alert>}

      <Card title="En-tête">
        <div className="form-grid">
          <Field label="Fournisseur" required>
            <select value={po.supplierId} onChange={(e) => patch({ supplierId: e.target.value })}>
              {data.suppliers.filter((f) => f.actif || f.id === po.supplierId).map((f) => (
                <option key={f.id} value={f.id}>{f.denomination}</option>
              ))}
            </select>
          </Field>
          <Field label="Date du bon">
            <input type="date" value={po.date} onChange={(e) => patch({ date: e.target.value })} />
          </Field>
          <Field label="Livraison souhaitée">
            <input type="date" value={po.dateLivraison ?? ""} onChange={(e) => patch({ dateLivraison: e.target.value || undefined })} />
          </Field>
          <Field label="Lieu de livraison">
            <input value={po.lieuLivraison ?? ""} onChange={(e) => patch({ lieuLivraison: e.target.value })} />
          </Field>
          <Field label="Mode de paiement">
            <input value={po.modePaiement ?? ""} onChange={(e) => patch({ modePaiement: e.target.value })} />
          </Field>
          <Field label="Conditions de paiement">
            <input value={po.conditionsPaiement ?? ""} onChange={(e) => patch({ conditionsPaiement: e.target.value })} />
          </Field>
          <div className="span2">
            <Field label="Observations">
              <textarea value={po.observations ?? ""} onChange={(e) => patch({ observations: e.target.value })} />
            </Field>
          </div>
        </div>
        {supplier && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>
            {supplier.nif ? `NIF : ${supplier.nif} ` : ""}{supplier.rc ? `· RC : ${supplier.rc}` : ""}
          </div>
        )}
      </Card>

      <Card
        title="Articles à commander"
        actions={<Btn small onClick={addLine}>+ Ajouter une ligne</Btn>}
      >
        {po.lines.length === 0 ? (
          <EmptyState>Aucune ligne. Ajoutez les articles à commander.</EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Désignation</th>
                <th style={{ width: 90 }}>Qté</th>
                <th style={{ width: 100 }}>Unité</th>
                <th style={{ width: 120 }}>P.U. HT</th>
                <th style={{ width: 80 }}>Remise %</th>
                <th style={{ width: 110 }}>TVA</th>
                <th style={{ textAlign: "right", width: 120 }}>Total HT</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l, i) => (
                <tr key={l.id}>
                  <td>
                    <select value="" onChange={(e) => pickProduct(l.id, e.target.value)}>
                      <option value="">— choisir —</option>
                      {data.products.filter((p) => p.actif).map((p) => (
                        <option key={p.id} value={p.id}>{p.reference} {p.designation}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={l.designation} onChange={(e) => patchLine(l.id, { designation: e.target.value })} />
                  </td>
                  <td>
                    <input type="number" min={0} step="any" value={l.qty}
                      onChange={(e) => patchLine(l.id, { qty: Number(e.target.value) })} />
                  </td>
                  <td>
                    <select value={l.unite} onChange={(e) => patchLine(l.id, { unite: e.target.value })}>
                      {[...new Set([l.unite, ...UNITES])].map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="number" min={0} step="0.01" value={l.puHtCents / 100}
                      onChange={(e) => patchLine(l.id, { puHtCents: fromNumber(Number(e.target.value) || 0) })} />
                  </td>
                  <td>
                    <input type="number" min={0} max={100} step="any" value={l.remisePct ?? 0}
                      onChange={(e) => patchLine(l.id, { remisePct: Number(e.target.value) || 0 })} />
                  </td>
                  <td>
                    <select value={l.taxCode} onChange={(e) => {
                      const t = data.taxRates.find((x) => x.code === e.target.value);
                      patchLine(l.id, { taxCode: e.target.value, taxRatePctSnapshot: t?.ratePct ?? 0 });
                    }}>
                      {[...new Set([l.taxCode, ...activeTaxes.map((t) => t.code)])].filter(Boolean).map((code) => {
                        const t = data.taxRates.find((x) => x.code === code);
                        return <option key={code} value={code}>{t?.libelle ?? code}</option>;
                      })}
                    </select>
                  </td>
                  <td style={{ textAlign: "right" }}>{formatCents(totals.lineHtCents[i] ?? 0, po.devise)}</td>
                  <td>
                    <Btn small variant="ghost" onClick={() => removeLine(l.id)}>✕</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <table style={{ minWidth: 300 }}>
            <tbody>
              <tr><td>Total HT</td><td style={{ textAlign: "right" }}>{formatCents(totals.totalHtCents, po.devise)}</td></tr>
              <tr><td>TVA</td><td style={{ textAlign: "right" }}>{formatCents(totals.totalTvaCents, po.devise)}</td></tr>
              <tr style={{ fontWeight: 700 }}>
                <td>Total TTC</td>
                <td style={{ textAlign: "right" }}>{formatCents(totals.totalTtcCents, po.devise)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <Btn onClick={() => save(false)}>Enregistrer le brouillon</Btn>
        <Btn variant="primary" onClick={() => save(true)}>Enregistrer et envoyer</Btn>
      </div>
      <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
        Le numéro (BC-AAAA-000001) est attribué à l'envoi. Un brouillon reste modifiable ; après envoi, le contenu est figé.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Réception et annulation                                             */
/* ------------------------------------------------------------------ */

function ReceptionModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<string, number>>(() =>
    Object.fromEntries(po.lines.map((l) => [l.id, l.qtyRecue]))
  );
  const [errors, setErrors] = useState<string[]>([]);
  const submit = () => {
    const errs = store.receivePurchaseOrder(po.id, qtys);
    if (errs.length) setErrors(errs);
    else onClose();
  };
  return (
    <Modal
      title={`Réception — ${po.number ?? "bon de commande"}`}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" onClick={submit}>Enregistrer la réception</Btn></>}
    >
      {errors.length > 0 && <Alert tone="warning">{errors.map((e, i) => <div key={i}>{e}</div>)}</Alert>}
      <p style={{ fontSize: 13 }}>Indiquez la quantité totale reçue à ce jour pour chaque ligne.</p>
      <table className="table">
        <thead>
          <tr><th>Désignation</th><th>Commandé</th><th>Déjà reçu</th><th>Reçu (total)</th></tr>
        </thead>
        <tbody>
          {po.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.designation}</td>
              <td>{l.qty} {l.unite}</td>
              <td>{l.qtyRecue}</td>
              <td>
                <input type="number" min={l.qtyRecue} max={l.qty} step="any" value={qtys[l.id] ?? 0}
                  onChange={(e) => setQtys((q) => ({ ...q, [l.id]: Number(e.target.value) }))} />
                <div style={{ fontSize: 11, color: "#666" }}>reste {resteARecevoir({ ...l, qtyRecue: qtys[l.id] ?? 0 })}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function CancelModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const [motif, setMotif] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const submit = () => {
    const errs = store.cancelPurchaseOrder(po.id, motif);
    if (errs.length) setErrors(errs);
    else onClose();
  };
  return (
    <Modal
      title={`Annuler ${po.number ?? "le bon de commande"}`}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Retour</Btn><Btn variant="danger" onClick={submit}>Annuler le bon</Btn></>}
    >
      {errors.length > 0 && <Alert tone="warning">{errors.map((e, i) => <div key={i}>{e}</div>)}</Alert>}
      <Field label="Motif d'annulation" required>
        <textarea value={motif} onChange={(e) => setMotif(e.target.value)} />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Fournisseurs                                                        */
/* ------------------------------------------------------------------ */

function SuppliersTab({ canWrite }: { canWrite: boolean }) {
  const data = useApp();
  const [editing, setEditing] = useState<{ f: Supplier; isNew: boolean } | null>(null);
  const [error, setError] = useState("");
  return (
    <Card
      title="Fournisseurs"
      actions={canWrite ? <Btn variant="primary" onClick={() => setEditing({ f: emptySupplier(), isNew: true })}>+ Nouveau fournisseur</Btn> : undefined}
    >
      {error && <Alert tone="warning">{error}</Alert>}
      {data.suppliers.length === 0 ? (
        <EmptyState>Aucun fournisseur. Créez-en un avant d'établir un bon de commande.</EmptyState>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Dénomination</th><th>NIF</th><th>RC</th><th>Wilaya</th><th>Téléphone</th><th>Statut</th><th /></tr>
          </thead>
          <tbody>
            {data.suppliers.map((f) => (
              <tr key={f.id}>
                <td>{f.denomination}</td>
                <td>{f.nif ?? ""}</td>
                <td>{f.rc ?? ""}</td>
                <td>{f.wilaya ?? ""}</td>
                <td>{f.telephone ?? ""}</td>
                <td>{f.actif ? <Badge tone="green">Actif</Badge> : <Badge tone="gray">Inactif</Badge>}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {canWrite && <Btn small onClick={() => setEditing({ f: { ...f }, isNew: false })}>Modifier</Btn>}
                  {canWrite && (
                    <Btn small variant="danger" onClick={() => {
                      if (!window.confirm(`Supprimer le fournisseur « ${f.denomination} » ?`)) return;
                      try {
                        store.deleteSupplier(f.id);
                        setError("");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}>Supprimer</Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <SupplierForm f={editing.f} isNew={editing.isNew} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function SupplierForm({ f: initial, isNew, onClose }: { f: Supplier; isNew: boolean; onClose: () => void }) {
  const [f, setF] = useState<Supplier>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (p: Partial<Supplier>) => setF((cur) => ({ ...cur, ...p }));
  const save = () => {
    if (!f.denomination.trim()) {
      setErrors(["La dénomination est obligatoire."]);
      return;
    }
    store.saveSupplier(f, isNew);
    onClose();
  };
  const txt = (k: keyof Supplier, label: string, required = false) => (
    <Field label={label} required={required}>
      <input value={(f[k] as string | undefined) ?? ""} onChange={(e) => set({ [k]: e.target.value } as Partial<Supplier>)} />
    </Field>
  );
  return (
    <Modal
      title={isNew ? "Nouveau fournisseur" : `Fournisseur — ${initial.denomination}`}
      onClose={onClose}
      width={720}
      footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" onClick={save}>Enregistrer</Btn></>}
    >
      {errors.length > 0 && <Alert tone="warning">{errors.map((e, i) => <div key={i}>{e}</div>)}</Alert>}
      <div className="form-grid">
        <div className="span2">{txt("denomination", "Dénomination", true)}</div>
        {txt("nomCommercial", "Nom commercial")}
        {txt("contactPrincipal", "Contact principal")}
        {txt("nif", "NIF")}
        {txt("rc", "RC")}
        {txt("nis", "NIS")}
        {txt("articleImposition", "Article d'imposition")}
        <div className="span2">{txt("adresse", "Adresse")}</div>
        <Field label="Wilaya">
          <select value={f.wilaya ?? ""} onChange={(e) => set({ wilaya: e.target.value || undefined })}>
            <option value="">—</option>
            {WILAYAS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
        {txt("commune", "Commune")}
        {txt("telephone", "Téléphone")}
        {txt("email", "Courriel")}
        <Field label="Délai de paiement (jours)">
          <input type="number" min={0} value={f.conditionsPaiementJours ?? ""}
            onChange={(e) => set({ conditionsPaiementJours: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </Field>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={f.actif} onChange={(e) => set({ actif: e.target.checked })} /> Actif
        </label>
        <div className="span2">
          <Field label="Observations">
            <textarea value={f.observations ?? ""} onChange={(e) => set({ observations: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
