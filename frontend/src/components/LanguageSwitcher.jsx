import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Globe } from 'lucide-react';
import './LanguageSwitcher.css';

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  const handleLanguageChange = (e) => {
    setLanguage(e.target.value);
  };

  return (
    <div className="language-switcher">
      <Globe size={18} className="lang-icon" />
      <select 
        value={language} 
        onChange={handleLanguageChange}
        className="lang-select"
        aria-label="Select Language"
      >
        <option value="en">English</option>
        <option value="hi">हिंदी (Hindi)</option>
        <option value="as">অসমীয়া (Assamese)</option>
      </select>
    </div>
  );
}
