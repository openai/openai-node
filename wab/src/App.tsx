import React, { useState } from 'react';
import { GovernmentBar } from './components/GovernmentBar';
import { Header } from './components/Header';
import { AnnouncementBanner } from './components/AnnouncementBanner';
import { FeaturedNewsSection } from './components/FeaturedNewsSection';
import { ServiceCards } from './components/ServiceCards';
import { SmartGateSection } from './components/SmartGateSection';
import { NewsSection } from './components/NewsSection';
import { Footer } from './components/Footer';
import { LoginOverlay } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ComplaintFormPage } from './pages/ComplaintFormPage';
import { QuestionFormPage } from './pages/QuestionFormPage';
import { LanguageProvider } from './lib/LanguageContext';
function AppContent() {
  const [showLogin, setShowLogin] = useState(true);
  const [currentPage, setCurrentPage] = useState<
    'home' | 'dashboard' | 'complaint' | 'question'>(
    'home');
  const handleGuestLogin = () => {
    setCurrentPage('dashboard');
    setShowLogin(false);
  };
  if (currentPage === 'complaint') {
    return <ComplaintFormPage onBack={() => setCurrentPage('dashboard')} />;
  }
  if (currentPage === 'question') {
    return <QuestionFormPage onBack={() => setCurrentPage('dashboard')} />;
  }
  if (currentPage === 'dashboard') {
    return (
      <DashboardPage
        onNavigateToComplaint={() => setCurrentPage('complaint')}
        onNavigateToQuestion={() => setCurrentPage('question')} />);


  }
  return (
    <div className="font-sans min-h-screen flex flex-col bg-white">
      <GovernmentBar onLoginClick={() => setShowLogin(true)} />
      <Header onLoginClick={() => setShowLogin(true)} />
      <AnnouncementBanner />
      <main className="flex-grow">
        <FeaturedNewsSection />
        <ServiceCards />
        <SmartGateSection />
        <NewsSection />
      </main>
      <Footer />

      {/* Login Overlay */}
      {showLogin &&
      <LoginOverlay
        onClose={() => setShowLogin(false)}
        onGuestLogin={handleGuestLogin} />

      }
    </div>);

}
export function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>);

}