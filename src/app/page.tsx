import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50 flex items-center justify-center px-6">
      <div className="w-full max-w-3xl text-center">
        <p className="text-indigo-400 text-sm font-semibold tracking-[0.18em] uppercase">Contextual growth for SaaS</p>
        <h1 className="mt-5 text-5xl md:text-7xl font-extrabold tracking-tight">Put your SaaS moments to work.</h1>
        <p className="mt-6 text-lg md:text-xl text-neutral-400 max-w-2xl mx-auto">
          Add one script, then call <code className="text-neutral-200">{`show_ads(&quot;your_moment&quot;)`}</code> wherever you want a contextual offer to appear.
        </p>
        <Link href="/activate" className="inline-flex mt-10 items-center justify-center rounded-2xl bg-indigo-600 hover:bg-indigo-500 px-7 py-4 font-semibold transition-colors">
          Set up publisher
        </Link>
        <p className="mt-5 text-sm text-neutral-500">No SDK. No crawling. No AI analysis.</p>
      </div>
    </main>
  );
}
