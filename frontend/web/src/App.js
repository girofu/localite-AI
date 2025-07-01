import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from 'react-hot-toast';

import { store } from './store/store';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import TourPage from './pages/TourPage';
import MerchantDashboard from './pages/MerchantDashboard';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

import './i18n/i18n';
import './styles/App.css';

const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
});

function App() {
  return (
    <HelmetProvider>
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Router>
            <Layout>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route
                  path="/tour/:tourId"
                  element={
                    <ProtectedRoute>
                      <TourPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/merchant"
                  element={
                    <ProtectedRoute requiredRole="merchant">
                      <MerchantDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<div>404 - Page Not Found</div>} />
              </Routes>
            </Layout>
          </Router>
          <Toaster position="top-right" />
        </ThemeProvider>
      </Provider>
    </HelmetProvider>
  );
}

export default App;
