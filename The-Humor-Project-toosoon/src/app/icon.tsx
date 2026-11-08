import { ImageResponse } from 'next/og'

export const size = {
  width: 64,
  height: 64,
}

export const contentType = 'image/png'

const getDeploymentEnv = () => {
  if (typeof process === 'undefined') {
    return 'development'
  }

  return (
    process.env.NEXT_PUBLIC_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    'development'
  )
}

export default function Icon() {
  const deploymentEnv = getDeploymentEnv()
  const isProd = deploymentEnv === 'production'
  const palette = isProd
    ? {
        bgStart: '#60a5fa',
        bgEnd: '#2563eb',
        bubble: '#f8fafc',
        ink: '#0f172a',
        label: '#1d4ed8',
        tag: null,
      }
    : {
        bgStart: '#fb7185',
        bgEnd: '#be123c',
        bubble: '#fff1f2',
        ink: '#4c0519',
        label: '#9f1239',
        tag: {
          text: 'DEV',
          background: '#4c0519',
          color: '#fff1f2',
        },
      }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, ${palette.bgStart}, ${palette.bgEnd})`,
          borderRadius: 16,
          fontFamily: '"Trebuchet MS", Verdana, Arial, sans-serif',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 44,
            height: 32,
            background: palette.bubble,
            borderRadius: 12,
            border: `2px solid ${palette.ink}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: 1,
            color: palette.label,
          }}
        >
          HA
        </div>
        <div
          style={{
            position: 'absolute',
            width: 10,
            height: 10,
            left: 20,
            top: 42,
            background: palette.bubble,
            borderLeft: `2px solid ${palette.ink}`,
            borderBottom: `2px solid ${palette.ink}`,
            transform: 'rotate(45deg)',
          }}
        />
        {palette.tag ? (
          <div
            style={{
              position: 'absolute',
              right: 6,
              top: 6,
              padding: '2px 4px',
              borderRadius: 6,
              background: palette.tag.background,
              color: palette.tag.color,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            {palette.tag.text}
          </div>
        ) : null}
      </div>
    ),
    {
      ...size,
    }
  )
}
