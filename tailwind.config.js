/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#0a0a0a',
          1: '#111111',
          2: '#1a1a1a',
          3: '#222222',
          4: '#2a2a2a',
          5: '#333333',
        },
        border: '#2a2a2a',
        accent: {
          DEFAULT: '#c8d4e0',
          hover: '#dce6ef',
          dim: '#c8d4e018',
        },
        text: {
          primary: '#f0f0f0',
          secondary: '#888888',
          dim: '#555555',
        },
        status: {
          green: '#22c55e',
          yellow: '#eab308',
          red: '#ef4444',
          blue: '#3b82f6',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': '0.65rem',
        xs: '0.72rem',
      }
    }
  },
  plugins: []
}
