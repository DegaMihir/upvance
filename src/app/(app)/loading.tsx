export default function Loading() {
  return (
    <div className="grid gap-4 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="h-4 w-96 max-w-full rounded-md bg-muted" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-muted" />
    </div>
  );
}
