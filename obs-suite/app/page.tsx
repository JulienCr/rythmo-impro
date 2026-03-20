import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-col items-center justify-center gap-8 p-8">
        <h1 className="text-4xl font-bold text-black dark:text-zinc-50">
          Suite OBS
        </h1>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Link
            href="/controller"
            className="flex h-14 w-48 items-center justify-center rounded-lg bg-blue-600 px-6 text-lg font-medium text-white transition-colors hover:bg-blue-700"
          >
            Contrôleur
          </Link>
          <Link
            href="/overlay/rythmo"
            className="flex h-14 w-48 items-center justify-center rounded-lg bg-green-600 px-6 text-lg font-medium text-white transition-colors hover:bg-green-700"
          >
            Incrustation
          </Link>
        </div>
      </main>
    </div>
  );
}
