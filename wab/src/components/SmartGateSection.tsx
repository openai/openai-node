import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
type Region = 'ASEAN' | 'Asia' | 'Americas' | 'Oceania' | 'Europe';
type Country = {
  name: string;
  flag: string;
};
const countryData: Record<Region, Country[]> = {
  ASEAN: [
  {
    name: 'Cambodia',
    flag: '🇰🇭'
  },
  {
    name: 'Indonesia',
    flag: '🇮🇩'
  },
  {
    name: 'Malaysia',
    flag: '🇲🇾'
  },
  {
    name: 'Singapore',
    flag: '🇸🇬'
  },
  {
    name: 'Laos',
    flag: '🇱🇦'
  },
  {
    name: 'Philippines',
    flag: '🇵🇭'
  },
  {
    name: 'Vietnam',
    flag: '🇻🇳'
  },
  {
    name: 'Thailand',
    flag: '🇹🇭'
  },
  {
    name: 'Myanmar',
    flag: '🇲🇲'
  },
  {
    name: 'Brunei Darussalam',
    flag: '🇧🇳'
  }],

  Asia: [
  {
    name: 'China',
    flag: '🇨🇳'
  },
  {
    name: 'Japan',
    flag: '🇯🇵'
  },
  {
    name: 'Macao SAR',
    flag: '🇲🇴'
  },
  {
    name: 'Republic of Korea (South Korea)',
    flag: '🇰🇷'
  },
  {
    name: 'Hong Kong SAR',
    flag: '🇭🇰'
  }],

  Americas: [
  {
    name: 'USA',
    flag: '🇺🇸'
  }],

  Oceania: [
  {
    name: 'Australia',
    flag: '🇦🇺'
  }],

  Europe: [
  {
    name: 'France',
    flag: '🇫🇷'
  },
  {
    name: 'Germany',
    flag: '🇩🇪'
  },
  {
    name: 'United Kingdom',
    flag: '🇬🇧'
  }]

};
export function SmartGateSection() {
  const { t } = useLanguage();
  const getRegionName = (region: Region) => {
    switch (region) {
      case 'ASEAN':
        return t('region_asean');
      case 'Asia':
        return t('region_asia');
      case 'Americas':
        return t('region_americas');
      case 'Oceania':
        return t('region_oceania');
      case 'Europe':
        return t('region_europe');
      default:
        return region;
    }
  };
  const RegionBlock = ({
    region,
    className = ''



  }: {region: Region;className?: string;}) =>
  <div className={`flex flex-col ${className}`}>
      <h2 className="text-xl font-bold text-[#1B2A4A] mb-4">
        {getRegionName(region)}
      </h2>
      <div className="flex flex-wrap gap-3">
        {countryData[region].map((country) =>
      <div
        key={country.name}
        className="flex items-center gap-3 bg-white px-4 py-3 rounded-lg shadow-sm border border-gray-100 min-w-[180px]">

            <span
          className="text-2xl"
          role="img"
          aria-label={`Flag of ${country.name}`}>

              {country.flag}
            </span>
            <span className="font-medium text-[#1B2A4A] text-sm md:text-base">
              {country.name}
            </span>
          </div>
      )}
      </div>
    </div>;

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#D4841C] mb-6 leading-tight">
            {t('smartgate_title')}
          </h2>
        </div>

        {/* Content Wrapper */}
        <div className="bg-gray-50 rounded-2xl p-6 md:p-10 border border-gray-100 shadow-inner">
          {/* Top Row: ASEAN + Asia */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-12 mb-12">
            {/* ASEAN takes 2/3 width on large screens */}
            <RegionBlock region="ASEAN" className="lg:col-span-2" />

            {/* Asia takes 1/3 width on large screens */}
            <RegionBlock region="Asia" className="lg:col-span-1" />
          </div>

          {/* Bottom Row: Americas + Oceania + Europe */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            <RegionBlock region="Americas" />
            <RegionBlock region="Oceania" />
            <RegionBlock region="Europe" />
          </div>

          {/* Footer Note */}
          <div className="mt-12 pt-6 border-t border-gray-200 flex items-center justify-center gap-2 text-sm text-gray-500">
            <CheckCircle2 className="w-4 h-4 text-[#D4841C]" />
            <span>{t('smartgate_requirement')}</span>
          </div>
        </div>
      </div>
    </section>);

}