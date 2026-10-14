// Trimmed UI barrel — only the primitives the public marketing surfaces use.
// The dashboard-only controls (Sheet, Toast, Combobox, Switch, pickers, etc.)
// are intentionally not re-exported here; they depend on session/native plumbing
// that a static brochure must not pull in.
export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from './Button';
export { Card, SectionTitle, type CardProps } from './Card';
export { StatusPill, type PillTone } from './StatusPill';
