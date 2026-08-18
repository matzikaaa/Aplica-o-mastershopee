import { MetricCardSkeleton, TableSkeleton } from "@/components/ui/skeleton";

/** Shown automatically by Next.js while a dashboard page's server data is loading (§43, §90). */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}
