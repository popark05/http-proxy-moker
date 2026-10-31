import { useEffect, useMemo, useState } from 'react';
import type { CapturedExchange } from '@shared/capture';
import { AppModeProvider, useAppMode } from './state/app-mode';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { TopBar } from './components/layout/TopBar';
import { AppShell } from './components/layout/AppShell';
import { Sidebar } from './components/layout/Sidebar';
import { useSidebarLayout } from './state/useSidebarLayout';
import { StatusBar } from './components/layout/StatusBar';
import { MockWorkspace } from './components/layout/MockWorkspace';
import { TrafficPanel } from './components/layout/TrafficPanel';
import { Workspace } from './components/layout/Workspace';
import { Button } from '@/components/ui/button';
import { FlaskConical } from 'lucide-react';
import { useWorkbench } from './state/useWorkbench';
import type { Tab } from './lib/workbench';
import { useCapture } from './state/useCapture';
import { useProject } from './state/useProject';
import { useMocks } from './state/useMocks';
import { useContracts } from './state/useContracts';
import { ContractModal } from './components/contract/ContractModal';
import { useScenarioLibrary } from './state/useScenarioLibrary';
import { useClients } from './state/useClients';
import { clientLabel, countWithoutClientIp } from '@shared/clients';
import { useTrafficFilter } from './state/useTrafficFilter';
import { useMockHits } from './state/useMockHits';
import { ExchangeDetail } from './components/traffic/ExchangeDetail';
import { SplashScreen } from './components/brand/SplashScreen';
import { ProjectBar } from './components/project/ProjectBar';
import { ScenarioEditor } from './components/mock/ScenarioEditor';
import { LibraryModal } from './components/mock/LibraryModal';
import { useProxyActions } from './state/useProxyActions';
import { useProjectActions } from './state/useProjectActions';
import { useScenarioActions } from './state/useScenarioActions';
import { useExchangeActions } from './state/useExchangeActions';
import { toast } from 'sonner';
import { errMsg } from './lib/errors';
import type { ScenarioV2 } from '@shared/scenario-library';

function AppInner(): JSX.Element {
  const { exchanges, tlsErrors, status, startProxy, stopProxy, clear, replaceExchanges, addTag, removeTag } =
    useCapture();
  const projectState = useProject();
  const { project } = projectState;
  const mocksState = useMocks();
  const { mocks, updateMock, removeMock, replaceMocks } = mocksState;
  const scenarioLib = useScenarioLibrary({ projectDir: project?.dir, mocks, replaceMocks });
  const { activeScenario } = scenarioLib;
  const contractState = useContracts(project?.dir);
  const [contractsOpen, setContractsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<{ scenario: ScenarioV2 | undefined } | undefined>(undefined);
  const { mode, setMode } = useAppMode();
  const { filter, patchFilter, clearFilter, filtered, hosts, tags, active, invalidateIndex } =
    useTrafficFilter(exchanges);
  const mockHits = useMockHits();
  const { clients, now } = useClients(exchanges, tlsErrors);
  const clientPlatforms = useMemo(() => new Map(clients.map((c) => [c.ip, c.platform] as const)), [clients]);
  const clientOptions = useMemo(
    () => clients.map((c) => ({ ip: c.ip, label: clientLabel(c, [], clients) })),
    [clients]
  );
  /** 이 요청을 보낸 기기 설명. 기기가 둘 이상 접속했을 때만 보여준다(한 대면 군더더기). */
  const clientDescriptionOf = (exchange: CapturedExchange | undefined): string | undefined => {
    const ip = exchange?.request.clientIp;
    const client = ip ? clients.find((c) => c.ip === ip) : undefined;
    return client && clients.length > 1 ? `${clientLabel(client, [], clients)} (${client.ip})` : undefined;
  };
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [trafficView, setTrafficView] = useState<'group' | 'flat'>('group');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [blockUnmatched, setBlockUnmatched] = useState(false);
  const { section, collapsed, openSection, toggleSection } = useSidebarLayout();

  const workbench = useWorkbench();

  const selected = exchanges.find((e) => e.id === selectedId);

  /** 트래픽 행 선택. 캡처 모드에서는 상세를 미리보기 탭으로 연다(목킹 모드에서는 복제 소스 선택일 뿐이라 탭을 바꾸지 않는다). */
  const handleSelect = (id: string | undefined): void => {
    setSelectedId(id);
    if (id && mode === 'capture') workbench.open({ kind: 'exchange', id });
  };

  const handleCloseTab = (key: string): void => {
    workbench.close(key);
    if (selectedId && key === `exchange:${selectedId}`) setSelectedId(undefined);
  };

  const closeExchangeTabs = (): void => workbench.closeWhere((t) => t.target.kind === 'exchange');

  // 목킹 모드로 바꾸면 목 · 시나리오 탭을 열어 보여 준다.
  useEffect(() => {
    if (mode === 'mock') workbench.open({ kind: 'mocks' }, { pin: true });
  }, [mode, workbench.open]);

  // 요청 탭을 활성화하면 트래픽 목록의 선택도 따라간다.
  const activeKey = workbench.state.activeKey;
  useEffect(() => {
    if (activeKey?.startsWith('exchange:')) setSelectedId(activeKey.slice('exchange:'.length));
  }, [activeKey]);

  const { proxyBusy, handleStartProxy, handleStopProxy } = useProxyActions({
    status,
    startProxy,
    stopProxy,
    mode,
    mocks,
    blockUnmatched
  });
  const { handleCreateProject, handleOpenProject, handleSaveCapture, handleLoadSession } = useProjectActions({
    projectState,
    exchanges,
    replaceExchanges,
    onSessionLoaded: () => {
      setSelectedId(undefined);
      closeExchangeTabs();
    }
  });
  const scenarioActions = useScenarioActions({ scenarioLib, hasProject: !!project, mode });
  const exchangeActions = useExchangeActions({
    exchanges,
    checkedIds,
    clearChecked: () => setCheckedIds(new Set()),
    mode,
    setMode,
    mocksState,
    contractState,
    project,
    openContracts: () => setContractsOpen(true)
  });

  const handleAddTag = (id: string, tag: string): void => {
    addTag(id, tag);
    invalidateIndex(id);
  };

  const handleRemoveTag = (id: string, tag: string): void => {
    removeTag(id, tag);
    invalidateIndex(id);
  };

  const trafficPanel = (
    <TrafficPanel
      filterProps={{ filter, patchFilter, clearFilter, active, hosts, tags, clients: clientOptions }}
      exchanges={exchanges}
      filtered={filtered}
      selectedId={selectedId}
      onSelect={handleSelect}
      checkedIds={checkedIds}
      setCheckedIds={setCheckedIds}
      view={trafficView}
      onViewChange={setTrafficView}
      clientPlatforms={clientPlatforms}
      onCloneChecked={exchangeActions.cloneChecked}
      onSaveContracts={() => void exchangeActions.saveContracts()}
      onExportBruno={() => void exchangeActions.exportBruno()}
    />
  );

  const sidebar = (
    <Sidebar
      section={section}
      proxyProps={{
        status,
        busy: proxyBusy,
        count: exchanges.length,
        onStart: () => void handleStartProxy(),
        onStop: () => void handleStopProxy(),
        onClear: () => {
          clear();
          mockHits.reset();
          setSelectedId(undefined);
          closeExchangeTabs();
        }
      }}
      deviceProps={{
        clients,
        now,
        proxyRunning: status.running,
        activeClientFilter: filter.client,
        untrackedCount: countWithoutClientIp(exchanges),
        onFilterClient: (ip) => {
          patchFilter({ client: ip });
          // 기기를 골랐으면 그 기기의 트래픽을 바로 볼 수 있게 트래픽 섹션으로 돌아간다.
          openSection('traffic');
        }
      }}
      traffic={trafficPanel}
    />
  );

  const activeTarget = workbench.state.tabs.find((t) => t.key === workbench.state.activeKey)?.target;
  const activeExchange =
    activeTarget?.kind === 'exchange' ? exchanges.find((e) => e.id === activeTarget.id) : undefined;

  const describeTab = (tab: Tab): { label: string; method?: string } => {
    if (tab.target.kind === 'mocks') return { label: '목 · 시나리오' };
    const id = tab.target.id;
    const exchange = exchanges.find((e) => e.id === id);
    return exchange ? { method: exchange.request.method, label: exchange.request.path } : { label: '(지워진 요청)' };
  };

  const activeContent =
    activeTarget?.kind === 'exchange' ? (
      <ExchangeDetail
        exchange={activeExchange}
        clientDescription={clientDescriptionOf(activeExchange)}
        onCloneToMock={exchangeActions.cloneToMock}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
      />
    ) : activeTarget?.kind === 'mocks' ? (
      <MockWorkspace
        selected={selected}
        cloneSourceProps={{
          clientDescription: clientDescriptionOf(selected),
          onCloneToMock: exchangeActions.cloneToMock,
          onAddTag: handleAddTag,
          onRemoveTag: handleRemoveTag
        }}
        mockProps={{
          mocks,
          mode,
          blockUnmatched,
          onBlockUnmatchedChange: setBlockUnmatched,
          onUpdate: updateMock,
          onRemove: removeMock,
          onSaveScenario: (name) => void scenarioActions.saveScenario(name),
          onSaveCase: (mock) => void scenarioActions.saveMockAsCase(mock),
          caseNameOf: scenarioActions.caseNameOf,
          hitCounts: mockHits.counts,
          lastHitAt: mockHits.lastHitAt,
          onResetHits: mockHits.reset
        }}
        scenarioProps={{
          scenarios: scenarioLib.scenarios,
          activeScenario,
          diff: scenarioLib.diff,
          hasLibrary: scenarioLib.library.endpoints.length > 0,
          onActivate: scenarioActions.activateScenario,
          onEdit: (scenario) => setEditorTarget({ scenario }),
          onDelete: (name) => void scenarioActions.deleteScenario(name),
          onUpdateActive: () => void scenarioActions.updateActiveScenario(),
          onNew: () => setEditorTarget({ scenario: undefined }),
          onOpenLibrary: () => setLibraryOpen(true)
        }}
      />
    ) : null;

  const workspace = (
    <Workspace
      tabs={workbench.state.tabs}
      activeKey={workbench.state.activeKey}
      tabBarProps={{
        describe: describeTab,
        onActivate: workbench.activate,
        onClose: handleCloseTab,
        onPin: workbench.pin,
        onMove: workbench.move
      }}
      emptyAction={
        <Button variant="outline" size="sm" onClick={() => workbench.open({ kind: 'mocks' }, { pin: true })}>
          <FlaskConical /> 목 · 시나리오 열기
        </Button>
      }
    >
      {activeContent}
    </Workspace>
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
        onOpenContracts={() => setContractsOpen(true)}
        contractCount={contractState.contracts.length}
      />

      <AppShell section={section} collapsed={collapsed} onToggleSection={toggleSection} sidebar={sidebar} workspace={workspace} />
      <StatusBar
        proxy={status}
        mode={mode}
        clientCount={clients.length}
        activeMockCount={mocks.filter((m) => m.enabled).length}
        activeScenario={activeScenario}
        scenarioDirty={scenarioLib.diff?.dirty}
        onOpenConnect={() => openSection('connect')}
      />

      <LibraryModal
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        library={scenarioLib.library}
        scenarios={scenarioLib.scenarios}
        onCommit={(next) => void scenarioLib.commit(next)}
      />
      <ScenarioEditor
        open={!!editorTarget}
        onOpenChange={(o) => {
          if (!o) setEditorTarget(undefined);
        }}
        scenario={editorTarget?.scenario}
        scenarios={scenarioLib.scenarios}
        library={scenarioLib.library}
        onSave={(scenario) => {
          const workspaceEdited = scenario.name === activeScenario && !!scenarioLib.diff?.dirty;
          void scenarioLib
            .saveScenario(scenario)
            .then((saved) => {
              toast.success('시나리오 저장됨', { description: saved });
              if (workspaceEdited) {
                toast.info('작업 공간에는 아직 반영되지 않았습니다', {
                  description: '직접 고친 목이 있어 그대로 두었습니다. "되돌리기"를 누르면 저장한 내용으로 바뀝니다.'
                });
              }
            })
            .catch((e) => toast.error('시나리오 저장 실패', { description: errMsg(e) }));
        }}
      />
      <ContractModal
        open={contractsOpen}
        onOpenChange={setContractsOpen}
        contracts={contractState.contracts}
        servers={contractState.servers}
        onRemoveContract={(name) => {
          if (window.confirm(`"${name}" 계약을 삭제할까요?`)) void contractState.removeContract(name);
        }}
        onUpdateContract={(c) => void contractState.updateContract(c)}
        onImportContracts={contractState.saveDrafts}
        projectName={project?.meta.name}
        onUpsertServer={contractState.upsertServer}
        onRemoveServer={(name) => void contractState.removeServer(name)}
      />
      <Toaster />
      <SplashScreen />
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
