// An illustrated empty state: spot illustration, one-line title, a hint.
import Spot from './illustrations/Spot';

export default function EmptyState({ kind = 'generic', title, hint, color }) {
  return (
    <div className="empty">
      <Spot kind={kind} color={color} />
      {title && <div className="empty-title">{title}</div>}
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  );
}
