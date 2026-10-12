/** Fiche client (§7) — entreprise ou particulier, identifiants distincts,
 *  validation configurable (§8), contacts multiples. */

import { useMemo, useState } from "react";
import { uid } from "../core/ids";
import { nowISO } from "../core/format";
import { fromNumber } from "../core/money";
import { currencySymbol } from "../core/currency";
import { WILAYAS, type Customer } from "../core/types";
import { customerName, formatCents, store } from "../store/store";
import { Alert, Badge, Btn, Card, EmptyState, Field, Modal, useApp } from "../ui/components";
import { ImportModal } from "./ImportModal";
import { validateCustomerIdentifiers } from "../core/validation";

function emptyCustomer(type: Customer["type"]): Customer {
  return {
    id: uid("cus"),
    type,
    contacts: [],
    actif: true,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    conditionsPaiementJours: store.data.company.conditionsPaiementDefautJours,
  };
}

export function CustomersScreen() {
  const data = useApp();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.customers.filter((c) => {
      if (!q) return true;
      return [customerName(c), c.nif, c.nis, c.rc, c.wilaya, c.email, c.telephone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data.customers, search]);

  return (
    <>
      <div className="toolbar">
        <Btn need="catalog.write" variant="primary" onClick={() => { setEditing(emptyCustomer("ENTREPRISE")); setIsNew(true); }}>
          + Nouveau client
        </Btn>
        <Btn need="catalog.write" onClick={() => setImporting(true)}>⬆ Importer Excel / CSV</Btn>
        <input className="grow" placeholder="Rechercher : nom, NIF, NIS, RC, wilaya…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 420 }} />
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <div className="table-wrap card-body tight">
          <table className="data">
            <thead>
              <tr>
                <th>Type</th><th>Nom / Dénomination</th><th>Wilaya</th><th>Téléphone</th>
                <th className="mono">NIF</th><th className="mono">RC</th>
                <th className="num">Plafond crédit</th><th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.type === "ENTREPRISE" ? <Badge tone="blue">Entreprise</Badge> : <Badge tone="gray">Particulier</Badge>}</td>
                  <td><b>{customerName(c)}</b>{c.demo && <span className="badge badge-amber" style={{ marginLeft: 6 }}>démo</span>}</td>
                  <td>{c.wilaya ?? "—"}</td>
                  <td>{c.telephone ?? "—"}</td>
                  <td className="mono">{c.nif ?? "—"}</td>
                  <td className="mono">{c.rc ?? "—"}</td>
                  <td className="num">{c.creditLimitCents ? formatCents(c.creditLimitCents) : "—"}</td>
                  <td>
                    <div className="row-actions">
                      <Btn need="catalog.write" small onClick={() => { setEditing(JSON.parse(JSON.stringify(c))); setIsNew(false); }}>Modifier</Btn>
                      <Btn small variant="ghost" onClick={() => {
                        if (!window.confirm(`Supprimer le client « ${customerName(c)} » ? Cette action est journalisée (§34).`)) return;
                        try { store.deleteCustomer(c.id); setError(""); } catch (e) { setError((e as Error).message); }
                      }}>Supprimer</Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8}><EmptyState>Aucun client trouvé.</EmptyState></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {importing && <ImportModal kind="customers" onClose={() => setImporting(false)} />}
      {editing && (
        <CustomerModal
          customer={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CustomerModal({ customer, isNew, onClose }: { customer: Customer; isNew: boolean; onClose: () => void }) {
  const [c, setC] = useState<Customer>(customer);
  const [error, setError] = useState("");
  const data = useApp();

  const set = (p: Partial<Customer>) => setC((x) => ({ ...x, ...p }));
  const idIssues = validateCustomerIdentifiers(c, data.settings.validation);

  function save() {
    try {
      if (c.type === "ENTREPRISE" && !c.denomination?.trim()) throw new Error("La dénomination de l'entreprise est obligatoire.");
      if (c.type === "PARTICULIER" && !c.nom?.trim() && !c.prenom?.trim()) throw new Error("Le nom du particulier est obligatoire.");
      store.saveCustomer(c, isNew);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal
      title={isNew ? "Nouveau client (§7)" : `Modifier — ${customerName(customer)}`}
      onClose={onClose}
      width={760}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
          <Btn need="catalog.write" variant="primary" onClick={save}>Enregistrer</Btn>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="form-grid">
        <Field label="Type de client" required>
          <select value={c.type} onChange={(e) => set({ type: e.target.value as Customer["type"] })}>
            <option value="ENTREPRISE">Entreprise</option>
            <option value="PARTICULIER">Personne physique / consommateur</option>
          </select>
        </Field>
        {c.type === "ENTREPRISE" ? (
          <>
            <Field label="Dénomination / raison sociale" required>
              <input value={c.denomination ?? ""} onChange={(e) => set({ denomination: e.target.value })} />
            </Field>
            <Field label="Nom commercial">
              <input value={c.nomCommercial ?? ""} onChange={(e) => set({ nomCommercial: e.target.value })} />
            </Field>
            <Field label="Forme juridique">
              <select value={c.formeJuridique ?? ""} onChange={(e) => set({ formeJuridique: e.target.value })}>
                <option value="">— Choisir —</option>
                {["EURL", "SARL", "SPA", "SNC", "SCS", "Entreprise individuelle", "Auto-entrepreneur", "Autre"].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="Activité">
              <input value={c.activite ?? ""} onChange={(e) => set({ activite: e.target.value })} />
            </Field>
            <Field label="Contact principal">
              <input value={c.contactPrincipal ?? ""} onChange={(e) => set({ contactPrincipal: e.target.value })} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Nom" required>
              <input value={c.nom ?? ""} onChange={(e) => set({ nom: e.target.value })} />
            </Field>
            <Field label="Prénom">
              <input value={c.prenom ?? ""} onChange={(e) => set({ prenom: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Adresse">
          <input value={c.adresse ?? ""} onChange={(e) => set({ adresse: e.target.value })} />
        </Field>
        <Field label="Wilaya">
          <select value={c.wilaya ?? ""} onChange={(e) => set({ wilaya: e.target.value })}>
            <option value="">— Choisir —</option>
            {WILAYAS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </Field>
        <Field label="Commune">
          <input value={c.commune ?? ""} onChange={(e) => set({ commune: e.target.value })} />
        </Field>
        <Field label="Téléphone">
          <input value={c.telephone ?? ""} onChange={(e) => set({ telephone: e.target.value })} />
        </Field>
        <Field label="Fax">
          <input value={c.fax ?? ""} onChange={(e) => set({ fax: e.target.value })} />
        </Field>
        <Field label="Email">
          <input value={c.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label="Conditions de paiement (jours)">
          <input type="number" min={0} value={c.conditionsPaiementJours ?? 0} onChange={(e) => set({ conditionsPaiementJours: Number(e.target.value) || 0 })} />
        </Field>
        <Field label={`Plafond de crédit (${currencySymbol(store.data.company.devise)}, facultatif)`}>
          <input type="number" min={0} step="0.01" value={c.creditLimitCents ? c.creditLimitCents / 100 : ""}
            onChange={(e) => set({ creditLimitCents: e.target.value ? fromNumber(Number(e.target.value)) : undefined })} />
        </Field>

        {c.type === "ENTREPRISE" && (
          <>
            <div className="span2"><b className="small">Identifiants fiscaux et légaux (§6, §8) — champs distincts</b></div>
            <Field label="RC (Registre de commerce)">
              <input value={c.rc ?? ""} onChange={(e) => set({ rc: e.target.value })} />
            </Field>
            <Field label="NIF">
              <input value={c.nif ?? ""} onChange={(e) => set({ nif: e.target.value })} />
            </Field>
            <Field label="NIS">
              <input value={c.nis ?? ""} onChange={(e) => set({ nis: e.target.value })} />
            </Field>
            <Field label="Article d'imposition (AI)">
              <input value={c.articleImposition ?? ""} onChange={(e) => set({ articleImposition: e.target.value })} />
            </Field>
            <Field label="TIN / NIF international (si nécessaire)" hint="Libellé international du NIF — pas un identifiant algérien supplémentaire (§6).">
              <input value={c.tinInternational ?? ""} onChange={(e) => set({ tinInternational: e.target.value })} />
            </Field>
          </>
        )}

        <div className="span2">
          <Field label="Observations">
            <textarea value={c.observations ?? ""} onChange={(e) => set({ observations: e.target.value })} />
          </Field>
        </div>
      </div>

      {c.type === "ENTREPRISE" && (
        <div style={{ marginTop: 14 }}>
          <div className="hrow" style={{ justifyContent: "space-between" }}>
            <b className="small">Contacts (§7)</b>
            <Btn small onClick={() => set({ contacts: [...c.contacts, { id: uid("ct"), nom: "" }] })}>+ Contact</Btn>
          </div>
          {c.contacts.map((ct) => (
            <div className="hrow" key={ct.id} style={{ marginTop: 6 }}>
              <input placeholder="Nom" value={ct.nom} style={{ flex: 2 }}
                onChange={(e) => set({ contacts: c.contacts.map((x) => (x.id === ct.id ? { ...x, nom: e.target.value } : x)) })} />
              <input placeholder="Fonction" value={ct.fonction ?? ""} style={{ flex: 1.5 }}
                onChange={(e) => set({ contacts: c.contacts.map((x) => (x.id === ct.id ? { ...x, fonction: e.target.value } : x)) })} />
              <input placeholder="Téléphone" value={ct.telephone ?? ""} style={{ flex: 1.5 }}
                onChange={(e) => set({ contacts: c.contacts.map((x) => (x.id === ct.id ? { ...x, telephone: e.target.value } : x)) })} />
              <input placeholder="Email" value={ct.email ?? ""} style={{ flex: 1.5 }}
                onChange={(e) => set({ contacts: c.contacts.map((x) => (x.id === ct.id ? { ...x, email: e.target.value } : x)) })} />
              <Btn small variant="ghost" onClick={() => set({ contacts: c.contacts.filter((x) => x.id !== ct.id) })}>✕</Btn>
            </div>
          ))}
        </div>
      )}

      {idIssues.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {idIssues.map((i, idx) => (
            <Alert key={idx} tone={i.level === "ERROR" ? "error" : "warning"}>
              {i.message} (règle configurable : Paramètres → Règles de validation, §8)
            </Alert>
          ))}
        </div>
      )}
    </Modal>
  );
}
