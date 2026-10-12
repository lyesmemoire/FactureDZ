/** Journal d'audit (§34) : horodaté, non modifiable par l'utilisateur. */

import { useMemo, useState } from "react";
import { formatDateTimeFr } from "../core/format";
import { Badge, Card, useApp } from "../ui/components";

const ACTION_TONES: Record<string, string> = {
  CREATION: "green",
  VALIDATION: "blue",
  ANNULATION: "red",
  SUPPRESSION: "red",
  ENCAISSEMENT: "teal",
  RESTAURATION: "amber",
  SAUVEGARDE: "blue",
  MODIFICATION: "gray",
};

export function AuditScreen() {
  const data = useApp();
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.audit.filter((a) =>
      !q || [a.action, a.objectType, a.utilisateur, a.details].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [data.audit, search]);

  return (
    <>
      <div className="toolbar">
        <input className="grow" placeholder="Rechercher dans le journal d'audit…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 420 }} />
        <span className="muted small">{rows.length} événement(s) — les factures validées ne peuvent jamais être effacées par simple suppression (§34).</span>
      </div>
      <Card>
        <div className="table-wrap card-body tight">
          <table className="data">
            <thead>
              <tr><th>Date / heure</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Détails</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((a) => {
                const prefix = a.action.split("_")[0];
                return (
                  <tr key={a.id}>
                    <td className="mono nowrap">{formatDateTimeFr(a.ts)}</td>
                    <td>{a.utilisateur}</td>
                    <td><Badge tone={ACTION_TONES[prefix] ?? "gray"}>{a.action}</Badge></td>
                    <td className="mono">{a.objectType}{a.objectId ? `:${a.objectId.slice(0, 14)}` : ""}</td>
                    <td className="small">{a.details ?? "—"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={5} className="empty-state">Journal vide.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
