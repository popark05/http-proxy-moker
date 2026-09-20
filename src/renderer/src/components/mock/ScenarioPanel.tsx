import { Trash2, Play, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ScenarioPanelProps {
  scenarios: string[];
  activeScenario: string | undefined;
  onActivate: (name: string) => void;
  onDelete: (name: string) => void;
}

/** 저장된 목 시나리오 목록. 활성 시나리오 표시 + 활성화/삭제. */
export function ScenarioPanel({
  scenarios,
  activeScenario,
  onActivate,
  onDelete
}: ScenarioPanelProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        시나리오 ({scenarios.length})
      </h3>

      {scenarios.length === 0 ? (
        <div className="p-2 text-xs text-muted-foreground">
          저장된 시나리오가 없습니다. 목 정의를 만든 뒤 "시나리오 저장"을 누르세요.
        </div>
      ) : (
        scenarios.map((name) => {
          const active = name === activeScenario;
          return (
            <div
              key={name}
              className={cn(
                'flex items-center gap-2 rounded-md border p-2',
                active ? 'border-primary bg-accent' : 'border-border'
              )}
            >
              {active && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
              <span className="min-w-0 flex-1 truncate text-sm" title={name}>
                {name}
              </span>
              {active && <Badge variant="success">활성</Badge>}
              <Button
                variant={active ? 'ghost' : 'default'}
                size="sm"
                disabled={active}
                onClick={() => onActivate(name)}
              >
                <Play /> {active ? '적용됨' : '활성화'}
              </Button>
              <Button variant="ghost" size="icon" aria-label="삭제" onClick={() => onDelete(name)}>
                <Trash2 />
              </Button>
            </div>
          );
        })
      )}
    </div>
  );
}
