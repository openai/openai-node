import React from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
interface LoginOverlayProps {
  onClose?: () => void;
  onGuestLogin?: () => void;
}
export function LoginOverlay({
  onClose,
  onGuestLogin
}: LoginOverlayProps) {
  const {
    t
  } = useLanguage();
  const handleGuestLogin = () => {
    if (onGuestLogin) {
      onGuestLogin();
    } else if (onClose) {
      onClose();
    }
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* White Card */}
      <div className="relative w-full max-w-[520px] bg-white rounded-xl shadow-2xl flex flex-col items-center">
        {/* Close Button */}
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 transition-colors z-10">
          <X className="w-6 h-6" />
        </button>

        {/* Content */}
        <div className="w-full flex flex-col items-center px-8 md:px-12 py-10">
          {/* Government Seal */}
          <img src="/logo-new.png" alt="General Department of Immigration Seal" className="w-36 h-36 md:w-44 md:h-44 object-contain mb-5" />

          {/* Khmer Title */}
          <h1 className="text-xl md:text-2xl text-center leading-relaxed mb-5" style={{
          fontFamily: "'Moul', serif",
          color: '#D4841C'
        }}>
            {t('department_name')}
          </h1>

          {/* Divider */}
          <div className="w-full h-px bg-gray-800 mb-8"></div>

          {/* Buttons */}
          <div className="w-full space-y-4">
            {/* Guest Login Button */}
            <button onClick={handleGuestLogin} className="w-full py-4 px-6 rounded-full bg-[#3B82F6] hover:bg-[#2563EB] text-white text-lg font-bold transition-colors shadow-md" style={{
            fontFamily: "'Moul', serif"
          }}>
              {t('login_guest')}
            </button>

            {/* Gmail Login Button */}
            <button onClick={onClose} className="w-full py-4 px-6 rounded-full bg-white hover:bg-gray-50 text-gray-700 text-base font-semibold transition-colors shadow-md border border-gray-200 flex items-center justify-center gap-3">
              <svg className="w-6 h-6 shrink-0" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span>{t('login_gmail')}</span>
            </button>
          </div>

          {/* Copyright */}
          <div className="text-center space-y-1 mt-8">
            <p className="text-gray-500 text-xs">{t('copyright_kh')}</p>
            <p className="text-gray-500 text-xs">{t('version')}</p>
          </div>

          {/* App Store Badges */}
          <div className="flex items-center justify-center gap-3 mt-5">
            <a href="#" className="h-11 rounded-lg bg-black hover:opacity-90 transition-opacity px-3 py-1.5 flex items-center gap-2 border border-gray-700">
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
                <path d="M3.61 1.814L13.793 12 3.61 22.186a.996.996 0 01-.61-.92V2.734c0-.384.22-.72.61-.92z" fill="#4285F4" />
                <path d="M17.091 8.702L5.226.834C4.846.605 4.41.55 4.01.66l9.783 9.783 3.298-1.741z" fill="#34A853" />
                <path d="M17.091 15.298L13.793 12l3.298-3.298 3.884 2.05c.66.348.66 1.148 0 1.496l-3.884 2.05z" fill="#FBBC05" />
                <path d="M4.01 23.34c.4.11.836.055 1.216-.174l11.865-7.868-3.298-3.298L4.01 23.34z" fill="#EA4335" />
              </svg>
              <div className="flex flex-col">
                <span className="text-[8px] text-white/70 leading-none uppercase tracking-wider">
                  {t('get_it_on')}
                </span>
                <span className="text-sm text-white font-semibold leading-tight">
                  Google Play
                </span>
              </div>
            </a>

            <a href="#" className="h-11 rounded-lg bg-black hover:opacity-90 transition-opacity px-3 py-1.5 flex items-center gap-2 border border-gray-700">
              <svg className="w-5 h-5 shrink-0 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              <div className="flex flex-col">
                <span className="text-[8px] text-white/70 leading-none">
                  {t('download_on')}
                </span>
                <span className="text-sm text-white font-semibold leading-tight">
                  App Store
                </span>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>;
}