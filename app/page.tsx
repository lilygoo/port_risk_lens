import { Dashboard } from "@/components/dashboard";
import { loadPortfolio } from "@/lib/data";
import { localPortfolio, withLocalSupportedSecurities } from "@/lib/local-data";
import { loadFileUniverse } from "@/lib/universe-file";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string }> }) {
  const params = await searchParams;
  const activeTab = params.tab === "supported" ? "supported" as const : "positions" as const;
  const initialEdit = params.edit === "1";
  if (!isSupabaseConfigured()) {
    if (process.env.VERCEL) {
      return <main className="setup-required"><h1>Portfolio Risk Lens</h1><p>Supabase environment variables are required before this private dashboard can run.</p></main>;
    }
    return <Dashboard initialPortfolio={withLocalSupportedSecurities(localPortfolio, await loadFileUniverse())} activeTab={activeTab} initialEdit={initialEdit} />;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <Dashboard initialPortfolio={await loadPortfolio(user.id)} authenticated activeTab={activeTab} initialEdit={initialEdit} />;
}
