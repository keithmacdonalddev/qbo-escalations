import { useTooltipLevel, shouldShowTooltip } from '../hooks/useTooltipLevel.jsx';

export default function Tooltip({ text, level = 'low', position = 'top', children }) {
  const { level: activeLevel } = useTooltipLevel();

  if (!shouldShowTooltip(level, activeLevel)) {
    return children;
  }

  return (
    <span className={`tip-anchor tip-${position}`}>
      {children}
      <span className="tip-popover" role="tooltip">{text}</span>
    </span>
  );
}
