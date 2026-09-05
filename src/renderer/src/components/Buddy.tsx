import { useState } from 'react'

export type Mood = 'asleep' | 'calm' | 'working' | 'alert'

interface Props {
  mood: Mood
  size?: number
  title?: string
  onClick?: () => void
}

/**
 * The buddy. Its mood is derived from real fleet state rather than decoration:
 * asleep with nothing open, watchful while output streams, and visibly agitated
 * the moment a pane goes quiet and wants you. It is the fastest read in the app.
 */
export default function Buddy({ mood, size = 26, title, onClick }: Props): React.JSX.Element {
  const [poked, setPoked] = useState(false)

  const poke = (): void => {
    setPoked(true)
    window.setTimeout(() => setPoked(false), 700)
    onClick?.()
  }

  const asleep = mood === 'asleep'
  const alert = mood === 'alert'

  return (
    <span
      className={`buddy buddy-${mood} ${poked ? 'is-poked' : ''}`}
      style={{ width: size, height: size }}
      title={title}
      onClick={poke}
      role="img"
      aria-label={`Coop buddy, ${mood}`}
    >
      <svg viewBox="0 0 40 44" width={size} height={size * 1.1}>
        <defs>
          <linearGradient id="buddySkin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>

        <g className="buddy-antenna">
          <path d="M20 10 L20 4" stroke="var(--accent-2)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <circle className="buddy-bulb" cx="20" cy="3.4" r="3.2" fill="var(--accent-2)" />
        </g>

        <g className="buddy-body">
          <rect x="4" y="9" width="32" height="30" rx="11" fill="url(#buddySkin)" />

          {asleep ? (
            <g stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="round" fill="none">
              <path d="M11.5 23 q3 3 6 0" />
              <path d="M22.5 23 q3 3 6 0" />
            </g>
          ) : (
            <g className="buddy-eyes">
              <circle cx="14.5" cy="22" r={alert ? 5.4 : 4.6} fill="#fff" />
              <circle cx="25.5" cy="22" r={alert ? 5.4 : 4.6} fill="#fff" />
              <g className="buddy-pupils" fill="var(--bg)">
                <circle cx="14.5" cy="22" r={alert ? 2.7 : 2.3} />
                <circle cx="25.5" cy="22" r={alert ? 2.7 : 2.3} />
              </g>
            </g>
          )}

          <path
            className="buddy-mouth"
            d={alert ? 'M16 31 q4 -3.5 8 0' : asleep ? 'M17 31 h6' : 'M16 30.5 q4 3.5 8 0'}
            stroke="var(--bg)"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        </g>

        {asleep && (
          <g className="buddy-zzz" fill="var(--fg-faint)" fontSize="9" fontWeight="700">
            <text x="29" y="14">z</text>
            <text x="33" y="8" fontSize="7">z</text>
          </g>
        )}

        {alert && (
          <g className="buddy-bang">
            <circle cx="32" cy="12" r="7" fill="var(--warn)" />
            <text x="32" y="16" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--bg)">
              !
            </text>
          </g>
        )}
      </svg>
    </span>
  )
}
