import React, { useState, createContext, useContext } from 'react';
import { translations, Language } from './translations';
interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof typeof translations) => string;
}
const LanguageContext = createContext<LanguageContextType | undefined>(undefined);
export function LanguageProvider({
  children


}: {children: ReactNode;}) {
  const [language, setLanguage] = useState<Language>('km');
  const t = (key: keyof typeof translations) => {
    const translation = translations[key];
    if (!translation) {
      console.warn(`Translation key "${key}" not found.`);
      return key;
    }
    return translation[language] || translation['en'];
  };
  return <LanguageContext.Provider value={{
    language,
    setLanguage,
    t
  }}>
      {children}
    </LanguageContext.Provider>;
}
export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}