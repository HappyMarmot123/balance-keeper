import { render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import type {
  KoreaMapGeometryFeature,
  KoreaMapGeometryLayer,
  KoreaMapLayerReplaceResult,
  KoreaMapPoint,
  KoreaMapPointLayer,
  KoreaMapSession,
} from '../../src/entities/map';
import { MapGeometryLayerOverlay, MapPointLayerOverlay } from '../../src/widgets/korea-map/ui/MapLayerOverlay';

function layerFixture() {
  const pointLayer = {
    destroy: vi.fn(),
    replace: vi.fn(
      (items: readonly KoreaMapPoint[]): KoreaMapLayerReplaceResult => ({
        overlayCount: items.length,
        status: 'replaced',
      }),
    ),
    select: vi.fn(),
  } satisfies KoreaMapPointLayer;
  const geometryLayer = {
    destroy: vi.fn(),
    replace: vi.fn(
      (items: readonly KoreaMapGeometryFeature[]): KoreaMapLayerReplaceResult => ({
        overlayCount: items.length,
        status: 'replaced',
      }),
    ),
    select: vi.fn(),
  } satisfies KoreaMapGeometryLayer;
  const createPointLayer = vi.fn((_options: Readonly<{ onSelect: (id: string) => void }>) => pointLayer);
  const createGeometryLayer = vi.fn((_options: Readonly<{ onSelect: (id: string) => void }>) => geometryLayer);
  const session = {
    createGeometryLayer,
    createPointLayer,
    destroy: vi.fn(),
    ready: Promise.resolve(),
    resetView: vi.fn(),
    subscribeViewport: vi.fn(() => vi.fn()),
  } satisfies KoreaMapSession;

  return { createGeometryLayer, createPointLayer, geometryLayer, pointLayer, session };
}

describe('MapLayerOverlay', () => {
  it('keeps one point layer controlled by item, selection, and current selection callback props', async () => {
    const firstItems = [
      {
        accessibleName: '서울 관측점 자세히 보기',
        id: 'point-seoul',
        keyboardAccessible: true,
        latitude: 37.56,
        longitude: 126.97,
      },
    ] satisfies readonly KoreaMapPoint[];
    const nextItems = [
      ...firstItems,
      {
        accessibleName: '부산 관측점 자세히 보기',
        id: 'point-busan',
        latitude: 35.18,
        longitude: 129.08,
      },
    ] satisfies readonly KoreaMapPoint[];
    const firstOnSelect = vi.fn();
    const nextOnSelect = vi.fn();
    const { createPointLayer, pointLayer, session } = layerFixture();
    const view = render(
      <MapPointLayerOverlay
        items={firstItems}
        keyboardAccessible={false}
        onSelect={firstOnSelect}
        selectedId="point-seoul"
        session={session}
      />,
    );

    await waitFor(() => expect(pointLayer.replace).toHaveBeenCalledOnce());
    expect(createPointLayer).toHaveBeenCalledOnce();
    expect(pointLayer.replace).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'point-seoul', keyboardAccessible: false }),
    ]);
    expect(pointLayer.select).toHaveBeenLastCalledWith('point-seoul');
    createPointLayer.mock.calls[0]?.[0]?.onSelect('point-seoul');
    expect(firstOnSelect).toHaveBeenCalledWith('point-seoul');

    view.rerender(
      <MapPointLayerOverlay
        items={nextItems}
        keyboardAccessible={false}
        onSelect={nextOnSelect}
        selectedId="point-busan"
        session={session}
      />,
    );

    await waitFor(() => expect(pointLayer.replace).toHaveBeenCalledTimes(2));
    expect(createPointLayer).toHaveBeenCalledOnce();
    expect(pointLayer.replace.mock.lastCall?.[0]).toHaveLength(2);
    expect(pointLayer.select).toHaveBeenLastCalledWith('point-busan');
    createPointLayer.mock.calls[0]?.[0]?.onSelect('point-busan');
    expect(nextOnSelect).toHaveBeenCalledWith('point-busan');

    view.unmount();
    expect(pointLayer.destroy).toHaveBeenCalledOnce();
  });

  it('forwards every point to the session and reports a budget rejection without slicing', async () => {
    const items = Array.from({ length: 241 }, (_, index) => ({
      accessibleName: `관측점 ${index} 자세히 보기`,
      id: `point-${index}`,
      latitude: 37,
      longitude: 127,
    })) satisfies readonly KoreaMapPoint[];
    const onRejected = vi.fn();
    const { pointLayer, session } = layerFixture();
    pointLayer.replace.mockImplementation(() => ({
      overlayCount: 0,
      reason: 'POINT_BUDGET_EXCEEDED',
      status: 'rejected',
    }));

    render(<MapPointLayerOverlay items={items} onRejected={onRejected} onSelect={vi.fn()} session={session} />);

    await waitFor(() => expect(onRejected).toHaveBeenCalledWith('POINT_BUDGET_EXCEEDED'));
    expect(pointLayer.replace.mock.lastCall?.[0]).toHaveLength(241);
    expect(pointLayer.replace.mock.lastCall?.[0]?.at(-1)?.id).toBe('point-240');
  });

  it('reports a later accepted replacement so a prior render rejection can be cleared', async () => {
    const firstItems = [
      { accessibleName: '첫 관측점', id: 'point-a', latitude: 37, longitude: 127 },
    ] satisfies readonly KoreaMapPoint[];
    const nextItems = [
      { accessibleName: '다음 관측점', id: 'point-b', latitude: 37.1, longitude: 127.1 },
    ] satisfies readonly KoreaMapPoint[];
    const onAccepted = vi.fn();
    const onRejected = vi.fn();
    const { pointLayer, session } = layerFixture();
    pointLayer.replace
      .mockReturnValueOnce({ overlayCount: 0, reason: 'RENDER_FAILED', status: 'rejected' })
      .mockReturnValueOnce({ overlayCount: 1, status: 'replaced' });
    const view = render(
      <MapPointLayerOverlay
        items={firstItems}
        onAccepted={onAccepted}
        onRejected={onRejected}
        onSelect={vi.fn()}
        session={session}
      />,
    );

    await waitFor(() => expect(onRejected).toHaveBeenCalledWith('RENDER_FAILED'));
    expect(onAccepted).not.toHaveBeenCalled();

    view.rerender(
      <MapPointLayerOverlay
        items={nextItems}
        onAccepted={onAccepted}
        onRejected={onRejected}
        onSelect={vi.fn()}
        session={session}
      />,
    );

    await waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());
  });

  it('does not call replace when point items are structurally equal after remap', async () => {
    const items = [
      {
        accessibleName: '점 테스트',
        id: 'point-a',
        latitude: 37,
        longitude: 127,
      },
    ] satisfies readonly KoreaMapPoint[];
    const { pointLayer, session } = layerFixture();
    const view = render(
      <MapPointLayerOverlay items={items} keyboardAccessible={false} onSelect={vi.fn()} session={session} />,
    );

    await waitFor(() => expect(pointLayer.replace).toHaveBeenCalledOnce());
    view.rerender(
      <MapPointLayerOverlay
        items={items.map((item) => ({ ...item, id: `${item.id}` }))}
        keyboardAccessible={false}
        onSelect={vi.fn()}
        session={session}
      />,
    );

    expect(pointLayer.replace).toHaveBeenCalledOnce();
  });

  it('forwards mixed official geometry to one controlled geometry layer and destroys it on unmount', async () => {
    const items = [
      {
        accessibleName: '관측점 자세히 보기',
        geometry: { kind: 'point', position: [127, 37] },
        id: 'geometry-point',
      },
      {
        accessibleName: '도로 구간 자세히 보기',
        geometry: {
          kind: 'line',
          path: [
            [127, 37],
            [127.1, 37.1],
          ],
        },
        id: 'geometry-line',
      },
      {
        accessibleName: '재난 영역 자세히 보기',
        geometry: {
          kind: 'area',
          ring: [
            [127, 37],
            [127.1, 37],
            [127.1, 37.1],
          ],
        },
        id: 'geometry-area',
      },
    ] satisfies readonly KoreaMapGeometryFeature[];
    const onSelect = vi.fn();
    const { createGeometryLayer, geometryLayer, session } = layerFixture();
    const view = render(
      <MapGeometryLayerOverlay
        items={items}
        keyboardAccessible={true}
        onSelect={onSelect}
        selectedId="geometry-line"
        session={session}
      />,
    );

    await waitFor(() => expect(geometryLayer.replace).toHaveBeenCalledOnce());
    expect(createGeometryLayer).toHaveBeenCalledOnce();
    expect(geometryLayer.replace.mock.lastCall?.[0]).toEqual(
      items.map((item) => ({ ...item, keyboardAccessible: true })),
    );
    expect(geometryLayer.select).toHaveBeenLastCalledWith('geometry-line');
    createGeometryLayer.mock.calls[0]?.[0]?.onSelect('geometry-area');
    expect(onSelect).toHaveBeenCalledWith('geometry-area');

    view.unmount();
    expect(geometryLayer.destroy).toHaveBeenCalledOnce();
  });

  it('does not call replace when geometry items are structurally equal after remap', async () => {
    const items = [
      {
        accessibleName: '도로 구간',
        geometry: {
          kind: 'line',
          path: [[127, 37] as const, [127.1, 37.1] as const],
        },
        id: 'geometry-line',
      },
    ] satisfies readonly KoreaMapGeometryFeature[];
    const { geometryLayer, session } = layerFixture();
    const view = render(
      <MapGeometryLayerOverlay items={items} keyboardAccessible onSelect={vi.fn()} session={session} />,
    );
    await waitFor(() => expect(geometryLayer.replace).toHaveBeenCalledOnce());
    view.rerender(
      <MapGeometryLayerOverlay
        items={items.map((item) => ({
          ...item,
          geometry: { ...item.geometry, path: [...item.geometry.path] as const },
        }))}
        keyboardAccessible
        onSelect={vi.fn()}
        session={session}
      />,
    );

    expect(geometryLayer.replace).toHaveBeenCalledOnce();
    view.unmount();
  });
});
