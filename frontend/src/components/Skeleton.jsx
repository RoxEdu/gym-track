import { Skeleton } from "./ui/skeleton";

export function CardSkeleton({ className = "" }) {
  return <Skeleton className={`bg-card border border-border rounded-xl ${className}`} data-testid="skeleton-card" />;
}

export function PageSkeleton() {
  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-4" data-testid="page-skeleton">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

export function ListSkeleton({ rows = 6 }) {
  return (
    <div className="space-y-1.5" data-testid="list-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-md" />
      ))}
    </div>
  );
}
