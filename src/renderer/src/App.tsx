import { useEffect, useMemo, useState } from 'react';
import { registerProjectOpeners, toastNoProject } from './lib/no-project';
import type { CapturedExchange } from '@shared/capture';
import { AppModeProvider, useAppMode } from './state/app-mode';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { TopBar } from './components/layout/TopBar';
import { AppShell } from './components/layout/AppShell';
import { Sidebar } from './components/layout/Sidebar';
import { DevicePanel } from './components/device/DevicePanel';
import { ProxyPanel } from './components/layout/ProxyPanel';
import { useSidebarLayout } from './state/useSidebarLayout';
import { StatusBar } from './components/layout/StatusBar';
import { MockingView, type MockingTab } from './components/mock/MockingView';
import { MockPanel } from './components/mock/MockPanel';
import { ScenarioPanel } from './components/mock/ScenarioPanel';
import { TrafficPanel } from './components/layout/TrafficPanel';
import { Workspace } from './components/layout/Workspace';
import { CommandPalette } from './components/layout/CommandPalette';
import { buildCommands } from './lib/commands';
import { Button } from '@/components/ui/button';
import { EmptyState } from './components/common/EmptyState';
import type { ScenarioV2 } from '@shared/scenario-library';
import { FlaskConical, Layers, Smartphone } from 'lucide-react';
import { useWorkbench } from './state/useWorkbench';
import type { Tab } from './lib/workbench';
import { useCapture } from './state/useCapture';
import { useProject } from './state/useProject';
import { useMocks } from './state/useMocks';
import { useContracts } from './state/useContracts';
import { CollectionView } from './components/collection/CollectionView';
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
import { newSessionName } from './lib/session-name';
import { errMsg } from './lib/errors';

function AppInner(): JSX.Element {
  const {
    exchanges,
    liveExchanges,
    tlsErrors,
    status,
    paused,
    setPaused,
    view: captureView,
    newLiveCount,
    viewSaved,
    backToLive,
    startProxy,
    stopProxy,
    clear,
    addTag,
    removeTag
  } = useCapture();
  const [proxyPanelOpen, setProxyPanelOpen] = useState(false);
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
  // 접속 기기는 실시간 트래픽 기준이다(저장된 캡처를 보는 중에도 기기 목록이 바뀌지 않게).
  const { clients, now } = useClients(liveExchanges, tlsErrors);
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
  // 목·시나리오·응답 케이스는 목킹 화면에서 다룬다(트래픽 섹션의 탭은 요청 상세뿐).
  const [mockingTab, setMockingTab] = useState<MockingTab>('mocks');
  /** 시나리오 탭에서 편집 중인 시나리오. undefined면 목록, null이면 새 시나리오. */
  const [editingScenario, setEditingScenario] = useState<string | null | undefined>(undefined);
  const openMocking = (tab: MockingTab): void => {
    setMockingTab(tab);
    openSection('mocking');
  };
  const openMocksTab = (): void => openMocking('mocks');
  const openScenarioTab = (name: string | null): void => {
    setEditingScenario(name);
    openMocking('scenarios');
  };
  const openLibraryTab = (): void => openMocking('library');
  const openCollection = (): void => openSection('collection');

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

  /** 실시간 목록과 요청 탭, 목 히트 수를 비운다. */
  const clearCapture = (): void => {
    clear();
    mockHits.reset();
    setSelectedId(undefined);
    closeExchangeTabs();
  };

  /** 실시간 목록으로 돌아간다(보던 저장본의 요청 탭은 닫는다). */
  const returnToLive = (): void => {
    backToLive();
    setSelectedId(undefined);
    closeExchangeTabs();
  };

  // 프로젝트가 바뀌면 이전 프로젝트의 저장된 캡처를 계속 보여 주지 않는다.
  useEffect(() => {
    if (captureView.kind === 'saved') returnToLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.dir]);

  /** 저장된 캡처를 본다. 실시간 목록은 그대로 두므로 사라지는 것이 없다. */
  const viewSavedCapture = (name: string): void => {
    openSection('traffic');
    void handleLoadSession(name);
  };

  // 요청 탭을 활성화하면 트래픽 목록의 선택도 따라간다.
  const activeKey = workbench.state.activeKey;
  useEffect(() => {
    if (activeKey?.startsWith('exchange:')) setSelectedId(activeKey.slice('exchange:'.length));
  }, [activeKey]);

  const { proxyBusy, ensureProxy, handleStopProxy, restartProxy } = useProxyActions({
    status,
    startProxy,
    stopProxy,
    mode,
    mocks,
    blockUnmatched
  });
  const { handleCreateProject, handleOpenProject, handleSaveCapture, handleLoadSession } = useProjectActions({
    projectState,
    liveExchanges,
    viewSaved,
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
    mode,
    setMode,
    mocksState,
    contractState,
    project,
    openCollection,
    openMocking: openMocksTab
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
      rowActions={{
        cloneToMock: (targets) => exchangeActions.cloneExchanges(targets),
        saveContracts: (targets) => void exchangeActions.saveContracts(targets),
        copy: (text, what) => {
          void navigator.clipboard.writeText(text).then(
            () => toast.success(`${what} 복사됨`),
            () => toast.error(`${what} 복사 실패`)
          );
        }
      }}
      source={captureView}
      liveCount={liveExchanges.length}
      newLiveCount={newLiveCount}
      savedNames={project?.captureSessions ?? []}
      sourceActions={{
        save: () => {
          if (!project) {
            toastNoProject('캡처 저장 실패');
            return;
          }
          void handleSaveCapture(newSessionName());
        },
        load: viewSavedCapture,
        backToLive: returnToLive,
        clear: clearCapture
      }}
    />
  );

  // 저장 실패 토스트의 "프로젝트 만들기 / 열기" 버튼이 쓴다.
  useEffect(() => {
    registerProjectOpeners({ create: () => void handleCreateProject(), open: () => void handleOpenProject() });
    return () => registerProjectOpeners(undefined);
  });

  const captureProps = {
    paused,
    onTogglePaused: () => setPaused(!paused),
    count: exchanges.length,
    onClear: clearCapture,
    clearDisabled: captureView.kind === 'saved'
  };

  const sidebar = <Sidebar section={section} captureProps={captureProps} traffic={trafficPanel} />;

  const connectView = (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-8">
      <DevicePanel
        ensureProxy={async () => !!(await ensureProxy())?.running}
        clients={clients}
        now={now}
        proxyRunning={status.running}
        activeClientFilter={filter.client}
        untrackedCount={countWithoutClientIp(exchanges)}
        onFilterClient={(ip) => {
          patchFilter({ client: ip });
          // 기기를 골랐으면 그 기기의 트래픽을 바로 볼 수 있게 트래픽 섹션으로 돌아간다.
          openSection('traffic');
        }}
      />
    </div>
  );

  const collectionView = (
    <CollectionView
      projectOpen={!!project}
      projectName={project?.meta.name}
      contracts={contractState.contracts}
      servers={contractState.servers}
      onCreate={contractState.createContract}
      onSave={contractState.updateContract}
      onRemove={(name) => {
        if (window.confirm(`"${name}" 요청을 컬렉션에서 삭제할까요?`)) void contractState.removeContract(name);
      }}
      onImport={contractState.saveDrafts}
      onUpsertServer={contractState.upsertServer}
      onRemoveServer={(name) => void contractState.removeServer(name)}
    />
  );

  const describeTab = (tab: Tab): { label: string; method?: string } => {
    const exchange = exchanges.find((e) => e.id === tab.target.id);
    return exchange
      ? { method: exchange.request.method, label: exchange.request.path }
      : { label: '(지워진 요청)' };
  };

  const handleSaveScenario = (scenario: ScenarioV2): void => {
    const workspaceEdited = scenario.name === activeScenario && !!scenarioLib.diff?.dirty;
    void scenarioLib
      .saveScenario(scenario)
      .then((saved) => {
        toast.success('시나리오 저장됨', { description: saved });
        if (workspaceEdited) {
          toast.info('현재 목에는 아직 반영되지 않았습니다', {
            description: '직접 고친 목이 있어 그대로 두었습니다. "되돌리기"를 누르면 저장한 내용으로 바뀝니다.'
          });
        }
      })
      .catch((e) => toast.error('시나리오 저장 실패', { description: errMsg(e) }));
  };

  const renderTabContent = (tab: Tab): JSX.Element => {
    const exchange = exchanges.find((e) => e.id === tab.target.id);
    return (
      <ExchangeDetail
        exchange={exchange}
        clientDescription={clientDescriptionOf(exchange)}
        onCloneToMock={exchangeActions.cloneToMock}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
      />
    );
  };

  const editingScenarioValue =
    editingScenario === null || editingScenario === undefined
      ? undefined
      : scenarioLib.scenarios.find((s) => s.name === editingScenario);

  const mockingView = (
    <MockingView
      tab={mockingTab}
      onTabChange={setMockingTab}
      counts={{
        mocks: mocks.length,
        scenarios: scenarioLib.scenarios.length,
        cases: scenarioLib.library.endpoints.length
      }}
      activeScenario={activeScenario}
      scenarioDirty={!!scenarioLib.diff?.dirty}
      mocks={
        <div className="flex h-full flex-col overflow-auto">
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <MockPanel
              mocks={mocks}
              mode={mode}
              blockUnmatched={blockUnmatched}
              onBlockUnmatchedChange={setBlockUnmatched}
              onUpdate={updateMock}
              onRemove={removeMock}
              onSaveScenario={(name) => void scenarioActions.saveScenario(name)}
              onSaveCase={(mock) => void scenarioActions.saveMockAsCase(mock)}
              caseNameOf={scenarioActions.caseNameOf}
              hitCounts={mockHits.counts}
              lastHitAt={mockHits.lastHitAt}
              onResetHits={mockHits.reset}
            />
          </div>
        </div>
      }
      scenarios={
        editingScenario === undefined ? (
          <div className="px-4 py-3">
            <ScenarioPanel
              scenarios={scenarioLib.scenarios}
              activeScenario={activeScenario}
              diff={scenarioLib.diff}
              hasLibrary={scenarioLib.library.endpoints.length > 0}
              onActivate={scenarioActions.activateScenario}
              onEdit={(scenario) => setEditingScenario(scenario.name)}
              onDelete={(name) => void scenarioActions.deleteScenario(name)}
              onUpdateActive={() => void scenarioActions.updateActiveScenario()}
              onNew={() => setEditingScenario(null)}
              onOpenLibrary={openLibraryTab}
            />
          </div>
        ) : editingScenario !== null && !editingScenarioValue ? (
          <EmptyState
            icon={Layers}
            title="시나리오를 찾을 수 없습니다"
            description="삭제되었거나 다른 프로젝트의 시나리오입니다."
            action={
              <Button variant="outline" size="sm" onClick={() => setEditingScenario(undefined)}>
                목록으로
              </Button>
            }
          />
        ) : (
          <ScenarioEditor
            variant="tab"
            open
            onOpenChange={(o) => {
              if (!o) setEditingScenario(undefined);
            }}
            scenario={editingScenarioValue}
            scenarios={scenarioLib.scenarios}
            library={scenarioLib.library}
            onSave={handleSaveScenario}
            activeScenario={activeScenario}
            onSwitch={(name) => setEditingScenario(name)}
            onActivate={scenarioActions.activateScenario}
          />
        )
      }
      library={
        <LibraryModal
          variant="tab"
          open
          onOpenChange={() => {}}
          library={scenarioLib.library}
          scenarios={scenarioLib.scenarios}
          onCommit={(next) => void scenarioLib.commit(next)}
        />
      }
    />
  );

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
          openCollection,
          loadSession: viewSavedCapture,
          startProxy: () => void ensureProxy(),
          stopProxy: () => void handleStopProxy(),
          setMode,
          closeActiveTab: () => {
            if (workbench.state.activeKey) handleCloseTab(workbench.state.activeKey);
          },
          clearCapture
        }
      })
    : [];

  // 열린 탭이 없을 때, 지금 상황에서 가장 자연스러운 다음 행동을 안내한다.
  const modifierKey = document.documentElement.dataset.platform === 'darwin' ? '⌘' : 'Ctrl+';
  const openMocksButton = (
    <Button variant="outline" size="sm" onClick={openMocksTab}>
      <FlaskConical /> 목킹 열기
    </Button>
  );
  const emptyState: { description: string; action: JSX.Element } = !status.running
    ? {
        description: '기기를 연결하면 프록시가 자동으로 켜지고, 앱의 요청이 왼쪽 목록에 쌓입니다. 선택하면 여기에 상세가 열립니다.',
        action: (
          <Button size="sm" onClick={() => openSection('connect')}>
            <Smartphone /> 기기 연결 보기
          </Button>
        )
      }
    : exchanges.length > 0
      ? { description: '왼쪽 트래픽 목록에서 요청을 선택하면 상세가 열립니다.', action: openMocksButton }
      : clients.length === 0
        ? {
            description: '아직 접속한 기기가 없습니다. 기기를 연결한 뒤 앱을 사용하면 요청이 쌓입니다.',
            action: (
              <Button variant="outline" size="sm" onClick={() => openSection('connect')}>
                <Smartphone /> 기기 연결 보기
              </Button>
            )
          }
        : { description: '기기가 접속했습니다. 앱에서 요청을 보내면 왼쪽 목록에 나타납니다.', action: openMocksButton };

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
      emptyDescription={emptyState.description}
      emptyAction={emptyState.action}
      emptyHint={`${modifierKey}K 로 탭 · 목 · 시나리오 · 요청을 검색하고 명령을 실행할 수 있습니다`}
      renderContent={renderTabContent}
    />
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TopBar />
      <ProjectBar
        project={project}
        onCreate={() => void handleCreateProject()}
        onOpen={() => void handleOpenProject()}
      />

      <AppShell
        section={section}
        collapsed={collapsed}
        onToggleSection={toggleSection}
        sidebar={sidebar}
        workspace={workspace}
        connectView={connectView}
        mockingView={mockingView}
        collectionView={collectionView}
      />
      <StatusBar
        proxy={status}
        proxyBusy={proxyBusy}
        onOpenProxy={() => setProxyPanelOpen(true)}
        mode={mode}
        clientCount={clients.length}
        activeMockCount={mocks.filter((m) => m.enabled).length}
        activeScenario={activeScenario}
        scenarioDirty={scenarioLib.diff?.dirty}
        lastHitAt={mockHits.lastHitOverall}
        onOpenConnect={() => openSection('connect')}
        onOpenMocking={openMocksTab}
      />

      <ProxyPanel
        open={proxyPanelOpen}
        onOpenChange={setProxyPanelOpen}
        status={status}
        busy={proxyBusy}
        onStart={(port) => void ensureProxy(port)}
        onStop={() => void handleStopProxy()}
        onRestart={(port) => void restartProxy(port)}
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
