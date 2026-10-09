import type { ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'outline' | 'quiet'

type UIButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

export function UIButton({
  variant = 'quiet',
  className = '',
  type = 'button',
  ...props
}: UIButtonProps) {
  return (
    <button
      className={['rift-button', 'rift-button--' + variant, className].filter(Boolean).join(' ')}
      type={type}
      {...props}
    />
  )
}
