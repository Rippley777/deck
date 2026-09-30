import { useEffect, useState } from 'react';
import { Layers3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function StackGlyph({
  icon,
  color,
  size = 18,
}: {
  icon: string;
  color: string;
  size?: number;
}) {
  const [loaded, setLoaded] = useState<{ id: string; component: LucideIcon }>();
  useEffect(() => {
    let active = true;
    if (icon.startsWith('lucide:'))
      void import('./stack-icon-catalog')
        .then(({ loadStackIcon }) => loadStackIcon(icon))
        .then((component) => {
          if (active && component) setLoaded({ id: icon, component });
        })
        .catch(() => {
          // Keep the fallback glyph if an icon chunk cannot be loaded.
        });
    return () => {
      active = false;
    };
  }, [icon]);
  if (!icon.startsWith('lucide:'))
    return (
      <span className="stack-glyph-fallback" style={{ color }} aria-hidden="true">
        {icon}
      </span>
    );
  const Icon = loaded?.id === icon ? loaded.component : Layers3;
  return (
    <Icon
      className="stack-lucide-glyph"
      aria-hidden="true"
      size={size}
      strokeWidth={1.8}
      style={{ color }}
      data-icon={icon.slice(7)}
    />
  );
}
