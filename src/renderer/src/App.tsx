import { useEffect, useState } from 'react';
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

  const handleLoadSession = async (name: string): Promise<void> => {
    const loaded = await loadCapture(name);
    replaceExchanges(loaded);
    setSelectedId(undefined);
  };

  const handleSaveScenario = async (name: string): Promise<void> => {
    const saved = await saveScenario(name);
    addScenarioName(saved);
    setActiveScenario(saved);
  };

  const handleActivateScenario = async (name: string): Promise<void> => {
    await loadScenario(name);
    setActiveScenario(name);
  };

  const handleDeleteScenario = async (name: string): Promise<void> => {
    await window.mokerApi.project.deleteScenario(name);
    removeScenarioName(name);
    if (activeScenario === name) setActiveScenario(undefined);
  };

  const handleAddTag = (id: string, tag: string): void => {
    addTag(id, tag);
    invalidateIndex(id);
  };

  const handleRemoveTag = (id: string, tag: string): void => {
    removeTag(id, tag);
    invalidateIndex(id);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TopBar />
      <ProjectBar
        project={project}
        exchanges={exchanges}
        onCreate={(name) => void createProject(name)}
        onOpen={() => void openProject()}
        onSave={(name) => void saveCapture(name, exchanges)}
        onLoadSession={(name) => void handleLoadSession(name)}
      />
      <div className="min-h-0 flex-1">
        <SplitPane
          left={
            <div className="flex h-full flex-col">
              <ProxyControls
                status={status}
                count={exchanges.length}
                onStart={() => void startProxy()}
                onStop={() => void stopProxy()}
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
                  onCloneToMock={(exchange) => cloneFromExchange(exchange)}
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
