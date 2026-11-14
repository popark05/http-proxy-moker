/** Astryx 버튼은 native disabled 대신 aria-disabled로 비활성을 표시한다(포커스를 잃지 않으려는 설계). 둘 다 인정한다. */
export function isDisabled(el: HTMLElement): boolean {
  const target = (el.closest('button') ?? el) as HTMLButtonElement;
  return target.disabled === true || target.getAttribute('aria-disabled') === 'true';
}
