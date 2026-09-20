import styled from 'styled-components';

/** 콘텐츠를 담는 기본 표면. */
export const Panel = styled.section`
  background: ${({ theme }) => theme.panelBackground};
  border: 1px solid ${({ theme }) => theme.borderSubtle};
  border-radius: ${({ theme }) => theme.radii.lg};
  overflow: hidden;
`;

export const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space.md};
  padding: ${({ theme }) => `${theme.space.md} ${theme.space.lg}`};
  border-bottom: 1px solid ${({ theme }) => theme.borderSubtle};
  font-size: ${({ theme }) => theme.fontSizes.subHeading};
  font-weight: 600;
`;

export const PanelBody = styled.div`
  padding: ${({ theme }) => theme.space.lg};
`;
