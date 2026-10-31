import { useMemo, useState } from 'react';
import type { CapturedExchange } from '@shared/capture';
import { AppModeProvider, useAppMode } from './state/app-mode';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { TopBar } from './components/layout/TopBar';
import { LeftColumn } from './components/layout/LeftColumn';
import { MockWorkspace } from './components/layout/MockWorkspace';
import { TrafficPanel } from './components/layout/TrafficPanel';
import { SplitPane } from './components/primitives';
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

  const selected = exchanges.find((e) => e.id === selectedId);

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
    onSessionLoaded: () => setSelectedId(undefined)
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
      onSelect={setSelectedId}
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

  const leftColumn = (
    <LeftColumn
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
        }
      }}
      deviceProps={{
        clients,
        now,
        proxyRunning: status.running,
        activeClientFilter: filter.client,
        untrackedCount: countWithoutClientIp(exchanges),
        onFilterClient: (ip) => patchFilter({ client: ip })
      }}
    >
      {trafficPanel}
    </LeftColumn>
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

      {mode === 'capture' ? (
        /* 캡처 모드: 좌(프록시+기기+트래픽) | 우(상세 풀높이) */
        <div className="min-h-0 flex-1">
          <SplitPane
            left={leftColumn}
            right={
              <div className="h-full overflow-auto">
                <ExchangeDetail
                  exchange={selected}
                  clientDescription={clientDescriptionOf(selected)}
                  onCloneToMock={exchangeActions.cloneToMock}
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
            }
          />
        </div>
      )}

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
