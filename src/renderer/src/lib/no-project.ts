import { toast } from '@/lib/toast';

/** 프로젝트를 만들거나 여는 동작. App이 등록해 두면 저장 실패 토스트에서 바로 쓸 수 있다. */
interface ProjectOpeners {
  create: () => void;
  open: () => void;
}

let openers: ProjectOpeners | undefined;

export function registerProjectOpeners(next: ProjectOpeners | undefined): void {
  openers = next;
}

/** 프로젝트가 없어서 저장할 수 없을 때, 막다른 길 대신 "프로젝트 만들기 / 열기"를 보여 준다. */
export function toastNoProject(title: string): void {
  toast.error(title, {
    description: '저장하려면 프로젝트가 필요합니다.',
    action: openers ? { label: '프로젝트 만들기', onClick: openers.create } : undefined,
    cancel: openers ? { label: '열기', onClick: openers.open } : undefined
  });
}
