import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3", {
  variants: {
    variant: {
      default: "border-transparent bg-primary/10 text-primary dark:bg-primary/20",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      outline: "text-foreground",
      success: "border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
      warning: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
      danger: "border-transparent bg-red-500/12 text-red-700 dark:text-red-300",
      info: "border-transparent bg-blue-500/12 text-blue-700 dark:text-blue-300",
      muted: "border-transparent bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;
