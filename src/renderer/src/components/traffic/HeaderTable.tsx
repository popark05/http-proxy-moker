import { Fragment } from 'react';
import styled from 'styled-components';

const Table = styled.dl`
  display: grid;
  grid-template-columns: minmax(120px, auto) 1fr;
  gap: 0;
  margin: 0;
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
`;

const Key = styled.dt`
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  color: ${({ theme }) => theme.secondaryText};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Value = styled.dd`
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  margin: 0;
  color: ${({ theme }) => theme.primaryText};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
  word-break: break-all;
`;

export function HeaderTable({ headers }: { headers: Array<[string, string]> }): JSX.Element {
  if (headers.length === 0) return <Value>헤더 없음</Value>;
  return (
    <Table>
      {headers.map(([name, value], i) => (
        <Fragment key={i}>
          <Key>{name}</Key>
          <Value>{value}</Value>
        </Fragment>
      ))}
    </Table>
  );
}
