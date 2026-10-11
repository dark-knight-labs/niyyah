"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login } from "@/lib/auth";
import { AuthSheet } from "@/components/auth/auth-sheet";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/");
    } catch {
      setError("Invalid email or password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthSheet eyebrow="Sign in / your notebook" title={<>Your day is <span>waiting.</span></>} lead="Sign in to open today's plan, the ring and your progress. Your data stays in your own account." facts={[["Account","Per user"],["Transport","TLS"]]} alt={<>No account? <Link href="/register">Register</Link></>}>
      <form onSubmit={handleSubmit}>
        {error && <p className="sheet-err" role="alert">{error}</p>}
        <div className="sheet-field"><label className="mono" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="sheet-field"><label className="mono" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <button type="submit" disabled={loading} className="sheet-go mono"><span>{loading ? "Signing in..." : "Sign in"}</span><span aria-hidden="true">→</span></button>
      </form>
    </AuthSheet>
  );
}
