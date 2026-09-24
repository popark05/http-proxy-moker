import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { CapturedExchange } from '@shared/capture';
import { AppModeProvider, useAppMode } from './state/app-mode';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Separator } from '@/components/ui/separator';
import { TopBar } from './components/layout/TopBar';
import { SplitPane } from './components/primitives';
import { useCapture } from './state/useCapture';
import { useProject } from './state/useProject';
import { useMocks } from './state/useMocks';
import { useTrafficFilter } from './state/useTrafficFilter';
import { useMockHits } from './state/useMockHits';
import { ProxyControls } from './components/traffic/ProxyControls';
import { FilterBar } from './components/traffic/FilterBar';
import { TrafficList } from './components/traffic/TrafficList';
import { ExchangeDetail } from './components/traffic/ExchangeDetail';
import { DevicePanel } from './components/device/DevicePanel';
import { ProjectBar } from './components/project/ProjectBar';
import { MockPanel } from './components/mock/MockPanel';
import { ScenarioPanel } from './components/mock/ScenarioPanel';

/** 에러 객체에서 사용자 표시용 메시지 추출. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function AppInner(): JSX.Element {
  const { exchanges, status, startProxy, stopProxy, clear, replaceExchanges, addTag, removeTag } =
    useCapture();
  const {
    project,
    createProject,
    openProject,
    saveCapture,
    loadCapture,
    addScenarioName,
    removeScenarioName
  } = useProject();
  const { mocks, cloneFromExchange, updateMock, removeMock, saveScenario, loadScenario } =
    useMocks();
  const { mode, setMode } = useAppMode();
  const { filter, patchFilter, clearFilter, filtered, hosts, tags, active, invalidateIndex } =
    useTrafficFilter(exchanges);
  const mockHits = useMockHits();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [blockUnmatched, setBlockUnmatched] = useState(false);
  const [activeScenario, setActiveScenario] = useState<string | undefined>(undefined);

  const selected = exchanges.find((e) => e.id === selectedId);

  // 모드/목/정책 변경 시 프록시에 목킹 적용 or 해제.
  useEffect(() => {
    if (!status.running) return;
    if (mode === 'mock') {
      void window.mokerApi.proxy.applyMocks({
        mocks,
        unmatchedPolicy: blockUnmatched ? 'block' : 'passthrough'
      });
    } else {
      void window.mokerApi.proxy.clearMocks();
    }
  }, [mode, mocks, blockUnmatched, status.running]);

  const handleStartProxy = async (): Promise<void> => {
    try {
      const next = await startProxy();
      toast.success('프록시 시작', { description: `포트 ${next?.port ?? ''} 수신 중` });
    } catch (e) {
      toast.error('프록시 시작 실패', { description: errMsg(e) });
    }
  };

  const handleStopProxy = async (): Promise<void> => {
    await stopProxy();
    toast('프록시 중지됨');
  };

  const handleLoadSession = async (name: string): Promise<void> => {
    try {
      const loaded = await loadCapture(name);
      replaceExchanges(loaded);
      setSelectedId(undefined);
      toast.success('세션 로드됨', { description: `${name} · ${loaded.length}건` });
    } catch (e) {
      toast.error('세션 로드 실패', { description: errMsg(e) });
    }
  };

  const handleSaveScenario = async (name: string): Promise<void> => {
    try {
      const saved = await saveScenario(name);
      addScenarioName(saved);
      setActiveScenario(saved);
      toast.success('시나리오 저장됨', { description: saved });
    } catch (e) {
      toast.error('시나리오 저장 실패', { description: errMsg(e) });
    }
  };

  const handleActivateScenario = async (name: string): Promise<void> => {
    await loadScenario(name);
    setActiveScenario(name);
    toast.success('시나리오 활성화', {
      description: mode === 'mock' ? `${name} 적용됨` : `${name} 로드됨 (목킹 모드에서 적용)`
    });
  };

  const handleDeleteScenario = async (name: string): Promise<void> => {
    await window.mokerApi.project.deleteScenario(name);
    removeScenarioName(name);
    if (activeScenario === name) setActiveScenario(undefined);
    toast('시나리오 삭제됨', { description: name });
  };

  const handleAddTag = (id: string, tag: string): void => {
    addTag(id, tag);
    invalidateIndex(id);
  };

  const handleRemoveTag = (id: string, tag: string): void => {
    removeTag(id, tag);
    invalidateIndex(id);
  };

  const handleCreateProject = async (name: string): Promise<void> => {
    try {
      await createProject(name);
    } catch (e) {
      toast.error('프로젝트 생성 실패', { description: errMsg(e) });
    }
  };

  const handleOpenProject = async (): Promise<void> => {
    try {
      await openProject();
    } catch (e) {
      toast.error('프로젝트 열기 실패', { description: errMsg(e) });
    }
  };

  const handleSaveCapture = async (name: string): Promise<void> => {
    try {
      await saveCapture(name, exchanges);
      toast.success('캡처 세션 저장됨', { description: `${name} · ${exchanges.length}건` });
    } catch (e) {
      toast.error('세션 저장 실패', { description: errMsg(e) });
    }
  };

  const handleCloneToMock = (exchange: CapturedExchange): void => {
    cloneFromExchange(exchange);
    const desc = `${exchange.request.method} ${exchange.request.path}`;
    if (mode === 'mock') {
      toast.success('목으로 복제됨', { description: `${desc} · 아래 목 정의에 추가됨` });
    } else {
      // 캡처 모드면 목킹 모드 전환을 한 번의 클릭으로 유도(제품 핵심 흐름).
      toast.success('목으로 복제됨', {
        description: `${desc} · 목킹 모드로 전환하면 이 응답이 반영됩니다`,
        action: { label: '목킹 모드로', onClick: () => setMode('mock') }
      });
    }
  };

  // 좌측 트래픽 패널(필터 + 리스트). 캡처/목킹 모드 공용.
  const trafficPanel = (
    <div className="flex h-full flex-col">
      <FilterBar
        filter={filter}
        patchFilter={patchFilter}
        clearFilter={clearFilter}
        active={active}
        hosts={hosts}
        tags={tags}
        total={exchanges.length}
        shown={filtered.length}
      />
      <div className="min-h-0 flex-1">
        <TrafficList exchanges={filtered} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TopBar
        activeMockCount={mocks.filter((m) => m.enabled).length}
        activeScenario={activeScenario}
        lastHitAt={mockHits.lastHitOverall}
      />
      <ProjectBar
        project={project}
        exchanges={exchanges}
        onCreate={(name) => void handleCreateProject(name)}
        onOpen={() => void handleOpenProject()}
        onSave={(name) => void handleSaveCapture(name)}
        onLoadSession={(name) => void handleLoadSession(name)}
      />

      {mode === 'capture' ? (
        /* 캡처 모드: 좌(프록시+기기+트래픽) | 우(상세 풀높이) */
        <div className="min-h-0 flex-1">
          <SplitPane
            left={
              <div className="flex h-full flex-col">
                <ProxyControls
                  status={status}
                  count={exchanges.length}
                  onStart={() => void handleStartProxy()}
                  onStop={() => void handleStopProxy()}
                  onClear={() => {
                    clear();
                    mockHits.reset();
                    setSelectedId(undefined);
                  }}
                />
                <div className="max-h-[40%] overflow-auto border-b border-border px-4 py-2">
                  <DevicePanel />
                </div>
                {trafficPanel}
              </div>
            }
            right={
              <div className="h-full overflow-auto">
                <ExchangeDetail
                  exchange={selected}
                  onCloneToMock={handleCloneToMock}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                />
              </div>
            }
          />
        </div>
      ) : (
        /* 목킹 모드: 좌(트래픽 - 복제 소스) | 우(목 정의+편집 + 시나리오) */
        <div className="min-h-0 flex-1">
          <SplitPane
            initialLeftWidth={360}
            left={trafficPanel}
            right={
              <div className="flex h-full flex-col overflow-auto">
                {/* 선택한 트래픽이 있으면 상세를 접이식으로 상단에 얇게 보여줘 복제 소스 확인 */}
                {selected && (
                  <div className="max-h-[38%] shrink-0 overflow-auto border-b border-border">
                    <ExchangeDetail
                      exchange={selected}
                      onCloneToMock={handleCloneToMock}
                      onAddTag={handleAddTag}
                      onRemoveTag={handleRemoveTag}
                    />
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                  <MockPanel
                    mocks={mocks}
                    mode={mode}
                    blockUnmatched={blockUnmatched}
                    onBlockUnmatchedChange={setBlockUnmatched}
                    onUpdate={updateMock}
                    onRemove={removeMock}
                    onSaveScenario={(name) => void handleSaveScenario(name)}
                    hitCounts={mockHits.counts}
                    lastHitAt={mockHits.lastHitAt}
                    onResetHits={mockHits.reset}
                  />
                  <Separator className="my-3" />
                  <ScenarioPanel
                    scenarios={project?.scenarios ?? []}
                    activeScenario={activeScenario}
                    onActivate={(name) => void handleActivateScenario(name)}
                    onDelete={(name) => void handleDeleteScenario(name)}
                  />
                </div>
              </div>
            }
          />
        </div>
      )}

      <Toaster />
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      <AppModeProvider>
        <AppInner />
      </AppModeProvider>
    </TooltipProvider>
  );
}
