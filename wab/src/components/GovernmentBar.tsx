import React, { useState } from 'react';
import { ChevronDown, Globe, User, Check } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
import { Language } from '../lib/translations';
interface GovernmentBarProps {
  onLoginClick?: () => void;
}
export function GovernmentBar({ onLoginClick }: GovernmentBarProps) {
  const { language, setLanguage, t } = useLanguage();
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const languages: {
    code: Language;
    label: string;
    flag: string;
  }[] = [
  {
    code: 'en',
    label: 'English',
    flag: '🇬🇧'
  },
  {
    code: 'km',
    label: 'ភាសាខ្មែរ',
    flag: '🇰🇭'
  },
  {
    code: 'zh',
    label: '中文',
    flag: 'https://firebasestorage.googleapis.com/v0/b/egdi-ecosystem.appspot.com/o/eligibleNationalities%2Fchina.png?alt=media&token=094e6a2b-6af6-430d-9f51-5c74b70882e8'
  }];

  const currentLang = languages.find((l) => l.code === language) || languages[0];
  return (
    <div
      className="py-1.5 border-b border-white/10 relative z-[60]"
      style={{
        backgroundImage:
        "url('https://cdn.magicpatterns.com/uploads/3BNso3gCYRQfUc1KFF3ptw/image.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#000000'
      }}>

      <div className="container mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-white/70" />
          <span className="text-[10px] md:text-xs text-white/80 hidden sm:inline">
            {t('official_website')}
          </span>
          <span className="text-[10px] md:text-xs text-white/80 sm:hidden">
            Official Gov Portal
          </span>

          <div className="relative ml-2">
            <button
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              className="flex items-center gap-1 text-[10px] md:text-xs text-white/90 hover:text-[#feb335] transition-colors px-2 py-0.5 rounded hover:bg-white/10">

              <span className="mr-1">
                {currentLang.flag.startsWith('http') ?
                <img
                  src={currentLang.flag}
                  alt={currentLang.label}
                  className="w-4 h-4 rounded-full object-cover inline-block" /> :


                currentLang.flag
                }
              </span>
              <span>{currentLang.label}</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform ${isLangMenuOpen ? 'rotate-180' : ''}`} />

            </button>

            {isLangMenuOpen &&
            <>
                <div
                className="fixed inset-0 z-10"
                onClick={() => setIsLangMenuOpen(false)}>
              </div>
                <div className="absolute top-full left-0 mt-1 w-32 bg-white rounded shadow-lg py-1 z-20 animate-in fade-in zoom-in-95 duration-100">
                  {languages.map((lang) =>
                <button
                  key={lang.code}
                  onClick={() => {
                    setLanguage(lang.code);
                    setIsLangMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-gray-50 ${language === lang.code ? 'text-[#feb335] font-medium bg-gray-50' : 'text-gray-700'}`}>

                      <div className="flex items-center gap-2">
                        <span>
                          {lang.flag.startsWith('http') ?
                      <img
                        src={lang.flag}
                        alt={lang.label}
                        className="w-4 h-4 rounded-full object-cover inline-block" /> :


                      lang.flag
                      }
                        </span>
                        <span>{lang.label}</span>
                      </div>
                      {language === lang.code && <Check className="w-3 h-3" />}
                    </button>
                )}
                </div>
              </>
            }
          </div>
        </div>

        <button
          onClick={onLoginClick}
          className="flex items-center gap-1.5 text-[10px] md:text-xs text-white/80 hover:text-white transition-colors">

          <User className="w-3.5 h-3.5" />
          <span>{t('sign_in')}</span>
        </button>
      </div>
    </div>);

}