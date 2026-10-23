import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>
}
export function Button({ variant = 'primary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>
}
export function StatusPill({ status }: { status: string }) {
  const label = status === 'in' ? 'Checked in' : status === 'out' ? 'Checked out' : status
  return <span className={`status-pill status-${status.toLowerCase().replace(/\s/g, '-')}`}><i />{label}</span>
}
export function Modal({ title, children, onClose, footer, wide = false, drawer = false }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean; drawer?: boolean }) {
  const dialog = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),a[href]')
    focusable()?.[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key === 'Tab') {
        const items = focusable()
        if (!items?.length) return
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus() }
        else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus() }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.focus() }
  }, [])
  return <div className={`modal-backdrop ${drawer ? 'drawer-backdrop' : ''}`} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section ref={dialog} className={`${drawer ? 'drawer' : 'modal'} ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></header><div className="modal-content">{children}</div>{footer && <footer className="modal-footer">{footer}</footer>}</section></div>
}
export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return <label className="form-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}{error && <small className="field-error">{error}</small>}</label>
}
