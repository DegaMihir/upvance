import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-xs placeholder:text-muted-foreground disabled:opacity-50 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground disabled:opacity-50 aria-[invalid=true]:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-xs disabled:opacity-50", className)}
      {...props}
    />
  );
}

export function Checkbox({ className, label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-3 text-sm cursor-pointer", className)}>
      <input type="checkbox" className="mt-0.5 size-4 rounded border-input accent-[var(--color-primary)]" {...props} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-muted-foreground text-xs mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

export function Field({ label, htmlFor, hint, error, missing, children, className }: { label: string; htmlFor?: string; hint?: string; error?: string; missing?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className={missing ? "text-destructive" : undefined}>
        {label}
        {missing && <span className="ml-1 text-xs font-normal">(required – missing)</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
