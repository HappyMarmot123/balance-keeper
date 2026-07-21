import { ThemeSwitch } from '../../../features/theme-switch';
import { Panel } from '../../../shared/ui';

const foundationFreshness = {
  dateTime: '2026-07-20',
  label: 'SPEC · 2026-07-20',
} as const;

export function DashboardShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-foreground">
      <header className="border-b border-boundary bg-surface">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="font-data text-xs font-semibold tracking-widest text-accent">ATLAS ARMILLARY</p>
            <p className="mt-1 text-sm font-semibold">Balance Keeper</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="flex items-center gap-2 font-data text-xs text-muted">
              <span aria-hidden="true" className="size-2 rounded-full bg-success" />
              FOUNDATION READY
            </p>
            <ThemeSwitch />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto grid w-full max-w-screen-2xl gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <section aria-labelledby="app-title">
            <h1 className="sr-only" id="app-title">
              Korea Monitor
            </h1>

            <figure className="relative isolate grid min-h-160 place-items-center overflow-hidden border border-boundary bg-surface-inset lg:min-h-192">
              <div aria-hidden="true" className="absolute inset-x-4 top-1/2 h-px bg-boundary" />
              <div aria-hidden="true" className="absolute inset-y-4 left-1/2 w-px bg-boundary" />
              <div aria-hidden="true" className="absolute size-48 rounded-full border-2 border-boundary-strong" />
              <div aria-hidden="true" className="absolute size-36 rotate-45 rounded-full border border-accent" />
              <div
                aria-hidden="true"
                className="absolute size-24 -rotate-12 rounded-full border border-boundary-strong"
              />
              <div aria-hidden="true" className="absolute size-3 rounded-full border border-accent bg-surface-raised" />
              <div className="absolute bottom-4 border-l-2 border-accent bg-surface px-3 py-2 text-center font-data text-xs text-muted">
                <span className="block text-foreground">SEOUL DATUM</span>
                37.5665°N / 126.9780°E
              </div>
              <figcaption className="sr-only">서울 좌표를 중심으로 표현한 Atlas Armillary 관측 기호</figcaption>
            </figure>
          </section>

          <section aria-labelledby="foundation-states-title">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-boundary pb-3">
              <div>
                <p className="font-data text-xs font-semibold tracking-widest text-accent">STATE MATRIX</p>
                <h2 className="mt-1 text-xl font-semibold" id="foundation-states-title">
                  데이터 생명주기 표본
                </h2>
              </div>
              <p className="max-w-xl text-sm text-muted">
                실제 API 연결 전, 모든 위젯이 공유할 의미와 접근성 계약입니다.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Panel
                description="색·경계·자료 글꼴의 단일 출처"
                freshness={foundationFreshness}
                headingLevel={3}
                source="DESIGN SYSTEM"
                status="success"
                title="시맨틱 토큰"
              >
                <dl className="grid grid-cols-2 gap-3">
                  <div className="border-l-2 border-success bg-success-soft px-3 py-2">
                    <dt className="font-data text-xs text-muted">PALETTE</dt>
                    <dd className="mt-1 font-semibold">LIGHT / DARK</dd>
                  </div>
                  <div className="border-l-2 border-success bg-success-soft px-3 py-2">
                    <dt className="font-data text-xs text-muted">CONTRAST</dt>
                    <dd className="mt-1 font-semibold">AA PASS</dd>
                  </div>
                </dl>
              </Panel>

              <Panel
                description="마지막 성공 콘텐츠를 유지"
                freshness={{ dateTime: '2026-07-19', label: 'PREVIOUS · 2026-07-19' }}
                headingLevel={3}
                message="업스트림 연결이 지연되어 이전 자료를 표시합니다."
                source="CACHE CONTRACT"
                status="stale"
                title="신선도 보존"
              >
                <p className="text-sm leading-6 text-muted">
                  장애 구간에서도 화면 맥락은 사라지지 않으며 자료시각과 상태 표식을 함께 제공합니다.
                </p>
              </Panel>

              <Panel
                description="레이아웃 높이를 유지하는 대기 상태"
                headingLevel={3}
                message="관측 채널을 준비하고 있습니다."
                source="ASYNC CONTRACT"
                status="loading"
                title="신호 수집"
              />

              <Panel
                announce={false}
                code="FOUNDATION_UPSTREAM"
                description="재현 가능한 코드와 원인 제공"
                headingLevel={3}
                message="업스트림 응답을 확인할 수 없습니다."
                source="ERROR CONTRACT"
                status="error"
                title="업스트림 오류"
              />

              <Panel
                description="결과가 없는 이유를 명시"
                headingLevel={3}
                message="현재 조건에 해당하는 관측 결과가 없습니다."
                source="EMPTY CONTRACT"
                status="empty"
                title="관측 결과"
              />

              <Panel
                description="기능 해제 상태와 이유를 함께 표시"
                headingLevel={3}
                message="운영 정책이 확정될 때까지 이 레이어는 비활성화됩니다."
                source="POLICY CONTRACT"
                status="disabled"
                title="제한 레이어"
              />

              <Panel
                description="비밀 이름이나 값 없는 설정 안내"
                headingLevel={3}
                source="MAP CONTRACT"
                status="missing-credential"
                title="지도 연결"
              />
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-boundary bg-surface px-4 py-4 text-center font-data text-xs text-muted">
        BALANCE KEEPER · ATLAS FOUNDATION · SEOUL DATUM
      </footer>
    </div>
  );
}
