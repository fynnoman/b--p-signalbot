import { createContext, useContext } from "react";
import type { DashboardContextValue } from "./types";

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const v = useContext(DashboardContext);
  if (!v) throw new Error("useDashboard must be used inside <Dashboard>");
  return v;
}
