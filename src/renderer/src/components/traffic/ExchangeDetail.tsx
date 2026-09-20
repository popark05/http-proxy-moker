import { Copy } from 'lucide-react';
import type { CapturedExchange } from '@shared/capture';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { methodTone, statusTone } from '../primitives';
import { HeaderTable } from './HeaderTable';
import { BodyView } from './BodyView';
import { TagEditor } from './TagEditor';

interface ExchangeDetailProps {
  exchange: CapturedExchange | undefined;
  onCloneToMock?: (exchange: CapturedExchange) => void;
  onAddTag?: (id: string, tag: string) => void;
  onRemoveTag?: (id: string, tag: string) => void;
}

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
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
  onRemoveTag
}: ExchangeDetailProps): JSX.Element {
  if (!exchange) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        왼쪽에서 요청을 선택하면 상세가 표시됩니다.
      </div>
    );
  }

  const { request, response } = exchange;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Badge variant={methodTone(request.method)}>{request.method}</Badge>
        {response === 'aborted' ? (
          <Badge variant="error">중단됨</Badge>
        ) : response ? (
          <Badge variant={statusTone(response.statusCode)}>
            {response.statusCode} {response.statusMessage}
          </Badge>
        ) : (
          <Badge variant="neutral">대기 중</Badge>
        )}
        <span className="break-all font-mono text-sm text-muted-foreground">{request.url}</span>
        <div className="flex-1" />
        {onCloneToMock && (
          <Button variant="outline" size="sm" onClick={() => onCloneToMock(exchange)}>
            <Copy /> 목으로 복제
          </Button>
        )}
      </div>

      {(onAddTag || onRemoveTag) && (
        <TagEditor
          tags={exchange.tags ?? []}
          onAdd={(tag) => onAddTag?.(exchange.id, tag)}
          onRemove={(tag) => onRemoveTag?.(exchange.id, tag)}
        />
      )}

      <Tabs defaultValue="request" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-2 w-fit">
          <TabsTrigger value="request">요청</TabsTrigger>
          <TabsTrigger value="response">응답</TabsTrigger>
        </TabsList>

        <TabsContent value="request" className="min-h-0 flex-1 overflow-auto">
          <SectionTitle>헤더</SectionTitle>
          <HeaderTable headers={request.headers} />
          <SectionTitle>본문</SectionTitle>
          <div className="h-80">
            <BodyView body={request.body} />
          </div>
        </TabsContent>

        <TabsContent value="response" className="min-h-0 flex-1 overflow-auto">
          {response && response !== 'aborted' ? (
            <>
              <SectionTitle>헤더</SectionTitle>
              <HeaderTable headers={response.headers} />
              <SectionTitle>본문</SectionTitle>
              <div className="h-80">
                <BodyView body={response.body} />
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {response === 'aborted' ? '요청이 중단되었습니다.' : '응답을 기다리는 중...'}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
