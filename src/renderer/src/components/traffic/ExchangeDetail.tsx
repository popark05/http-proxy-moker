import { useState } from 'react';
import { Copy, MousePointerClick } from 'lucide-react';
import type { CapturedExchange } from '@shared/capture';
import { Badge } from '@astryxdesign/core/Badge';
import { EmptyState } from '../common/EmptyState';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { methodTone, statusTone } from '../primitives';
import { HeaderTable } from './HeaderTable';
import { BodyView } from './BodyView';
import { TagEditor } from './TagEditor';

interface ExchangeDetailProps {
  exchange: CapturedExchange | undefined;
  onCloneToMock?: (exchange: CapturedExchange) => void;
  onAddTag?: (id: string, tag: string) => void;
  onRemoveTag?: (id: string, tag: string) => void;
  /** 이 요청을 보낸 기기 설명(예: "iPhone · iOS 17.4 (192.168.0.10)"). 알 수 없으면 생략. */
  clientDescription?: string;
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h4 className="px-3 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h4>
  );
}

export function ExchangeDetail({
  exchange,
  onCloneToMock,
  onAddTag,
  onRemoveTag,
  clientDescription
}: ExchangeDetailProps): React.JSX.Element {
  const [tab, setTab] = useState<'request' | 'response'>('request');
  if (!exchange) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={MousePointerClick}
          title="요청을 선택하세요"
          description="왼쪽 트래픽 목록에서 항목을 선택하면 요청·응답 상세와 편집 옵션이 표시됩니다."
        />
      </div>
    );
  }

  const { request, response } = exchange;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Badge variant={methodTone(request.method)} label={request.method} className="shrink-0" />
        {response === 'aborted' ? (
          <Badge variant="error" label="중단됨" className="shrink-0" />
        ) : response ? (
          <Badge
            variant={statusTone(response.statusCode)}
            label={`${response.statusCode} ${response.statusMessage}`}
            className="shrink-0"
          />
        ) : (
          <Badge variant="neutral" label="대기 중" className="shrink-0" />
        )}
        <span className="break-all font-mono text-sm text-muted-foreground">{request.url}</span>
        {clientDescription && (
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground" title="이 요청을 보낸 기기">
            {clientDescription}
          </span>
        )}
        <div className="flex-1" />
        {onCloneToMock && (
          <Button
            label="목으로 복제"
            icon={<Icon icon={Copy} />}
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => onCloneToMock(exchange)}
          />
        )}
      </div>

      {(onAddTag || onRemoveTag) && (
        <TagEditor
          tags={exchange.tags ?? []}
          onAdd={(tag) => onAddTag?.(exchange.id, tag)}
          onRemove={(tag) => onRemoveTag?.(exchange.id, tag)}
        />
      )}

      <TabList role="tablist" value={tab} onChange={(v) => setTab(v as 'request' | 'response')} hasDivider>
        <Tab value="request" label="요청" panelId="exchange-panel-request" />
        <Tab value="response" label="응답" panelId="exchange-panel-response" />
      </TabList>

      {tab === 'request' ? (
        <div id="exchange-panel-request" role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          <SectionTitle>헤더</SectionTitle>
          <HeaderTable headers={request.headers} />
          <SectionTitle>본문</SectionTitle>
          <div className="h-[60vh] min-h-[420px]">
            <BodyView body={request.body} />
          </div>
        </div>
      ) : (
        <div id="exchange-panel-response" role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          {response && response !== 'aborted' ? (
            <>
              <SectionTitle>헤더</SectionTitle>
              <HeaderTable headers={response.headers} />
              <SectionTitle>본문</SectionTitle>
              <div className="h-[60vh] min-h-[420px]">
                <BodyView body={response.body} />
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {response === 'aborted' ? '요청이 중단되었습니다.' : '응답을 기다리는 중...'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
