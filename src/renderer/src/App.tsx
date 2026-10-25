import { useEffect, useMemo, useState } from 'react';
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
import { contractsFromExchanges } from '@shared/contract';
import { useContracts } from './state/useContracts';
import { ContractModal } from './components/contract/ContractModal';
import { useScenarioLibrary } from './state/useScenarioLibrary';
import { useClients } from './state/useClients';
import { clientLabel, countWithoutClientIp } from '@shared/clients';
import { useTrafficFilter } from './state/useTrafficFilter';
import { useMockHits } from './state/useMockHits';
import { ProxyControls } from './components/traffic/ProxyControls';
import { FilterBar } from './components/traffic/FilterBar';
import { TrafficList } from './components/traffic/TrafficList';
import { ExchangeDetail } from './components/traffic/ExchangeDetail';
import { SplashScreen } from './components/brand/SplashScreen';
import { withProgress } from './state/with-progress';
import { operationId } from '@shared/progress';
import { CloneSourceBar } from './components/mock/CloneSourceBar';
import { TrafficGroupList } from './components/traffic/TrafficGroupList';
import { SelectionBar } from './components/traffic/SelectionBar';
import { DevicePanel } from './components/device/DevicePanel';
import { ProjectBar } from './components/project/ProjectBar';
import { MockPanel } from './components/mock/MockPanel';
import { ScenarioPanel } from './components/mock/ScenarioPanel';
import { ScenarioEditor } from './components/mock/ScenarioEditor';
import { LibraryModal } from './components/mock/LibraryModal';
import type { MockDefinition } from '@shared/mock';
import type { ScenarioV2 } from '@shared/scenario-library';

/** 에러 객체에서 사용자 표시용 메시지 추출. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function AppInner(): JSX.Element {
  const { exchanges, tlsErrors, status, startProxy, stopProxy, clear, replaceExchanges, addTag, removeTag } =
    useCapture();
  const {
    project,
    createProject,
    openProject,
    saveCapture,
    loadCapture
  } = useProject();
  const { mocks, cloneFromExchange, cloneMany, updateMock, removeMock, replaceMocks } = useMocks();
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

  const [proxyBusy, setProxyBusy] = useState<'starting' | 'stopping' | undefined>();

  const handleStartProxy = async (): Promise<void> => {
    setProxyBusy('starting');
    try {
      const next = await withProgress(operationId.proxyStart, '프록시 시작 중', () => startProxy());
      toast.success('프록시 시작', { description: `포트 ${next?.port ?? ''} 수신 중` });
    } catch (e) {
      toast.error('프록시 시작 실패', { description: errMsg(e) });
    } finally {
      setProxyBusy(undefined);
    }
  };

  const handleStopProxy = async (): Promise<void> => {
    setProxyBusy('stopping');
    try {
      await withProgress(operationId.proxyStop, '프록시 중지 중', () => stopProxy());
      toast('프록시 중지됨');
    } catch (e) {
      toast.error('프록시 중지 실패', { description: errMsg(e) });
    } finally {
      setProxyBusy(undefined);
    }
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
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!project) {
      toast.error('시나리오 저장 실패', { description: '프로젝트를 먼저 열거나 만드세요.' });
      return;
    }
    if (
      scenarioLib.scenarios.some((s) => s.name === trimmed) &&
      !window.confirm(`"${trimmed}" 시나리오를 현재 작업 공간 내용으로 덮어쓸까요?`)
    ) {
      return;
    }
    try {
      const saved = await scenarioLib.saveFromWorkspace(trimmed);
      toast.success('시나리오 저장됨', { description: `${saved} · 목이 케이스 라이브러리에 저장되었습니다` });
    } catch (e) {
      toast.error('시나리오 저장 실패', { description: errMsg(e) });
    }
  };

  const handleActivateScenario = (name: string): void => {
    const { missing, cycle } = scenarioLib.activate(name);
    toast.success('시나리오 활성화', {
      description: mode === 'mock' ? `${name} 적용됨` : `${name} 로드됨 (목킹 모드에서 적용)`
    });
    if (cycle) toast.warning('베이스 상속이 순환합니다', { description: '시나리오 편집에서 베이스를 확인하세요.' });
    if (missing.length > 0) {
      toast.warning(`라이브러리에 없는 케이스 ${missing.length}개를 건너뜀`, { description: missing.join(', ') });
    }
  };

  const handleDeleteScenario = async (name: string): Promise<void> => {
    if (!window.confirm(`"${name}" 시나리오를 삭제할까요? (케이스 라이브러리는 유지됩니다)`)) return;
    try {
      await scenarioLib.deleteScenario(name);
      toast('시나리오 삭제됨', { description: name });
    } catch (e) {
      toast.error('삭제할 수 없습니다', { description: errMsg(e) });
    }
  };

  const handleUpdateActiveScenario = async (): Promise<void> => {
    try {
      await scenarioLib.updateActiveFromWorkspace();
      toast.success('시나리오 갱신됨', { description: activeScenario });
    } catch (e) {
      toast.error('시나리오 갱신 실패', { description: errMsg(e) });
    }
  };

  const handleSaveMockAsCase = async (mock: MockDefinition): Promise<void> => {
    if (!project) {
      toast.error('케이스 저장 실패', { description: '프로젝트를 먼저 열거나 만드세요.' });
      return;
    }
    try {
      const { created, caseName } = await scenarioLib.saveMockAsCase(mock);
      toast.success(created ? '케이스로 저장됨' : '케이스에 반영됨', {
        description: `${mock.method} ${mock.path} · ${caseName}`
      });
    } catch (e) {
      toast.error('케이스 저장 실패', { description: errMsg(e) });
    }
  };

  const caseNameOf = (mock: MockDefinition): string | undefined => {
    const ref = mock.caseRef;
    if (!ref) return undefined;
    return scenarioLib.library.endpoints
      .find((e) => e.id === ref.endpointId)
      ?.cases.find((c) => c.id === ref.caseId)?.name;
  };

  // 프로젝트를 열 때 v1 시나리오가 변환되었다면 한 번 알린다.
  useEffect(() => {
    if (scenarioLib.migratedCount > 0) {
      toast.info(`시나리오 ${scenarioLib.migratedCount}개를 케이스 라이브러리 형식으로 변환했습니다`, {
        description: '원본은 scenarios/*.v1.bak으로 보관됩니다.'
      });
    }
  }, [scenarioLib.migratedCount]);

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

  /** 체크된 요청들을 계약으로 저장. */
  const handleSaveContracts = async (): Promise<void> => {
    if (!project) {
      toast.error('계약 저장 실패', { description: '프로젝트를 먼저 열거나 만드세요. (상단 "열기" 또는 "새 프로젝트")' });
      return;
    }
    const targets = exchanges.filter((e) => checkedIds.has(e.id));
    try {
      const { saved, merged, skipped } = await contractState.saveFromExchanges(targets);
      setCheckedIds(new Set());
      const detail =
        (merged > 0 ? ` (이미 있는 ${merged}개는 응답 모양을 합침)` : '') +
        (skipped > 0 ? ` (응답이 없는 ${skipped}개는 건너뜀)` : '');
      if (saved === 0 && merged === 0) {
        toast.info('저장할 계약이 없습니다', { description: `응답이 있는 요청을 선택하세요${detail}` });
        return;
      }
      toast.success(saved > 0 ? `${saved}개 계약으로 저장됨` : '기존 계약에 합쳤습니다', {
        description: `contracts/ 폴더에 저장했습니다${detail}`,
        action: { label: '계약 테스트 열기', onClick: () => setContractsOpen(true) }
      });
    } catch (e) {
      toast.error('계약 저장 실패', { description: errMsg(e) });
    }
  };

  /** 체크된 요청들을 Bruno 컬렉션으로 바로 내보낸다(프로젝트 없이도 가능). 기존 컬렉션 폴더를 고르면 거기에 추가한다. */
  const handleExportBruno = async (): Promise<void> => {
    const targets = exchanges.filter((e) => checkedIds.has(e.id));
    const { contracts, skipped } = contractsFromExchanges(targets, () => `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    if (contracts.length === 0) {
      toast.info('내보낼 요청이 없습니다', { description: '응답이 있는 요청을 선택하세요' });
      return;
    }
    try {
      const out = await window.mokerApi.contract.exportBruno(project?.meta.name ?? 'EverMock', contracts, contractState.servers);
      if (!out) return;
      const notes = [
        out.existing > 0 ? `이미 있는 ${out.existing}개는 건너뜀` : '',
        skipped > 0 ? `응답 없는 ${skipped}개 제외` : ''
      ].filter(Boolean);
      toast.success(out.merged ? `기존 Bruno 컬렉션에 ${out.added}개 추가` : `Bruno 컬렉션 만듦 (${out.added}개 요청)`, {
        description: [out.dir, ...notes].join(' · ')
      });
    } catch (e) {
      toast.error('Bruno 내보내기 실패', { description: errMsg(e) });
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
        clients={clientOptions}
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
        onSaveContracts={() => void handleSaveContracts()}
        onExportBruno={() => void handleExportBruno()}
        view={trafficView}
        onViewChange={setTrafficView}
      />
      <div className="min-h-0 flex-1">
        {trafficView === 'group' ? (
          <TrafficGroupList
            exchanges={filtered}
            selectedId={selectedId}
            onSelect={setSelectedId}
            checkedIds={checkedIds}
            onCheckedChange={setCheckedIds}
          />
        ) : (
          <TrafficList
            exchanges={filtered}
            selectedId={selectedId}
            onSelect={setSelectedId}
            checkedIds={checkedIds}
            onCheckedChange={setCheckedIds}
            clientPlatforms={clientPlatforms}
          />
        )}
      </div>
    </div>
  );

  // 좌측 컬럼(프록시 컨트롤 + 기기 + 트래픽). 캡처/목킹 모드 공용: 목킹에서도 프록시 시작과 기기 연결이 필요하다.
  const leftColumn = (
      <div className="flex h-full flex-col">
        <ProxyControls
          status={status}
          busy={proxyBusy}
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
        <div className="max-h-[50%] shrink-0 overflow-auto border-b border-border px-4 py-2">
          <DevicePanel
            clients={clients}
            now={now}
            proxyRunning={status.running}
            activeClientFilter={filter.client}
            untrackedCount={countWithoutClientIp(exchanges)}
            onFilterClient={(ip) => patchFilter({ client: ip })}
          />
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
        onOpenContracts={() => setContractsOpen(true)}
        contractCount={contractState.contracts.length}
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
                  clientDescription={clientDescriptionOf(selected)}
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
                    clientDescription={clientDescriptionOf(selected)}
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
                    onSaveCase={(mock) => void handleSaveMockAsCase(mock)}
                    caseNameOf={caseNameOf}
                    hitCounts={mockHits.counts}
                    lastHitAt={mockHits.lastHitAt}
                    onResetHits={mockHits.reset}
                  />
                  <Separator className="my-3" />
                  <ScenarioPanel
                    scenarios={scenarioLib.scenarios}
                    activeScenario={activeScenario}
                    diff={scenarioLib.diff}
                    hasLibrary={scenarioLib.library.endpoints.length > 0}
                    onActivate={handleActivateScenario}
                    onEdit={(scenario) => setEditorTarget({ scenario })}
                    onDelete={(name) => void handleDeleteScenario(name)}
                    onUpdateActive={() => void handleUpdateActiveScenario()}
                    onNew={() => setEditorTarget({ scenario: undefined })}
                    onOpenLibrary={() => setLibraryOpen(true)}
                  />
                </div>
              </div>
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
