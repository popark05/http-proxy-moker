import { useState } from 'react';
import styled, { css } from 'styled-components';
import { MoonStars, Sun, Certificate } from '@phosphor-icons/react';
import { Button } from '../primitives';
import { CaExportModal } from '../cert/CaExportModal';
import { useAppTheme } from '../../theme/ThemeProvider';
import { useAppMode } from '../../state/app-mode';

// 모드에 따라 상단 바 색을 강하게 구분해 QA가 현재 모드를 착각하지 않도록 한다.
const Bar = styled.header<{ $mode: 'capture' | 'mock' }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.lg};
  height: 52px;
  padding: 0 ${({ theme }) => theme.space.lg};
  -webkit-app-region: drag;
  padding-left: 84px; /* macOS 신호등 버튼 공간 */
  border-bottom: 3px solid
    ${({ theme, $mode }) => ($mode === 'capture' ? theme.captureModeColor : theme.mockModeColor)};
  background: ${({ theme }) => theme.panelBackground};

  ${({ $mode, theme }) =>
    $mode === 'mock' &&
    css`
      background: linear-gradient(
        to bottom,
        ${theme.panelBackground},
        ${theme.panelRaisedBackground}
      );
    `}
`;

const Title = styled.div`
  font-family: ${({ theme }) => theme.fonts.sans};
  font-weight: 700;
  font-size: ${({ theme }) => theme.fontSizes.subHeading};
`;

const ModeLabel = styled.span<{ $mode: 'capture' | 'mock' }>`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: ${({ theme }) => theme.fontSizes.smallPrint};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${({ theme, $mode }) =>
    $mode === 'capture' ? theme.captureModeColor : theme.mockModeColor};
`;

const Spacer = styled.div`
  flex: 1;
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  -webkit-app-region: no-drag;
`;

export function TopBar(): JSX.Element {
  const { themeName, toggleTheme } = useAppTheme();
  const { mode, setMode } = useAppMode();
  const [caOpen, setCaOpen] = useState(false);

  return (
    <Bar $mode={mode}>
      <Title>EverMock</Title>
      <ModeLabel $mode={mode}>{mode === 'capture' ? '● 캡처 모드' : '● 목킹 모드'}</ModeLabel>
      <Spacer />
      <Controls>
        <Button
          $variant="ghost"
          $size="sm"
          onClick={() => setMode(mode === 'capture' ? 'mock' : 'capture')}
        >
          {mode === 'capture' ? '목킹 모드로' : '캡처 모드로'}
        </Button>
        <Button $variant="ghost" $size="sm" aria-label="CA 인증서" onClick={() => setCaOpen(true)}>
          <Certificate size={16} /> CA
        </Button>
        <Button
          $variant="ghost"
          $size="sm"
          aria-label="테마 전환"
          onClick={toggleTheme}
        >
          {themeName === 'dark' ? <Sun size={16} /> : <MoonStars size={16} />}
        </Button>
      </Controls>
      <CaExportModal open={caOpen} onOpenChange={setCaOpen} />
    </Bar>
  );
}
