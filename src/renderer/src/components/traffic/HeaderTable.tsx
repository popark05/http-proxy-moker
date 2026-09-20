import { Fragment } from 'react';

export function HeaderTable({ headers }: { headers: Array<[string, string]> }): JSX.Element {
  if (headers.length === 0) {
    return <div className="px-2 py-1 font-mono text-xs text-muted-foreground">헤더 없음</div>;
  }
  return (
    <dl className="m-0 grid grid-cols-[minmax(120px,auto)_1fr] font-mono text-xs">
      {headers.map(([name, value], i) => (
        <Fragment key={i}>
          <dt className="truncate border-b border-border px-2 py-1 text-muted-foreground">
            {name}
          </dt>
          <dd className="m-0 border-b border-border px-2 py-1 break-all text-foreground">
            {value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
