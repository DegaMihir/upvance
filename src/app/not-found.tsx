import Link from "next/link";
import { brand } from "@/config/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-dvh grid place-items-center p-6 text-center">
      <div className="grid gap-4 justify-items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo.icon} alt="" width={56} height={56} />
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="text-muted-foreground">That page doesn&apos;t exist (or was removed).</p>
        <Button asChild variant="brand">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
