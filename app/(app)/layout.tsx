import { Nav } from "@/components/nav";
import { requireOwner } from "@/lib/session";

// Everything inside (app) needs a valid session; signin and auth stay public.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  return (
    <>
      <main
        className="mx-auto grid max-w-xl gap-3 pt-[max(16px,env(safe-area-inset-top))]"
        style={{
          paddingLeft: "max(16px, env(safe-area-inset-left))",
          paddingRight: "max(16px, env(safe-area-inset-right))",
          paddingBottom: "calc(88px + env(safe-area-inset-bottom))",
        }}
      >
        {children}
      </main>
      <Nav />
    </>
  );
}
