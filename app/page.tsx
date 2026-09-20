import { Dashboard } from "@/components/dashboard";
import { loadPortfolio } from "@/lib/data";
import { localPortfolio, withLocalSupportedSecurities } from "@/lib/local-data";
import { loadFileUniverse } from "@/lib/universe-file";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string }> }) {
  const params = await searchParams;
  const activeTab = params.tab === "supported" ? "supported" as const : "positions" as const;
  const initialEdit = params.edit === "1";
  if (isSupabaseConfigured()) {
    return <Dashboard initialPortfolio={await loadPortfolio()} persistent activeTab={activeTab} initialEdit={initialEdit} />;
  }
  return <Dashboard initialPortfolio={withLocalSupportedSecurities(localPortfolio, await loadFileUniverse())} activeTab={activeTab} initialEdit={initialEdit} />;
}
