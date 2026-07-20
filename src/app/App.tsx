import { DashboardPage } from '../pages/dashboard';
import { AppProviders } from './providers/AppProviders';

export function App() {
  return (
    <AppProviders>
      <DashboardPage />
    </AppProviders>
  );
}
