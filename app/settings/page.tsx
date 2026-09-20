import { redirect } from "next/navigation";

export default function SettingsPage() {
  redirect("/?tab=positions&edit=1");
}
