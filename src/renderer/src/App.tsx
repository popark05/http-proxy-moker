import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AppModeProvider, useAppMode } from './state/app-mode';
import { AppThemeProvider } from './theme/ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Separator } from '@/components/ui/separator';
import { TopBar } from './components/layout/TopBar';
import { SplitPane } from './components/primitives';
import { useCapture } from './state/useCapture';
import { useProject } from './state/useProject';
import { useMocks } from './state/useMocks';
import { useTrafficFilter } from './state/useTrafficFilter';
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
  const { mode } = useAppMode();
  const { filter, patchFilter, clearFilter, filtered, hosts, tags, active, invalidateIndex } =
    useTrafficFilter(exchanges);
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

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TopBar />
      <ProjectBar
        project={project}
        exchanges={exchanges}
        onCreate={(name) => void handleCreateProject(name)}
        onOpen={() => void handleOpenProject()}
        onSave={(name) => void handleSaveCapture(name)}
        onLoadSession={(name) => void handleLoadSession(name)}
      />
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
                  setSelectedId(undefined);
                }}
              />
              <div className="max-h-[40%] overflow-auto border-b border-border px-4 py-2">
                <DevicePanel />
              </div>
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
                <TrafficList
                  exchanges={filtered}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
            </div>
          }
          right={
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1 overflow-auto">
                <ExchangeDetail
                  exchange={selected}
                  onCloneToMock={(exchange) => {
                    cloneFromExchange(exchange);
                    toast.success('목으로 복제됨', {
                      description: `${exchange.request.method} ${exchange.request.path} · 아래 목 정의에서 편집`
                    });
                  }}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                />
              </div>
              <div className="max-h-[50%] overflow-auto border-t border-border px-4 py-2">
                <MockPanel
                  mocks={mocks}
                  mode={mode}
                  blockUnmatched={blockUnmatched}
                  onBlockUnmatchedChange={setBlockUnmatched}
                  onUpdate={updateMock}
                  onRemove={removeMock}
                  onSaveScenario={(name) => void handleSaveScenario(name)}
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
      <Toaster />
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <AppThemeProvider>
      <TooltipProvider delayDuration={300}>
        <AppModeProvider>
          <AppInner />
        </AppModeProvider>
      </TooltipProvider>
    </AppThemeProvider>
  );
}
