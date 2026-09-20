import { Switch } from '@/components/ui/switch';

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  'aria-label'?: string;
}

/** 기존 Toggle API를 shadcn Switch로 매핑하는 어댑터. */
export function Toggle({ checked, onCheckedChange, id, ...rest }: ToggleProps): JSX.Element {
  return (
    <Switch
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={rest['aria-label']}
    />
  );
}
