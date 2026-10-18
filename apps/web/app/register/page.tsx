import { Suspense } from "react";
import { AuthPanel } from "@/components/auth/AuthPanel";

/** Create an account. `?next=` deep-links back to where the user was headed. */
export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <AuthPanel mode="register" />
    </Suspense>
  );
}
