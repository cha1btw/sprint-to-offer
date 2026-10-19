import { signIn } from "@/app/actions";

// The bot's login link opens this page. The token is used only when the button
// is pressed (a POST), so a link preview that opens the URL cannot burn it.
export default async function AuthPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Вход в Спринт</h1>
      {token ? (
        <form action={signIn} className="grid gap-3">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="min-h-12 rounded-xl bg-accent px-4 text-lg font-semibold text-accent-ink">
            Войти
          </button>
          <p className="text-sm text-muted">Ссылка одноразовая. После входа телефон будет помнить тебя 30 дней.</p>
        </form>
      ) : (
        <p className="text-muted">В ссылке нет кода. Отправь боту /login, чтобы получить новую.</p>
      )}
    </main>
  );
}
