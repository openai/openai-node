import React, { useState } from 'react';
import { Menu, X, User, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
import { Language } from '../lib/translations';
interface HeaderProps {
  onLoginClick?: () => void;
}
export function Header({ onLoginClick }: HeaderProps) {
  const { t, language, setLanguage } = useLanguage();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedMobileMenu, setExpandedMobileMenu] = useState<string | null>(
    null
  );
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
  const navItems = [
  {
    label: t('nav_home'),
    href: '/',
    active: true
  },
  {
    label: t('nav_about'),
    href: '#',
    active: false,
    children: [
    {
      label: t('about_dg_message'),
      href: '#'
    },
    {
      label: t('about_general_dept'),
      href: '#'
    },
    {
      label: t('about_infrastructure'),
      href: '#'
    },
    {
      label: t('about_leaders'),
      href: '#'
    },
    {
      label: t('about_admin_dept'),
      href: '#'
    },
    {
      label: t('about_non_immigrant_dept'),
      href: '#'
    },
    {
      label: t('about_immigrant_refugee_dept'),
      href: '#'
    },
    {
      label: t('about_immigrant_investor_dept'),
      href: '#'
    },
    {
      label: t('about_gateway_1'),
      href: '#'
    },
    {
      label: t('about_gateway_2'),
      href: '#'
    },
    {
      label: t('about_investigation_dept'),
      href: '#'
    },
    {
      label: t('about_it_dept'),
      href: '#'
    },
    {
      label: t('about_uyfc'),
      href: '#'
    },
    {
      label: t('about_gender'),
      href: '#'
    },
    {
      label: t('about_sport'),
      href: '#'
    }]

  },
  {
    label: t('nav_services'),
    href: '#',
    active: false,
    children: [
    {
      label: t('service_visa_extension'),
      href: '#'
    },
    {
      label: t('service_residence_permit'),
      href: '#'
    },
    {
      label: t('service_foreign_passport'),
      href: '#'
    },
    {
      label: t('service_citizenship'),
      href: '#'
    },
    {
      label: t('nav_contact'),
      href: '#'
    }]

  },
  {
    label: t('nav_news'),
    href: '/news',
    active: false
  },
  {
    label: t('nav_digital_library'),
    href: '#',
    active: false,
    children: [
    {
      label: t('digital_announcement'),
      href: '#'
    },
    {
      label: t('digital_official_doc'),
      href: '#'
    }]

  }];

  const toggleMobileSubmenu = (label: string) => {
    if (expandedMobileMenu === label) {
      setExpandedMobileMenu(null);
    } else {
      setExpandedMobileMenu(label);
    }
  };
  return (
    <header
      className="w-full shadow-lg relative z-50"
      style={{
        backgroundImage:
        "url('https://cdn.magicpatterns.com/uploads/9cJCDVV4AYU2Cxv9Tr23WL/image.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}>

      {/* Overlay for better text readability */}
      <div
        className="absolute inset-0 bg-[#1B2A4A]/90 mix-blend-multiply pointer-events-none"
        style={{
          backgroundColor: '#83255c'
        }}>
      </div>

      {/* Top Branding Area */}
      <div className="relative container mx-auto px-4 py-4 md:py-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src="/logo-new.png"
              alt="General Department of Immigration Seal"
              className="w-15 h-13 md:w-20 md:h-20 rounded-full object-contain shrink-0 drop-shadow-md" />

            <div className="text-left">
              <h1
                className="text-lg md:text-2xl font-bold text-white leading-tight drop-shadow-sm"
                style={{
                  fontFamily: "'Moul', serif",
                  color: '#feb335'
                }}>

                អគ្គនាយកដ្ឋានអន្តោប្រវេសន៍
              </h1>
              <h2
                className="text-xs md:text-base font-medium text-white/20 uppercase tracking-wide"
                style={{
                  color: '#feb335'
                }}>

                General Department of Immigration
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-label="Toggle menu">

              {isMenuOpen ?
              <X className="w-6 h-6" /> :

              <Menu className="w-6 h-6" />
              }
            </button>
          </div>
        </div>
      </div>

      {/* Scrolling Marquee Ticker */}
      <div className="relative w-full bg-[#1B2A4A] border-t border-white/5"></div>

      {/* Desktop Navigation Bar */}
      <div className="relative hidden md:block border-t border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="container mx-auto px-4">
          <div
            className="flex items-center justify-between"
            style={{
              paddingTop: '1px',
              paddingBottom: '1px'
            }}>

            <nav className="flex items-center">
              <ul className="flex items-center">
                {navItems.map((item) =>
                <li key={item.label} className="relative group">
                    <a
                    href={item.href}
                    className={`flex items-center gap-1 px-4 py-4 text-sm font-medium transition-colors border-b-2 ${item.active ? 'text-[#feb335] border-[#feb335]' : 'text-white border-transparent hover:text-[#feb335] hover:border-[#feb335]/50'}`}>

                      {item.label}
                      {item.children &&
                    <ChevronDown className="w-3.5 h-3.5 mt-0.5" />
                    }
                    </a>

                    {item.children &&
                  <div className="absolute left-0 top-full w-64 bg-white shadow-xl rounded-b-lg overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform origin-top-left z-50">
                        <ul className="py-2">
                          {item.children.map((child, idx) =>
                      <li key={idx}>
                              <a
                          href={child.href}
                          className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#83255c] transition-colors border-l-2 border-transparent hover:border-[#feb335]">

                                {child.label}
                              </a>
                            </li>
                      )}
                        </ul>
                      </div>
                  }
                  </li>
                )}
              </ul>
            </nav>

            {/* Language Selector */}
            <div className="relative ml-4 pl-4 border-l border-white/10">
              <button
                onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                className="flex items-center gap-2 text-sm text-white hover:text-[#feb335] transition-colors py-2">
              </button>

              {isLangMenuOpen &&
              <div className="absolute top-full right-0 mt-2 w-40 bg-white rounded-lg shadow-xl py-1 z-20 animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
                  {languages.map((lang) =>
                <button
                  key={lang.code}
                  onClick={() => {
                    setLanguage(lang.code);
                    setIsLangMenuOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between hover:bg-gray-50 ${language === lang.code ? 'text-[#83255c] font-medium bg-gray-50' : 'text-gray-700'}`}>

                      <div className="flex items-center gap-3">
                        <span className="text-lg">
                          {lang.flag.startsWith('http') ?
                      <img
                        src={lang.flag}
                        alt={lang.label}
                        className="w-5 h-5 rounded-full object-cover inline-block" /> :


                      lang.flag
                      }
                        </span>
                        <span>{lang.label}</span>
                      </div>
                      {language === lang.code &&
                  <Check className="w-3.5 h-3.5" />
                  }
                    </button>
                )}
                </div>
              }
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Dropdown */}
      {isMenuOpen &&
      <div className="relative md:hidden border-t border-white/10 bg-[#1B2A4A] animate-in slide-in-from-top-2 duration-200">
          <nav className="container mx-auto px-4 py-4 max-h-[80vh] overflow-y-auto">
            <ul className="space-y-1">
              {navItems.map((item) =>
            <li
              key={item.label}
              className="border-b border-white/5 last:border-0">

                  {item.children ?
              <div>
                      <button
                  onClick={() => toggleMobileSubmenu(item.label)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${item.active || expandedMobileMenu === item.label ? 'text-[#feb335] font-medium' : 'text-white/90 hover:bg-white/5 hover:text-[#feb335]'}`}>

                        {item.label}
                        <ChevronDown
                    className={`w-4 h-4 transition-transform duration-200 ${expandedMobileMenu === item.label ? 'rotate-180' : ''}`} />

                      </button>

                      {expandedMobileMenu === item.label &&
                <ul className="bg-black/20 rounded-lg mb-2 overflow-hidden">
                          {item.children.map((child, idx) =>
                  <li key={idx}>
                              <a
                      href={child.href}
                      className="block px-8 py-3 text-sm text-white/80 hover:text-[#feb335] hover:bg-white/5 transition-colors border-l-2 border-transparent hover:border-[#feb335]"
                      onClick={() => setIsMenuOpen(false)}>

                                {child.label}
                              </a>
                            </li>
                  )}
                        </ul>
                }
                    </div> :

              <a
                href={item.href}
                className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${item.active ? 'bg-[#feb335]/10 text-[#feb335] font-medium' : 'text-white/90 hover:bg-white/5 hover:text-[#feb335]'}`}
                onClick={() => setIsMenuOpen(false)}>

                      {item.label}
                      {item.active && <ChevronRight className="w-4 h-4" />}
                    </a>
              }
                </li>
            )}

              {/* Mobile Language Selector */}
              <li className="pt-4 mt-2 border-t border-white/10">
                <div className="px-4 pb-2 text-xs font-medium text-white/50 uppercase tracking-wider">
                  Language
                </div>
                <div className="grid grid-cols-3 gap-2 px-4 pb-4">
                  {languages.map((lang) =>
                <button
                  key={lang.code}
                  onClick={() => setLanguage(lang.code)}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg border ${language === lang.code ? 'bg-[#feb335]/20 border-[#feb335] text-[#feb335]' : 'border-white/10 text-white/70 hover:bg-white/5'}`}>

                      <span className="text-xl mb-1">
                        {lang.flag.startsWith('http') ?
                    <img
                      src={lang.flag}
                      alt={lang.label}
                      className="w-6 h-6 rounded-full object-cover inline-block" /> :


                    lang.flag
                    }
                      </span>
                      <span className="text-[10px]">{lang.label}</span>
                    </button>
                )}
                </div>
              </li>

              <li className="pt-2 mt-2 border-t border-white/10">
                <button
                onClick={() => {
                  if (onLoginClick) onLoginClick();
                  setIsMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-white/90 hover:bg-white/5 hover:text-[#feb335] rounded-lg transition-colors text-left">

                  <User className="w-5 h-5" />
                  {t('sign_in')}
                </button>
              </li>
            </ul>
          </nav>
        </div>
      }
    </header>);

}