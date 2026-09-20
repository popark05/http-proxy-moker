import styled from 'styled-components';
import { Copy } from '@phosphor-icons/react';
import type { CapturedExchange } from '@shared/capture';
import {
  Tabs,
  TabsList,
  TabTrigger,
  TabContent,
  Badge,
  Button,
  methodTone,
  statusTone
} from '../primitives';
import { HeaderTable } from './HeaderTable';
import { BodyView } from './BodyView';
import { TagEditor } from './TagEditor';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const Summary = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => theme.space.md};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
`;

const SummaryUrl = styled.span`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.input};
  color: ${({ theme }) => theme.secondaryText};
  word-break: break-all;
`;

const Section = styled.div`
  padding: ${({ theme }) => theme.space.sm} 0;
`;

const SectionTitle = styled.h4`
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.mutedText};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
`;

const BodyWrap = styled.div`
  height: 320px;
`;

const Placeholder = styled.div`
  padding: ${({ theme }) => theme.space.xl};
  color: ${({ theme }) => theme.mutedText};
  text-align: center;
`;

interface ExchangeDetailProps {
  exchange: CapturedExchange | undefined;
  onCloneToMock?: (exchange: CapturedExchange) => void;
  onAddTag?: (id: string, tag: string) => void;
  onRemoveTag?: (id: string, tag: string) => void;
}

const SummarySpacer = styled.div`
  flex: 1;
`;

export function ExchangeDetail({
  exchange,
  onCloneToMock,
  onAddTag,
  onRemoveTag
}: ExchangeDetailProps): JSX.Element {
  if (!exchange) {
    return <Placeholder>왼쪽에서 요청을 선택하면 상세가 표시됩니다.</Placeholder>;
  }

  const { request, response } = exchange;

  return (
    <Wrap>
      <Summary>
        <Badge $tone={methodTone(request.method)}>{request.method}</Badge>
        {response === 'aborted' ? (
          <Badge $tone="error">중단됨</Badge>
        ) : response ? (
          <Badge $tone={statusTone(response.statusCode)}>
            {response.statusCode} {response.statusMessage}
          </Badge>
        ) : (
          <Badge $tone="neutral">대기 중</Badge>
        )}
        <SummaryUrl>{request.url}</SummaryUrl>
        <SummarySpacer />
        {onCloneToMock && (
          <Button $variant="secondary" $size="sm" onClick={() => onCloneToMock(exchange)}>
            <Copy size={14} /> 목으로 복제
          </Button>
        )}
      </Summary>

      {(onAddTag || onRemoveTag) && (
        <TagEditor
          tags={exchange.tags ?? []}
          onAdd={(tag) => onAddTag?.(exchange.id, tag)}
          onRemove={(tag) => onRemoveTag?.(exchange.id, tag)}
        />
      )}

      <Tabs defaultValue="request">
        <TabsList>
          <TabTrigger value="request">요청</TabTrigger>
          <TabTrigger value="response">응답</TabTrigger>
        </TabsList>

        <TabContent value="request">
          <Section>
            <SectionTitle>헤더</SectionTitle>
            <HeaderTable headers={request.headers} />
          </Section>
          <Section>
            <SectionTitle>본문</SectionTitle>
            <BodyWrap>
              <BodyView body={request.body} />
            </BodyWrap>
          </Section>
        </TabContent>

        <TabContent value="response">
          {response && response !== 'aborted' ? (
            <>
              <Section>
                <SectionTitle>헤더</SectionTitle>
                <HeaderTable headers={response.headers} />
              </Section>
              <Section>
                <SectionTitle>본문</SectionTitle>
                <BodyWrap>
                  <BodyView body={response.body} />
                </BodyWrap>
              </Section>
            </>
          ) : (
            <Placeholder>
              {response === 'aborted' ? '요청이 중단되었습니다.' : '응답을 기다리는 중...'}
            </Placeholder>
          )}
        </TabContent>
      </Tabs>
    </Wrap>
  );
}
