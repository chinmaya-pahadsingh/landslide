import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import Dashboard from './pages/Dashboard';
import RiskMap from './pages/RiskMap';
import FieldReports from './pages/FieldReports';
import Alerts from './pages/Alerts';
import News from './pages/News';
import { LanguageProvider } from './contexts/LanguageContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <NetworkProvider>
          <LanguageProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<AppLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="map" element={<RiskMap key="map" />} />
                  <Route path="area-intelligence" element={<RiskMap key="area-intelligence" />} />
                  <Route path="reports" element={<FieldReports />} />
                  <Route path="alerts" element={<Alerts />} />
                  <Route path="news" element={<News />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </LanguageProvider>
        </NetworkProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
