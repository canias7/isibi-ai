import { Search } from "lucide-react";

export function TopNav({ title }: { title: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-700 bg-slate-900 px-6">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search..."
            className="h-9 w-64 rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 text-sm text-slate-300 placeholder:text-slate-500 focus:border-pink-500 focus:outline-none"
          />
        </div>
      </div>
    </header>
  );
}
