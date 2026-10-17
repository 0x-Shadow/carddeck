import { Suspense } from "react";
import { AuthPanel } from "@/components/auth/AuthPanel";

/** Sign in. `?next=` deep-links back to where the user was headed. */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthPanel mode="login" />
    </Suspense>
  );
}
