const ERRORS: Record<string, string> = {
  link: "Ссылка уже использована или устарела. Попроси у бота новую.",
  config: "На сервере не настроен SESSION_SECRET (нужно 32+ символа).",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Спринт</h1>
      <p>Это личное приложение. Чтобы войти, отправь своему боту в Telegram команду <b>/login</b> и открой ссылку из ответа.</p>
      {error && ERRORS[error] && (
        <p role="alert" className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
          {ERRORS[error]}
        </p>
      )}
    </main>
  );
}
