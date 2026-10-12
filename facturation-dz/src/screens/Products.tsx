/** Catalogue produits et services (§9). */

import { useMemo, useState } from "react";
import { uid } from "../core/ids";
import { nowISO } from "../core/format";
import { fromNumber } from "../core/money";
import { currencySymbol } from "../core/currency";
import { UNITES, type Product } from "../core/types";
import { formatCents, store } from "../store/store";
import { Alert, Badge, Btn, Card, EmptyState, Field, Modal, useApp } from "../ui/components";
import { ImportModal } from "./ImportModal";

function emptyProduct(): Product {
  return {
    id: uid("prd"),
    reference: "",
    designation: "",
    unite: "unité",
    puHtCents: 0,
    taxCodeDefaut: "TVA19",
    actif: true,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
}

export function ProductsScreen() {
  const data = useApp();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.products.filter((p) =>
      !q || [p.reference, p.designation, p.categorie].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [data.products, search]);

  return (
    <>
      <div className="toolbar">
        <Btn need="catalog.write" variant="primary" onClick={() => { setEditing(emptyProduct()); setIsNew(true); }}>
          + Nouveau produit / service
        </Btn>
        <Btn need="catalog.write" onClick={() => setImporting(true)}>⬆ Importer Excel / CSV</Btn>
        <input className="grow" placeholder="Rechercher : référence, désignation, catégorie…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 420 }} />
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <div className="table-wrap card-body tight">
          <table className="data">
            <thead>
              <tr>
                <th>Référence</th><th>Désignation</th><th>Catégorie</th><th>Unité</th>
                <th className="num">PU HT</th><th>TVA défaut</th><th>Statut</th><th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.reference}</td>
                  <td><b>{p.designation}</b>{p.demo && <span className="badge badge-amber" style={{ marginLeft: 6 }}>démo</span>}</td>
                  <td>{p.categorie ?? "—"}</td>
                  <td>{p.unite}</td>
                  <td className="num">{formatCents(p.puHtCents)}</td>
                  <td>{data.taxRates.find((t) => t.code === p.taxCodeDefaut)?.libelle ?? p.taxCodeDefaut}</td>
                  <td>{p.actif ? <Badge tone="green">Actif</Badge> : <Badge tone="gray">Inactif</Badge>}</td>
                  <td>
                    <div className="row-actions">
                      <Btn need="catalog.write" small onClick={() => { setEditing({ ...p }); setIsNew(false); }}>Modifier</Btn>
                      <Btn small variant="ghost" onClick={() => store.saveProduct({ ...p, actif: !p.actif }, false)}>
                        {p.actif ? "Désactiver" : "Activer"}
                      </Btn>
                      <Btn small variant="ghost" onClick={() => {
                        if (!window.confirm(`Supprimer le produit « ${p.reference} » ?`)) return;
                        try { store.deleteProduct(p.id); setError(""); } catch (e) { setError((e as Error).message); }
                      }}>Supprimer</Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8}><EmptyState>Aucun produit trouvé.</EmptyState></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {importing && <ImportModal kind="products" onClose={() => setImporting(false)} />}
      {editing && <ProductModal product={editing} isNew={isNew} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProductModal({ product, isNew, onClose }: { product: Product; isNew: boolean; onClose: () => void }) {
  const data = useApp();
  const [p, setP] = useState<Product>(product);
  const [error, setError] = useState("");
  const set = (patch: Partial<Product>) => setP((x) => ({ ...x, ...patch }));

  function save() {
    try {
      if (!p.reference.trim()) throw new Error("La référence est obligatoire.");
      if (!p.designation.trim()) throw new Error("La désignation est obligatoire.");
      if (p.puHtCents < 0) throw new Error("Le prix unitaire HT doit être ≥ 0.");
      store.saveProduct(p, isNew);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal
      title={isNew ? "Nouveau produit / service (§9)" : `Modifier — ${product.reference}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
          <Btn need="catalog.write" variant="primary" onClick={save}>Enregistrer</Btn>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="form-grid">
        <Field label="Référence" required>
          <input value={p.reference} onChange={(e) => set({ reference: e.target.value })} />
        </Field>
        <Field label="Catégorie">
          <input value={p.categorie ?? ""} onChange={(e) => set({ categorie: e.target.value })} />
        </Field>
        <div className="span2">
          <Field label="Désignation" required>
            <input value={p.designation} onChange={(e) => set({ designation: e.target.value })} />
          </Field>
        </div>
        <div className="span2">
          <Field label="Description (facultative)">
            <textarea value={p.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>
        <Field label="Unité">
          <select value={p.unite} onChange={(e) => set({ unite: e.target.value })}>
            {UNITES.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Field>
        <Field label={`Prix unitaire HT (${currencySymbol(store.data.company.devise)})`}>
          <input type="number" min={0} step="0.01" value={(p.puHtCents / 100).toFixed(2)}
            onChange={(e) => set({ puHtCents: fromNumber(Number(e.target.value) || 0) })} />
        </Field>
        <Field label="Taux de TVA par défaut">
          <select value={p.taxCodeDefaut} onChange={(e) => set({ taxCodeDefaut: e.target.value })}>
            {data.taxRates.filter((t) => t.actif).map((t) => (
              <option key={t.id} value={t.code}>{t.libelle}</option>
            ))}
          </select>
        </Field>
        <Field label="Statut">
          <label className="hrow">
            <input type="checkbox" style={{ width: "auto" }} checked={p.actif} onChange={(e) => set({ actif: e.target.checked })} />
            Actif
          </label>
        </Field>
      </div>
    </Modal>
  );
}
