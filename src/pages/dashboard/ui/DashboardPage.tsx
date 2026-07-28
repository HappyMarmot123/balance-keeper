import { DashboardShell } from '../../../widgets/dashboard-shell';
import { KoreaMapWidget } from '../../../widgets/korea-map';
import { WeatherNowcastWidget } from '../../../widgets/weather-nowcast';

export function DashboardPage() {
  return <DashboardShell mapSlot={<KoreaMapWidget />} weatherSlot={<WeatherNowcastWidget />} />;
}
