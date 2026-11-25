"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid gap-4 max-w-xl">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <Alert variant="danger" title="Error">
        {error.message || "An unexpected error happened."}
      </Alert>
      <p className="text-sm text-muted-foreground">Your data is safe. Try again – if it keeps happening, check the terminal window where Upvance is running.</p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
