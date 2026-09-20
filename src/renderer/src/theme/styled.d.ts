import 'styled-components';
import type { AppTheme } from './theme';

declare module 'styled-components' {
  // styled-components의 DefaultTheme을 우리 AppTheme으로 확장.
  export interface DefaultTheme extends AppTheme {}
}
