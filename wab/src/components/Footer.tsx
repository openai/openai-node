import React from 'react';
import { MapPin, Phone, Mail, Facebook, Twitter, Youtube, Globe } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
export function Footer() {
  const {
    t
  } = useLanguage();
  return <footer className="bg-[#1B2A4A] text-white pt-16 pb-8">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          {/* Column 1: About */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <img src="/logo-new.png" alt="General Department of Immigration Seal" className="w-12 h-12 rounded-full object-contain" />
              <div>
                <h3 className="font-bold text-lg leading-tight">
                  {t('department_name').split(' ').slice(0, 2).join(' ')}
                  <br />
                  {t('department_name').split(' ').slice(2).join(' ')}
                </h3>
              </div>
            </div>
            <p className="text-gray-300 text-sm leading-relaxed">
              {t('footer_desc')}
            </p>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#D4841C] transition-colors">
                <Facebook className="w-5 h-5" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#D4841C] transition-colors">
                <Twitter className="w-5 h-5" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#D4841C] transition-colors">
                <Youtube className="w-5 h-5" />
              </a>
            </div>
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h4 className="text-lg font-bold mb-6 text-[#D4841C]">
              {t('quick_links')}
            </h4>
            <ul className="space-y-3">
              {[t('nav_about'), t('service_visa_title'), t('nav_legal'), t('nav_services'), t('nav_news'), t('nav_contact')].map((item) => <li key={item}>
                  <a href="#" className="text-gray-300 hover:text-[#D4841C] transition-colors text-sm flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#D4841C]"></span>
                    {item}
                  </a>
                </li>)}
            </ul>
          </div>

          {/* Column 3: Services */}
          <div>
            <h4 className="text-lg font-bold mb-6 text-[#D4841C]">
              {t('e_services')}
            </h4>
            <ul className="space-y-3">
              {['e-Visa Application', 'Foreigners Present in Cambodia System', 'Non-Immigrant Visa Extension', 'Exit Visa', 'Refugee Travel Document'].map((item) => <li key={item}>
                  <a href="#" className="text-gray-300 hover:text-[#D4841C] transition-colors text-sm flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#D4841C]"></span>
                    {item}
                  </a>
                </li>)}
            </ul>
          </div>

          {/* Column 4: Contact */}
          <div>
            <h4 className="text-lg font-bold mb-6 text-[#D4841C]">
              {t('contact_info')}
            </h4>
            <ul className="space-y-4">
              <li className="flex items-start gap-3 text-sm text-gray-300">
                <MapPin className="w-5 h-5 text-[#D4841C] shrink-0 mt-0.5" />
                <span>
                  No. 322, Russian Federation Blvd, <br />
                  Phnom Penh, Cambodia
                </span>
              </li>
              <li className="flex items-center gap-3 text-sm text-gray-300">
                <Phone className="w-5 h-5 text-[#D4841C] shrink-0" />
                <span>+855 23 890 380</span>
              </li>
              <li className="flex items-center gap-3 text-sm text-gray-300">
                <Mail className="w-5 h-5 text-[#D4841C] shrink-0" />
                <span>info@immigration.gov.kh</span>
              </li>
              <li className="flex items-center gap-3 text-sm text-gray-300">
                <Globe className="w-5 h-5 text-[#D4841C] shrink-0" />
                <span>www.immigration.gov.kh</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-white/10 pt-8 mt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-gray-400">
          <p>{t('copyright_kh')}</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white transition-colors">
              {t('privacy_policy')}
            </a>
            <a href="#" className="hover:text-white transition-colors">
              {t('terms_of_use')}
            </a>
            <a href="#" className="hover:text-white transition-colors">
              {t('sitemap')}
            </a>
          </div>
        </div>
      </div>
    </footer>;
}