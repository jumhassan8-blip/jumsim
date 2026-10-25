import { useEffect, useRef } from 'react'

/** renders a scannable QR code onto a canvas (bundled qrcode lib, no network) */
export default function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let alive = true
    import('qrcode')
      .then((QRCode) => {
        if (!alive || !ref.current) return
        QRCode.toCanvas(ref.current, value, {
          width: size,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#FFFFFF' },
        })
      })
      .catch(() => {
        /* canvas stays blank — LPA string copy is the fallback */
      })
    return () => {
      alive = false
    }
  }, [value, size])

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="eSIM installation QR code"
      className="rounded-xl"
      style={{ width: size, height: size }}
    />
  )
}
