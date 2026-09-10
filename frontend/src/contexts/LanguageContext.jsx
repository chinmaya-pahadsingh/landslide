import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, dynamicPatterns } from '../locales/translations';

export const LanguageContext = createContext();

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(() => {
    const stored = localStorage.getItem('ner_lmrs_language');
    if (stored === 'hi' || stored === 'as') return stored;
    return 'en';
  });

  useEffect(() => {
    localStorage.setItem('ner_lmrs_language', language);
    document.documentElement.lang = language;
  }, [language]);

  const t = (key) => {
    if (!key || typeof key !== 'string') return key;
    
    // Default fallback to English (the original keys are in English)
    if (language === 'en') return key;

    const langDict = translations[language];
    if (!langDict) return key;

    // 1. Exact static string match
    if (langDict[key]) {
      return langDict[key];
    }

    // 2. Dynamic pattern match
    for (const pattern of dynamicPatterns) {
      const match = key.match(pattern.regex);
      if (match) {
        const replacer = pattern.replacers[language];
        if (replacer) {
          // match[1...] contains captured groups
          return replacer(...match.slice(1));
        }
      }
    }

    // 3. Fallback: return original key if missing translation
    return key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    return {
      language: 'en',
      setLanguage: () => {},
      t: (key) => key
    };
  }
  return context;
};
