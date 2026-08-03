import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { KOREA_MAP_LAYER_REGISTRY, type KoreaMapLayerId } from '../../src/widgets/korea-map/model/mapLayerRegistry';
import { MapLayerControls } from '../../src/widgets/korea-map/ui/MapLayerControls';

const selectedLayers = new Set<KoreaMapLayerId>(['cctv', 'earthquakes']);

describe('MapLayerControls', () => {
  it('announces the selected count and exposes every registry layer as a controlled pressed button', () => {
    const onToggle = vi.fn();
    render(<MapLayerControls activeLayerIds={selectedLayers} onReset={vi.fn()} onToggle={onToggle} />);

    const trigger = screen.getByRole('button', { name: /지도 레이어.*2/u });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain(`2/${KOREA_MAP_LAYER_REGISTRY.length}`);

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    for (const layer of KOREA_MAP_LAYER_REGISTRY) {
      const toggle = screen.getByRole('button', { name: layer.label });
      expect(toggle.getAttribute('aria-pressed')).toBe(String(selectedLayers.has(layer.id)));
    }

    fireEvent.click(screen.getByRole('button', { name: '도로전광표지' }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledWith('vms');
  });

  it('offers the whole-country reset action without owning reset state', () => {
    const onReset = vi.fn();
    render(<MapLayerControls activeLayerIds={new Set()} onReset={onReset} onToggle={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /지도 레이어/u }));
    fireEvent.click(screen.getByRole('button', { name: '대한민국 전체 보기' }));

    expect(onReset).toHaveBeenCalledOnce();
  });

  it('closes on Escape and returns focus while allowing focus to leave the compact menu', () => {
    render(
      <div>
        <MapLayerControls activeLayerIds={new Set()} onReset={vi.fn()} onToggle={vi.fn()} />
        <button type="button">지도 밖 동작</button>
      </div>,
    );

    const trigger = screen.getByRole('button', { name: /지도 레이어/u });
    fireEvent.click(trigger);

    const outsideAction = screen.getByRole('button', { name: '지도 밖 동작' });
    outsideAction.focus();
    expect(document.activeElement).toBe(outsideAction);

    const firstLayer = screen.getByRole('button', { name: KOREA_MAP_LAYER_REGISTRY[0].label });
    firstLayer.focus();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('button', { name: KOREA_MAP_LAYER_REGISTRY[0].label })).toBeNull();
  });

  it('closes when a pointer action moves to the map rail without stealing the new focus target', () => {
    render(
      <div>
        <MapLayerControls activeLayerIds={new Set()} onReset={vi.fn()} onToggle={vi.fn()} />
        <button type="button">지도 데이터 항목</button>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: /지도 레이어/u });
    const outsideAction = screen.getByRole('button', { name: '지도 데이터 항목' });
    fireEvent.click(trigger);

    fireEvent.pointerDown(outsideAction);
    outsideAction.focus();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outsideAction);
  });
});
