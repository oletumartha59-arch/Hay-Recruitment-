import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { WorkforceProvider } from './app/WorkforceContext';
import { AppLayout } from './components/Layout';
import { HomePage } from './pages/Home';
import { EmployeesPage } from './pages/Employees';
import { ExecutiveDashboardPage } from './pages/ExecutiveDashboard';
import { RiskModelsPage } from './pages/RiskModels';
import { RecommendationsPage } from './pages/Recommendations';
import { AssistantPage } from './pages/Assistant';
import { ReportsPage } from './pages/Reports';
import { DataUploadsPage } from './pages/DataUploads';
import { SettingsPage } from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <WorkforceProvider>
        <AppLayout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/dashboard" element={<ExecutiveDashboardPage />} />
            <Route path="/risk" element={<RiskModelsPage />} />
            <Route path="/recommendations" element={<RecommendationsPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/data" element={<DataUploadsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppLayout>
      </WorkforceProvider>
    </BrowserRouter>
  );
}
