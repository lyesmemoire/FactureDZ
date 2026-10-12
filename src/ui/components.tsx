import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { store } from "../store/store";
import type { DocStatus } from "../core/types";
import type { Action } from "../core/permissions";
import { STATUS_LABELS } from "../core/types";

/** Hook réactif sur le store local. */
export function useApp() {
  useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.getVersion()
  );
  return store.data;
}

export function Btn({
  children,
  onClick,
  variant = "default",
  disabled,
  title,
  small,
  type = "button",
  need,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost" | "success";
  disabled?: boolean;
  title?: string;
  small?: boolean;
  type?: "button" | "submit";
  /** Droit requis (§35) : bouton désactivé si le rôle ne le possède pas. */
  need?: Action;
}) {
  const interdit = need !== undefined && !store.can(need);
  return (
    <button
      type={type}
      className={`btn btn-${variant}${small ? " btn-sm" : ""}`}
      onClick={onClick}
      disabled={disabled || interdit}
      title={interdit ? "Action non autorisée pour votre rôle (§35)" : title}
    >
      {children}
    </button>
  );
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ status, overdue }: { status: DocStatus; overdue?: boolean }) {
  const toneMap: Record<string, string> = {
    BROUILLON: "gray",
    VALIDEE: "blue",
    ENVOYEE: "teal",
    PARTIELLEMENT_PAYEE: "amber",
    PAYEE: "green",
    ANNULEE: "red",
    ENVOYE: "teal",
    ACCEPTE: "green",
    REFUSE: "red",
    EXPIRE: "gray",
  };
  return (
    <>
      <Badge tone={toneMap[status] ?? "gray"}>{STATUS_LABELS[status]}</Badge>
      {overdue && <Badge tone="red-outline">EN RETARD</Badge>}
    </>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 560,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || actions) && (
        <div className="card-head">
          <h3>{title}</h3>
          <div className="card-actions">{actions}</div>
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "green" | "red" | "amber" | "blue";
}) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: "error" | "warning" | "info" | "success";
  children: ReactNode;
}) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function downloadFile(filename: string, content: string, mime = "application/json"): void {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Lecture du fichier impossible."));
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Lecture du fichier impossible."));
    r.readAsText(file);
  });
}
