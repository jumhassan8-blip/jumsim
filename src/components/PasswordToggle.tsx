import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * Show/hide password toggle for every password field (login, sign-up,
 * confirm-password, reset-password, guest-checkout account creation).
 *
 * - eye-off (hidden, default) → tap → eye, characters visible; tap again
 *   re-hides. Uses type="password" ↔ "text" — never a masking workaround.
 * - type="button" + a separate hit area: never submits the form, and
 *   pointer-events keep the press from stealing focus from the input.
 * - Icon #9A9A9E at rest, lime when the password is visible.
 * - aria-label "Show password" / "Hide password".
 */
export default function PasswordToggle({
  id,
  visible,
  onToggle,
}: {
  id: string
  visible: boolean
  onToggle: (visible: boolean) => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={visible ? 'Hide password' : 'Show password'}
      aria-controls={id}
      aria-pressed={visible}
      title={visible ? 'Hide password' : 'Show password'}
      onPointerDown={(e) => e.preventDefault() /* keep input focus */}
      onClick={() => onToggle(!visible)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-[#9A9A9E] transition-colors"
      style={visible || hover ? { color: '#D7FF3F' } : undefined}
    >
      {visible ? <Eye size={18} /> : <EyeOff size={18} />}
    </button>
  )
}
