import { AirQualityWidget } from '../../../widgets/air-quality';
import { DashboardShell } from '../../../widgets/dashboard-shell';
import { EarthquakeWidget } from '../../../widgets/earthquake';
import { KoreaMapWidget } from '../../../widgets/korea-map';
import { WeatherNowcastWidget } from '../../../widgets/weather-nowcast';

export function DashboardPage() {
  return (
    <DashboardShell
      airQualitySlot={<AirQualityWidget />}
      earthquakeSlot={<EarthquakeWidget />}
      mapSlot={<KoreaMapWidget />}
      weatherSlot={<WeatherNowcastWidget />}
    />
  );
}
