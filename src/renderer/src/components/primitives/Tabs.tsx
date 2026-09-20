/** 기존 Tabs 네이밍(Tabs/TabsList/TabTrigger/TabContent)을 shadcn tabs로 재노출하는 어댑터. */
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export { Tabs, TabsList };
export const TabTrigger = TabsTrigger;
export const TabContent = TabsContent;
