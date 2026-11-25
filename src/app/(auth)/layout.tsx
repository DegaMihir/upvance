import { brand } from "@/config/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between brand-gradient p-10 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo.icon} alt="" width={48} height={48} className="rounded-xl ring-2 ring-white/30" />
        <div className="max-w-md">
          <h2 className="text-4xl font-extrabold tracking-tight">{brand.tagline}</h2>
          <p className="mt-4 text-white/85 leading-relaxed">
            Honest job matching for international candidates: visa-aware eligibility, truthful tailored resumes, and applications that only go out when you approve them.
          </p>
        </div>
        <p className="text-sm text-white/70">Runs on your computer. Your data stays local.</p>
      </div>
      <div className="flex items-center justify-center p-6">{children}</div>
    </div>
  );
}
