import Dashboard from "@/app/components/Dashboard";
import { fetchCases, fetchStats, fetchEmergingCompanies, getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

async function fetchTargets() {
  const pool = getPool();
  const res = await pool.query<{ total: number; scanned: number; last_scan: string | null }>(`
    SELECT
      COUNT(*)::int                                            AS total,
      COUNT(*) FILTER (WHERE last_scanned_at IS NOT NULL)::int AS scanned,
      MAX(last_scanned_at)                                     AS last_scan
    FROM target_companies WHERE active = true
  `);
  return res.rows[0];
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [cases, stats, targets, emerging] = await Promise.all([
    fetchCases(),
    fetchStats(),
    fetchTargets(),
    fetchEmergingCompanies(),
  ]);
  return (
    <Dashboard
      initialCases={cases}
      initialStats={stats}
      initialTargets={targets}
      initialEmerging={emerging}
    >
      {children}
    </Dashboard>
  );
}
