import type { LucideIcon } from 'lucide-react';

type IconSize = 20 | 24 | 28;
type IconTint = 'gold' | 'navy' | 'success' | 'danger' | 'white' | 'light' | 'stock' | 'invoice' | 'account';
type IconShape = 'circle' | 'rounded';

interface IconBadgeProps {
  icon: LucideIcon;
  size?: IconSize;
  tint?: IconTint;
  shape?: IconShape;
  strokeWidth?: number;
  className?: string;
}

const SIZE_MAP: Record<IconSize, { container: number; icon: number; radius: number }> = {
  20: { container: 36, icon: 20, radius: 10 },
  24: { container: 44, icon: 24, radius: 12 },
  28: { container: 52, icon: 28, radius: 14 },
};

const TINT_MAP: Record<IconTint, { bg: string; color: string }> = {
  gold: { bg: '#F0F3FF', color: '#185FA5' },
  navy: { bg: '#F0F3FF', color: '#1E2A80' },
  success: { bg: '#E8F6F0', color: '#1F9D6B' },
  danger: { bg: '#FDEDE9', color: '#2050D8' },
  white: { bg: '#FFFFFF', color: '#1E2A80' },
  light: { bg: 'rgba(255,255,255,0.18)', color: '#FFFFFF' },
  stock: { bg: '#E1F5EE', color: '#0F6E56' },
  invoice: { bg: '#EAF3FB', color: '#2E86C1' },
  account: { bg: '#F3E7CC', color: '#D9A441' },
};

export function IconBadge({
  icon: Icon,
  size = 20,
  tint = 'navy',
  shape = 'rounded',
  strokeWidth = 2,
  className,
}: IconBadgeProps) {
  const { container, icon: iconSize, radius } = SIZE_MAP[size];
  const { bg, color } = TINT_MAP[tint];

  return (
    <div
      className={className}
      style={{
        width: container,
        height: container,
        borderRadius: shape === 'circle' ? '50%' : radius,
        backgroundColor: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon size={iconSize} color={color} strokeWidth={strokeWidth} />
    </div>
  );
}
