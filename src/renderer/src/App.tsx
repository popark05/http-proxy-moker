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
import { ProjectTree } from './components/project/ProjectTree';
import { Workspace } from './components/layout/Workspace';
import { CommandPalette } from './components/layout/CommandPalette';
import { buildCommands } from './lib/commands';
import { Button } from '@/components/ui/button';
import { EmptyState } from './components/common/EmptyState';
import type { ScenarioV2 } from '@shared/scenario-library';
import { FlaskConical, Layers } from 'lucide-react';
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

function AppInner(): JSX.Element {
  const { exchanges, tlsErrors, status, startProxy, stopProxy, clear, replaceExchanges, addTag, removeTag } =
    useCapture();
  const projectState = useProject();
  const { project } = projectState;
  const mocksState = useMocks();
  const { mocks, updateMock, removeMock, replaceMocks } = mocksState;
  const scenarioLib = useScenarioLibrary({
    projectDir: project?.dir,
    mocks,
    replaceMocks
  });
  const { activeScenario } = scenarioLib;
  const contractState = useContracts(project?.dir);
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
  // 편집 화면은 입력 중인 내용이 미리보기 교체로 사라지지 않도록 항상 고정 탭으로 연다.
  const openMocksTab = (): void => workbench.open({ kind: 'mocks' }, { pin: true });
  const openScenarioTab = (name: string | null): void => workbench.open({ kind: 'scenario', name }, { pin: true });
  const openLibraryTab = (): void => workbench.open({ kind: 'library' }, { pin: true });
  const openContractsTab = (): void => workbench.open({ kind: 'contracts' }, { pin: true });

  const selected = exchanges.find((e) => e.id === selectedId);

  /** 트래픽 행 선택. 모드와 무관하게 상세를 미리보기 탭으로 연다. */
  const handleSelect = (id: string | undefined): void => {
    setSelectedId(id);
    if (id) workbench.open({ kind: 'exchange', id });
  };

  const handleCloseTab = (key: string): void => {
    workbench.close(key);
    if (selectedId && key === `exchange:${selectedId}`) setSelectedId(undefined);
  };

  const closeExchangeTabs = (): void => workbench.closeWhere((t) => t.target.kind === 'exchange');

  /** 캡처된 요청과 요청 탭, 목 히트 수를 비운다. */
  const clearCapture = (): void => {
    clear();
    mockHits.reset();
    setSelectedId(undefined);
    closeExchangeTabs();
  };

  /** 세션을 불러오면 지금 캡처 목록이 대체되므로, 쌓인 요청이 있으면 한 번 확인한다. */
  const loadSessionConfirmed = (name: string): void => {
    if (
      exchanges.length > 0 &&
      !window.confirm(`"${name}" 세션을 불러오면 지금 캡처된 ${exchanges.length}건이 사라집니다. 계속할까요?`)
    )
      return;
    void handleLoadSession(name);
  };

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
  const scenarioActions = useScenarioActions({
    scenarioLib,
    hasProject: !!project,
    mode
  });
  const exchangeActions = useExchangeActions({
    exchanges,
    checkedIds,
    clearChecked: () => setCheckedIds(new Set()),
    mode,
    setMode,
    mocksState,
    contractState,
    project,
    openContracts: openContractsTab
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
      filterProps={{
        filter,
        patchFilter,
        clearFilter,
        active,
        hosts,
        tags,
        clients: clientOptions
      }}
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

  const treeInput = useMemo(
    () => ({
      hasProject: !!project,
      captureSessions: project?.captureSessions ?? [],
      mocks,
      hitCounts: mockHits.counts,
      scenarios: scenarioLib.scenarios,
      activeScenario,
      scenarioDirty: !!scenarioLib.diff?.dirty,
      library: scenarioLib.library,
      contracts: contractState.contracts
    }),
    [
      project,
      mocks,
      mockHits.counts,
      scenarioLib.scenarios,
      activeScenario,
      scenarioLib.diff?.dirty,
      scenarioLib.library,
      contractState.contracts
    ]
  );

  const projectTree = (
    <ProjectTree
      input={treeInput}
      onOpenMocks={openMocksTab}
      onLoadSession={loadSessionConfirmed}
      onToggleMock={(id, enabled) => {
        const mock = mocks.find((m) => m.id === id);
        if (mock) updateMock({ ...mock, enabled });
      }}
      onSaveMockAsCase={(id) => {
        const mock = mocks.find((m) => m.id === id);
        if (mock) void scenarioActions.saveMockAsCase(mock);
      }}
      onRemoveMock={(id) => {
        const mock = mocks.find((m) => m.id === id);
        if (mock && window.confirm(`"${mock.method} ${mock.path}" 목을 삭제할까요?`)) removeMock(id);
      }}
      onActivateScenario={(name) => {
        scenarioActions.activateScenario(name);
        openMocksTab();
      }}
      onEditScenario={(name) => {
        const scenario = scenarioLib.scenarios.find((s) => s.name === name);
        if (scenario) openScenarioTab(scenario.name);
      }}
      onDeleteScenario={(name) => void scenarioActions.deleteScenario(name)}
      onUpdateActiveScenario={() => void scenarioActions.updateActiveScenario()}
      onOpenLibrary={openLibraryTab}
      onOpenContracts={openContractsTab}
      onRemoveContract={(name) => {
        if (window.confirm(`"${name}" 계약을 삭제할까요?`)) void contractState.removeContract(name);
      }}
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
        onClear: clearCapture
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
      projectTree={projectTree}
    />
  );

  const describeTab = (tab: Tab): { label: string; method?: string } => {
    const target = tab.target;
    switch (target.kind) {
      case 'mocks':
        return { label: '목 · 시나리오' };
      case 'scenario':
        return { label: target.name ?? '새 시나리오' };
      case 'library':
        return { label: '케이스 라이브러리' };
      case 'contracts':
        return { label: '계약 테스트' };
      case 'exchange': {
        const exchange = exchanges.find((e) => e.id === target.id);
        return exchange
          ? { method: exchange.request.method, label: exchange.request.path }
          : { label: '(지워진 요청)' };
      }
    }
  };

  const handleSaveScenario = (scenario: ScenarioV2): void => {
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
  };

  const renderTabContent = (tab: Tab): JSX.Element => {
    const target = tab.target;
    switch (target.kind) {
      case 'exchange': {
        const exchange = exchanges.find((e) => e.id === target.id);
        return (
          <ExchangeDetail
            exchange={exchange}
            clientDescription={clientDescriptionOf(exchange)}
            onCloneToMock={exchangeActions.cloneToMock}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
          />
        );
      }
      case 'mocks':
        return (
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
              onEdit: (scenario) => openScenarioTab(scenario.name),
              onDelete: (name) => void scenarioActions.deleteScenario(name),
              onUpdateActive: () => void scenarioActions.updateActiveScenario(),
              onNew: () => openScenarioTab(null),
              onOpenLibrary: openLibraryTab
            }}
          />
        );
      case 'scenario': {
        const scenario = target.name === null ? undefined : scenarioLib.scenarios.find((s) => s.name === target.name);
        if (target.name !== null && !scenario) {
          return (
            <EmptyState
              icon={Layers}
              title="시나리오를 찾을 수 없습니다"
              description="삭제되었거나 다른 프로젝트의 시나리오입니다. 탭을 닫아 주세요."
            />
          );
        }
        return (
          <ScenarioEditor
            variant="tab"
            open
            onOpenChange={(o) => {
              if (!o) workbench.close(tab.key);
            }}
            scenario={scenario}
            scenarios={scenarioLib.scenarios}
            library={scenarioLib.library}
            onSave={handleSaveScenario}
          />
        );
      }
      case 'library':
        return (
          <LibraryModal
            variant="tab"
            open
            onOpenChange={(o) => {
              if (!o) workbench.close(tab.key);
            }}
            library={scenarioLib.library}
            scenarios={scenarioLib.scenarios}
            onCommit={(next) => void scenarioLib.commit(next)}
          />
        );
      case 'contracts':
        return (
          <ContractModal
            variant="tab"
            open
            onOpenChange={(o) => {
              if (!o) workbench.close(tab.key);
            }}
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
        );
    }
  };

  // Cmd/Ctrl+K: 커맨드 팔레트.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 항목은 팔레트가 열려 있을 때만 만든다(캡처가 쌓이는 동안 매번 만들 필요가 없다).
  const paletteCommands = paletteOpen
    ? buildCommands({
        tabs: workbench.state.tabs,
        describeTab,
        exchanges,
        mocks,
        scenarios: scenarioLib.scenarios,
        activeScenario,
        library: scenarioLib.library,
        contracts: contractState.contracts,
        captureSessions: project?.captureSessions ?? [],
        hasProject: !!project,
        mode,
        proxyRunning: status.running,
        activeTabKey: workbench.state.activeKey,
        actions: {
          activateTab: workbench.activate,
          openSection,
          openExchange: handleSelect,
          openMocks: openMocksTab,
          openScenario: openScenarioTab,
          activateScenario: (name) => {
            scenarioActions.activateScenario(name);
            openMocksTab();
          },
          openLibrary: openLibraryTab,
          openContracts: openContractsTab,
          loadSession: loadSessionConfirmed,
          startProxy: () => void handleStartProxy(),
          stopProxy: () => void handleStopProxy(),
          setMode,
          closeActiveTab: () => {
            if (workbench.state.activeKey) handleCloseTab(workbench.state.activeKey);
          },
          clearCapture
        }
      })
    : [];

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
        <Button variant="outline" size="sm" onClick={openMocksTab}>
          <FlaskConical /> 목 · 시나리오 열기
        </Button>
      }
      renderContent={renderTabContent}
    />
  );

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
        onOpenContracts={openContractsTab}
        contractCount={contractState.contracts.length}
      />

      <AppShell
        section={section}
        collapsed={collapsed}
        onToggleSection={toggleSection}
        sidebar={sidebar}
        workspace={workspace}
      />
      <StatusBar
        proxy={status}
        mode={mode}
        clientCount={clients.length}
        activeMockCount={mocks.filter((m) => m.enabled).length}
        activeScenario={activeScenario}
        scenarioDirty={scenarioLib.diff?.dirty}
        lastHitAt={mockHits.lastHitOverall}
        onOpenConnect={() => openSection('connect')}
      />

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={paletteCommands} />
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
