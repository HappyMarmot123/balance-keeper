import { AirQualityWidget } from '../../../widgets/air-quality';
import { DashboardShell } from '../../../widgets/dashboard-shell';
import { DisasterWidget } from '../../../widgets/disaster';
import { EarthquakeWidget } from '../../../widgets/earthquake';
import { KoreaMapWidget } from '../../../widgets/korea-map';
import { MacroWidget } from '../../../widgets/macro';
import { MarketsWidget } from '../../../widgets/markets';
import { NewsWidget } from '../../../widgets/news';
import { WeatherNowcastWidget } from '../../../widgets/weather-nowcast';

export function DashboardPage() {
  return (
    <DashboardShell
      airQualitySlot={<AirQualityWidget />}
      disasterSlot={<DisasterWidget />}
      earthquakeSlot={<EarthquakeWidget />}
      mapSlot={<KoreaMapWidget />}
      macroSlot={<MacroWidget />}
      marketsSlot={<MarketsWidget />}
      newsSlot={<NewsWidget />}
      weatherSlot={<WeatherNowcastWidget />}
    />
  );
}
