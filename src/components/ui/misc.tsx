import * as React from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export function Alert({ variant = "info", title, children, className }: { variant?: "info" | "warning" | "danger" | "success"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const Icon = { info: Info, warning: AlertTriangle, danger: XCircle, success: CheckCircle2 }[variant];
  const styles = {
    info: "border-blue-500/30 bg-blue-500/5 text-blue-900 dark:text-blue-200",
    warning: "border-amber-500/40 bg-amber-500/8 text-amber-900 dark:text-amber-200",
    danger: "border-red-500/30 bg-red-500/5 text-red-900 dark:text-red-200",
    success: "border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-200",
  }[variant];
  return (
    <div role={variant === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border p-3 text-sm", styles, className)}>
      <Icon className="size-4 mt-0.5 shrink-0" />
      <div className="grid gap-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}

export function Progress({ value, className, tone }: { value: number; className?: string; tone?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", tone ?? "brand-gradient")} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted-foreground max-w-md">{children}</div>}
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <hr className={cn("border-border my-4", className)} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full text-sm [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-b [&_tbody_tr:hover]:bg-muted/40", className)} {...props} />
    </div>
  );
}
