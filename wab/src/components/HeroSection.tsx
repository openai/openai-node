import React from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
export function HeroSection() {
  const {
    t
  } = useLanguage();
  return <section className="relative w-full h-[500px] md:h-[600px] bg-[#83255c] overflow-hidden">
      {/* Background Image Placeholder with Gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#83255c] to-[#a03070]">
        {/* Abstract shapes to simulate Angkor Wat silhouette */}
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-[#521414] opacity-30" style={{
        clipPath: 'polygon(0% 100%, 10% 80%, 20% 100%, 30% 60%, 40% 100%, 50% 40%, 60% 100%, 70% 70%, 80% 100%, 90% 80%, 100% 100%)'
      }}></div>
        <div className="absolute bottom-0 left-0 right-0 h-full bg-[url('https://images.unsplash.com/photo-1560251180-1a0b93970379?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center mix-blend-overlay opacity-40"></div>
      </div>

      {/* Overlay Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#83255c] via-[#83255c]/60 to-transparent"></div>

      {/* Content */}
      <div className="relative container mx-auto px-4 h-full flex flex-col justify-center items-start pt-10">
        <div className="max-w-2xl space-y-6 animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#feb335]/20 border border-[#feb335]/40 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-[#feb335]"></span>
            <span className="text-[#feb335] text-xs md:text-sm font-medium uppercase tracking-wider">
              {t('hero_official_portal')}
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
            {t('hero_welcome')} <br />
            <span className="text-[#feb335]">
              {t('hero_immigration_services')}
            </span>
          </h1>

          <p className="text-lg md:text-xl text-gray-200 max-w-xl leading-relaxed">
            {t('hero_description')}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <button className="group px-8 py-4 bg-[#feb335] hover:bg-[#e5a02f] text-[#521414] font-semibold rounded-lg shadow-lg shadow-[#feb335]/20 transition-all duration-300 flex items-center justify-center gap-2">
              {t('hero_apply_visa')}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <button className="px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white font-semibold rounded-lg border border-white/20 transition-all duration-300 flex items-center justify-center gap-2">
              {t('hero_check_status')}
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom decorative bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#feb335] via-[#f4dec0] to-[#feb335]"></div>
    </section>;
}