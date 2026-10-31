import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileJson, FlaskConical, FolderClock, Layers, Library, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { buildProjectTree } from '../../lib/project-tree';
import type { GroupId, ProjectTreeInput, TreeGroup, TreeNode } from '../../lib/project-tree';
import { useContextMenu } from '../primitives';
import type { MenuItem } from '../primitives';

interface ProjectTreeProps {
  input: Omit<ProjectTreeInput, 'query'>;
  onOpenMocks: () => void;
  onLoadSession: (name: string) => void;
  onToggleMock: (id: string, enabled: boolean) => void;
  onSaveMockAsCase: (id: string) => void;
  onRemoveMock: (id: string) => void;
  onActivateScenario: (name: string) => void;
  onEditScenario: (name: string) => void;
  onDeleteScenario: (name: string) => void;
  onUpdateActiveScenario: () => void;
  onOpenLibrary: () => void;
  onOpenContracts: () => void;
  onRemoveContract: (name: string) => void;
}

const GROUP_ICON: Record<GroupId, typeof Layers> = {
  sessions: FolderClock,
  mocks: FlaskConical,
  scenarios: Layers,
  library: Library,
  contracts: FileJson
};

const EMPTY_HINT: Record<GroupId, string> = {
  sessions: '저장한 캡처 세션이 없습니다',
  mocks: '요청을 "목으로 복제"하면 여기에 쌓입니다',
  scenarios: '저장한 시나리오가 없습니다',
  library: '케이스가 없습니다',
  contracts: '저장한 계약이 없습니다'
};

/** 프로젝트 자산 트리(캡처 세션·목·시나리오·케이스 라이브러리·계약). 클릭은 기본 동작, 우클릭은 메뉴. */
export function ProjectTree(props: ProjectTreeProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<GroupId>>(new Set());
  const { open: openMenu, element: menuElement } = useContextMenu();
  const treeRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => buildProjectTree({ ...props.input, query }), [props.input, query]);

  const toggleGroup = (id: GroupId): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const menuFor = (node: TreeNode): MenuItem[] => {
    switch (node.kind) {
      case 'session':
        return [{ label: '불러오기', onSelect: () => props.onLoadSession(node.label) }];
      case 'mock': {
        const id = node.key.slice('mock:'.length);
        return [
          { label: node.enabled ? '끄기' : '켜기', onSelect: () => props.onToggleMock(id, !node.enabled) },
          { label: '케이스로 저장', onSelect: () => props.onSaveMockAsCase(id) },
          { label: '삭제', destructive: true, onSelect: () => props.onRemoveMock(id) }
        ];
      }
      case 'scenario':
        return [
          { label: '활성화', disabled: node.active, onSelect: () => props.onActivateScenario(node.label) },
          { label: '편집', onSelect: () => props.onEditScenario(node.label) },
          ...(node.active ? [{ label: '현재 작업 공간으로 갱신', onSelect: props.onUpdateActiveScenario }] : []),
          { label: '삭제', destructive: true, onSelect: () => props.onDeleteScenario(node.label) }
        ];
      case 'endpoint':
      case 'case':
        return [{ label: '케이스 라이브러리 열기', onSelect: props.onOpenLibrary }];
      case 'contract':
        return [
          { label: '계약 테스트 열기', onSelect: props.onOpenContracts },
          { label: '삭제', destructive: true, onSelect: () => props.onRemoveContract(node.label) }
        ];
    }
  };

  /** 삭제 키로 지울 수 있는 항목의 삭제 동작(확인 창은 각 핸들러가 띄운다). */
  const deleteFor = (node: TreeNode): (() => void) | undefined => {
    switch (node.kind) {
      case 'mock':
        return () => props.onRemoveMock(node.key.slice('mock:'.length));
      case 'scenario':
        return () => props.onDeleteScenario(node.label);
      case 'contract':
        return () => props.onRemoveContract(node.label);
      default:
        return undefined;
    }
  };

  const nodeByKey = useMemo(() => {
    const map = new Map<string, TreeNode>();
    const visit = (node: TreeNode): void => {
      map.set(node.key, node);
      if (node.kind === 'endpoint') node.children.forEach(visit);
    };
    groups.forEach((g) => g.children.forEach(visit));
    return map;
  }, [groups]);

  const focusables = (): HTMLElement[] =>
    Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-focus]') ?? []);

  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    const kind = target.dataset.treeFocus;
    if (!kind) return;
    const all = focusables();
    const at = all.indexOf(target);
    const move = (to: number): void => {
      e.preventDefault();
      all[Math.max(0, Math.min(all.length - 1, to))]?.focus();
    };
    const groupId = target.dataset.groupId as GroupId | undefined;
    const node = kind === 'item' ? nodeByKey.get(target.dataset.nodeKey ?? '') : undefined;

    switch (e.key) {
      case 'ArrowDown':
        return move(at + 1);
      case 'ArrowUp':
        return move(at - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(all.length - 1);
      case 'ArrowRight':
        if (kind === 'group' && groupId) {
          e.preventDefault();
          if (collapsed.has(groupId)) toggleGroup(groupId);
          else move(at + 1);
        }
        return;
      case 'ArrowLeft':
        if (kind === 'group' && groupId && !collapsed.has(groupId)) {
          e.preventDefault();
          toggleGroup(groupId);
        } else if (kind === 'item') {
          e.preventDefault();
          treeRef.current?.querySelector<HTMLElement>(`[data-tree-focus=group][data-group-id=${groupId}]`)?.focus();
        }
        return;
      case 'Enter':
      case ' ':
        if (node) {
          e.preventDefault();
          activate(node);
        }
        return;
      case 'Delete':
      case 'Backspace': {
        const remove = node && deleteFor(node);
        if (remove) {
          e.preventDefault();
          remove();
        }
        return;
      }
      case 'ContextMenu':
      case 'F10': {
        if (!node || (e.key === 'F10' && !e.shiftKey)) return;
        const rect = target.getBoundingClientRect();
        openMenu(
          {
            clientX: rect.left + 24,
            clientY: rect.bottom,
            preventDefault: () => e.preventDefault(),
            stopPropagation: () => e.stopPropagation()
          },
          menuFor(node)
        );
      }
    }
  };

  const activate = (node: TreeNode): void => {
    switch (node.kind) {
      case 'session':
        return props.onLoadSession(node.label);
      case 'mock':
        return props.onOpenMocks();
      case 'scenario':
        return props.onActivateScenario(node.label);
      case 'endpoint':
      case 'case':
        return props.onOpenLibrary();
      case 'contract':
        return props.onOpenContracts();
    }
  };

  const renderNode = (node: TreeNode, depth: number, groupId: GroupId): JSX.Element => (
    <div key={node.key}>
      <div
        role="treeitem"
        tabIndex={0}
        data-tree-focus="item"
        data-group-id={groupId}
        onClick={() => activate(node)}
        onDoubleClick={node.kind === 'scenario' ? () => props.onEditScenario(node.label) : undefined}
        onContextMenu={(e) => openMenu(e, menuFor(node))}
        data-node-key={node.key}
        style={{ paddingLeft: 12 + depth * 14 }}
        className="group flex h-7 cursor-pointer items-center gap-2 pr-3 text-xs hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <NodeBody node={node} onToggleMock={props.onToggleMock} />
      </div>
      {node.kind === 'endpoint' && node.children.map((child) => renderNode(child, depth + 1, groupId))}
    </div>
  );

  const renderGroup = (group: TreeGroup): JSX.Element => {
    const Icon = GROUP_ICON[group.id];
    const isOpen = !collapsed.has(group.id) || !!query;
    return (
      <section key={group.id} aria-label={group.label}>
        <button
          type="button"
          aria-expanded={isOpen}
          data-tree-focus="group"
          data-group-id={group.id}
          onClick={() => toggleGroup(group.id)}
          className="flex h-7 w-full items-center gap-1.5 px-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <Icon className="size-3.5" />
          {group.label}
          <span className="ml-auto font-normal">{group.total}</span>
        </button>
        {isOpen &&
          (group.children.length > 0 ? (
            group.children.map((node) => renderNode(node, 0, group.id))
          ) : (
            <p className="px-8 py-1 text-xs text-muted-foreground">{EMPTY_HINT[group.id]}</p>
          ))}
      </section>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative shrink-0 px-3 py-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // 검색창에서 아래 화살표로 트리의 첫 항목으로 내려간다.
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusables()[0]?.focus();
            }
          }}
          placeholder="목 · 시나리오 · 계약 검색"
          aria-label="프로젝트 검색"
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div ref={treeRef} role="tree" onKeyDown={onTreeKeyDown} className="min-h-0 flex-1 overflow-auto pb-3">
        {groups.length > 0 ? (
          groups.map(renderGroup)
        ) : (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">검색 결과가 없습니다</p>
        )}
        {!props.input.hasProject && !query && (
          <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            프로젝트를 열면 캡처 세션, 시나리오, 케이스 라이브러리, 계약이 여기에 나타납니다.
          </p>
        )}
      </div>
      {menuElement}
    </div>
  );
}

function NodeBody({
  node,
  onToggleMock
}: {
  node: TreeNode;
  onToggleMock: (id: string, enabled: boolean) => void;
}): JSX.Element {
  switch (node.kind) {
    case 'mock':
      return (
        <>
          <input
            type="checkbox"
            checked={node.enabled}
            aria-label={`${node.label} 활성`}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onToggleMock(node.key.slice('mock:'.length), e.target.checked)}
            className="size-3.5 shrink-0 accent-[hsl(var(--warning))]"
          />
          <span className="shrink-0 text-2xs font-semibold text-muted-foreground">{node.method}</span>
          <span className={cn('truncate', !node.enabled && 'text-muted-foreground line-through')}>{node.path}</span>
          {node.hits > 0 && (
            <Badge variant="warning" className="ml-auto shrink-0">
              {node.hits}
            </Badge>
          )}
        </>
      );
    case 'scenario':
      return (
        <>
          <Layers className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn('truncate', node.active && 'font-medium text-foreground')}>{node.label}</span>
          {node.base && <span className="shrink-0 text-2xs text-muted-foreground">← {node.base}</span>}
          <span className="ml-auto flex shrink-0 gap-1">
            {node.active && <Badge variant="success">활성</Badge>}
            {node.dirty && <Badge variant="warning">수정됨</Badge>}
          </span>
        </>
      );
    case 'session':
      return (
        <>
          <FolderClock className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.label}</span>
        </>
      );
    case 'endpoint':
      return (
        <>
          <span className="shrink-0 text-2xs font-semibold text-muted-foreground">{node.method}</span>
          <span className="truncate">{node.path}</span>
        </>
      );
    case 'case':
      return <span className="truncate text-muted-foreground">{node.label}</span>;
    case 'contract':
      return (
        <>
          <span className="shrink-0 text-2xs font-semibold text-muted-foreground">{node.method}</span>
          <span className="truncate">{node.label}</span>
        </>
      );
  }
}
