import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { CapturedExchange } from '@shared/capture';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { methodTone, statusTone } from '../primitives';
import { ExchangeDetail } from '../traffic/ExchangeDetail';

interface CloneSourceBarProps {
  exchange: CapturedExchange;
  onCloneToMock: (exchange: CapturedExchange) => void;
  onAddTag: (id: string, tag: string) => void;
  onRemoveTag: (id: string, tag: string) => void;
  clientDescription?: string;
}

/**
 * 목킹 모드의 복제 소스 바. 선택한 트래픽을 한 줄로 요약하고 "목으로 복제"를 바로 제공한다.
 * 읽기 전용 상세(헤더/본문)는 필요할 때만 펼쳐 보게 해서, 기본 화면은 목 편집 영역이 차지한다.
 */
export function CloneSourceBar({
  exchange,
  onCloneToMock,
  onAddTag,
  onRemoveTag,
  clientDescription
}: CloneSourceBarProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { request, response } = exchange;

  return (
    <div className="shrink-0 border-b border-border bg-card/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={expanded ? '원본 상세 접기' : '원본 상세 펼치기'}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <Badge variant={methodTone(request.method)}>{request.method}</Badge>
        {response && response !== 'aborted' && (
          <Badge variant={statusTone(response.statusCode)}>{response.statusCode}</Badge>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground" title={request.url}>
          {request.url}
        </span>
        <Button variant="outline" size="sm" onClick={() => onCloneToMock(exchange)}>
          <Copy /> 목으로 복제
        </Button>
      </div>
      {expanded && (
        <div className="max-h-[50vh] overflow-auto border-t border-border">
          <ExchangeDetail
            exchange={exchange}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            clientDescription={clientDescription}
          />
        </div>
      )}
    </div>
  );
}
