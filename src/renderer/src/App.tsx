import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { AppThemeProvider } from './theme/ThemeProvider';
import { AppModeProvider, useAppMode } from './state/app-mode';
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

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const Content = styled.div`
  flex: 1;
  min-height: 0;
`;

const LeftColumn = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const ListArea = styled.div`
  flex: 1;
  min-height: 0;
`;

const DeviceArea = styled.div`
  padding: ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.md};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
  max-height: 40%;
  overflow: auto;
`;

const RightColumn = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const DetailArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
`;

const MockArea = styled.div`
  border-top: 1px solid ${({ theme }) => theme.borderSubtle};
  padding: ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.md};
  max-height: 50%;
  overflow: auto;
`;

const ScenarioDivider = styled.hr`
  border: none;
  border-top: 1px dashed ${({ theme }) => theme.borderSubtle};
  margin: ${({ theme }) => theme.space.md} 0;
`;

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
    // 시나리오를 목 목록으로 로드. 목킹 모드면 useEffect가 mocks 변경을 감지해 즉시 적용.
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
    invalidateIndex(id); // 검색 인덱스 갱신(태그가 인덱스에 포함됨)
  };

  const handleRemoveTag = (id: string, tag: string): void => {
    removeTag(id, tag);
    invalidateIndex(id);
  };

  return (
    <Shell>
      <TopBar />
      <ProjectBar
        project={project}
        exchanges={exchanges}
        onCreate={(name) => void createProject(name)}
        onOpen={() => void openProject()}
        onSave={(name) => void saveCapture(name, exchanges)}
        onLoadSession={(name) => void handleLoadSession(name)}
      />
      <Content>
        <SplitPane
          left={
            <LeftColumn>
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
              <DeviceArea>
                <DevicePanel />
              </DeviceArea>
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
              <ListArea>
                <TrafficList
                  exchanges={filtered}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </ListArea>
            </LeftColumn>
          }
          right={
            <RightColumn>
              <DetailArea>
                <ExchangeDetail
                  exchange={selected}
                  onCloneToMock={(exchange) => cloneFromExchange(exchange)}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                />
              </DetailArea>
              <MockArea>
                <MockPanel
                  mocks={mocks}
                  mode={mode}
                  blockUnmatched={blockUnmatched}
                  onBlockUnmatchedChange={setBlockUnmatched}
                  onUpdate={updateMock}
                  onRemove={removeMock}
                  onSaveScenario={(name) => void handleSaveScenario(name)}
                />
                <ScenarioDivider />
                <ScenarioPanel
                  scenarios={project?.scenarios ?? []}
                  activeScenario={activeScenario}
                  onActivate={(name) => void handleActivateScenario(name)}
                  onDelete={(name) => void handleDeleteScenario(name)}
                />
              </MockArea>
            </RightColumn>
          }
        />
      </Content>
    </Shell>
  );
}

export function App(): JSX.Element {
  return (
    <AppThemeProvider>
      <AppModeProvider>
        <AppInner />
      </AppModeProvider>
    </AppThemeProvider>
  );
}
