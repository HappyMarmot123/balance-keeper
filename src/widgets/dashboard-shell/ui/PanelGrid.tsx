import type { ComponentChildren } from 'preact';

export type PanelGridSlotProps = {
  airQualitySlot: ComponentChildren;
  disasterSlot: ComponentChildren;
  earthquakeSlot: ComponentChildren;
  forecastSlot: ComponentChildren;
  macroSlot: ComponentChildren;
  marketsSlot: ComponentChildren;
  newsSlot: ComponentChildren;
  regionalContextSlot: ComponentChildren;
  weatherSlot: ComponentChildren;
};

export function PanelGrid({
  airQualitySlot,
  disasterSlot,
  earthquakeSlot,
  forecastSlot,
  macroSlot,
  marketsSlot,
  newsSlot,
  regionalContextSlot,
  weatherSlot,
}: PanelGridSlotProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {weatherSlot}
      {forecastSlot}
      {airQualitySlot}
      {earthquakeSlot}
      {disasterSlot}
      {macroSlot}
      {marketsSlot}
      {newsSlot}
      {regionalContextSlot}
    </div>
  );
}
