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
import { CloneSourceBar } from './components/mock/CloneSourceBar';
import { SelectionBar } from './components/traffic/SelectionBar';
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
  const { mocks, cloneFromExchange, cloneMany, updateMock, removeMock, saveScenario, loadScenario } =
    useMocks();
  const { mode, setMode } = useAppMode();
  const { filter, patchFilter, clearFilter, filtered, hosts, tags, active, invalidateIndex } =
    useTrafficFilter(exchanges);
  const mockHits = useMockHits();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
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

  /** 체크된 요청들을 한 번에 목으로 복제. */
  const handleCloneChecked = (): void => {
    const targets = exchanges.filter((e) => checkedIds.has(e.id));
    const { added, skipped } = cloneMany(targets);
    setCheckedIds(new Set());
    const detail = skipped > 0 ? ` (같은 method+path ${skipped}개는 건너뜀)` : '';
    if (added === 0) {
      toast.info('새로 복제할 목이 없습니다', {
        description: `이미 목이 있는 요청이거나 중복입니다${detail}`
      });
      return;
    }
    if (mode === 'mock') {
      toast.success(`${added}개 목으로 복제됨`, { description: `목 정의에 추가됨${detail}` });
    } else {
      toast.success(`${added}개 목으로 복제됨`, {
        description: `목킹 모드로 전환하면 반영됩니다${detail}`,
        action: { label: '목킹 모드로', onClick: () => setMode('mock') }
      });
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

  // 삭제(전체 비우기 등)로 사라진 id는 세지 않는다.
  const checkedTotal = exchanges.filter((e) => checkedIds.has(e.id)).length;
  const checkedShown = filtered.filter((e) => checkedIds.has(e.id)).length;

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
      <SelectionBar
        shownCount={filtered.length}
        checkedShownCount={checkedShown}
        checkedCount={checkedTotal}
        onToggleAllShown={() =>
          setCheckedIds((prev) => {
            const next = new Set(prev);
            for (const e of filtered) {
              if (checkedShown === filtered.length) next.delete(e.id);
              else next.add(e.id);
            }
            return next;
          })
        }
        onClear={() => setCheckedIds(new Set())}
        onCloneChecked={handleCloneChecked}
      />
      <div className="min-h-0 flex-1">
        <TrafficList
          exchanges={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          checkedIds={checkedIds}
          onCheckedChange={setCheckedIds}
        />
      </div>
    </div>
  );

  // 좌측 컬럼(프록시 컨트롤 + 기기 + 트래픽). 캡처/목킹 모드 공용: 목킹에서도 프록시 시작과 기기 연결이 필요하다.
  const leftColumn = (
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
        {/* 기기 패널은 줄어들지 않는다(shrink-0). 낮은 창에서는 트래픽 리스트가 남는 높이만큼만 쓴다. */}
        <div className="max-h-[40%] shrink-0 overflow-auto border-b border-border px-4 py-2">
          <DevicePanel />
        </div>
        <div className="min-h-0 flex-1">{trafficPanel}</div>
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
              leftColumn
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
            left={leftColumn}
            right={
              <div className="flex h-full flex-col overflow-auto">
                {/* 선택한 트래픽은 한 줄 요약 + 복제 버튼으로만 두고, 상세는 펼쳤을 때만 보여준다 */}
                {selected && (
                  <CloneSourceBar
                    exchange={selected}
                    onCloneToMock={handleCloneToMock}
                    onAddTag={handleAddTag}
                    onRemoveTag={handleRemoveTag}
                  />
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
