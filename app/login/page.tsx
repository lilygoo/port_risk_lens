import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <p className="eyebrow">PRIVATE ACCESS</p>
        <h1>Portfolio Risk Lens</h1>
        <p>Enter the portfolio owner email to receive a secure sign-in link.</p>
        <LoginForm />
      </section>
    </main>
  );
}
