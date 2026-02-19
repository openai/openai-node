import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
export function AnnouncementBanner() {
  const { t } = useLanguage();
  return (
    <div
      className="w-full"
      style={{
        background: 'linear-gradient(to right, #E5792A, #F5A623)'
      }}>

      <a
        href="https://arrival.gov.kh/"
        target="_blank"
        rel="noopener noreferrer"
        className="container mx-auto px-4 py-3 flex items-center justify-center gap-2 group">

        <span className="text-white text-sm md:text-base font-medium text-center">
          {t('banner_earrival')}{' '}
          <span className="font-bold text-lg md:text-2xl align-middle">
            {t('banner_submission_free')}
          </span>
        </span>
        <ChevronRight className="w-5 h-5 md:w-6 md:h-6 text-white shrink-0 group-hover:translate-x-1 transition-transform" />
      </a>
    </div>);

}