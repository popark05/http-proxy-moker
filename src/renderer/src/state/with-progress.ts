import { toast } from 'sonner';

/**
 * 오래 걸리는 작업(프록시 시작/중지, 기기 인터셉션 시작/해제) 동안 로딩 토스트를 보여 준다.
 * main이 push하는 진행 단계(`operationProgress`)로 "지금 하는 일"을 같은 토스트에 갱신하고,
 * 작업이 끝나면(성공/실패 모두) 로딩 토스트를 닫는다. 결과 토스트는 호출부가 띄운다.
 */
export async function withProgress<T>(operation: string, title: string, run: () => Promise<T>): Promise<T> {
  const id = toast.loading(title);
  const unsubscribe = window.mokerApi.onOperationProgress((progress) => {
    if (progress.operation === operation) toast.loading(`${title} — ${progress.step}`, { id });
  });
  try {
    return await run();
  } finally {
    unsubscribe();
    toast.dismiss(id);
  }
}
