import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { FoundationPage } from './pages/FoundationPage';
import { HomePage } from './pages/HomePage';
import { CalendarPage } from './pages/CalendarPage';
import { ListsPage } from './pages/ListsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlanPage } from './pages/PlanPage';
import { RoutinesPage } from './pages/RoutinesPage';
import { FocusPage } from './pages/FocusPage';

export function App() {
  return (
    <Routes>
      <Route path="focus/:taskId" element={<FocusPage />} />
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="plan" element={<PlanPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="lists" element={<ListsPage />} />
        <Route path="routines" element={<RoutinesPage />} />
        <Route
          path="insights"
          element={
            <FoundationPage
              eyebrow="Insights"
              title="Notice patterns without judgment"
              description="Descriptive insights are reserved for a later phase. Planibly will never use scores or punitive streaks."
            />
          }
        />
        <Route
          path="settings"
          element={
            <FoundationPage
              eyebrow="Settings"
              title="Make Planibly feel like yours"
              description="Settings controls will be introduced alongside the features they configure."
            />
          }
        />
        <Route path="home" element={<Navigate replace to="/" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
