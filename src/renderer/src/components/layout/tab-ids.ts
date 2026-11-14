/** 탭과 탭 패널을 aria로 잇는 id. 키에 공백이나 한글이 들어갈 수 있어 인코딩한다(id/idref는 공백을 못 쓴다). */
export const tabId = (key: string): string => `tab-${encodeURIComponent(key)}`;
export const panelId = (key: string): string => `panel-${encodeURIComponent(key)}`;
