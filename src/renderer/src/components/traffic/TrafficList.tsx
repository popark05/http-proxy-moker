import { useRef } from 'react';
import styled from 'styled-components';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CapturedExchange } from '@shared/capture';
import { Badge, methodTone, statusTone } from '../primitives';

const Scroll = styled.div`
  height: 100%;
  overflow: auto;
`;

const Row = styled.button<{ $selected: boolean }>`
  display: grid;
  grid-template-columns: 56px 1fr 52px;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  width: 100%;
  text-align: left;
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  border: none;
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
  background: ${({ theme, $selected }) =>
    $selected ? theme.panelRaisedBackground : 'transparent'};
  color: ${({ theme }) => theme.primaryText};
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.sans};

  &:hover {
    background: ${({ theme }) => theme.panelRaisedBackground};
  }
`;

const UrlCell = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Url = styled.span`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.input};
  color: ${({ theme }) => theme.secondaryText};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TagRow = styled.div`
  display: flex;
  gap: 3px;
  overflow: hidden;
`;

const TinyTag = styled.span`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 10px;
  line-height: 1.4;
  padding: 0 4px;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.panelRaisedBackground};
  color: ${({ theme }) => theme.mutedText};
  white-space: nowrap;
`;

const Empty = styled.div`
  padding: ${({ theme }) => theme.space.lg};
  color: ${({ theme }) => theme.mutedText};
  font-size: ${({ theme }) => theme.fontSizes.input};
`;

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

interface TrafficListProps {
  exchanges: CapturedExchange[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

/** 캡처된 트래픽 목록. @tanstack/react-virtual로 대량 렌더 최적화. */
export function TrafficList({ exchanges, selectedId, onSelect }: TrafficListProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: exchanges.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (exchanges[index]?.tags?.length ? 60 : 44),
    overscan: 12
  });

  if (exchanges.length === 0) {
    return <Empty>아직 캡처된 요청이 없습니다. 프록시를 시작하고 트래픽을 보내보세요.</Empty>;
  }

  return (
    <Scroll ref={parentRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const exchange = exchanges[item.index];
          const response = exchange.response;
          return (
            <div
              key={exchange.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`
              }}
            >
              <Row
                $selected={exchange.id === selectedId}
                onClick={() => onSelect(exchange.id)}
              >
                <Badge $tone={methodTone(exchange.request.method)}>
                  {exchange.request.method}
                </Badge>
                <UrlCell>
                  <Url title={exchange.request.url}>{shortUrl(exchange.request.url)}</Url>
                  {exchange.tags && exchange.tags.length > 0 && (
                    <TagRow>
                      {exchange.tags.map((t) => (
                        <TinyTag key={t}>{t}</TinyTag>
                      ))}
                    </TagRow>
                  )}
                </UrlCell>
                {response === 'aborted' ? (
                  <Badge $tone="error">✕</Badge>
                ) : response ? (
                  <Badge $tone={statusTone(response.statusCode)}>{response.statusCode}</Badge>
                ) : (
                  <Badge $tone="neutral">…</Badge>
                )}
              </Row>
            </div>
          );
        })}
      </div>
    </Scroll>
  );
}
