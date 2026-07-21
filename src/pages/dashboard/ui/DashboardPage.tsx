import { DashboardShell } from '../../../widgets/dashboard-shell';
import { KoreaMapWidget } from '../../../widgets/korea-map';

export function DashboardPage() {
  return <DashboardShell mapSlot={<KoreaMapWidget />} />;
}
