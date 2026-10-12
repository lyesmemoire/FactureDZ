/**
 * Coquille applicative : navigation (§44), verrouillage (§37),
 * impression (§26), assistant de premier démarrage (§54).
 */

import { useEffect, useState } from "react";
import type { DocType, InvoiceDoc } from "../core/types";
import { setLanguage } from "../core/i18n";
import { isTauri } from "../store/desktop";
import { store } from "../store/store";
import { Card, useApp } from "./components";
import type { Action } from "../core/permissions";
import { FirstRunWizard } from "./FirstRunWizard";
import { InvoiceA4 } from "./InvoiceA4";
import { PrintOptionsModal } from "./PrintOptions";
import { AuditScreen } from "../screens/Audit";
import { BackupsScreen } from "../screens/Backups";
import { CustomersScreen } from "../screens/Customers";
import { Dashboard } from "../screens/Dashboard";
import { DiagnosticScreen } from "../screens/Diagnostic";
import { DocumentsScreen } from "../screens/Documents";
import { InvoiceEditor } from "../screens/InvoiceEditor";
import { PaymentsScreen } from "../screens/Payments";
import { PurchasesScreen } from "../screens/Purchases";
import { ProductsScreen } from "../screens/Products";
import { ReportsScreen } from "../screens/Reports";
import { SettingsScreen } from "../screens/Settings";
import { UsersScreen } from "../screens/Users";

export type Route =
  | { name: "dashboard" }
  | { name: "documents"; docType: DocType }
  | { name: "editor"; docType: DocType; docId?: string }
  | { name: "customers" }
  | { name: "products" }
  | { name: "payments" }
  | { name: "achats" }
  | { name: "reports" }
  | { name: "settings"; tab?: string }
  | { name: "backups" }
  | { name: "users" }
  | { name: "audit" }
  | { name: "diagnostic" };

const NAV: Array<{ section?: string; label?: string; ico?: string; route?: Route; needs?: Action }> = [
  { label: "Tableau de bord", ico: "▦", route: { name: "dashboard" } },
  { section: "Documents" },
  { label: "Factures", ico: "🧾", route: { name: "documents", docType: "FAC" } },
  { label: "Avoirs", ico: "↩", route: { name: "documents", docType: "AVOIR" } },
  { label: "Devis", ico: "🗒", route: { name: "documents", docType: "DEV" } },
  { label: "Proforma", ico: "⧉", route: { name: "documents", docType: "PRO" } },
  { label: "Bons de livraison", ico: "🚚", route: { name: "documents", docType: "BL" } },
  { section: "Référentiels" },
  { label: "Clients", ico: "👥", route: { name: "customers" } },
  { label: "Produits / Services", ico: "▤", route: { name: "products" } },
  { label: "Paiements", ico: "💰", route: { name: "payments" } },
  { section: "Achats" },
  { label: "Bons de commande et fournisseurs", ico: "📋", route: { name: "achats" }, needs: "purchase.write" },
  { section: "Pilotage" },
  { label: "Rapports", ico: "📊", route: { name: "reports" } },
  { label: "Journal d'audit", ico: "≡", route: { name: "audit" } },
  { label: "Diagnostic", ico: "🛈", route: { name: "diagnostic" } },
  { section: "Administration" },
  { label: "Paramètres", ico: "⚙", route: { name: "settings" }, needs: "config.manage" },
  { label: "Sauvegardes", ico: "💾", route: { name: "backups" }, needs: "backup.create" },
  { label: "Utilisateurs", ico: "🔐", route: { name: "users" }, needs: "users.manage" },
];

function titleFor(route: Route): string {
  switch (route.name) {
    case "dashboard": return "Tableau de bord";
    case "documents": return ({ FAC: "Factures", AVOIR: "Avoirs", DEV: "Devis", PRO: "Factures proforma", BL: "Bons de livraison" } as Record<DocType, string>)[route.docType];
    case "editor": return route.docId ? "Détail du document" : "Nouveau document";
    case "customers": return "Clients";
    case "products": return "Produits et services";
    case "payments": return "Paiements";
    case "achats": return "Achats";
    case "reports": return "Rapports";
    case "settings": return "Paramètres";
    case "backups": return "Sauvegardes";
    case "users": return "Utilisateurs";
    case "audit": return "Journal d'audit";
    case "diagnostic": return "Diagnostic";
  }
}

export function App() {
  const data = useApp();
  const [route, setRoute] = useState<Route>({ name: "dashboard" });
  const [locked, setLocked] = useState(false);
  // Impression (§26) : demande (document choisi) → options (exemplaires) → feuilles A4 montées.
  const [printAsk, setPrintAsk] = useState<{ doc: InvoiceDoc; copy?: boolean } | null>(null);
  const [printDoc, setPrintDoc] = useState<{ doc: InvoiceDoc; copy?: boolean; copies: number } | null>(null);
  // Amorçage desktop (§51, §52) : sur un profil local vide, on reprend la
  // configuration déjà présente dans la base SQLite (réinstallation, nouveau
  // poste, copie du dossier de données) avant d'afficher l'assistant.
  const [booted, setBooted] = useState(!isTauri());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (isTauri()) await store.bootstrapDesktop();
      } finally {
        if (alive) {
          // Desktop : un compte existe → connexion obligatoire au démarrage (§37).
          if (isTauri() && store.data.users.length > 0) setLocked(true);
          setBooted(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Langue de l'interface (§43).
  useEffect(() => {
    setLanguage(data.language ?? "fr");
  }, [data.language]);

  // Sauvegarde automatique (§30) au démarrage.
  useEffect(() => {
    if (data.initialized) store.maybeAutoBackup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.initialized]);

  // Sauvegarde « à la fermeture » (§30, O-12) : hook desktop avant fermeture
  // de la fenêtre ; repli beforeunload côté navigateur.
  useEffect(() => {
    if (!data.initialized || data.settings.autoBackupFrequency !== "ON_CLOSE") return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    if (isTauri()) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          unlisten = await getCurrentWindow().onCloseRequested(async () => {
            store.exportBackup("AUTO", "Sauvegarde à la fermeture");
            const { invokeDesktop } = await import("../store/desktop");
            await invokeDesktop("backup_now", { label: "Fermeture de l'application" });
          });
        } catch (e) {
          store.techLog("WARNING", `Hook de fermeture indisponible : ${(e as Error)?.message ?? e}`);
        }
      })();
    }
    const onBeforeUnload = () => {
      store.exportBackup("AUTO", "Sauvegarde à la fermeture");
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onBeforeUnload);
      unlisten?.();
      void cancelled;
    };
  }, [data.initialized, data.settings.autoBackupFrequency]);

  // Verrouillage automatique après inactivité (§37).
  useEffect(() => {
    const minutes = data.settings.lockTimeoutMinutes;
    if (!minutes || minutes <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setLocked(true), minutes * 60_000);
    };
    const events = ["mousedown", "keydown", "wheel", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [data.settings.lockTimeoutMinutes]);

  // Impression : on monte la feuille A4 puis on déclenche window.print (§26).
  useEffect(() => {
    if (!printDoc) return;
    const t = setTimeout(() => window.print(), 80);
    const done = () => setPrintDoc(null);
    window.addEventListener("afterprint", done);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [printDoc]);

  if (!booted) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <p>Chargement de vos données locales…</p>
      </div>
    );
  }

  if (!data.initialized) {
    return <FirstRunWizard />;
  }

  const go = (r: Route) => setRoute(r);

  const screen = (() => {
    switch (route.name) {
      case "dashboard": return <Dashboard go={go} print={(doc, copy) => setPrintAsk({ doc, copy })} />;
      case "documents": return <DocumentsScreen docType={route.docType} go={go} print={(doc, copy) => setPrintAsk({ doc, copy })} />;
      case "editor": return <InvoiceEditor key={`${route.docType}-${route.docId ?? "new"}`} docType={route.docType} docId={route.docId} go={go} print={(doc, copy) => setPrintAsk({ doc, copy })} />;
      case "customers": return <CustomersScreen />;
      case "products": return <ProductsScreen />;
      case "payments": return <PaymentsScreen go={go} />;
      case "achats": return <PurchasesScreen />;
      case "reports": return <ReportsScreen />;
      case "settings": return store.can("config.manage") ? <SettingsScreen tab={route.tab} /> : <AccessDenied />;
      case "backups": return <BackupsScreen />;
      case "users": return store.can("users.manage") ? <UsersScreen /> : <AccessDenied />;
      case "audit": return <AuditScreen />;
      case "diagnostic": return <DiagnosticScreen />;
    }
  })();

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="brand-mark">FZ</div>
            <div>
              <div className="t1">FacturationDZ</div>
              <div className="t2">Hors ligne — {data.company.raisonSociale || "Entreprise"}</div>
            </div>
          </div>
          <nav className="sidebar-nav">
            {NAV.filter((item) => !item.needs || store.can(item.needs)).map((item, i) =>
              item.section ? (
                <div key={i} className="nav-section">{item.section}</div>
              ) : (
                <button
                  key={i}
                  className={`nav-item ${sameRoute(route, item.route!) ? "active" : ""}`}
                  onClick={() => go(item.route!)}
                >
                  <span className="ico">{item.ico}</span>
                  {item.label}
                </button>
              )
            )}
          </nav>
          <div className="sidebar-foot">
            <span>
              <span className="user">{data.currentUser}</span>
              <br />v{data.appVersion} — locale
            </span>
            <button className="btn btn-sm" onClick={() => setLocked(true)} title="Verrouiller l'application (§37)">
              🔒
            </button>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <h1>{titleFor(route)}</h1>
            <div className="spacer" />
            {data.demoSeeded && <span className="badge badge-amber">Données de démonstration présentes (§77)</span>}
          </div>
          <div className="content">{screen}</div>
          <footer className="legal-note">
            FacturationDZ est conçu pour intégrer les réglementations algériennes applicables. Il n'est ni certifié
            ni agréé par la DGI. La validation finale des documents relève de l'entreprise et de son conseiller fiscal.
          </footer>
        </div>
      </div>

      {locked && <LockScreen onUnlock={() => setLocked(false)} />}

      {/* Feuille d'impression (§26) — hors flux normal */}
      {printAsk && (
        <PrintOptionsModal
          titre={`${printAsk.doc.number ?? "Brouillon"} — ${printAsk.doc.buyerSnapshot?.displayName ?? ""}`}
          copyDefault={printAsk.copy}
          onCancel={() => setPrintAsk(null)}
          onPrint={(opts) => {
            setPrintDoc({ doc: printAsk.doc, copy: opts.copy, copies: opts.copies });
            setPrintAsk(null);
          }}
        />
      )}
      {printDoc && (
        <div className="print-sheet">
          {Array.from({ length: printDoc.copies }, (_, i) => (
            <InvoiceA4 key={i} doc={printDoc.doc} company={data.company} copy={printDoc.copy} />
          ))}
        </div>
      )}
    </>
  );
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === "documents" && b.name === "documents") return a.docType === b.docType;
  return true;
}

/** Écran affiché lorsque le rôle de l'utilisateur ne donne pas accès (§35). */
function AccessDenied() {
  return (
    <Card title="Accès réservé">
      <p className="muted">
        Cette section est réservée à l'administrateur. Votre rôle ne permet pas de la modifier (§35).
      </p>
    </Card>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const data = useApp();
  const [username, setUsername] = useState(data.currentUser);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function tryUnlock() {
    let ok = false;
    try {
      ok = await store.verifyPassword(username, password);
    } catch (e) {
      // Ex. « Ce compte est désactivé » : message du backend, pas d'accès.
      setError((e as Error).message || "Connexion impossible.");
      store.techLog("WARNING", `Connexion refusée pour « ${username} » : ${(e as Error).message}`);
      return;
    }
    if (ok) {
      store.setCurrentUser(username);
      onUnlock();
    } else {
      setError("Mot de passe incorrect.");
      store.techLog("WARNING", `Échec de déverrouillage pour « ${username} ».`);
    }
  }

  return (
    <div className="lock-screen">
      <div className="lock-box">
        <div className="brand-mark">FZ</div>
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>Application verrouillée</h2>
        <p className="muted small" style={{ marginBottom: 14 }}>
          Saisissez votre mot de passe pour reprendre la session (§37).
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        {data.users.length === 0 ? (
          /* Garde-fou (O-16) : sauvegarde restaurée sans aucun compte.
             On propose de relancer l'assistant pour recréer un administrateur. */
          <div className="stack">
            <div className="alert alert-warning">
              Aucun compte utilisateur n'est défini dans cette base. Relancez l'assistant de
              configuration pour recréer un administrateur.
            </div>
            <button
              className="btn btn-primary"
              style={{ justifyContent: "center" }}
              onClick={() => store.resetToFirstRun()}
            >
              Relancer l'assistant de configuration
            </button>
          </div>
        ) : (
          <div className="stack">
            <select value={username} onChange={(e) => setUsername(e.target.value)}>
              {data.users.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.username}
                </option>
              ))}
            </select>
            <input
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
              autoFocus
            />
            <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={tryUnlock}>
              Déverrouiller
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
