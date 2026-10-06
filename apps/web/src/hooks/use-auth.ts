"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

interface User {
  id: number;
  email: string;
  timezone: string;
  locale: string;
  subscription_tier: string;
}

/** `required: false` lets public pages load without a session (no redirect to /login). */
export function useAuth(required = true) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setLoading(false);
      if (required) router.push("/login");
      return;
    }
    api.get<User>("/auth/me")
      .then(setUser)
      .catch((err: { status?: number }) => {
        // Only a rejected session sends the owner to /login; a server hiccup keeps the stored tokens.
        if (required && (err.status === 401 || !localStorage.getItem("access_token"))) router.push("/login");
      })
      .finally(() => setLoading(false));
  }, [router, required]);

  return { user, loading };
}
