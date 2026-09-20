"use client";

import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const response = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(body.message ?? "If this email is authorized, a sign-in link is on its way.");
    setPending(false);
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label><span>Email</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Sending…" : "Send sign-in link"}</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
