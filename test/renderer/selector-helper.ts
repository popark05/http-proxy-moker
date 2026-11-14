import { fireEvent, screen } from '@testing-library/react';

/** 라벨로 Astryx Selector(combobox 버튼)를 찾는다. */
export function selectorOf(label: string): HTMLElement {
  const el = screen.getAllByLabelText(label).find((e) => e.getAttribute('role') === 'combobox');
  if (!el) throw new Error(`Selector를 찾지 못했습니다: ${label}`);
  return el;
}

/** Selector를 열고 보이는 옵션 이름들을 돌려준다(열린 채로 둔다). */
export function openSelector(label: string): string[] {
  fireEvent.click(selectorOf(label));
  return screen.getAllByRole('option').map((o) => o.textContent ?? '');
}

/** Selector를 열고 옵션을 고른다. 옵션은 이름(부분 일치) 또는 정규식으로 지정한다. */
export function chooseOption(label: string, option: string | RegExp): void {
  openSelector(label);
  const match = (text: string): boolean => (typeof option === 'string' ? text.includes(option) : option.test(text));
  const target = screen.getAllByRole('option').find((o) => match(o.textContent ?? ''));
  if (!target) throw new Error(`옵션을 찾지 못했습니다: ${String(option)}`);
  fireEvent.click(target);
}
