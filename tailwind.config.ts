import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ck: {
          green: '#18A957',
          amber: '#E0A400',
          red: '#D64545',
          slate: '#1D2330'
        }
      },
      keyframes: {
        dash: {
          '0%': { strokeDashoffset: '0' },
          '100%': { strokeDashoffset: '-56' }
        },
        'pulse-once': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.03)' },
          '100%': { transform: 'scale(1)' }
        }
      },
      animation: {
        'pulse-once': 'pulse-once 380ms ease-out 1'
      }
    }
  },
  corePlugins: {
    preflight: false
  }
};

export default config;
