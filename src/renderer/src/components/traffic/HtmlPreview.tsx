/**
 * 캡처된 HTML을 격리된 iframe으로 렌더링한다.
 * - sandbox="" : 스크립트, 폼 제출, 팝업, 상위 페이지 접근, same-origin을 모두 막는다(응답은 신뢰할 수 없는 외부 콘텐츠).
 * - 앱의 CSP(default-src 'self')가 srcdoc에도 적용되어 외부 이미지/CSS/폰트 요청은 차단된다.
 *   따라서 인라인 스타일과 data: 이미지만 표시되는 "정적 미리보기"다.
 */
export function HtmlPreview({ html }: { html: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-3 py-1 text-xs text-muted-foreground">
        정적 미리보기: 스크립트는 실행되지 않고 외부 리소스(이미지/CSS/폰트)는 불러오지 않습니다.
      </div>
      {/* 페이지는 보통 흰 배경을 가정하고 만들어지므로 다크 테마와 무관하게 흰 배경을 깐다. */}
      <iframe
        title="HTML 응답 렌더링"
        sandbox=""
        srcDoc={html}
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
}
