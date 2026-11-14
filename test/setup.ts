import '@testing-library/jest-dom/vitest';

// jsdom에는 <dialog>의 showModal/show/close가 없다(Astryx Dialog가 네이티브 <dialog>를 쓴다). open 속성만 맞춰 주는 최소 폴리필.
if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  const open = function (this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };
  proto.showModal ??= open;
  proto.show ??= open;
  proto.close ??= function (this: HTMLDialogElement): void {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
