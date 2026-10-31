import type { ComponentProps } from 'react';
import type { CapturedExchange } from '@shared/capture';
import { Separator } from '@/components/ui/separator';
import { CloneSourceBar } from '../mock/CloneSourceBar';
import { MockPanel } from '../mock/MockPanel';
import { ScenarioPanel } from '../mock/ScenarioPanel';

interface MockWorkspaceProps {
  /** 복제 소스로 선택한 트래픽. */
  selected: CapturedExchange | undefined;
  cloneSourceProps: Omit<ComponentProps<typeof CloneSourceBar>, 'exchange'>;
  mockProps: ComponentProps<typeof MockPanel>;
  scenarioProps: ComponentProps<typeof ScenarioPanel>;
}

/** 목킹 모드의 우측 영역: 복제 소스 요약 + 목 정의/편집 + 시나리오. */
export function MockWorkspace({ selected, cloneSourceProps, mockProps, scenarioProps }: MockWorkspaceProps): JSX.Element {
  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* 선택한 트래픽은 한 줄 요약 + 복제 버튼으로만 두고, 상세는 펼쳤을 때만 보여준다 */}
      {selected && <CloneSourceBar exchange={selected} {...cloneSourceProps} />}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <MockPanel {...mockProps} />
        <Separator className="my-3" />
        <ScenarioPanel {...scenarioProps} />
      </div>
    </div>
  );
}
